// POST /api/webhook
// Stripe calls this when billing events happen (an invoice is paid, a payment
// fails, a subscription starts or ends).
//
// There's no database, so we save the latest status onto the Stripe customer
// itself (as metadata). The usage panel reads it back from there.

import { stripe } from '../lib/stripe.js';

export async function POST(request) {
  // Signature check: proves the request really came from Stripe.
  // It must use the RAW body text, exactly as sent. Parsing it as JSON first
  // would change it slightly and the check would fail.
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('webhook signature check failed:', err.message);
    return new Response('Bad signature', { status: 400 });
  }

  try {
    const obj = event.data.object;
    const now = String(Math.floor(Date.now() / 1000));

    // Test-clock simulations (the sample account, simulate-invoice) are read straight
    // from Stripe, and Stripe blocks customer edits while a clock is moving. Skip them.
    if (obj.test_clock) return Response.json({ received: true, skipped: 'test clock' });

    switch (event.type) {
      case 'invoice.paid':
      case 'invoice.payment_failed':
        await stripe.customers.update(obj.customer, {
          metadata: {
            last_invoice_id: obj.id,
            last_invoice_status: event.type === 'invoice.paid' ? 'paid' : 'payment_failed',
            last_invoice_total: String(obj.total), // in cents
            last_invoice_url: obj.hosted_invoice_url || '',
            last_invoice_at: now,
          },
        });
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.deleted':
        await stripe.customers.update(obj.customer, {
          metadata: { subscription_status: obj.status, subscription_status_at: now },
        });
        break;

      default:
        // Not an event this demo uses. Still answer 200 so Stripe doesn't retry.
        break;
    }
  } catch (err) {
    // A 500 tells Stripe to retry later.
    console.error(`webhook handling failed for ${event.type}:`, err.message);
    return new Response('Handler error', { status: 500 });
  }

  return Response.json({ received: true });
}
