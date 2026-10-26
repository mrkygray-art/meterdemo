// One shared Stripe client for every API route.
//
// Hard rule: this demo runs in TEST MODE only. If someone ever pastes a live
// key, every route refuses to start instead of touching real money.

import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY || '';

if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) {
  throw new Error('Live Stripe key detected. MeterDemo only runs with TEST keys (sk_test_...). Refusing to start.');
}
if (!key.startsWith('sk_test_')) {
  throw new Error('STRIPE_SECRET_KEY is missing or not a test key (sk_test_...).');
}

export const stripe = new Stripe(key);

// IDs created during setup (see README, step 1).
export const PRICE_ID = process.env.STRIPE_PRICE_ID;
export const METER_ID = process.env.STRIPE_METER_ID;
export const METER_EVENT_NAME = process.env.STRIPE_METER_EVENT_NAME || 'ai_tokens';

// A customer's newest subscription (active or not), or null if they have none.
export async function latestSubscription(customerId) {
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 1 });
  return subs.data[0] || null;
}
