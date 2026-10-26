# MeterDemo: usage-based AI billing with Stripe

A small live demo of **usage-based (metered) billing** with Stripe, running entirely in **test mode**.
You chat with an AI assistant, every reply is measured in **tokens**, and Stripe turns that usage into a monthly invoice.
The first 2,000 tokens each month are free.

> **TEST MODE ONLY.** Use card `4242 4242 4242 4242`, any future date, any CVC. No real money moves.
> The app refuses to start if it sees a live Stripe key.

## How it works

```
 Visitor chats          Server counts tokens        Stripe adds them up        Stripe bills
┌─────────────┐        ┌────────────────────┐      ┌──────────────────┐      ┌──────────────┐
│  Chat page  │ ─────▶ │ /api/chat          │ ───▶ │ Meter: ai_tokens │ ───▶ │ Price: tiered│
│             │        │ OpenAI reply +     │      │ (sum per month)  │      │ 0-2,000 free │
│             │        │ usage.total_tokens │      └──────────────────┘      │ then $0.50/1K│
└─────────────┘        └────────────────────┘                                └──────┬───────┘
       ▲                                                                            │
       │   /api/usage: tokens used, free tokens left, estimate (invoice preview)    ▼
       └───────────────────────────────────────────────────────────────  Subscription → monthly invoice
                                                                                    │
                                     /api/webhook ◀── invoice.paid / payment_failed ┘
```

In plain language:

1. **Meter.** A counter in Stripe called `ai_tokens`. Each time we send it a number, it adds it to that customer's total for the month.
2. **Price.** Says what the counted units cost. Ours is *graduated*: tokens 1 to 2,000 cost $0, and every token after that costs $0.0005 ($0.50 per 1,000). Demo prices are inflated so the numbers are visible.
3. **Subscription.** Created through Stripe Checkout. It connects one customer to the price, billed monthly *in arrears* (after the usage happens).
4. **Usage events.** After every AI reply, the server sends a *meter event* with that reply's token count.
5. **Invoice.** At the end of the month, Stripe multiplies the meter total by the price and charges the card.

There's no database. Stripe holds the customers, subscriptions, usage and invoices. The browser keeps a signed, HTTP-only cookie with its Stripe customer ID.

## What's in the repo

| Path | What it does |
|---|---|
| `public/index.html` | Landing page with the test-mode banner and the "Start demo" button |
| `public/chat.html`, `public/chat.js` | Chat, plus the usage panel and the "Manage billing" button |
| `api/create-checkout-session.js` | Creates a Stripe customer and a Checkout page (subscription mode) |
| `api/checkout-complete.js` | Where Checkout returns: confirms with Stripe, sets the session cookie |
| `api/chat.js` | Calls OpenAI, returns the reply, sends the token count to the Stripe meter |
| `api/usage.js` | Tokens used this period, free tokens left, and Stripe's invoice preview |
| `api/portal.js` | Opens the Stripe Customer Portal (invoices, card, cancel) |
| `api/webhook.js` | Verifies Stripe's signature on the raw body; saves the latest invoice and subscription status onto the customer |
| `lib/stripe.js` | Shared Stripe client; blocks live keys |
| `lib/session.js` | Signed cookie helpers |
| `scripts/create-price.cjs` | One-time setup: creates the tiered metered price |
| `scripts/listen.cjs` | Forwards Stripe webhooks to your local server |
| `scripts/simulate-invoice.js` | Uses a Stripe test clock to produce a real, finalized monthly usage invoice |
| `scripts/seed-sample.js` | Builds the sample account (2 months of history) on a test clock |
| `public/sample.html`, `public/sample.js`, `api/sample.js`, `api/sample-portal.js` | The read-only sample account page, its data and its read-only portal |
| `scripts/dev.js` | Local server that runs the `/api` routes the way Vercel does |

## Guardrails (it's a public demo)

- Replies are capped at 300 tokens; messages at 500 characters; only the last 6 turns are sent as context.
- 6 messages per minute per visitor, and 30 messages in total per demo customer (the count is stored in Stripe).
- Chat only works while the visitor's subscription is active.
- The OpenAI key lives in its own project with a monthly budget.

## Run it locally

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your **test** values (it's git-ignored).
3. Terminal 1: `npm run dev`, then open http://localhost:3000
4. Terminal 2: `npm run listen` (forwards webhooks; put the `whsec_...` it prints into `.env` as `STRIPE_WEBHOOK_SECRET`)

## One-time Stripe setup (test mode / sandbox)

1. **Meter:** Dashboard → Usage-based billing → Meters → Create meter. Event name `ai_tokens`, aggregation **Sum**.
2. **Price:** `npm run setup:price` creates the product and the graduated, metered price and prints the IDs for `.env`.
3. **Customer Portal:** Settings → Billing → Customer portal. Invoice history on, payment method updates on, cancellation on (end of period), plan switching off. Save.
4. **Webhooks:** locally, `npm run listen`. In production, add an endpoint for `https://<your-app>/api/webhook` with the events `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created` and `customer.subscription.deleted`.

## Sample account (months of history)

A brand-new visitor has no invoices yet (usage is billed after the month ends), so the landing page also offers **View a sample account**: a fictional team, *Northwind Labs*, with 2 months of chat usage and paid monthly invoices plus the current month in progress. No card needed.

- `npm run seed:sample` builds it (about 5-8 minutes). It puts the customer on a Stripe **test clock** that starts 2 months ago, then month by month: moves the clock to the end of the month, records that month's daily usage as meter events, and moves the clock past month end so Stripe issues, finalizes and charges the invoice. It finishes by filling in the current month.
- `/api/sample` reads it all live from Stripe: invoices, daily usage from the meter (`value_grouping_window=day`), and the invoice preview for the current month.
- The sample's billing portal uses its own **read-only portal configuration** (invoice history only), so visitors can't cancel it or change its card.
- The app finds the sample through metadata on the product (`sample_customer_id`), so re-seeding needs no redeploy.
- **Stripe deletes test clocks 30 days after creation**, so the sample must be rebuilt every few weeks (re-running the script also deletes the old one).

One thing learned building it: for a test-clock customer, Stripe checks meter event timestamps against the *clock's* time, not the real time. That's why the script moves the clock to each month's end before recording that month's usage.

## See a real monthly invoice (test clock)

Usage invoices normally appear once a month. To see one now, run:

```
npm run simulate:invoice
```

It uses a Stripe **test clock** (a pretend calendar for test customers). It creates a customer on the clock, subscribes them, records a month of chat usage (18 replies, 10,902 tokens), then moves the clock past the end of the month. Stripe issues the invoice, finalizes it, and charges the test card:

| Invoice line | Amount |
|---|---|
| 2,000 tokens (Tier 1, free allowance) | $0.00 |
| 8,902 tokens (Tier 2 at $0.0005) | $4.45 |
| **Total (paid with test card 4242)** | **$4.45** |

The script prints links to the hosted invoice and the PDF. Simulations show up under Billing → Subscriptions → Simulations in the Dashboard, and Stripe deletes them after 30 days.

Note: while a test clock is moving, Stripe won't let anything edit that customer. If the webhook receives `invoice.paid` mid-advance, it answers 500 and Stripe retries it later (or resend it from the Dashboard). Real customers never hit this.

## Cleaning up test data

Everything lives in a Stripe sandbox. You can delete test customers one by one in the Dashboard, or clear all test data from the sandbox settings. Nothing here touches real customers or money.

## A note on Stripe's newer option

This demo uses **Stripe Billing Meters**, which keeps the moving parts easy to see. For new production usage-based billing, Stripe now recommends **Metronome**, its dedicated usage billing platform (prepaid credits, contracts, real-time usage). The concepts here (meter → price → subscription → usage events → invoice) carry over.

---

Built by [Ky Gray](https://ky-gray-portfolio.vercel.app) as a proof-of-work project. Not affiliated with Stripe.
