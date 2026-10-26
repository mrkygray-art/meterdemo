// Revenue leakage check: does Stripe have all the usage we generated?
//
// For every live demo customer, compares our own record (tokens we reported, kept on
// the customer by lib/usage-reporting.js) with what Stripe's meters actually counted,
// and re-sends any usage that couldn't be reported at the time.
//
// In a real company this runs daily (for example as a scheduled job), and before
// month-end so nothing is missing when invoices are finalized.
//
// Run with:  npm run reconcile

import { stripe, PRICES, meterTotal } from '../lib/stripe.js';

const now = Math.floor(Date.now() / 1000);

async function main() {
  const customers = (await stripe.customers.list({ limit: 100 })).data.filter(
    (c) => c.metadata?.app === 'meter-demo' && !c.test_clock,
  );
  const rows = [];

  for (const c of customers) {
    const m = c.metadata;
    const ours = { input: Number(m.reported_input_tokens || 0), output: Number(m.reported_output_tokens || 0) };
    const pending = { input: Number(m.unreported_input_tokens || 0), output: Number(m.unreported_output_tokens || 0) };

    // 1. Re-send usage that failed earlier (one event per meter, idempotent identifier).
    for (const kind of ['input', 'output']) {
      if (!pending[kind]) continue;
      await stripe.billing.meterEvents.create({
        event_name: PRICES[kind].eventName,
        payload: { stripe_customer_id: c.id, value: String(pending[kind]) },
        identifier: `reconcile-${c.id}-${kind}-${now}`,
      });
      ours[kind] += pending[kind];
    }
    if (pending.input || pending.output) {
      await stripe.customers.update(c.id, {
        metadata: {
          reported_input_tokens: String(ours.input),
          reported_output_tokens: String(ours.output),
          unreported_input_tokens: '0',
          unreported_output_tokens: '0',
        },
      });
    }

    // 2. Compare with what Stripe counted since the customer was created.
    const [stripeIn, stripeOut] = await Promise.all([
      meterTotal(c.id, PRICES.input.eventName, c.created, now + 60),
      meterTotal(c.id, PRICES.output.eventName, c.created, now + 60),
    ]);
    rows.push({
      customer: c.id,
      'our input': ours.input,
      'stripe input': stripeIn,
      'our output': ours.output,
      'stripe output': stripeOut,
      resent: pending.input + pending.output,
      status: ours.input === stripeIn && ours.output === stripeOut ? 'matches' : 'CHECK',
    });
  }

  if (!rows.length) return console.log('No live demo customers to check.');
  console.table(rows);
  const off = rows.filter((r) => r.status !== 'matches');
  console.log(
    off.length
      ? `${off.length} customer(s) differ. Usage sent in the last minute or two may still be processing; run again shortly. A gap that stays means usage was lost or double-counted.`
      : 'All usage accounted for: our records match Stripe.',
  );
}

main().catch((err) => {
  console.error('Reconcile failed:', err.message);
  process.exit(1);
});
