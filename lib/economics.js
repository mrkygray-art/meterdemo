// The business side: what usage costs us, what Stripe charges, and what each pricing
// model would bill. Used by the sample account (real invoices) and the pricing lab.
//
// Scale: real AI prices are fractions of a cent, so every price AND cost in this demo
// is scaled up 1,000x. Because both sides use the same scale, the margins are realistic.

// What the AI model costs us per token, in cents.
// gpt-6-luna list price: $0.10 per 1M input tokens, $0.50 per 1M output tokens (x1,000).
export const COST_CENTS_PER_TOKEN = { input: 0.01, output: 0.05 };

// Stripe's standard US pricing: cards 2.9% + 30c per successful charge; Billing 0.7% of billing volume.
// Stripe can't charge less than 50c, so smaller amounts aren't charged that month.
export const CARD_PERCENT = 0.029;
export const CARD_FIXED_CENTS = 30;
export const BILLING_PERCENT = 0.007;
export const MIN_CHARGE_CENTS = 50;

export function modelCost({ input, output }) {
  return input * COST_CENTS_PER_TOKEN.input + output * COST_CENTS_PER_TOKEN.output;
}

// Estimated Stripe fees on an invoice amount (used when there's no real charge to read).
export function stripeFees(amountCents) {
  if (amountCents < MIN_CHARGE_CENTS) return Math.round(amountCents * BILLING_PERCENT);
  return Math.round(amountCents * (CARD_PERCENT + BILLING_PERCENT) + CARD_FIXED_CENTS);
}

// Gross margin = revenue minus the direct cost of serving it (AI model + payment fees).
export function margin(revenueCents, usage, feesCents = stripeFees(revenueCents)) {
  const cost = modelCost(usage);
  const profit = revenueCents - cost - feesCents;
  return {
    revenue: Math.round(revenueCents),
    modelCost: Math.round(cost),
    fees: Math.round(feesCents),
    profit: Math.round(profit),
    marginPct: revenueCents > 0 ? profit / revenueCents : null,
  };
}

const graduated = (tokens, free, centsPerToken) => Math.max(tokens - free, 0) * centsPerToken;

// The four pricing models compared in the pricing lab. Each returns cents for one month.
export const PRICING_MODELS = [
  {
    id: 'flat',
    name: 'Flat plan',
    summary: '$49/month, unlimited use',
    goodFor: 'Simple to sell and predictable for customers, but heavy users can cost more than they pay.',
    bill: () => 4900,
  },
  {
    id: 'blended',
    name: 'One token price (v1)',
    summary: '2,000 tokens free, then $0.50 per 1K tokens',
    goodFor: 'Easy to explain, but treats cheap input and expensive output tokens the same.',
    bill: ({ input, output }) => graduated(input + output, 2000, 0.05),
  },
  {
    id: 'base',
    name: 'Base fee + overage',
    summary: '$29/month includes 50K tokens, then $0.40 per 1K',
    goodFor: 'Predictable minimum revenue, but light users pay for capacity they never use.',
    bill: ({ input, output }) => 2900 + graduated(input + output, 50000, 0.04),
  },
  {
    id: 'split',
    name: 'Input + output pricing (v2, live)',
    summary: 'Input: 2,000 free, then $0.25 per 1K. Output: 500 free, then $1.00 per 1K',
    goodFor: 'Price follows cost, so every customer is profitable; still has a free allowance to start.',
    live: true,
    bill: ({ input, output }) => graduated(input, 2000, 0.025) + graduated(output, 500, 0.1),
  },
];

export function compareModels(usage) {
  return PRICING_MODELS.map((m) => ({ id: m.id, ...margin(Math.round(m.bill(usage)), usage) }));
}
