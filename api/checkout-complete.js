// GET /api/checkout-complete?session_id=cs_test_...
// Stripe sends the visitor here after Checkout. We confirm with Stripe that
// the Checkout really finished, remember the customer in a signed cookie,
// and send the visitor to the chat page.

import { stripe } from '../lib/stripe.js';
import { sessionCookie } from '../lib/session.js';

export async function GET(request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id') || '';

  try {
    if (!sessionId.startsWith('cs_')) throw new Error('missing session_id');

    // Ask Stripe directly; never trust the URL alone.
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status !== 'complete' || !session.customer) throw new Error(`session status ${session.status}`);

    return new Response(null, {
      status: 303,
      headers: {
        Location: `${url.origin}/chat.html`,
        'Set-Cookie': sessionCookie(session.customer, request.url),
      },
    });
  } catch (err) {
    console.error('checkout-complete failed:', err.message);
    return Response.redirect(`${url.origin}/?checkout=failed`, 303);
  }
}
