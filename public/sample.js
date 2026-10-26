// Sample account page: loads the fictional customer's year of usage and invoices from
// /api/sample and draws two simple bar charts plus an invoice table.

const $ = (id) => document.getElementById(id);
const money = (cents, currency = 'usd') =>
  (cents / 100).toLocaleString(undefined, { style: 'currency', currency: currency.toUpperCase() });
const num = (n) => Math.round(n).toLocaleString();
const monthName = (t) => new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayName = (t) => new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const tooltip = $('tooltip');
function showTip(evt, html) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const pad = 12;
  const x = Math.min(evt.clientX + pad, window.innerWidth - tooltip.offsetWidth - pad);
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${evt.clientY - tooltip.offsetHeight - pad}px`;
}
const hideTip = () => (tooltip.hidden = true);

// A "nice" axis maximum and 4 gridlines (e.g. 0, 15K, 30K, 45K, 60K).
function niceMax(v) {
  const step = Math.pow(10, Math.floor(Math.log10(v / 4)));
  for (const m of [1, 2, 2.5, 5, 10]) if ((m * step * 4) >= v) return m * step * 4;
  return v;
}
const short = (n) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : String(n));

// Bar with a 4px rounded top and a square base on the baseline.
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// bars: [{ label, value, tip, labelEvery }]
function barChart(el, bars, { height = 240, showLabel = () => true } = {}) {
  const width = el.clientWidth || 800;
  const m = { top: 12, right: 8, bottom: 26, left: 44 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;
  const max = niceMax(Math.max(...bars.map((b) => b.value), 1));
  const slot = w / bars.length;
  const gap = Math.max(2, Math.min(slot * 0.3, 14)); // at least a 2px surface gap between bars
  const bw = Math.max(1, Math.min(slot - gap, 56)); // thin marks, even when there are few bars

  let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">`;
  for (let i = 0; i <= 4; i++) {
    const y = m.top + h - (h * i) / 4;
    svg += `<line x1="${m.left}" x2="${width - m.right}" y1="${y}" y2="${y}" class="grid"/>`;
    svg += `<text x="${m.left - 8}" y="${y + 4}" text-anchor="end" class="axis">${short((max * i) / 4)}</text>`;
  }
  bars.forEach((b, i) => {
    const bh = (b.value / max) * h;
    const x = m.left + i * slot + (slot - bw) / 2; // centered in its column
    const y = m.top + h - bh;
    const cls = b.inProgress ? 'bar in-progress' : 'bar';
    if (bh > 0) svg += `<path d="${barPath(x, y, bw, bh)}" class="${cls}"/>`;
    // Hit target: the full column, bigger than the bar itself.
    svg += `<rect x="${m.left + i * slot}" y="${m.top}" width="${slot}" height="${h}" class="hit" data-i="${i}"/>`;
    if (showLabel(i)) svg += `<text x="${x + bw / 2}" y="${height - 8}" text-anchor="middle" class="axis">${esc(b.label)}</text>`;
  });
  svg += '</svg>';
  el.innerHTML = svg;

  el.querySelectorAll('.hit').forEach((r) => {
    const b = bars[+r.dataset.i];
    r.addEventListener('mousemove', (e) => showTip(e, b.tip));
    r.addEventListener('mouseleave', hideTip);
  });
}

function render(s) {
  $('title').textContent = `Sample account: ${s.customer.name.replace(/\s*\(sample\)$/i, '')}`;
  $('asof').textContent = `Data as of ${new Date(s.asOf * 1000).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })} on the sample's Stripe test clock.`;

  const billed = s.invoices.reduce((a, i) => a + i.amount, 0);
  const tokens = s.invoices.reduce((a, i) => a + i.tokens, 0);
  $('t-current').textContent = num(s.current.tokens);
  $('t-estimate').textContent = money(s.current.estimate, s.current.currency);
  $('t-billed').textContent = money(billed);
  $('t-tokens').textContent = num(tokens);

  const monthBars = s.invoices.map((inv) => ({
    label: monthName(inv.periodStart),
    value: inv.tokens,
    tip: `<b>${monthName(inv.periodStart)}</b><br>${num(inv.tokens)} tokens<br>${num(inv.freeTokens)} free, ${num(inv.paidTokens)} billed<br>Invoice: ${money(inv.amount)} (${esc(inv.status)})`,
  }));
  monthBars.push({
    label: 'This month',
    value: s.current.tokens,
    inProgress: true,
    tip: `<b>This month so far</b><br>${num(s.current.tokens)} tokens<br>Estimated: ${money(s.current.estimate)}`,
  });
  const dayBars = s.days.slice(-60).map((d) => ({
    label: dayName(d.day),
    value: d.tokens,
    tip: `<b>${dayName(d.day)}</b><br>${num(d.tokens)} tokens`,
  }));
  const draw = () => {
    barChart($('monthly'), monthBars);
    barChart($('daily'), dayBars, { height: 200, showLabel: (i) => i % 10 === 0 });
  };

  $('invoices').innerHTML = s.invoices
    .slice()
    .reverse()
    .map((inv) => `<tr>
      <td>${dayName(inv.periodStart)} - ${dayName(inv.periodEnd)}</td>
      <td>${esc(inv.number || '')}</td>
      <td class="num">${num(inv.tokens)}</td>
      <td class="num">${num(inv.freeTokens)}</td>
      <td class="num">${num(inv.paidTokens)}</td>
      <td class="num">${money(inv.amount)}</td>
      <td><span class="status-${esc(inv.status)}">${esc(inv.status)}</span></td>
      <td class="links">${inv.url ? `<a href="${esc(inv.url)}" target="_blank" rel="noopener">View</a>` : ''}
        ${inv.pdf ? `<a href="${esc(inv.pdf)}" target="_blank" rel="noopener">PDF</a>` : ''}</td>
    </tr>`)
    .join('');

  $('content').hidden = false; // show first so the charts can measure their width
  draw();
  window.addEventListener('resize', draw);
}

fetch('/api/sample')
  .then((r) => r.json())
  .then((s) => {
    if (s.error) throw new Error(s.error);
    if (!s.available) throw new Error('The sample account is being rebuilt. Check back in a few minutes.');
    render(s);
  })
  .catch((err) => ($('error').textContent = err.message));

$('portal').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const res = await fetch('/api/sample-portal', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    location.href = data.url;
  } catch (err) {
    $('error').textContent = err.message;
    btn.disabled = false;
  }
});
