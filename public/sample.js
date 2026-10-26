// Sample customers page: tabs for the three fictional customers, each showing usage,
// invoices and gross margin, all loaded from /api/sample (read live from Stripe).

const $ = (id) => document.getElementById(id);
let samples = null;
let active = 0;

function renderCustomer(i) {
  active = i;
  const c = samples.customers[i];
  document.querySelectorAll('.tab').forEach((t, n) => t.setAttribute('aria-selected', String(n === i)));
  $('profile').textContent = c.profile;

  const u = c.current.usage;
  $('t-current').textContent = fmt.num(u.input + u.output);
  $('t-split').textContent = `${fmt.num(u.input)} input, ${fmt.num(u.output)} output`;
  $('t-estimate').textContent = fmt.money(c.current.estimate);

  const billed = c.invoices.reduce((a, x) => a + x.revenue, 0);
  const profit = c.invoices.reduce((a, x) => a + x.profit, 0);
  $('t-billed').textContent = fmt.money(billed);
  $('t-invoices').textContent = `${c.invoices.length} paid monthly invoices`;
  $('t-margin').textContent = billed > 0 ? fmt.pct(profit / billed) : 'Free tier';
  $('t-profit').textContent = billed > 0
    ? `${fmt.money(profit)} gross profit`
    : `Costs ${fmt.money(-profit)} to serve so far (the free allowance at work)`;

  const draw = () =>
    stackedBars($('daily'), c.days.map((d) => ({
      label: fmt.day(d.day),
      parts: [d.input, d.output],
      tip: `<b>${fmt.day(d.day)}</b><br>${fmt.num(d.input)} input tokens<br>${fmt.num(d.output)} output tokens`,
    })), { classes: ['seg-input', 'seg-output'], labelEvery: 10 });
  draw();
  window.onresize = draw;

  const rows = [...c.invoices].reverse().map((inv) => `<tr>
      <td>${fmt.day(inv.periodStart)} - ${fmt.day(inv.periodEnd)}<br><span class="muted small">${fmt.esc(inv.number)}</span></td>
      <td class="num">${fmt.num(inv.usage.input)}</td>
      <td class="num">${fmt.num(inv.usage.output)}</td>
      <td class="num">${fmt.money(inv.revenue)}</td>
      <td class="num">${fmt.money(inv.modelCost)}</td>
      <td class="num">${fmt.money(inv.fees)}</td>
      <td class="num ${inv.profit < 0 ? 'neg' : ''}">${fmt.money(inv.profit)}</td>
      <td class="num">${fmt.pct(inv.marginPct)}</td>
      <td><span class="status-${fmt.esc(inv.status)}">${fmt.esc(inv.status)}</span></td>
      <td class="links">${inv.url ? `<a href="${fmt.esc(inv.url)}" target="_blank" rel="noopener">View</a>` : ''}
        ${inv.pdf ? `<a href="${fmt.esc(inv.pdf)}" target="_blank" rel="noopener">PDF</a>` : ''}</td>
    </tr>`);
  const cur = c.current;
  rows.unshift(`<tr class="current">
      <td>${fmt.day(cur.periodStart)} - ${fmt.day(cur.periodEnd)}<br><span class="muted small">In progress (estimate)</span></td>
      <td class="num">${fmt.num(cur.usage.input)}</td>
      <td class="num">${fmt.num(cur.usage.output)}</td>
      <td class="num">${fmt.money(cur.revenue)}</td>
      <td class="num">${fmt.money(cur.modelCost)}</td>
      <td class="num">${fmt.money(cur.fees)}</td>
      <td class="num ${cur.profit < 0 ? 'neg' : ''}">${fmt.money(cur.profit)}</td>
      <td class="num">${fmt.pct(cur.marginPct)}</td>
      <td class="muted">upcoming</td><td></td>
    </tr>`);
  $('invoices').innerHTML = rows.join('');
}

fetch('/api/sample')
  .then((r) => r.json())
  .then((s) => {
    if (s.error) throw new Error(s.error);
    if (!s.available) throw new Error('The sample accounts are being rebuilt. Check back in a few minutes.');
    samples = s;
    $('asof').textContent = `Data as of ${new Date(s.asOf * 1000).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })} on the samples' Stripe test clock.`;
    $('tabs').innerHTML = s.customers
      .map((c, i) => `<button class="tab" role="tab" data-i="${i}">${fmt.esc(c.name)}</button>`)
      .join('');
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => renderCustomer(+t.dataset.i)));
    $('content').hidden = false; // show first so the chart can measure its width
    const wanted = s.customers.findIndex((c) => c.key === new URLSearchParams(location.search).get('c'));
    renderCustomer(wanted >= 0 ? wanted : 1);
  })
  .catch((err) => ($('error').textContent = err.message));

$('portal').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const res = await fetch(`/api/sample-portal?i=${active}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    location.href = data.url;
  } catch (err) {
    $('error').textContent = err.message;
    btn.disabled = false;
  }
});
