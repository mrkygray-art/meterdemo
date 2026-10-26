// Loads the read-only sample customers (built by scripts/seed-sample.js) with
// everything the sample page and pricing lab need, read live from Stripe:
// invoices, real Stripe fees, AI cost from the input/output meters, daily usage
// and the current month's invoice preview.
// Their IDs live in metadata on the product, so re-seeding needs no redeploy.

import { stripe, PRODUCT_NAME, PRICES, meterId, meterTotal, latestSubscription } from './stripe.js';
import { margin, BILLING_PERCENT, MIN_CHARGE_CENTS } from './economics.js';

const CACHE_MS = 5 * 60 * 1000; // samples change rarely; spare Stripe repeat calls
let cache = { at: 0, data: null };

const dayFloor = (t) => Math.floor(t / 86400) * 86400;

export async function sampleIds() {
  const products = await stripe.products.list({ active: true, limit: 100 });
  const m = products.data.find((p) => p.name === PRODUCT_NAME)?.metadata || {};
  const ids = (m.sample_customer_ids || '').split(',').filter(Boolean);
  if (!ids.length) return null;
  return { customerIds: ids, clockId: m.sample_clock_id, portalConfig: m.sample_portal_config };
}

// The card fee Stripe actually charged on a paid invoice, plus the 0.7% Billing fee.
async function invoiceFees(invoice) {
  const billing = Math.round(invoice.total * BILLING_PERCENT);
  if (invoice.status !== 'paid' || invoice.amount_paid < MIN_CHARGE_CENTS) return billing;
  const payments = await stripe.invoicePayments.list({ invoice: invoice.id, status: 'paid', limit: 1 });
  const piId = payments.data[0]?.payment?.payment_intent;
  if (!piId) return billing;
  const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge.balance_transaction'] });
  return (pi.latest_charge?.balance_transaction?.fee || 0) + billing;
}

async function usageBetween(customerId, from, to) {
  const [input, output] = await Promise.all([
    meterTotal(customerId, PRICES.input.eventName, from, to),
    meterTotal(customerId, PRICES.output.eventName, from, to),
  ]);
  return { input, output };
}

async function dailyUsage(customerId, from, to) {
  const get = async (eventName) =>
    stripe.billing.meters
      .listEventSummaries(await meterId(eventName), {
        customer: customerId,
        start_time: dayFloor(from),
        end_time: dayFloor(to) + 86400,
        value_grouping_window: 'day',
        limit: 100,
      })
      .autoPagingToArray({ limit: 1000 });
  const [inp, out] = await Promise.all([get(PRICES.input.eventName), get(PRICES.output.eventName)]);
  const days = new Map();
  for (const d of inp) days.set(d.start_time, { day: d.start_time, input: d.aggregated_value, output: 0 });
  for (const d of out) {
    const row = days.get(d.start_time) || { day: d.start_time, input: 0, output: 0 };
    row.output = d.aggregated_value;
    days.set(d.start_time, row);
  }
  return [...days.values()].sort((a, b) => a.day - b.day);
}

async function loadCustomer(customerId, asOf) {
  const [customer, sub, invoices] = await Promise.all([
    stripe.customers.retrieve(customerId),
    latestSubscription(customerId),
    stripe.invoices.list({ customer: customerId, limit: 30 }),
  ]);
  if (customer.deleted || !sub) return null;
  const item = sub.items.data[0];

  // Monthly invoices (billing_reason "subscription_cycle" = the end-of-month usage bill).
  const monthly = await Promise.all(
    invoices.data
      .filter((inv) => inv.billing_reason === 'subscription_cycle')
      .map(async (inv) => {
        const period = inv.lines.data[0]?.period || { start: inv.period_start, end: inv.period_end };
        const [usage, fees] = await Promise.all([usageBetween(customerId, period.start, period.end), invoiceFees(inv)]);
        return {
          number: inv.number,
          periodStart: period.start,
          periodEnd: period.end,
          usage,
          status: inv.status,
          url: inv.hosted_invoice_url,
          pdf: inv.invoice_pdf,
          ...margin(inv.total, usage, fees),
        };
      }),
  );
  monthly.sort((a, b) => a.periodStart - b.periodStart);

  const [currentUsage, preview, days] = await Promise.all([
    usageBetween(customerId, item.current_period_start, asOf + 60),
    stripe.invoices.createPreview({ customer: customerId, subscription: sub.id }),
    dailyUsage(customerId, sub.start_date, asOf),
  ]);

  return {
    key: customer.metadata.sample,
    name: customer.name.replace(/\s*\(sample\)$/i, ''),
    profile: customer.metadata.profile || customer.description,
    invoices: monthly,
    days,
    current: {
      periodStart: item.current_period_start,
      periodEnd: item.current_period_end,
      usage: currentUsage,
      estimate: preview.amount_due,
      ...margin(preview.amount_due, currentUsage),
    },
  };
}

export async function loadSamples() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const ids = await sampleIds();
  if (!ids) return { available: false };
  const clock = await stripe.testHelpers.testClocks.retrieve(ids.clockId);
  const customers = (await Promise.all(ids.customerIds.map((id) => loadCustomer(id, clock.frozen_time)))).filter(Boolean);
  const data = { available: customers.length > 0, asOf: clock.frozen_time, customers };
  cache = { at: Date.now(), data };
  return data;
}
