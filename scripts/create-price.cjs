// One-time setup: creates the metered, tiered price for MeterDemo.
// Used instead of the Dashboard "Add price" form, which would not save.
//
// Run with:  npm run setup:price
// Needs in .env:  STRIPE_SECRET_KEY (sk_test_...)
// STRIPE_METER_ID is optional: if it is blank or a placeholder, the script
// finds the meter by its event name (ai_tokens) and prints the ID.

const Stripe = require('stripe');

const PRODUCT_NAME = 'MeterDemo AI Assistant';
const EVENT_NAME = process.env.STRIPE_METER_EVENT_NAME || 'ai_tokens';

const key = process.env.STRIPE_SECRET_KEY || '';
let meterId = process.env.STRIPE_METER_ID || '';
if (meterId.includes('replace_me')) meterId = '';

// Hard rule: test mode only. Stop before touching anything if this is a live key.
if (!key.startsWith('sk_test_')) {
  console.error('STRIPE_SECRET_KEY must be a TEST key (starts with sk_test_). Stopping.');
  process.exit(1);
}
// Catch the placeholder value copied from .env.example.
if (key.includes('replace_me')) {
  console.error('.env still has the placeholder STRIPE_SECRET_KEY. Paste your real sk_test_ key, save, and run again.');
  process.exit(1);
}

const stripe = new Stripe(key);

async function main() {
  // Find the meter by event name if no meter ID was given.
  if (!meterId) {
    const meters = await stripe.billing.meters.list({ status: 'active', limit: 100 });
    const meter = meters.data.find((m) => m.event_name === EVENT_NAME);
    if (!meter) throw new Error(`No active meter with event name "${EVENT_NAME}". Create it in the Dashboard first.`);
    meterId = meter.id;
    console.log(`Found meter ${meterId} (event name ${EVENT_NAME})`);
  }

  // Reuse the product you already made in the Dashboard; create it only if it is missing.
  const products = await stripe.products.list({ active: true, limit: 100 });
  let product = products.data.find((p) => p.name === PRODUCT_NAME);
  if (!product) {
    product = await stripe.products.create({ name: PRODUCT_NAME });
    console.log(`Created product ${product.id}`);
  } else {
    console.log(`Using existing product ${product.id}`);
  }

  // The price: what each token costs, and how Stripe should count them.
  const price = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    nickname: 'AI tokens - 2,000 free, then $0.50 per 1K',
    recurring: {
      interval: 'month', // one bill per month
      usage_type: 'metered', // bill for what was used, after the month ends
      meter: meterId, // the meter that adds up the ai_tokens events
    },
    billing_scheme: 'tiered',
    // "Graduated" = each tier only prices the tokens inside it,
    // so the first 2,000 tokens stay free even after you go over.
    tiers_mode: 'graduated',
    tiers: [
      { up_to: 2000, unit_amount: 0 }, // tokens 1-2,000: free
      // Amounts are in cents. $0.0005 per token = 0.05 cents = $0.50 per 1,000 tokens.
      { up_to: 'inf', unit_amount_decimal: '0.05' },
    ],
  });

  console.log(`\nCreated price ${price.id}`);
  console.log(`Add these lines to your .env:\nSTRIPE_METER_ID=${meterId}\nSTRIPE_PRICE_ID=${price.id}`);
}

main().catch((err) => {
  console.error('Stripe error:', err.message);
  process.exit(1);
});
