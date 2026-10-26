// GET /api/usage
// Everything the usage panel shows, read live from Stripe:
// - tokens used this billing period (from the meter)
// - the free allowance (from the price's first tier)
// - the estimated charge (Stripe's own preview of the next invoice)
// - subscription status and the latest invoice status (saved by the webhook)

import { stripe, PRICE_ID, METER_ID, latestSubscription } from '../lib/stripe.js';
import { customerFromRequest } from '../lib/session.js';

// The free allowance is the first price tier if it costs $0. Read once, then reuse.
let freeAllowance = null;
async function getFreeAllowance() {
  if (freeAllowance === null) {
    const price = await stripe.prices.retrieve(PRICE_ID, { expand: ['tiers'] });
    const first = price.tiers?.[0];
    freeAllowance = first && Number(first.unit_amount_decimal || first.unit_amount || 0) === 0 ? first.up_to || 0 : 0;
  }
  return freeAllowance;
}

// Meter summaries need start/end times on whole minutes.
const floorMinute = (t) => Math.floor(t / 60) * 60;
const ceilMinute = (t) => Math.ceil(t / 60) * 60;

async function tokensThisPeriod(customerId, periodStart) {
  const summaries = await stripe.billing.meters.listEventSummaries(METER_ID, {
    customer: customerId,
    start_time: floorMinute(periodStart),
    end_time: ceilMinute(Math.floor(Date.now() / 1000) + 60),
  });
  return summaries.data.reduce((sum, s) => sum + s.aggregated_value, 0);
}

export async function GET(request) {
  const customerId = customerFromRequest(request);
  if (!customerId) return Response.json({ started: false });

  try {
    const [customer, sub, allowance] = await Promise.all([
      stripe.customers.retrieve(customerId),
      latestSubscription(customerId),
      getFreeAllowance(),
    ]);
    if (customer.deleted || !sub) return Response.json({ started: false });

    // The billing period lives on the subscription item in current API versions.
    const item = sub.items.data[0];
    const live = ['active', 'trialing', 'past_due'].includes(sub.status);

    const [tokensUsed, preview] = await Promise.all([
      tokensThisPeriod(customerId, item.current_period_start),
      // Stripe's own calculation of the next invoice, so the estimate always
      // matches what Stripe will really bill (tiers, free allowance and all).
      live ? stripe.invoices.createPreview({ customer: customerId, subscription: sub.id }) : null,
    ]);

    const meta = customer.metadata || {};
    return Response.json({
      started: true,
      subscription: {
        status: sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        periodStart: item.current_period_start,
        periodEnd: item.current_period_end,
      },
      tokensUsed,
      freeAllowance: allowance,
      freeRemaining: Math.max(allowance - tokensUsed, 0),
      estimate: preview
        ? { amountDue: preview.amount_due, currency: preview.currency, invoiceDate: preview.period_end }
        : null,
      latestInvoice: meta.last_invoice_id
        ? {
            status: meta.last_invoice_status,
            total: Number(meta.last_invoice_total || 0),
            url: meta.last_invoice_url || null,
            at: Number(meta.last_invoice_at || 0),
          }
        : null,
      messagesSent: Number(meta.demo_messages || 0),
    });
  } catch (err) {
    console.error('usage failed:', err.message);
    return Response.json({ error: 'Could not load usage.' }, { status: 500 });
  }
}
