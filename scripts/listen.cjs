// Forwards Stripe webhook events to the local app while you test.
// Uses the sandbox key from .env, so it always listens to the same
// Stripe account the app uses (no `stripe login` needed).
//
// Run with:  npm run listen
// It prints a webhook signing secret (whsec_...). Put that in .env as STRIPE_WEBHOOK_SECRET.

const { spawn } = require('child_process');

const key = process.env.STRIPE_SECRET_KEY || '';
if (!key.startsWith('sk_test_') || key.includes('replace_me')) {
  console.error('STRIPE_SECRET_KEY in .env must be your real sk_test_ key. Stopping.');
  process.exit(1);
}

// The only events the app's webhook handles.
const EVENTS = [
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.created',
  'customer.subscription.deleted',
].join(',');

// Every piece is plain letters, digits and punctuation (checked below), so it's
// safe to pass as one command line. A single string (rather than a list of
// args) lets Windows find the npm-installed `stripe` command without warnings.
const command = ['stripe', 'listen', '--api-key', key, '--forward-to', 'localhost:3000/api/webhook', '--events', EVENTS].join(' ');
if (!/^[\w\s.,:/-]+$/.test(command)) {
  console.error('Unexpected characters in the Stripe command. Stopping.');
  process.exit(1);
}

const child = spawn(command, { stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
