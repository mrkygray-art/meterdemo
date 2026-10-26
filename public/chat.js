// Chat page: send messages, show replies, and keep the usage panel in step with Stripe.

const messagesEl = document.getElementById('messages');
const form = document.getElementById('composer');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const panel = document.getElementById('panel');
const panelError = document.getElementById('panel-error');
const history = []; // recent turns sent along for context

const money = (cents, currency = 'usd') =>
  (cents / 100).toLocaleString(undefined, { style: 'currency', currency: currency.toUpperCase() });
const date = (unix) => new Date(unix * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const num = (n) => n.toLocaleString();

function addMessage(role, text, meta) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  if (meta) {
    const m = document.createElement('span');
    m.className = 'meta';
    m.textContent = meta;
    el.appendChild(m);
  }
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function row(label, value, cls = '') {
  return `<div class="stat"><span>${label}</span><b class="${cls}">${value}</b></div>`;
}

async function loadUsage() {
  try {
    const res = await fetch('/api/usage');
    const u = await res.json();
    if (!res.ok) throw new Error(u.error);
    if (!u.started) {
      location.href = '/'; // no demo session in this browser
      return;
    }
    panelError.textContent = '';

    const sub = u.subscription;
    let subText = sub.status;
    if (sub.cancelAtPeriodEnd && sub.status === 'active') subText = `cancels ${date(sub.periodEnd)}`;

    let html = '';
    // One block per metered price (v2: input and output tokens; v1: one token price).
    for (const m of u.meters) {
      const pct = m.free ? Math.min((m.used / m.free) * 100, 100) : 100;
      html += row(m.label, num(m.used));
      html += `<div class="bar" title="${m.label}: free allowance used"><div style="width:${pct}%"></div></div>`;
      html += `<p class="muted small" style="margin:-8px 0 8px">${num(m.freeRemaining)} of ${num(m.free)} free left</p>`;
    }
    html += row('Estimated charge', u.estimate ? money(u.estimate.amountDue, u.estimate.currency) : '-');
    html += row('Invoice date', u.estimate ? date(u.estimate.invoiceDate) : '-');
    html += row('Subscription', subText, `status-${sub.status}`);
    if (u.latestInvoice) {
      const inv = u.latestInvoice;
      const label = inv.status === 'paid' ? `Paid ${money(inv.total)}` : 'Payment failed';
      const link = inv.url ? ` <a href="${inv.url}" target="_blank" rel="noopener">view</a>` : '';
      html += row('Latest invoice', label + link, `status-${inv.status}`);
    }
    html += `<p class="muted small" style="margin-top:10px">Estimate comes from Stripe's invoice preview.</p>`;
    panel.classList.remove('muted');
    panel.innerHTML = html;

    const ended = !['active', 'trialing', 'past_due'].includes(sub.status);
    input.disabled = sendBtn.disabled = ended;
    if (ended) input.placeholder = 'This demo subscription has ended. Start a new demo from the home page.';
  } catch (err) {
    panelError.textContent = err.message || 'Could not load usage.';
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  addMessage('user', message);
  input.value = '';
  sendBtn.disabled = true;
  const thinking = addMessage('assistant', '...');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    });
    const data = await res.json();
    thinking.remove();
    if (!res.ok) throw new Error(data.error);

    const u = data.usage;
    const note = data.reported ? 'metered' : 'saved for reconciliation (Stripe was unreachable)';
    addMessage('assistant', data.reply, `${num(u.input)} input + ${num(u.output)} output tokens ${note}`);
    history.push({ role: 'user', content: message }, { role: 'assistant', content: data.reply });

    // Stripe processes meter events in the background (often 30-60 seconds),
    // so check the panel again a few times.
    [5000, 20000, 40000, 70000].forEach((ms) => setTimeout(loadUsage, ms));
  } catch (err) {
    thinking.remove();
    addMessage('assistant', err.message || 'Something went wrong.');
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
});

document.getElementById('manage').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const res = await fetch('/api/portal', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    location.href = data.url; // Stripe's hosted Customer Portal
  } catch (err) {
    panelError.textContent = err.message || 'Could not open billing.';
    btn.disabled = false;
  }
});

loadUsage();
