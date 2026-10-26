// One-time setup for the v2 pricing (the "solution"): separate metered prices for
// input and output tokens, because output tokens cost the AI provider 5x more.
//
// Creates (or reuses) two meters and two graduated prices, each with a free allowance,
// and gives the prices lookup keys. The app finds prices by lookup key, so pricing can
// change in Stripe without a code deploy. The old blended v1 price is archived (existing
// subscriptions keep it; new sign-ups get v2).
//
// Run with:  npm run setup:pricing

import { stripe, PRODUCT_NAME, PRICES } from '../lib/stripe.js';

async function meterFor(eventName, displayName) {
  const meters = await stripe.billing.meters.list({ status: 'active', limit: 100 });
  const found = meters.data.find((m) => m.event_name === eventName);
  if (found) return found;
  return stripe.billing.meters.create({
    display_name: displayName,
    event_name: eventName,
    default_aggregation: { formula: 'sum' }, // add up every value reported in the month
    customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
    value_settings: { event_payload_key: 'value' },
  });
}

async function main() {
  const products = await stripe.products.list({ active: true, limit: 100 });
  const product = products.data.find((p) => p.name === PRODUCT_NAME);
  if (!product) throw new Error(`Product "${PRODUCT_NAME}" not found.`);

  for (const p of Object.values(PRICES)) {
    const meter = await meterFor(p.eventName, p.meterName);
    const existing = await stripe.prices.list({ lookup_keys: [p.lookupKey], active: true });
    if (existing.data.length) {
      console.log(`${p.lookupKey}: already exists (${existing.data[0].id})`);
      continue;
    }
    const price = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      nickname: p.nickname,
      lookup_key: p.lookupKey,
      transfer_lookup_key: true,
      recurring: { interval: 'month', usage_type: 'metered', meter: meter.id },
      billing_scheme: 'tiered',
      tiers_mode: 'graduated', // each tier only prices the tokens inside it
      tiers: [
        { up_to: p.freeTokens, unit_amount: 0 }, // free allowance
        { up_to: 'inf', unit_amount_decimal: p.centsPerToken }, // cents per token after that
      ],
      metadata: { kind: p.kind },
    });
    console.log(`${p.lookupKey}: created ${price.id} on meter ${meter.event_name} (${meter.id})`);
  }

  // Archive the v1 blended price so new sign-ups only see v2.
  // (Pass --keep-old to skip this while the old code is still live.)
  if (process.argv.includes('--keep-old')) return;
  const all = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const v2 = new Set(Object.values(PRICES).map((p) => p.lookupKey));
  for (const price of all.data) {
    if (!v2.has(price.lookup_key)) {
      await stripe.prices.update(price.id, { active: false });
      console.log(`Archived old price ${price.id} (${price.nickname || 'v1'})`);
    }
  }
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
