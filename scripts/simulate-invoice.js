// Produces a real, finalized usage invoice without waiting a month.
//
// Stripe "test clocks" let a test customer live on a pretend calendar. We:
//   1. start a clock at today's date and put a new customer on it
//   2. subscribe them to the metered price (card 4242 via Stripe's test token)
//   3. record a month of chat usage as meter events
//   4. move the clock past the end of the month -> Stripe creates the invoice
//   5. move it 2 more hours -> Stripe finalizes the invoice and charges the test card
//
// Run with:  npm run simulate:invoice
// Test clocks only exist in sandboxes/test mode. Stripe deletes them after 30 days,
// or delete one sooner in the Dashboard (Billing > Subscriptions > Simulations).

import { stripe, PRICE_ID, METER_ID, METER_EVENT_NAME } from '../lib/stripe.js';

// A month of chat replies (tokens per reply), similar to what the live demo meters.
const REPLY_TOKENS = [412, 655, 388, 902, 540, 731, 466, 820, 610, 395, 770, 512, 688, 459, 905, 534, 618, 497];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const minute = (t) => Math.floor(t / 60) * 60;

async function waitForClock(clockId) {
  for (;;) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === 'ready') return clock;
    if (clock.status === 'internal_failure') throw new Error('Test clock failed to advance.');
    await wait(3000);
  }
}

async function main() {
  const now = Math.floor(Date.now() / 1000);

  // 1. Clock + customer
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: now, name: 'MeterDemo monthly invoice' });
  const customer = await stripe.customers.create({
    name: 'Avery Demo (test clock)',
    email: 'avery.demo@example.com',
    test_clock: clock.id,
    metadata: { app: 'meter-demo', simulation: 'true' },
  });
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id }); // Stripe's 4242 test card
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  console.log(`Clock ${clock.id}, customer ${customer.id}`);

  // 2. Subscription to the metered price
  const sub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: PRICE_ID }] });
  const periodEnd = sub.items.data[0].current_period_end;
  console.log(`Subscription ${sub.id} (${sub.status}), period ends ${new Date(periodEnd * 1000).toDateString()}`);

  // 3. Usage: one meter event per chat reply (sent one at a time; Stripe allows one
  //    concurrent meter event per customer per meter).
  const total = REPLY_TOKENS.reduce((a, b) => a + b, 0);
  for (const [i, tokens] of REPLY_TOKENS.entries()) {
    await stripe.billing.meterEvents.create({
      event_name: METER_EVENT_NAME,
      payload: { stripe_customer_id: customer.id, value: String(tokens) },
      identifier: `${customer.id}-reply-${i + 1}`,
    });
  }
  console.log(`Sent ${REPLY_TOKENS.length} meter events, ${total.toLocaleString()} tokens`);

  // Meter events are processed in the background; wait until Stripe has counted them all
  // so they land on this month's invoice.
  process.stdout.write('Waiting for Stripe to process usage');
  for (let counted = 0; counted < total; ) {
    await wait(10000);
    const s = await stripe.billing.meters.listEventSummaries(METER_ID, {
      customer: customer.id,
      start_time: minute(now),
      end_time: minute(Math.floor(Date.now() / 1000)) + 120,
    });
    counted = s.data.reduce((a, x) => a + x.aggregated_value, 0);
    process.stdout.write('.');
  }
  console.log(' done');

  // 4. Jump to the end of the billing month: Stripe creates the usage invoice (as a draft)
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: periodEnd + 60 });
  await waitForClock(clock.id);
  // 5. Two hours later: the draft is finalized and the test card is charged
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: periodEnd + 2 * 3600 });
  await waitForClock(clock.id);

  const invoices = await stripe.invoices.list({ subscription: sub.id, limit: 5 });
  const usageInvoice = invoices.data.find((inv) => inv.billing_reason === 'subscription_cycle');
  if (!usageInvoice) throw new Error('No monthly invoice found yet. Check Simulations in the Dashboard.');

  console.log('\nMonthly usage invoice');
  console.log(`  ${usageInvoice.id}  number ${usageInvoice.number}  status ${usageInvoice.status}`);
  // Graduated pricing shows one line per tier (the free tokens, then the paid ones).
  for (const line of usageInvoice.lines.data) {
    console.log(`  ${line.description}: $${(line.amount / 100).toFixed(2)}`);
  }
  console.log(`  total: $${(usageInvoice.total / 100).toFixed(2)}`);
  console.log(`  hosted invoice: ${usageInvoice.hosted_invoice_url}`);
  console.log(`  PDF: ${usageInvoice.invoice_pdf}`);
}

main().catch((err) => {
  console.error('Simulation failed:', err.message);
  process.exit(1);
});
