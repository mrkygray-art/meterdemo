// POST /api/sample-portal
// Opens the Stripe Customer Portal for the sample account, using a read-only portal
// configuration (invoice history only), so visitors can browse its invoices but
// can't cancel it or change its card.

import { stripe } from '../lib/stripe.js';
import { sampleIds } from '../lib/sample.js';

// POST /api/sample-portal?i=0   (which sample customer: 0, 1 or 2)
export async function POST(request) {
  try {
    const ids = await sampleIds();
    if (!ids) return Response.json({ error: 'The sample accounts are being rebuilt. Try again soon.' }, { status: 503 });
    const i = Number(new URL(request.url).searchParams.get('i') || 0);
    const customerId = ids.customerIds[i];
    if (!customerId) return Response.json({ error: 'Unknown sample account.' }, { status: 400 });

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      configuration: ids.portalConfig,
      return_url: `${new URL(request.url).origin}/sample.html`,
    });
    return Response.json({ url: portal.url });
  } catch (err) {
    console.error('sample-portal failed:', err.message);
    return Response.json({ error: 'Could not open the sample billing portal.' }, { status: 500 });
  }
}
