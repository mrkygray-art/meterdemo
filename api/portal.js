// POST /api/portal
// Opens the Stripe Customer Portal: Stripe's own page where the visitor can
// see invoices, change the card, or cancel. Configured in the Dashboard
// (Settings > Billing > Customer portal).

import { stripe } from '../lib/stripe.js';
import { customerFromRequest } from '../lib/session.js';

export async function POST(request) {
  const customerId = customerFromRequest(request);
  if (!customerId) return Response.json({ error: 'Start the demo first.' }, { status: 401 });

  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${new URL(request.url).origin}/chat.html`, // where "Return" in the portal goes
    });
    return Response.json({ url: portal.url });
  } catch (err) {
    console.error('portal failed:', err.message);
    return Response.json({ error: 'Could not open billing. Try again.' }, { status: 500 });
  }
}
