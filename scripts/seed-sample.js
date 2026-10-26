// Builds the read-only sample accounts that visitors can open from the landing page:
// three fictional customers with very different usage, each with 2 paid monthly
// invoices plus the current month in progress, on the v2 input/output pricing.
//
//   Pixel & Pine Studio  - light user, stays inside the free allowance
//   Northwind Labs       - growing team, moderate usage
//   Atlas Robotics       - power user, long code-generation outputs (output-heavy)
//
// They are the evidence for the pricing lab: on a flat $49 plan, Atlas costs more
// than it pays; on input + output pricing every customer has a healthy margin.
//
// How: one Stripe test clock (a pretend calendar; up to 3 customers per clock) starts
// 2 months ago. For each month we move the clock to the last minutes of the month,
// record that month's usage as meter events, then move the clock past month end so
// Stripe issues, finalizes and charges each invoice. Then we fill in the current month.
//
// Stripe rule learned the hard way: for a test-clock customer, meter event timestamps
// are checked against the CLOCK's time, so usage can only be recorded up to "clock now".
//
// Usage is sent pre-aggregated (a few batches per customer per day), which is what
// Stripe recommends for high-volume usage instead of one event per request.
//
// The app finds the samples through metadata on the product, so re-running this
// script swaps in fresh samples with no redeploy. Stripe deletes test clocks 30 days
// after creation, so re-run it every few weeks.
//
// Run with:  npm run seed:sample      (takes about 8-12 minutes)

import { stripe, PRODUCT_NAME, PRICES, currentPriceIds, meterTotal } from '../lib/stripe.js';

const CUSTOMERS = [
  {
    key: 'light',
    name: 'Pixel & Pine Studio',
    email: 'billing@pixelpine.example',
    profile: 'Light user: a two-person design studio that asks a few questions a week.',
    monthlyTokens: [1600, 1900],
    currentPace: 1800,
    outputShare: 0.2,
  },
  {
    key: 'growing',
    name: 'Northwind Labs',
    email: 'billing@northwind-labs.example',
    profile: 'Growing team: a 12-person startup using the assistant daily for support replies.',
    monthlyTokens: [38400, 46900],
    currentPace: 52000,
    outputShare: 0.22,
  },
  {
    key: 'power',
    name: 'Atlas Robotics',
    email: 'billing@atlas-robotics.example',
    profile: 'Power user: an engineering team generating long code and reports (output-heavy).',
    monthlyTokens: [298000, 352000],
    currentPace: 380000,
    outputShare: 0.4,
  },
];
const MONTHS = CUSTOMERS[0].monthlyTokens.length;

const DAY = 86400;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const minute = (t) => Math.floor(t / 60) * 60;

// Small seeded random generator so the samples look the same every time they're rebuilt.
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

// Spread a period's tokens over its days (weekdays busier than weekends), in 1-4
// batches per day, each split into input and output tokens.
function planUsage(from, to, totalTokens, outputShare) {
  const days = [];
  for (let t = from; t + 3600 < to; t += DAY) {
    const weekday = new Date(t * 1000).getUTCDay();
    days.push({ start: t, weight: (weekday === 0 || weekday === 6 ? 0.35 : 1) * (0.7 + rand() * 0.6) });
  }
  const sum = days.reduce((a, d) => a + d.weight, 0);
  const batches = [];
  for (const d of days) {
    let dayTokens = Math.round((totalTokens * d.weight) / sum);
    const n = 1 + Math.floor(rand() * 4);
    for (let b = 0; b < n && dayTokens > 0; b++) {
      const tokens = b === n - 1 ? dayTokens : Math.round((dayTokens / (n - b)) * (0.6 + rand() * 0.8));
      const offset = Math.floor(rand() * Math.max(60, Math.min(DAY - 3600, to - d.start - 3600)));
      const output = Math.round(tokens * outputShare * (0.8 + rand() * 0.4));
      batches.push({ timestamp: minute(d.start + 1800 + offset), input: Math.max(tokens - output, 0), output });
      dayTokens -= tokens;
    }
  }
  // Keep every event before the clock's current time (the clock sits 15 minutes before `to`).
  return batches.filter((b) => b.timestamp < to - 900).sort((a, b) => a.timestamp - b.timestamp);
}

// Send one customer's batches: input and output meters in parallel (Stripe allows one
// concurrent event per customer per meter), then wait until Stripe has counted them.
async function recordUsage(customer, batches, from, to) {
  const send = async (kind) => {
    for (const [i, b] of batches.entries()) {
      if (!b[kind]) continue;
      await stripe.billing.meterEvents.create({
        event_name: PRICES[kind].eventName,
        payload: { stripe_customer_id: customer.id, value: String(b[kind]) },
        timestamp: b.timestamp,
        identifier: `${customer.id}-${kind}-${b.timestamp}-${i}`,
      });
    }
  };
  await Promise.all([send('input'), send('output')]);

  const expected = { input: 0, output: 0 };
  for (const b of batches) (expected.input += b.input), (expected.output += b.output);
  for (let tries = 0; ; tries++) {
    await wait(10000);
    const [inp, out] = await Promise.all([
      meterTotal(customer.id, PRICES.input.eventName, from, to + 60),
      meterTotal(customer.id, PRICES.output.eventName, from, to + 60),
    ]);
    if (inp >= expected.input && out >= expected.output) break;
    if (tries > 30) throw new Error(`${customer.name}: Stripe counted ${inp}/${out} of ${expected.input}/${expected.output} after 5 minutes.`);
  }
  return expected;
}

async function recordAll(customers, plans, from, to, label) {
  const results = await Promise.all(customers.map((c, i) => recordUsage(c, plans[i], from, to)));
  const line = results.map((r, i) => `${customers[i].name}: ${(r.input + r.output).toLocaleString()} (${r.output.toLocaleString()} out)`).join(' | ');
  console.log(`  ${label}: ${line}`);
}

// A portal configuration for the samples: invoice history only. Visitors can't cancel
// a sample or change its card.
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
  const products = await stripe.products.list({ active: true, limit: 100 });
  const product = products.data.find((p) => p.name === PRODUCT_NAME);
  const previousClock = product.metadata.sample_clock_id;
  const prices = await currentPriceIds();

  // Start MONTHS months and 12 days ago, so after the full months the clock is ~12 days
  // into the current month, and we fill those days in at the end.
  const start = new Date();
  start.setUTCMonth(start.getUTCMonth() - MONTHS);
  start.setUTCDate(start.getUTCDate() - 12);
  start.setUTCHours(9, 0, 0, 0);
  const startTime = Math.floor(start.getTime() / 1000);

  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: startTime, name: 'MeterDemo sample accounts' });
  const customers = [];
  let sub;
  for (const c of CUSTOMERS) {
    const customer = await stripe.customers.create({
      name: `${c.name} (sample)`,
      email: c.email,
      description: c.profile,
      test_clock: clock.id,
      metadata: { app: 'meter-demo', sample: c.key, profile: c.profile },
    });
    const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id }); // Stripe's 4242 test card
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
    sub = await stripe.subscriptions.create({ customer: customer.id, items: prices.map((price) => ({ price })) });
    customers.push(customer);
  }
  console.log(`Clock ${clock.id}; customers ${customers.map((c) => c.id).join(', ')}`);
  console.log(`Starting ${start.toDateString()}`);

  // All three subscriptions start at the same clock time, so they share billing periods.
  for (let m = 0; m < MONTHS; m++) {
    const item = sub.items.data[0];
    const from = item.current_period_start;
    const to = item.current_period_end;
    await advanceClock(clock.id, to - 900); // last 15 minutes of the month
    const plans = CUSTOMERS.map((c) => planUsage(from, to, c.monthlyTokens[m], c.outputShare));
    await recordAll(customers, plans, from, to, new Date(from * 1000).toISOString().slice(0, 7));
    await advanceClock(clock.id, to + 2 * 3600); // past month end: invoices issued, finalized, paid
    sub = await stripe.subscriptions.retrieve(sub.id);
  }

  // The current, unfinished month: usage up to (real) today.
  const item = sub.items.data[0];
  const from = item.current_period_start;
  const nowish = Math.min(minute(Math.floor(Date.now() / 1000)) - 600, item.current_period_end - 3600);
  if (nowish > from + DAY) {
    await advanceClock(clock.id, nowish);
    const share = (nowish - from) / (item.current_period_end - from);
    const plans = CUSTOMERS.map((c) => planUsage(from, nowish, Math.round(c.currentPace * share), c.outputShare));
    await recordAll(customers, plans, from, nowish, 'current month');
  }

  const portalConfig = await samplePortalConfig(product.metadata.sample_portal_config);
  await stripe.products.update(product.id, {
    metadata: {
      sample_customer_ids: customers.map((c) => c.id).join(','),
      sample_customer_id: customers[1].id, // v1 single-sample key, kept for older deployments
      sample_clock_id: clock.id,
      sample_portal_config: portalConfig,
      sample_generated_at: String(Math.floor(Date.now() / 1000)),
    },
  });
  console.log(`\nSample accounts ready (portal config ${portalConfig})`);

  // Remove the previous samples (deleting a test clock deletes its customers too).
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
