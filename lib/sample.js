// Finds the read-only sample account (built by scripts/seed-sample.js).
// Its IDs live in metadata on the product, so re-seeding needs no redeploy.

import { stripe, PRICE_ID } from './stripe.js';

let productId = null;

export async function sampleIds() {
  if (!productId) productId = (await stripe.prices.retrieve(PRICE_ID)).product;
  const product = await stripe.products.retrieve(productId);
  const m = product.metadata || {};
  if (!m.sample_customer_id) return null;
  return { customerId: m.sample_customer_id, clockId: m.sample_clock_id, portalConfig: m.sample_portal_config };
}
