// GET /api/usage
// Everything the usage panel shows, read live from Stripe:
// - usage this billing period for each metered price (from its meter)
// - each price's free allowance (its first $0 tier)
// - the estimated charge (Stripe's own preview of the next invoice)
// - subscription status and the latest invoice status (saved by the webhook)

import { stripe, latestSubscription, meterTotal } from '../lib/stripe.js';
import { customerFromRequest } from '../lib/session.js';

// Price details rarely change; read each once per server instance.
const priceCache = new Map();
async function priceInfo(priceId) {
  if (!priceCache.has(priceId)) {
    const price = await stripe.prices.retrieve(priceId, { expand: ['tiers'] });
    const meter = await stripe.billing.meters.retrieve(price.recurring.meter);
    const first = price.tiers?.[0];
    const free = first && Number(first.unit_amount_decimal || first.unit_amount || 0) === 0 ? first.up_to || 0 : 0;
    const label = price.metadata?.kind === 'input' ? 'Input tokens' : price.metadata?.kind === 'output' ? 'Output tokens' : 'Tokens';
    priceCache.set(priceId, { label, free, eventName: meter.event_name });
  }
  return priceCache.get(priceId);
}

export async function GET(request) {
  const customerId = customerFromRequest(request);
  if (!customerId) return Response.json({ started: false });

  try {
    const [customer, sub] = await Promise.all([stripe.customers.retrieve(customerId), latestSubscription(customerId)]);
    if (customer.deleted || !sub) return Response.json({ started: false });

    // The billing period lives on the subscription items in current API versions.
    const items = sub.items.data;
    const periodStart = items[0].current_period_start;
    const now = Math.floor(Date.now() / 1000);
    const live = ['active', 'trialing', 'past_due'].includes(sub.status);

    const [meters, preview] = await Promise.all([
      Promise.all(
        items.map(async (item) => {
          const info = await priceInfo(item.price.id);
          const used = await meterTotal(customerId, info.eventName, periodStart, now + 60);
          return { label: info.label, used, free: info.free, freeRemaining: Math.max(info.free - used, 0) };
        }),
      ),
      // Stripe's own calculation of the next invoice, so the estimate always
      // matches what Stripe will really bill (tiers, free allowances and all).
      live ? stripe.invoices.createPreview({ customer: customerId, subscription: sub.id }) : null,
    ]);

    const meta = customer.metadata || {};
    return Response.json({
      started: true,
      subscription: {
        status: sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        periodStart,
        periodEnd: items[0].current_period_end,
      },
      meters,
      estimate: preview ? { amountDue: preview.amount_due, currency: preview.currency, invoiceDate: preview.period_end } : null,
      latestInvoice: meta.last_invoice_id
        ? {
            status: meta.last_invoice_status,
            total: Number(meta.last_invoice_total || 0),
            url: meta.last_invoice_url || null,
            at: Number(meta.last_invoice_at || 0),
          }
        : null,
      messagesSent: Number(meta.demo_messages || 0),
      unreportedTokens: Number(meta.unreported_input_tokens || 0) + Number(meta.unreported_output_tokens || 0),
    });
  } catch (err) {
    console.error('usage failed:', err.message);
    return Response.json({ error: 'Could not load usage.' }, { status: 500 });
  }
}
