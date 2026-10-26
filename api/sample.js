// GET /api/sample
// The three read-only sample customers: invoices with revenue, AI cost, Stripe fees
// and gross margin; daily input/output usage; and the current month's estimate.
// Everything comes from Stripe (see lib/sample.js).

import { loadSamples } from '../lib/sample.js';

export async function GET() {
  try {
    return Response.json(await loadSamples());
  } catch (err) {
    console.error('sample failed:', err.message);
    return Response.json({ error: 'Could not load the sample accounts.' }, { status: 500 });
  }
}
