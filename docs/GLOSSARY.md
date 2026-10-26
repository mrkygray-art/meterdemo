# Glossary: the business and billing terms behind MeterDemo

Plain-English definitions, each tied to where it shows up in the demo. Numbers come from the sample customers and the pricing lab (all test mode, fictional customers).

## Pricing and billing

**Usage-based (metered) billing**
Charging for how much a customer uses instead of a fixed fee. MeterDemo charges per token the AI reads (input) and writes (output).
*In the demo:* every chat reply sends its token counts to Stripe.

**Meter (Stripe Billing Meter)**
A counter in Stripe. Each time the app reports usage ("customer X used 412 input tokens"), the meter adds it to that customer's total for the month.
*In the demo:* two meters, `ai_input_tokens` and `ai_output_tokens`.

**Meter event**
One usage report sent to a meter. It carries the customer ID, the number, a time, and a unique ID so the same report can never be counted twice.

**Price / pricing model**
The rule that turns a meter total into money. MeterDemo uses *graduated tiers*: the first block is free, the rest costs a set amount per token.

**Graduated vs. volume tiers**
*Graduated:* each tier only prices the units inside it (the first 2,000 input tokens are free even after you pass them). *Volume:* once you reach a tier, **all** units are priced at that tier's rate. Graduated is gentler and easier to explain on an invoice.

**Free allowance (free tier)**
Usage that costs the customer nothing each month. It isn't free to the company: the AI still costs money.
*In the demo:* Pixel & Pine Studio stays inside the free allowance, so it pays $0 but still costs a few cents a month to serve. That's a deliberate customer acquisition cost.

**Flat-rate plan**
One fixed price no matter how much is used ($49/month in the pricing lab). Predictable, but the company carries all the risk of heavy use.

**Base fee + overage**
A fixed monthly fee that includes some usage, plus a per-unit charge above it. Guarantees minimum revenue, but light users pay for capacity they don't use.

**Billing in arrears**
Charging after the usage happens (at month end), as opposed to *in advance* (paying first). Usage-based billing is almost always in arrears, because you can't know the amount until the month is over.

**Invoice preview (upcoming invoice)**
Stripe's own calculation of what the next invoice will be, based on usage so far. MeterDemo shows this instead of doing its own math, so the estimate always matches the real bill.

**Lookup key**
A stable name for a price (for example `meterdemo_output_tokens_v2`). The app asks Stripe for "the price with this key", so pricing can change in Stripe without changing code.

**Customer Portal**
Stripe's ready-made page where customers see invoices, update their card or cancel. The sample customers use a *read-only* version (invoice history only).

**Webhook**
A message Stripe sends to the app when something happens (invoice paid, payment failed, subscription started or ended). The app checks Stripe's signature on each one so fake messages are rejected.

**Test clock**
A Stripe testing tool that puts a test customer on a pretend calendar, so you can jump a month ahead and see real invoices get created and paid. The sample customers were built this way.

## Unit economics

**Revenue**
What the customer is billed. *In the demo:* the invoice total.

**COGS (cost of goods sold) / cost to serve**
The direct cost of delivering the product to a customer. For an AI product the biggest piece is the AI model's usage fees, plus payment processing.
*In the demo:* "AI cost" (model list price for input and output tokens) + "Stripe fees".

**Payment processing fees**
What Stripe keeps for handling the payment: 2.9% + 30¢ per card charge (standard US pricing), plus 0.7% of billing volume for Stripe Billing. The 30¢ part is why tiny invoices are expensive to collect, and why Stripe won't charge less than 50¢.
*In the demo:* the invoice table shows the fee Stripe actually charged on each paid invoice.

**Gross profit**
Revenue minus cost to serve. *In the demo:* "Gross profit" column.

**Gross margin**
Gross profit as a percentage of revenue. It answers "out of every dollar a customer pays, how much is left after the direct cost of serving them?" Software companies usually aim high (often 70%+); AI products tend to run lower because every request has a real model cost.
*In the demo:* the pricing lab shows each customer's margin under four pricing models.

**Negative gross margin**
Serving the customer costs more than they pay. *In the demo:* the power user on the flat $49 plan.

**Unit economics**
Profit and cost looked at per customer (or per unit of usage) instead of for the company as a whole. The pricing lab is a unit economics view.

**Price follows cost**
The pricing principle behind v2: output tokens cost the AI provider 5x more than input tokens, so they're priced higher. That keeps margins steady whatever mix a customer uses.

## Revenue health

**MRR / ARR (monthly / annual recurring revenue)**
The revenue a company can expect every month or year from subscriptions. With usage-based pricing it moves month to month, so companies often report a *run rate* (last month × 12).

**ARPU (average revenue per user/account)**
Total revenue divided by the number of customers.

**Net revenue retention (NRR)**
This year's revenue from last year's customers, divided by last year's revenue from those same customers. Above 100% means existing customers grow (use more) faster than others leave. Usage-based pricing tends to lift NRR because revenue grows as customers use more, like Northwind Labs' month-over-month growth.

**Churn**
Customers who cancel. Overcharging light users (the base-fee plan in the pricing lab) is a classic churn risk.

## Accounting and finance operations

**Revenue leakage**
Revenue a company earned but never billed. In usage billing the usual cause is usage that was delivered but never reported to the billing system.
*In the demo:* `lib/usage-reporting.js` retries failed reports and records anything Stripe couldn't take; `npm run reconcile` compares our records with Stripe's meters and re-sends what's missing.

**Reconciliation**
Checking that two records of the same thing agree (here: tokens the app served vs. tokens Stripe counted) and fixing any gap.

**Idempotency**
Making a request safe to repeat. Each meter event has a unique ID, so a retry can never bill the same reply twice.

**Accrued (unbilled) revenue**
Revenue earned but not yet invoiced. With billing in arrears, the usage in the current month is accrued revenue until the invoice goes out.
*In the demo:* the "in progress" row in each sample customer's invoice table.

**Deferred revenue**
Money received before the service is delivered (for example prepaid credits). It isn't revenue yet; it becomes revenue as the customer uses it. MeterDemo doesn't use prepaid credits, but Stripe supports them (billing credits) and Metronome specializes in them.

**Revenue recognition**
The accounting rules for *when* money counts as revenue: when the service is delivered, not necessarily when the invoice is paid. Stripe has a Revenue Recognition product that automates this from billing data.

**Dunning**
The process of retrying failed payments and reminding customers to update their card. Stripe handles this with automatic retries (Smart Retries) and reminder emails.
