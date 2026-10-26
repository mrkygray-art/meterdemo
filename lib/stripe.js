// One shared Stripe client for every API route, plus the pricing setup it relies on.
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

export const PRODUCT_NAME = 'MeterDemo AI Assistant';

// The v2 pricing. Output tokens cost the AI provider 5x more than input tokens,
// so they get their own meter and a higher price. Each has a monthly free allowance.
// Prices are found by lookup key, so they can be changed in Stripe without a deploy.
// (All amounts are scaled up 1,000x from real AI prices so test invoices show
// visible cents. Costs in lib/economics.js use the same scale, so margins are real.)
export const PRICES = {
  input: {
    kind: 'input',
    lookupKey: 'meterdemo_input_tokens_v2',
    nickname: 'Input tokens: 2,000 free, then $0.25 per 1K',
    eventName: 'ai_input_tokens',
    meterName: 'AI input tokens',
    freeTokens: 2000,
    centsPerToken: '0.025', // $0.25 per 1,000 tokens
  },
  output: {
    kind: 'output',
    lookupKey: 'meterdemo_output_tokens_v2',
    nickname: 'Output tokens: 500 free, then $1.00 per 1K',
    eventName: 'ai_output_tokens',
    meterName: 'AI output tokens',
    freeTokens: 500,
    centsPerToken: '0.1', // $1.00 per 1,000 tokens
  },
};

// The v1 meter (all tokens, one price). Still reported so v1 subscriptions keep billing.
export const TOTAL_EVENT_NAME = 'ai_tokens';

// Price IDs for new subscriptions, looked up by key (cached per server instance).
let priceIds = null;
export async function currentPriceIds() {
  if (!priceIds) {
    const keys = Object.values(PRICES).map((p) => p.lookupKey);
    const list = await stripe.prices.list({ lookup_keys: keys, active: true });
    if (list.data.length !== keys.length) throw new Error('v2 prices not found. Run npm run setup:pricing.');
    priceIds = list.data.map((p) => p.id);
  }
  return priceIds;
}

// Meter ID for an event name (cached). Meters are found by name, not hard-coded IDs.
const meterIds = new Map();
export async function meterId(eventName) {
  if (!meterIds.has(eventName)) {
    const meters = await stripe.billing.meters.list({ status: 'active', limit: 100 });
    for (const m of meters.data) meterIds.set(m.event_name, m.id);
  }
  const id = meterIds.get(eventName);
  if (!id) throw new Error(`No active meter for ${eventName}.`);
  return id;
}

// Total usage on one meter for one customer between two times (whole minutes).
export async function meterTotal(customerId, eventName, from, to) {
  const summaries = await stripe.billing.meters.listEventSummaries(await meterId(eventName), {
    customer: customerId,
    start_time: Math.floor(from / 60) * 60,
    end_time: Math.ceil(to / 60) * 60,
  });
  return summaries.data.reduce((sum, s) => sum + s.aggregated_value, 0);
}

// A customer's newest subscription (active or not), or null if they have none.
export async function latestSubscription(customerId) {
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 1 });
  return subs.data[0] || null;
}
