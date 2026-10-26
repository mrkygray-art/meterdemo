// GET /api/pricing
// The pricing lab: takes each sample customer's latest full month of real usage
// (input and output tokens from the Stripe meters) and works out what they would
// pay under four pricing models, what serving them costs, and the gross margin.
//
// The live bill always comes from Stripe's invoice preview. This lab is a what-if
// tool, so it applies the pricing rules in lib/economics.js to the real usage.

import { loadSamples } from '../lib/sample.js';
import { PRICING_MODELS, compareModels, COST_CENTS_PER_TOKEN, CARD_PERCENT, CARD_FIXED_CENTS, BILLING_PERCENT } from '../lib/economics.js';

export async function GET() {
  try {
    const samples = await loadSamples();
    if (!samples.available) return Response.json({ available: false });

    const customers = samples.customers.map((c) => {
      const last = c.invoices[c.invoices.length - 1];
      const prev = c.invoices[c.invoices.length - 2];
      return {
        key: c.key,
        name: c.name,
        profile: c.profile,
        month: last ? { start: last.periodStart, end: last.periodEnd } : null,
        previousTokens: prev ? prev.usage.input + prev.usage.output : null,
        usage: last ? last.usage : c.current.usage,
        results: compareModels(last ? last.usage : c.current.usage),
      };
    });

    return Response.json({
      available: true,
      models: PRICING_MODELS.map(({ id, name, summary, goodFor, live }) => ({ id, name, summary, goodFor, live: !!live })),
      assumptions: {
        costPer1kInput: COST_CENTS_PER_TOKEN.input * 1000,
        costPer1kOutput: COST_CENTS_PER_TOKEN.output * 1000,
        cardPercent: CARD_PERCENT,
        cardFixed: CARD_FIXED_CENTS,
        billingPercent: BILLING_PERCENT,
      },
      customers,
    });
  } catch (err) {
    console.error('pricing failed:', err.message);
    return Response.json({ error: 'Could not load the pricing lab.' }, { status: 500 });
  }
}
