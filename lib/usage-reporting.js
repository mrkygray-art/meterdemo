// Reporting usage to Stripe without losing any.
//
// By the time we report, the AI reply has already been generated (and paid for).
// If the report to Stripe fails and nobody notices, that usage is never billed:
// "revenue leakage". So we:
//   1. retry a few times with a short wait (most failures are brief)
//   2. use the same identifier on every retry, so Stripe never counts a reply twice
//   3. keep a running total of tokens reported on the customer (our own record)
//   4. if Stripe still can't take it, record the tokens as "unreported" so the
//      reconcile script (npm run reconcile) can send them later
//
// The customer metadata is written last. If that write fails, the reconcile
// script still catches the gap by comparing our record with Stripe's meters.

import { stripe, PRICES, TOTAL_EVENT_NAME } from './stripe.js';

const RETRY_WAITS_MS = [250, 1000, 3000];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendWithRetry(params) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_WAITS_MS.length; attempt++) {
    try {
      return await stripe.billing.meterEvents.create(params);
    } catch (err) {
      lastErr = err;
      const retryable = !err.statusCode || err.statusCode === 429 || err.statusCode >= 500;
      if (!retryable || attempt === RETRY_WAITS_MS.length) break;
      await wait(RETRY_WAITS_MS[attempt]);
    }
  }
  throw lastErr;
}

// usage: { input, output, total } tokens for one AI reply. replyId makes it idempotent.
export async function reportUsage(customerId, replyId, usage, { messages } = {}) {
  const events = [
    { event_name: PRICES.input.eventName, value: usage.input, identifier: `${replyId}-in` },
    { event_name: PRICES.output.eventName, value: usage.output, identifier: `${replyId}-out` },
    // v1 meter (all tokens), so subscriptions on the old price keep billing correctly
    { event_name: TOTAL_EVENT_NAME, value: usage.total, identifier: `${replyId}-total` },
  ];

  // Different meters can be written in parallel (Stripe allows one at a time per meter).
  const results = await Promise.allSettled(
    events.map((e) =>
      sendWithRetry({
        event_name: e.event_name,
        payload: { stripe_customer_id: customerId, value: String(e.value) },
        identifier: e.identifier,
      }),
    ),
  );
  const ok = (i) => results[i].status === 'fulfilled';
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`UNREPORTED USAGE ${events[i].event_name} ${customerId}:`, r.reason?.message);
  });

  // Our own record, used by the reconcile script.
  const customer = await stripe.customers.retrieve(customerId);
  const m = customer.metadata || {};
  const add = (key, n) => String(Number(m[key] || 0) + n);
  const metadata = {
    reported_input_tokens: add('reported_input_tokens', ok(0) ? usage.input : 0),
    reported_output_tokens: add('reported_output_tokens', ok(1) ? usage.output : 0),
    unreported_input_tokens: add('unreported_input_tokens', ok(0) ? 0 : usage.input),
    unreported_output_tokens: add('unreported_output_tokens', ok(1) ? 0 : usage.output),
  };
  if (messages) metadata.demo_messages = String(messages);
  await stripe.customers.update(customerId, { metadata });

  return ok(0) && ok(1);
}
