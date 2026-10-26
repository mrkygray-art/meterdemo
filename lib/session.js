// The demo has no database and no logins. After Checkout, we remember which
// Stripe customer this browser belongs to in a signed, HTTP-only cookie.
//
// "Signed" means the cookie carries a fingerprint made with COOKIE_SECRET.
// If anyone edits the customer ID, the fingerprint no longer matches and we
// ignore the cookie. "HTTP-only" means page JavaScript can't read it.

import crypto from 'node:crypto';

const COOKIE_NAME = 'md_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.COOKIE_SECRET || '';
  if (s.length < 32 || s.includes('replace')) throw new Error('COOKIE_SECRET is missing or too short.');
  return s;
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

// Build the Set-Cookie header value for a customer.
export function sessionCookie(customerId, requestUrl) {
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  const value = `${customerId}.${sign(customerId)}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secure}`;
}

// Read the customer ID back from the request, or null if missing or tampered with.
export function customerFromRequest(request) {
  const header = request.headers.get('cookie') || '';
  const match = header.split(/;\s*/).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;

  const raw = match.slice(COOKIE_NAME.length + 1);
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;

  const customerId = raw.slice(0, dot);
  const given = Buffer.from(raw.slice(dot + 1));
  const expected = Buffer.from(sign(customerId));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  return customerId.startsWith('cus_') ? customerId : null;
}
