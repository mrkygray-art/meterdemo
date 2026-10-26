# Project brief: AI Usage Billing Demo (working title: "MeterDemo")

## What this is
A small, standalone web app that demonstrates **usage-based (metered) billing with Stripe in TEST MODE**. A visitor chats with a small AI assistant, every response is metered by **tokens**, and Stripe generates a usage-based invoice. It is a portfolio project for Ky Gray, shown as a "Proof of Work" card with a live test-mode demo. It is **separate from Ask Ky** and must never touch that repo or its Vercel project.

## Hard rules
1. **Test mode only.** Use `sk_test_...` / `pk_test_...` keys. Refuse to run if a live key (`sk_live_`) is detected at startup.
2. **No secrets in the repo.** Keys live in environment variables (Vercel env vars, plus a local `.env` that is git-ignored). Provide a `.env.example` with placeholder names only.
3. **No real money, no real customer data.** Show a visible "TEST MODE - use card 4242 4242 4242 4242" banner in the UI.
4. **Check current Stripe docs before coding any Stripe call** (Billing Meters, meter events, Checkout, Customer Portal, webhooks). The API for metered billing changed in recent years; do not rely on memory.
5. Keep it simple and readable. Ky is a self-taught, AI-assisted builder who thinks at a field level and has no finance background: comment the Stripe-specific parts in plain language.

## Stack (match Ky's existing pattern)
- Plain static front end (`index.html`, vanilla JS, no framework) plus **Vercel serverless functions in an `/api` folder** (Node).
- Stripe Node SDK.
- OpenAI API for the chat assistant (same provider Ask Ky uses). Model choice should be cheap and fast.
- No database. Stripe is the source of truth for customers, subscriptions, usage, and invoices. A signed, HTTP-only cookie stores the Stripe customer ID for the demo session.
- New GitHub repo and new Vercel project.

## Billing design
- **Metered unit:** tokens (input + output tokens reported by the OpenAI response `usage` field). Optionally report in units of 1,000 tokens to keep numbers readable.
- **Stripe Meter:** event name `ai_tokens`, aggregation = sum, customer mapped via `stripe_customer_id`.
- **Pricing:** graduated/tiered per-unit price with a **free allowance** (first N tokens at $0, then a small per-1K-token price). Pick N small enough that a demo user can cross it in a few messages.
- **Subscription:** one product, one metered price, billed monthly in arrears. Metered prices have no quantity at Checkout.
- **Reporting usage:** after each assistant reply, send a meter event with the token count. Meter events are processed asynchronously, so the UI must tolerate a short delay.

## User flow
1. Landing page explains the demo in two sentences and shows the test-mode banner.
2. "Start demo" creates a Stripe Checkout session (subscription mode, test card) and returns the visitor to the app.
3. Chat page: visitor talks to the assistant. After each reply, the server reports token usage to Stripe.
4. **Usage panel:** shows tokens used this period, free allowance remaining, and estimated charge (use Stripe's invoice preview for the upcoming invoice, not a locally computed number).
5. "Manage billing" button opens the **Stripe Customer Portal** (view invoices, update card, cancel). Configure the portal in the Stripe dashboard (test mode).
6. Webhook handler receives invoice events and shows the latest invoice status in the UI.

## API routes (in `/api`)
- `create-checkout-session` - creates customer + Checkout session
- `chat` - calls OpenAI, returns the reply, reports token usage to the Stripe meter
- `usage` - returns usage summary and upcoming invoice preview
- `portal` - creates a Customer Portal session
- `webhook` - verifies Stripe signature using the **raw request body**; handles `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.deleted`

## Guardrails for a public demo
- Rate-limit `chat` per session and cap max tokens per reply, so a visitor cannot run up an OpenAI bill.
- Cap message length. Set a spending limit on the OpenAI key.
- Cancel/cleanup note in README: test-mode data can be cleared from the Stripe dashboard.

## Setup steps Claude Code should walk Ky through
1. Create the Meter, Product, and metered Price in the Stripe dashboard (test mode), or via script, and record the IDs in `.env.example` names.
2. Configure the Customer Portal in test mode.
3. Install the Stripe CLI and use `stripe listen` to forward webhooks locally; add the production webhook endpoint after deploying.
4. Deploy to Vercel, add env vars, and run an end-to-end test with the 4242 card.
5. Generate a test invoice by advancing the test clock (Stripe test clocks) so Ky can screenshot a real finalized usage invoice.

## Deliverables
- Working live demo (test mode) on Vercel.
- README that explains the architecture in plain language: meter -> price -> subscription -> usage events -> invoice.
- A short "How it works" diagram in the README.
- Screenshots Ky can use on his portfolio: the Meter, the usage chart, a finalized invoice, and the Customer Portal.

## Out of scope
Real payments, taxes, multiple plans, user accounts/passwords, an admin UI, and any change to Ask Ky or the portfolio site itself (Ky will add the portfolio card separately).
