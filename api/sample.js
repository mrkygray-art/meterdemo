// GET /api/sample
// Everything the sample account page shows, read live from Stripe: 12 months of
// paid invoices, daily usage from the meter, and the current month's estimate.
// The sample customer lives on a Stripe test clock, so "today" is the clock's date.

import { stripe, METER_ID, latestSubscription } from '../lib/stripe.js';
import { sampleIds } from '../lib/sample.js';

const CACHE_MS = 5 * 60 * 1000; // the sample changes rarely; spare Stripe repeat calls
let cache = { at: 0, data: null };

const dayFloor = (t) => Math.floor(t / 86400) * 86400;

async function build() {
  const ids = await sampleIds();
  if (!ids) return { available: false };

  const [customer, sub, clock, invoices] = await Promise.all([
    stripe.customers.retrieve(ids.customerId),
    latestSubscription(ids.customerId),
    stripe.testHelpers.testClocks.retrieve(ids.clockId),
    stripe.invoices.list({ customer: ids.customerId, limit: 30 }),
  ]);
  if (customer.deleted || !sub) return { available: false };

  const item = sub.items.data[0];
  const asOf = clock.frozen_time;

  // Monthly invoices (billing_reason "subscription_cycle" = the end-of-month usage bill).
  const monthly = invoices.data
    .filter((inv) => inv.billing_reason === 'subscription_cycle')
    .map((inv) => {
      const lines = inv.lines.data;
      const tokens = lines.reduce((a, l) => a + (l.quantity || 0), 0);
      const free = lines.filter((l) => l.amount === 0).reduce((a, l) => a + (l.quantity || 0), 0);
      return {
        number: inv.number,
        periodStart: lines[0]?.period?.start ?? inv.period_start,
        periodEnd: lines[0]?.period?.end ?? inv.period_end,
        tokens,
        freeTokens: free,
        paidTokens: tokens - free,
        amount: inv.total,
        status: inv.status,
        url: inv.hosted_invoice_url,
        pdf: inv.invoice_pdf,
      };
    })
    .sort((a, b) => a.periodStart - b.periodStart);

  // Daily usage from the meter. Daily summaries need whole UTC days.
  const daily = await stripe.billing.meters
    .listEventSummaries(METER_ID, {
      customer: ids.customerId,
      start_time: dayFloor(sub.start_date),
      end_time: dayFloor(asOf) + 86400,
      value_grouping_window: 'day',
      limit: 100,
    })
    .autoPagingToArray({ limit: 1000 });

  const days = daily.map((d) => ({ day: d.start_time, tokens: d.aggregated_value })).sort((a, b) => a.day - b.day);
  const tokensThisPeriod = days.filter((d) => d.day >= dayFloor(item.current_period_start)).reduce((a, d) => a + d.tokens, 0);

  const preview = await stripe.invoices.createPreview({ customer: ids.customerId, subscription: sub.id });

  return {
    available: true,
    customer: { name: customer.name },
    asOf,
    subscription: { status: sub.status, periodStart: item.current_period_start, periodEnd: item.current_period_end },
    current: { tokens: tokensThisPeriod, estimate: preview.amount_due, currency: preview.currency },
    invoices: monthly,
    days,
  };
}

export async function GET() {
  try {
    if (!cache.data || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), data: await build() };
    return Response.json(cache.data);
  } catch (err) {
    console.error('sample failed:', err.message);
    return Response.json({ error: 'Could not load the sample account.' }, { status: 500 });
  }
}
