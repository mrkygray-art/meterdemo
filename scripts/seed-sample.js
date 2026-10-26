// Builds the read-only "sample account" that visitors can open from the landing page:
// a fictional customer with 2 months of chat usage and 2 paid monthly invoices,
// plus the current month in progress.
//
// How: a Stripe test clock (a pretend calendar for one test customer) starts 2 months
// ago. For each month we move the clock to the last minutes of that month, record
// that month's daily usage as meter events, then move the clock past month end so
// Stripe issues, finalizes and charges the invoice. Finally we fill in the current
// month up to today.
//
// Stripe rule learned the hard way: for a test-clock customer, meter event timestamps
// are checked against the CLOCK's time, so usage can only be recorded up to "clock now".
//
// The app finds the sample through metadata on the product (sample_customer_id), so
// re-running this script swaps in a fresh sample with no redeploy.
// Stripe deletes test clocks 30 days after creation, so re-run it every few weeks.
//
// Run with:  npm run seed:sample      (takes about 5-8 minutes)

import { stripe, PRICE_ID, METER_ID, METER_EVENT_NAME } from '../lib/stripe.js';

// Tokens per completed month, oldest first. Add numbers here for more history
// (each month adds about 2 minutes to the run).
const MONTHLY_TOKENS = [38400, 46900];
const MONTHS = MONTHLY_TOKENS.length;
const CURRENT_MONTH_PACE = 52000; // the in-progress month continues at roughly this pace

const DAY = 86400;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const minute = (t) => Math.floor(t / 60) * 60;

// Small seeded random generator so the sample looks the same every time it's rebuilt.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = seeded(20261026);

async function advanceClock(clockId, to) {
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: to });
  for (;;) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === 'ready') return;
    if (clock.status === 'internal_failure') throw new Error('Test clock failed to advance.');
    await wait(3000);
  }
}

// Split a month's tokens into chat replies spread over its days.
// Weekdays are busier than weekends; each day has 1-6 replies.
function planUsage(from, to, totalTokens) {
  const days = [];
  for (let t = from; t + 3600 < to; t += DAY) {
    const weekday = new Date(t * 1000).getUTCDay();
    const weight = (weekday === 0 || weekday === 6 ? 0.35 : 1) * (0.7 + rand() * 0.6);
    days.push({ start: t, weight });
  }
  const sum = days.reduce((a, d) => a + d.weight, 0);
  const events = [];
  for (const d of days) {
    let dayTokens = Math.round((totalTokens * d.weight) / sum);
    const replies = 1 + Math.floor(rand() * 6);
    for (let r = 0; r < replies && dayTokens > 0; r++) {
      const tokens = r === replies - 1 ? dayTokens : Math.round((dayTokens / (replies - r)) * (0.6 + rand() * 0.8));
      const offset = Math.floor(rand() * Math.max(60, Math.min(DAY - 3600, to - d.start - 3600)));
      events.push({ timestamp: d.start + 1800 + offset - (offset % 60), tokens: Math.max(tokens, 1) });
      dayTokens -= tokens;
    }
  }
  // Keep every event before the clock's current time (the clock sits 15 minutes before `to`).
  return events.filter((e) => e.timestamp < to - 900).sort((a, b) => a.timestamp - b.timestamp);
}

async function recordUsage(customerId, events, from, to, label) {
  // One at a time: Stripe allows one concurrent meter event per customer per meter.
  for (const [i, e] of events.entries()) {
    await stripe.billing.meterEvents.create({
      event_name: METER_EVENT_NAME,
      payload: { stripe_customer_id: customerId, value: String(e.tokens) },
      timestamp: e.timestamp,
      identifier: `${customerId}-${e.timestamp}-${i}`,
    });
  }
  const expected = events.reduce((a, e) => a + e.tokens, 0);
  // Wait until Stripe has processed them, so they land on the right invoice.
  for (let tries = 0; ; tries++) {
    await wait(10000);
    const s = await stripe.billing.meters.listEventSummaries(METER_ID, {
      customer: customerId,
      start_time: minute(from),
      end_time: minute(to) + 60,
    });
    const counted = s.data.reduce((a, x) => a + x.aggregated_value, 0);
    if (counted >= expected) break;
    if (tries > 30) throw new Error(`${label}: Stripe counted ${counted} of ${expected} tokens after 5 minutes.`);
  }
  console.log(`  ${label}: ${events.length} replies, ${expected.toLocaleString()} tokens`);
}

// A portal configuration for the sample: invoice history only. Visitors can't cancel
// the sample or change its card.
async function samplePortalConfig(existingId) {
  if (existingId) {
    try {
      const cfg = await stripe.billingPortal.configurations.retrieve(existingId);
      if (cfg.active) return cfg.id;
    } catch {}
  }
  const cfg = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'MeterDemo sample account (read-only, test mode)' },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: false },
      customer_update: { enabled: false },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
    },
  });
  return cfg.id;
}

async function main() {
  const price = await stripe.prices.retrieve(PRICE_ID);
  const product = await stripe.products.retrieve(price.product);
  const previousClock = product.metadata.sample_clock_id;

  // Start MONTHS months and 12 days ago, so after the full months the clock is ~12 days
  // into the current month, and we fill those days in at the end.
  const start = new Date();
  start.setUTCMonth(start.getUTCMonth() - MONTHS);
  start.setUTCDate(start.getUTCDate() - 12);
  start.setUTCHours(9, 0, 0, 0);
  const startTime = Math.floor(start.getTime() / 1000);

  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: startTime, name: 'MeterDemo sample account' });
  const customer = await stripe.customers.create({
    name: 'Northwind Labs (sample)',
    email: 'billing@northwind-labs.example',
    description: 'Fictional sample customer for the MeterDemo portfolio demo',
    test_clock: clock.id,
    metadata: { app: 'meter-demo', sample: 'true' },
  });
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id }); // Stripe's 4242 test card
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  let sub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: PRICE_ID }] });
  console.log(`Clock ${clock.id}, customer ${customer.id}, subscription ${sub.id}`);
  console.log(`Starting ${start.toDateString()}`);

  for (let m = 0; m < MONTHS; m++) {
    const item = sub.items.data[0];
    const from = item.current_period_start;
    const to = item.current_period_end;
    await advanceClock(clock.id, to - 900); // last 15 minutes of the month
    await recordUsage(customer.id, planUsage(from, to, MONTHLY_TOKENS[m]), from, to, new Date(from * 1000).toISOString().slice(0, 7));
    await advanceClock(clock.id, to + 2 * 3600); // past month end: invoice issued, finalized, paid
    sub = await stripe.subscriptions.retrieve(sub.id);
  }

  // The current, unfinished month: usage up to (real) today.
  const item = sub.items.data[0];
  const from = item.current_period_start;
  const nowish = Math.min(minute(Math.floor(Date.now() / 1000)) - 600, item.current_period_end - 3600);
  if (nowish > from + DAY) {
    await advanceClock(clock.id, nowish);
    const elapsedShare = (nowish - from) / (item.current_period_end - from);
    await recordUsage(customer.id, planUsage(from, nowish, Math.round(CURRENT_MONTH_PACE * elapsedShare)), from, nowish, 'current month');
  }

  const portalConfig = await samplePortalConfig(product.metadata.sample_portal_config);
  await stripe.products.update(product.id, {
    metadata: {
      sample_customer_id: customer.id,
      sample_clock_id: clock.id,
      sample_portal_config: portalConfig,
      sample_generated_at: String(Math.floor(Date.now() / 1000)),
    },
  });
  console.log(`\nSample account ready: ${customer.id} (portal config ${portalConfig})`);

  // Remove the previous sample (deleting a test clock deletes its customer too).
  if (previousClock && previousClock !== clock.id) {
    try {
      await stripe.testHelpers.testClocks.del(previousClock);
      console.log(`Deleted previous sample clock ${previousClock}`);
    } catch (err) {
      console.log(`Previous sample clock already gone (${err.message})`);
    }
  }
}

main().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
