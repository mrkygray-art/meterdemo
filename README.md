# MeterDemo: usage-based billing for an AI product, built on Stripe

**Live:** https://meterdemo.vercel.app · [Sample customers](https://meterdemo.vercel.app/sample.html) · [Pricing lab](https://meterdemo.vercel.app/pricing.html) · [Solution brief](docs/SOLUTION_BRIEF.md)

AI products have a pricing problem: every reply costs money to generate, so on a flat plan the heaviest users can cost more than they pay. MeterDemo shows the fix on Stripe. It meters every AI reply, prices **input and output tokens separately** (output costs the AI provider about 5x more), and makes sure **no usage goes unbilled**.

> **TEST MODE ONLY.** Use card `4242 4242 4242 4242`, any future date, any CVC. No real money moves, and the app refuses to start with a live Stripe key. Customers in the samples are fictional.

## Problem → solution → result

| | |
|---|---|
| **Problem** | On a flat $49/month plan, the sample power user costs $90.03 a month in AI usage: a **−88% gross margin**. Light users pay $49 for $0.34 of usage and leave. |
| **Analysis** | The [pricing lab](https://meterdemo.vercel.app/pricing.html) runs real metered usage from three customer types through four pricing models and shows revenue, AI cost, Stripe fees and gross margin for each. |
| **Solution** | Two Stripe Billing Meters (input, output), each with a graduated price and a free allowance, found by lookup key. Checkout, invoice preview, Customer Portal, signed webhooks. |
| **Safeguard** | Usage reports retry with the same ID (never double-billed); failures are recorded and a reconcile job compares our records with Stripe's meters. |
| **Result** | Every paying customer at **47–49% gross margin**; the lab's v2 bills match Stripe's real invoices to the cent. |

The full write-up: [docs/SOLUTION_BRIEF.md](docs/SOLUTION_BRIEF.md). How to present it: [docs/TALK_TRACK.md](docs/TALK_TRACK.md). Terms explained: [docs/GLOSSARY.md](docs/GLOSSARY.md).

## How a reply becomes an invoice

```
Customer chats
     │
     ▼
/api/chat ── AI model ──► reply + input & output token counts
     │
     ▼  lib/usage-reporting.js: retry, idempotent IDs, record anything unreported
Stripe Billing Meters:  ai_input_tokens   ai_output_tokens      (sum per month)
     │
     ▼
Graduated prices:  input: 2,000 free, then $0.25/1K   output: 500 free, then $1.00/1K
     │
     ▼
Subscription (from Checkout) ──► month end: invoice ──► card charged
     │                                                     │
     │  /api/usage: meter totals + Stripe invoice preview   ▼
     └──────────────────────────────── /api/webhook ◄── invoice.paid / payment_failed

npm run reconcile: our reported totals vs. Stripe's meters; re-sends anything missing
```

1. **Meters** count usage. Each AI reply sends two meter events (input tokens, output tokens) for that customer.
2. **Prices** turn meter totals into money. Both are *graduated*: a free first tier, then a per-token rate. Output is priced higher because it costs more.
3. **Lookup keys** (`meterdemo_input_tokens_v2`, `meterdemo_output_tokens_v2`) let the app find the current prices, so pricing changes in Stripe need no deploy.
4. **Subscription** from Stripe Checkout holds both prices, billed monthly *in arrears*.
5. **Invoice preview** gives the customer Stripe's own estimate; the app never does its own billing math.
6. **Invoice** at month end; Stripe charges the card and sends a webhook.

There's no database. Stripe holds the customers, subscriptions, usage and invoices; the browser keeps a signed, HTTP-only cookie with its Stripe customer ID.

*Scale note: real AI prices are fractions of a cent, so every price and every cost is scaled up 1,000x to make test invoices visible. Both sides use the same scale, so margins are realistic.*

## Pages

| Page | What it shows |
|---|---|
| `/` | The problem, the solution and the safeguard; start the live demo |
| `/chat.html` | Live demo: chat, input/output usage, Stripe's estimate, Manage billing (Customer Portal) |
| `/sample.html` | Three fictional customers (light, growing, power) with paid invoices, daily usage and **per-invoice margin**: revenue, AI cost, the card fee Stripe actually charged, gross profit |
| `/pricing.html` | The pricing lab: four pricing models on each customer's real usage, with findings |

## Repo map

| Path | What it does |
|---|---|
| `api/create-checkout-session.js` | Creates a customer and a Checkout session with both v2 prices |
| `api/checkout-complete.js` | Where Checkout returns: confirms with Stripe, sets the signed cookie |
| `api/chat.js` | Calls the AI model with guardrails, returns the reply, reports usage |
| `api/usage.js` | Usage per meter, free allowance left, Stripe invoice preview |
| `api/portal.js` | Customer Portal session |
| `api/webhook.js` | Verifies Stripe's signature on the raw body; records invoice and subscription status |
| `api/sample.js`, `api/sample-portal.js` | Sample customers' data and their read-only portal |
| `api/pricing.js` | Pricing lab data |
| `lib/stripe.js` | Stripe client, live-key guard, v2 price definitions, lookups by key and meter name |
| `lib/usage-reporting.js` | Revenue-leakage safeguards: retries, idempotency, unreported-usage record |
| `lib/economics.js` | AI costs, Stripe fees, gross margin, the four pricing models |
| `lib/sample.js` | Loads sample customers with invoices, real fees, costs and daily usage |
| `lib/session.js` | Signed cookie helpers |
| `scripts/setup-pricing.js` | Creates the meters and v2 prices (with lookup keys); archives v1 |
| `scripts/seed-sample.js` | Builds the three sample customers on a Stripe test clock |
| `scripts/reconcile.js` | Compares our usage records with Stripe's meters; re-sends missing usage |
| `scripts/listen.cjs`, `scripts/dev.js` | Local webhook forwarding and a local server that runs `/api` like Vercel |
| `docs/` | Solution brief, talk track, glossary |

## Run it locally

1. `npm install`, then copy `.env.example` to `.env` and fill in **test** values (git-ignored).
2. `npm run setup:pricing` once (creates the meters and prices).
3. Terminal 1: `npm run dev`, then open http://localhost:3000
4. Terminal 2: `npm run listen` (forwards webhooks; put the `whsec_...` it prints into `.env` as `STRIPE_WEBHOOK_SECRET`)

**Customer Portal:** Settings → Billing → Customer portal in the Dashboard: invoice history, payment method updates, cancellation at period end; plan switching off.
**Production webhook:** an endpoint for `https://<your-app>/api/webhook` with `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.deleted`.

## Sample customers (test clocks)

`npm run seed:sample` (about 8–12 minutes) builds three fictional customers on one Stripe **test clock** that starts two months ago. Month by month it moves the clock to the end of the month, records that month's usage, and moves past month end so Stripe issues, finalizes and charges each invoice. Then it fills in the current month.

- Usage is sent **pre-aggregated** (a few batches per customer per day), as Stripe recommends for high volume.
- The samples use a **read-only portal configuration** (invoice history only).
- The app finds the samples through metadata on the product, so re-seeding needs no redeploy.
- **Stripe deletes test clocks 30 days after creation**, so re-run the script every few weeks; it deletes the previous samples.
- Learned by experiment: for a test-clock customer, Stripe checks meter event timestamps against the *clock's* time, not the real time.
- The webhook ignores test-clock events (Stripe blocks customer edits while a clock is moving).

## Guardrails (it's a public demo)

- Replies capped at 300 tokens, messages at 500 characters, 6 turns of context.
- 6 messages per minute per visitor; 30 messages per demo customer (counted in Stripe).
- Chat only works while the visitor's subscription is active; the AI key has a spending limit.

## Billing Meters vs. Metronome

This demo uses **Stripe Billing Meters**, which keeps every step visible. For new production usage-based billing, Stripe now recommends **Metronome** (real-time usage, prepaid credits, contracts, high-volume ingestion). The concepts here (meter → price → subscription → usage events → invoice) carry over. See the [solution brief](docs/SOLUTION_BRIEF.md#7-trade-offs-and-alternatives).

## Cleaning up test data

Everything lives in a Stripe sandbox. Delete test customers in the Dashboard or clear the sandbox's test data. Simulations (test clocks) are under Billing → Subscriptions → Simulations.

---

Built by [Ky Gray](https://ky-gray-portfolio.vercel.app) as a proof-of-work project. Not affiliated with Stripe.
