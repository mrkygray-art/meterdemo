// POST /api/create-checkout-session
// Starts the demo: creates a Stripe customer, then a Stripe Checkout page
// where the visitor subscribes with the 4242 test card.

import { stripe, currentPriceIds } from '../lib/stripe.js';

export async function POST(request) {
  try {
    const origin = new URL(request.url).origin;

    // A fresh customer for each demo visitor. Stripe is our only "database".
    const customer = await stripe.customers.create({
      name: 'MeterDemo visitor',
      metadata: { app: 'meter-demo' },
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', // sign up for a recurring plan, not a one-off payment
      customer: customer.id,
      // Two metered prices (input and output tokens), found by lookup key.
      // Metered prices have no quantity: the amount depends on usage, which
      // Stripe adds up from meter events and bills at the end of the month.
      line_items: (await currentPriceIds()).map((price) => ({ price })),
      // Stripe swaps {CHECKOUT_SESSION_ID} for the real ID when it redirects back.
      success_url: `${origin}/api/checkout-complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
    });

    return Response.json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session failed:', err.message);
    return Response.json({ error: 'Could not start Checkout. Try again.' }, { status: 500 });
  }
}
