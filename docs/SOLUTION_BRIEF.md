# Solution brief: usage-based billing for an AI product

*MeterDemo, by Ky Gray. Written the way a Solutions Engineer would brief a customer. The company and customers are fictional; the billing runs on Stripe in test mode, and every number below comes from real Stripe objects (meters, invoices, fees) in that sandbox.*

## Summary

An AI assistant sold on a flat $49/month plan was losing money on its heaviest customers, because every reply has a real AI cost. MeterDemo moves it to usage-based billing on Stripe: input and output tokens are metered separately and priced so **price follows cost**, each with a monthly free allowance. In the pricing lab, the power customer goes from **−88% gross margin on the flat plan to 49%**, every paying customer lands at **47–49%**, and a reconciliation safeguard keeps delivered usage from going unbilled.

## 1. The problem

**The company:** a small AI startup selling an AI assistant to teams, on a flat $49/month plan.

**Why flat pricing breaks for AI products:** in traditional software, one more user costs almost nothing. With AI, every reply costs money to generate: the AI provider charges for every token the model reads (input) and writes (output), and output tokens cost about **5x more** than input tokens. On a flat plan, the company carries all of that cost risk.

**What the numbers show** (one month of real usage per customer, from the Stripe meters):

| Customer | Usage profile | Tokens (input / output) | Flat plan result |
|---|---|---|---|
| Pixel & Pine Studio | Light: a few questions a week | 1,520 / 378 | Pays $49 for $0.34 of AI cost. Overcharged, likely to cancel |
| Northwind Labs | Growing team, daily use | 36,447 / 10,453 | 78% margin today, but usage grew 22% last month |
| Atlas Robotics | Power user, long code outputs | 214,928 / 137,071 | Costs **$90.03** to serve, pays $49: **loses $43.09 a month** |

**The problem in one sentence:** revenue is fixed, but cost grows with usage, so the company's best (most engaged) customers are the ones losing it money.

## 2. Goals

1. Every paying customer is profitable, whatever mix of input and output they use.
2. Customers can still start free and can always see what they've used and what they'll owe.
3. No delivered usage goes unbilled (no revenue leakage), and no usage is ever billed twice.
4. Pricing can change without a code deploy.

## 3. Analysis: four pricing models on the same usage

The pricing lab (`/pricing.html`) runs each customer's real monthly usage through four models. Gross margin = revenue minus AI cost and Stripe fees, as a share of revenue.

| Pricing model | Pixel & Pine (light) | Northwind (growing) | Atlas (power) |
|---|---|---|---|
| Flat $49/month | $49.00, 95% | $49.00, 78% | $49.00, **−88%** |
| One token price (v1): 2,000 free, then $0.50/1K | $0.00, free tier | $22.45, 56% | $175.00, 45% |
| Base fee: $29 incl. 50K tokens, then $0.40/1K | $29.00, 94% | $29.00, 65% | $149.80, 36% |
| **Input + output pricing (v2, chosen)** | **$0.00, free tier** | **$18.56, 47%** | **$189.80, 49%** |

**What it tells us:**

- **Flat** loses money on heavy users and overcharges light ones. It looks best for moderate users only until they grow: at Northwind's usage mix, flat stops covering cost at about 248,000 tokens a month.
- **One token price** fixes the losses but hides where cost is: Atlas's margin (45%) trails Northwind's (56%) because 39% of Atlas's tokens are expensive output tokens priced like cheap input tokens.
- **Base fee + overage** guarantees minimum revenue but charges the light user $29 for $0.34 of usage, a churn risk.
- **Input + output pricing** keeps margins nearly flat (47–49%) across very different customers, because each token type is priced at a steady markup over its own cost. The light user stays free: a deliberate acquisition cost of about $0.34 a month.

**Check on the analysis:** for v2, the lab's calculated bills match Stripe's actual invoices to the cent (Northwind $18.56, Atlas $189.80), so the what-if math uses the same rules Stripe bills with.

## 4. The solution (built on Stripe)

**Pricing (v2):**
- Input tokens: first 2,000 a month free, then $0.25 per 1,000.
- Output tokens: first 500 a month free, then $1.00 per 1,000.

*(All demo prices and costs are scaled 1,000x from real AI prices so test invoices show visible cents. Both sides use the same scale, so the margins are realistic.)*

**Stripe building blocks:**

| Need | Stripe feature | How it's used |
|---|---|---|
| Count usage | **Billing Meters** (`ai_input_tokens`, `ai_output_tokens`, sum aggregation) | The app sends a meter event after every AI reply |
| Turn usage into money | **Graduated metered prices**, one per meter, with a $0 first tier | The free allowance plus the per-token rate |
| Change pricing without deploys | **Lookup keys** (`meterdemo_input_tokens_v2`, `meterdemo_output_tokens_v2`) | The app asks Stripe for "the current price for this key" |
| Sign-up and card | **Checkout** (subscription mode) | Both metered prices on one subscription, no quantity |
| "What will I owe?" | **Invoice preview** | The usage panel shows Stripe's own estimate, not app math |
| Self-service | **Customer Portal** | Invoices, card updates, cancellation |
| React to billing events | **Webhooks** (signature-verified on the raw body) | Invoice paid / failed, subscription started / ended |
| Test months in minutes | **Test clocks** | The three sample customers' paid invoices |

**There is no database.** Stripe is the system of record for customers, subscriptions, usage and invoices. The browser holds a signed, HTTP-only cookie with its Stripe customer ID.

## 5. Workflow: from a reply to a paid invoice

1. **Sign up.** The customer starts a Stripe Checkout session (test card 4242), which creates a subscription with the input and output prices.
2. **Use the product.** Each chat message goes to the AI model, which returns the reply plus exact input and output token counts.
3. **Report usage.** The server sends two meter events (input, output), each with a unique ID made from the reply ID. Retries reuse that ID, so Stripe can never count a reply twice.
4. **Show usage.** The usage panel reads this month's totals from the meters and the estimate from Stripe's invoice preview. Stripe processes meter events in the background, so totals catch up within about a minute.
5. **Month end.** Stripe totals each meter, applies the graduated prices, and creates the invoice (billing in arrears).
6. **Collect.** About an hour later Stripe finalizes the invoice and charges the saved card. Stripe's fees: 2.9% + 30¢ per card charge, plus 0.7% for Billing.
7. **Notify.** Stripe sends `invoice.paid` (or `invoice.payment_failed`) to the webhook, which records the status for the usage panel.
8. **Reconcile.** A reconciliation job (`npm run reconcile`) compares the app's own record of reported tokens with Stripe's meter totals, re-sends anything that failed, and flags any gap.

## 6. Safeguards

**Revenue leakage.** The AI reply is generated (and paid for) before usage is reported. If that report fails silently, the usage is never billed. MeterDemo:
- retries failed reports with backoff (only for errors worth retrying),
- uses the same identifier on every retry (idempotency, so no double billing),
- keeps a running total of reported tokens on the customer,
- records anything Stripe couldn't take as "unreported" for the reconcile job to send.

**Customer trust.** A free allowance to start, a live usage panel with Stripe's own estimate, and a self-service portal.

**Cost control for a public demo.** Capped reply length and message length, rate limits per visitor, a message cap per demo customer, and a spending limit on the AI key.

**Test mode only.** The app refuses to start with a live Stripe key.

## 7. Trade-offs and alternatives

- **Billing Meters vs. Metronome.** Stripe now recommends **Metronome**, its dedicated usage-billing platform, for new usage-based integrations: real-time usage, prepaid credits, contracts and commitments. Billing Meters keeps the moving parts visible for a demo and covers straightforward pay-as-you-go pricing. For a production company expecting prepaid credits, enterprise contracts or very high event volume, I'd recommend Metronome.
- **Two prices are harder to explain than one.** Mitigations: show both meters in the usage panel, keep generous free allowances, and lead with "you pay for what the AI reads and writes" in sales conversations.
- **47–49% gross margin is below typical software margins.** That's common for AI products. The levers: raise the output price, use a cheaper model for simple requests, cache repeated prompts, or add a small platform fee. The pricing lab shows the effect of each before anything changes in Stripe.
- **Prepaid credits** (customers buy a balance that counts down) would cut collection risk and fixed card fees on small invoices. Stripe supports them with billing credits; Metronome specializes in them.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Bill shock (a customer's usage spikes) | Live usage panel and estimate today; next step: Stripe usage alerts and spend thresholds |
| Failed payments | Stripe automatic retries and reminder emails (dunning); `invoice.payment_failed` webhook already handled |
| Tiny invoices eaten by the 30¢ card fee; Stripe won't charge under 50¢ | Free allowance keeps tiny users at $0; consider a minimum or a small base fee |
| Usage lost between the app and Stripe | Retries, idempotent IDs, unreported-usage record and the reconcile job |
| Usage takes time to process | UI explains the delay; invoices finalize about an hour after month end, so late events still land |

## 9. Rollout plan for a real company

1. **Shadow billing (1–2 months).** Meter every customer but keep charging the flat plan. Show each customer "what you would have paid" next to their current bill.
2. **Decide the prices** with the pricing lab, using that real usage. Check every segment's margin and bill change.
3. **Announce early** (30–60 days), with the free allowance and an estimate tool. Keep light users free.
4. **Migrate new customers first**, then existing ones at renewal. Give large accounts a transition credit.
5. **Monitor monthly:** margin by customer segment, bill-change complaints, cancellations, unreported-usage gaps.

## 10. What's built, and what isn't

**Built and live (test mode):** the live demo (Checkout → chat → usage panel → Customer Portal), v2 input/output pricing in Stripe, three sample customers with paid invoices and per-invoice margins, the pricing lab, signature-verified webhooks, retry/idempotency/reconciliation for usage reporting, and a read-only portal for samples.

**Not built (next steps):** spend alerts and thresholds, prepaid credits, failed-payment simulation, tax (Stripe Tax), a month-end revenue report, and a Metronome version for comparison.

## Results

| Measure | Before (flat $49) | After (v2 input + output pricing) |
|---|---|---|
| Power customer gross margin | −88% (loses $43.09/month) | 49% ($92.64 gross profit/month) |
| Range across paying customers | −88% to 95% | 47% to 49% |
| Light customer | Pays $49 for $0.34 of AI cost | Free (acquisition cost about $0.34/month) |
| Unbilled usage | Not tracked | Retried, recorded and reconciled |
| Pricing changes | Code change | Stripe price change (lookup keys) |
