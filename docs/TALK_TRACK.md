# Talk track: how to explain MeterDemo

For interviews and demos. Plain language first; the Stripe terms are there when someone asks "how".

## The 30-second version

> "AI products have a pricing problem: every reply costs money to generate, so on a flat plan your heaviest users can cost more than they pay. I built MeterDemo to show the fix on Stripe. It meters every AI reply, prices input and output tokens separately because output costs about five times more, and makes sure no usage slips through unbilled. In my pricing lab, the power customer goes from losing 88 cents on every dollar to a 49% margin, and every paying customer lands between 47 and 49%."

## The 2-minute version: why, how, what

**Why (the problem).**
"I set it up like a real customer scenario: an AI startup charging $49 a month flat. With AI, cost scales with usage. The model provider bills per token, and output tokens cost about 5x input. I built three sample customers from real metered usage: a light user, a growing team and a power user. On the flat plan the power user costs $90 a month to serve and pays $49. The light user pays $49 for 34 cents of usage, so they'll probably leave."

**How (the analysis and build).**
"First I compared four pricing models on the same usage: flat, one token price, a base fee with overage, and separate input and output pricing. The single token price stopped the losses but still squeezed output-heavy customers. Separate input and output pricing kept margins steady for everyone, because price follows cost. Then I built it on Stripe: two Billing Meters, a graduated price on each with a free allowance, prices found by lookup key so pricing can change without a deploy, Checkout for sign-up, the invoice preview for the customer's estimate, the Customer Portal, and signature-verified webhooks. I used test clocks to generate real paid invoices for the sample customers."

**What it accomplishes.**
"Three things. Every paying customer is profitable, 47 to 49% gross margin, whatever their usage mix. Customers can still start free and always see their usage and Stripe's own estimate. And there's a revenue-leakage safeguard: usage reports retry with the same ID, so nothing is billed twice; anything that still fails is recorded; and a reconciliation job compares our records against Stripe's meters. The lab's math also matches Stripe's real invoices to the cent, so the analysis and the billing agree."

## Demo click path (about 4 minutes)

1. **Home page:** read the three cards (Problem, Solution, Safeguard). Frame it as a customer engagement.
2. **Pricing lab:** walk the findings top to bottom. Point at Atlas Robotics' flat-plan row (−88%) and the v2 row (49%).
3. **Sample customers → Atlas Robotics:** the daily chart (output tokens in orange), then the invoice table: revenue, AI cost, the card fee Stripe actually charged, margin. Click **View** to open a real Stripe invoice with four tier lines.
4. **Pixel & Pine Studio:** $0 invoices, and the cost of the free tier.
5. **Live demo:** Try the live demo → Checkout with 4242 → send two messages → each reply shows its input and output tokens → after a minute the usage panel updates → **Manage billing** opens Stripe's portal.
6. **GitHub:** `lib/usage-reporting.js` (retries and leakage), `lib/economics.js` (costs and pricing models), `docs/SOLUTION_BRIEF.md`.

## Questions you'll likely get

**"Why Billing Meters and not Metronome?"**
"Stripe now recommends Metronome for new usage-based billing, and I'd recommend it for a production company that needs prepaid credits, contracts or real-time usage at high volume. For this demo, Billing Meters keeps every step visible (meter, price, subscription, invoice) and covers simple pay-as-you-go. The concepts carry straight over."

**"Why is the margin only 47–49%? Software is usually 70%+."**
"That's typical for AI products, because every request has a real model cost. The point of v2 is that margin is *steady and positive* across customers. To raise it you'd raise the output price, route simple questions to a cheaper model, cache repeated prompts, or add a small platform fee. The lab shows the effect before anything changes in Stripe."

**"The flat plan gives Northwind a 78% margin. Why not keep it?"**
"Only while they stay small. At their usage mix, flat stops covering cost around 248,000 tokens a month, and they grew 22% last month. Usage pricing turns their growth into revenue instead of cost."

**"What's revenue leakage, and how did you handle it?"**
"Usage you delivered but never billed. Here the AI reply is already generated before we tell Stripe about it, so a failed report means free usage. I retry with backoff, reuse the same identifier so retries can't double-bill, keep our own running total, record anything Stripe couldn't take, and a reconcile job compares our totals with Stripe's meters and re-sends what's missing."

**"Why show Stripe's invoice preview instead of calculating the bill yourself?"**
"One source of truth. If the app did its own math, the estimate and the real invoice could drift apart. The preview is Stripe's own calculation with the same tiers and free allowances."

**"Why are the prices so high per token?"**
"Real AI prices are fractions of a cent, so test invoices would show $0.00. I scaled every price *and* every cost by 1,000x. Both sides use the same scale, so the margins are realistic."

**"How would you roll this out to existing customers?"**
"Shadow billing first: meter everyone for a month or two while still charging flat, and show each customer what they would have paid. Use that real data to set prices, announce early, keep light users free, move new customers first and existing ones at renewal, and watch margin and cancellations by segment."

**"How do you know the bill is right?"**
"Three checks: the lab's v2 calculation matches Stripe's actual invoices to the cent; the reconcile job confirms our usage records match Stripe's meters; and each invoice shows the tier lines, so the customer can see the math."

**"What would you build next?"**
"Spend alerts and thresholds so customers aren't surprised, prepaid credits, failed-payment handling with Stripe's retries, and a version on Metronome to compare."

**"What was the hardest part?"**
"Test clocks. Stripe checks usage timestamps against the *clock's* date, not the real date, so I had to move the clock to each month's end before recording that month's usage. I found that by experiment."

## Words to use correctly

Gross margin, cost to serve, revenue leakage, reconciliation, idempotency, billing in arrears, graduated vs. volume tiers, free allowance, invoice preview, lookup key. Definitions with demo examples: [GLOSSARY.md](GLOSSARY.md).
