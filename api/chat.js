// POST /api/chat   body: { message: "...", history: [{ role, content }, ...] }
// Sends the visitor's message to OpenAI, returns the reply, and reports the
// tokens it used to the Stripe meters. Those meter events are what Stripe bills.

import { stripe, latestSubscription } from '../lib/stripe.js';
import { customerFromRequest } from '../lib/session.js';
import { reportUsage } from '../lib/usage-reporting.js';

const MODEL = process.env.OPENAI_MODEL || 'gpt-6-luna';

// Guardrails so a public demo can't run up an OpenAI bill.
const MAX_MESSAGE_CHARS = 500; // longest message a visitor can send
const MAX_HISTORY_TURNS = 6; // earlier messages sent along for context
const MAX_REPLY_TOKENS = 300; // longest reply the model may write
const MAX_MESSAGES_PER_MINUTE = 6;
const MAX_MESSAGES_PER_CUSTOMER = 30; // total, for the life of a demo customer

const INSTRUCTIONS = `You are the assistant inside MeterDemo, a demo of usage-based billing with Stripe in test mode.
Every reply you write is metered by tokens and billed through Stripe usage-based prices.
Be friendly and brief (under 120 words). If asked how the demo works, explain simply:
input tokens (what the visitor sends) and output tokens (what you write) go to two Stripe Meters.
Output tokens cost the AI provider about 5x more, so they're priced higher. Each has a monthly
free allowance (2,000 input, 500 output), and Stripe adds the rest to a monthly invoice.
No real money is involved.`;

// Best-effort per-minute limit. Each server instance keeps its own memory,
// so the per-customer total below (stored in Stripe) is the firm cap.
const recent = new Map(); // customerId -> timestamps of recent messages
function tooFast(customerId) {
  const now = Date.now();
  const times = (recent.get(customerId) || []).filter((t) => now - t < 60_000);
  times.push(now);
  recent.set(customerId, times);
  return times.length > MAX_MESSAGES_PER_MINUTE;
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
}

// The Responses API returns a list of output items; join the text parts.
function replyText(data) {
  return (data.output || [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('')
    .trim();
}

export async function POST(request) {
  const customerId = customerFromRequest(request);
  if (!customerId) return Response.json({ error: 'Start the demo first.' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Bad request.' }, { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return Response.json({ error: 'Type a message first.' }, { status: 400 });
  if (message.length > MAX_MESSAGE_CHARS) {
    return Response.json({ error: `Keep messages under ${MAX_MESSAGE_CHARS} characters.` }, { status: 400 });
  }
  if (tooFast(customerId)) {
    return Response.json({ error: 'Slow down a little. Try again in a minute.' }, { status: 429 });
  }

  try {
    // Check the visitor still has a live subscription and hasn't hit the demo cap.
    const [customer, sub] = await Promise.all([stripe.customers.retrieve(customerId), latestSubscription(customerId)]);
    if (!sub || !['active', 'trialing'].includes(sub.status)) {
      return Response.json({ error: 'This demo subscription has ended. Start a new demo to keep chatting.' }, { status: 403 });
    }
    const sent = Number(customer.metadata?.demo_messages || 0);
    if (sent >= MAX_MESSAGES_PER_CUSTOMER) {
      return Response.json({ error: `Demo limit reached (${MAX_MESSAGES_PER_CUSTOMER} messages). Thanks for trying it!` }, { status: 429 });
    }

    // Ask OpenAI for a reply.
    const aiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        instructions: INSTRUCTIONS,
        input: [...cleanHistory(body.history), { role: 'user', content: message }],
        max_output_tokens: MAX_REPLY_TOKENS,
        reasoning: { effort: 'none' },
        store: false,
      }),
    });
    const data = await aiRes.json();
    if (!aiRes.ok) {
      console.error('OpenAI error:', aiRes.status, data?.error?.message);
      return Response.json({ error: 'The assistant is unavailable right now.' }, { status: 502 });
    }

    const reply = replyText(data) || '(No reply.)';
    const usage = {
      input: data.usage?.input_tokens || 0,
      output: data.usage?.output_tokens || 0,
      total: data.usage?.total_tokens || 0,
    };

    // Report usage to Stripe (the "metering" step). The reply has already been
    // generated, so we must not lose this usage: reportUsage retries, and if Stripe
    // still can't be reached it records the tokens as unreported for reconciliation.
    const reported = await reportUsage(customerId, data.id, usage, { messages: sent + 1 });

    return Response.json({ reply, usage, reported });
  } catch (err) {
    console.error('chat failed:', err.message);
    return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
  }
}
