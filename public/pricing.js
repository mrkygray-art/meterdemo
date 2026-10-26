// Pricing lab: loads /api/pricing (real usage from Stripe meters, four pricing models)
// and shows the margin table per customer plus findings worked out from the numbers.

const $ = (id) => document.getElementById(id);

function findings(d) {
  const byKey = Object.fromEntries(d.customers.map((c) => [c.key, c]));
  const r = (c, id) => c.results.find((x) => x.id === id);
  const out = [];
  const power = byKey.power, growing = byKey.growing, light = byKey.light;

  if (power) {
    const flat = r(power, 'flat');
    out.push(`<b>The flat plan loses money on heavy users.</b> ${fmt.esc(power.name)} pays ${fmt.money(flat.revenue)} on the flat plan,
      but serving them costs ${fmt.money(flat.modelCost)} in AI usage alone, a gross loss of ${fmt.money(-flat.profit)} a month.
      The more they use, the more the company loses.`);
  }
  if (power && growing) {
    const pb = r(power, 'blended'), gb = r(growing, 'blended');
    out.push(`<b>One price for all tokens hides where the cost is.</b> With a single token price, ${fmt.esc(power.name)}'s margin is
      ${fmt.pct(pb.marginPct)} against ${fmt.pct(gb.marginPct)} for ${fmt.esc(growing.name)}, because ${Math.round((power.usage.output / (power.usage.input + power.usage.output)) * 100)}%
      of ${fmt.esc(power.name)}'s tokens are output tokens, which cost 5x more to produce but are priced the same.`);
  }
  if (growing) {
    const gf = r(growing, 'flat');
    const tokens = growing.usage.input + growing.usage.output;
    const costPerToken = gf.modelCost / tokens;
    const breakEven = (gf.revenue - gf.fees) / costPerToken;
    out.push(`<b>Flat looks best for moderate users, until they grow.</b> ${fmt.esc(growing.name)} earns a ${fmt.pct(gf.marginPct)} margin on the
      flat plan today, but at its usage mix the flat plan stops covering cost at about ${fmt.num(Math.round(breakEven / 1000) * 1000)} tokens a month${
        growing.previousTokens ? `, and its usage grew ${fmt.pct(tokens / growing.previousTokens - 1)} last month` : ''}.
      Usage pricing turns that growth into revenue instead of cost.`);
  }
  if (light) {
    const lb = r(light, 'base');
    out.push(`<b>A base fee overcharges light users.</b> ${fmt.esc(light.name)} used ${fmt.num(light.usage.input + light.usage.output)} tokens
      (${fmt.money(r(light, 'split').modelCost)} of AI cost) but would pay ${fmt.money(lb.revenue)} on the base-fee plan. Customers notice that, and it drives cancellations.`);
  }
  const paying = d.customers.map((c) => r(c, 'split')).filter((x) => x.revenue > 0);
  if (paying.length) {
    const lo = Math.min(...paying.map((x) => x.marginPct)), hi = Math.max(...paying.map((x) => x.marginPct));
    let text = `<b>Input + output pricing keeps every paying customer profitable.</b> Gross margins land between ${fmt.pct(lo)} and ${fmt.pct(hi)},
      whatever the mix of input and output, because the price follows the cost.`;
    if (light) {
      const ls = r(light, 'split');
      if (ls.revenue === 0) text += ` ${fmt.esc(light.name)} stays inside the free allowance and costs ${fmt.money(-ls.profit)} a month to serve: the price of letting new customers start free.`;
    }
    out.push(text + ' That is the pricing now live in Stripe.');
  }
  return out;
}

function table(c, models) {
  const rows = c.results.map((x) => {
    const m = models.find((mm) => mm.id === x.id);
    return `<tr class="${m.live ? 'live' : ''}">
      <td><b>${fmt.esc(m.name)}</b>${m.live ? ' <span class="badge">live</span>' : ''}<br><span class="muted small">${fmt.esc(m.summary)}</span></td>
      <td class="num">${fmt.money(x.revenue)}</td>
      <td class="num">${fmt.money(x.modelCost)}</td>
      <td class="num">${fmt.money(x.fees)}</td>
      <td class="num ${x.profit < 0 ? 'neg' : ''}">${fmt.money(x.profit)}</td>
      <td class="num ${x.profit < 0 ? 'neg' : ''}">${x.revenue > 0 ? fmt.pct(x.marginPct) : 'free'}</td>
    </tr>`;
  });
  const u = c.usage;
  return `<section class="card lab">
    <h2>${fmt.esc(c.name)}</h2>
    <p class="muted small">${fmt.esc(c.profile)} ${c.month ? `Usage for ${fmt.day(c.month.start)} - ${fmt.day(c.month.end)}` : ''}:
      <b>${fmt.num(u.input)}</b> input + <b>${fmt.num(u.output)}</b> output tokens.
      <a href="/sample.html?c=${fmt.esc(c.key)}">See their invoices</a></p>
    <div class="table-wrap"><table>
      <thead><tr><th>Pricing model</th><th class="num">Customer pays</th><th class="num">AI cost</th><th class="num">Stripe fees</th>
        <th class="num">Gross profit</th><th class="num">Margin</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>
  </section>`;
}

fetch('/api/pricing')
  .then((r) => r.json())
  .then((d) => {
    if (d.error) throw new Error(d.error);
    if (!d.available) throw new Error('The sample accounts are being rebuilt. Check back in a few minutes.');
    $('findings').innerHTML = findings(d).map((f) => `<li>${f}</li>`).join('');
    $('tables').innerHTML = d.customers.map((c) => table(c, d.models)).join('');
    const a = d.assumptions;
    $('assumptions').innerHTML = [
      `AI cost: ${fmt.money(a.costPer1kInput)} per 1K input tokens and ${fmt.money(a.costPer1kOutput)} per 1K output tokens (gpt-6-luna list price, scaled 1,000x like every price in this demo so test invoices show visible cents; margins are unaffected by the scaling).`,
      `Stripe fees: ${(a.cardPercent * 100).toFixed(1)}% + ${a.cardFixed}c per card charge, plus ${(a.billingPercent * 100).toFixed(1)}% of billing volume for Stripe Billing (Stripe's standard US pricing). Amounts under 50c aren't charged.`,
      'Gross margin here covers direct costs only (AI usage and payment fees), not salaries, hosting or marketing.',
      'Usage is each customer\'s latest full month from the Stripe meters. The live bill always comes from Stripe\'s own invoice preview; this lab applies each model\'s rules to that usage.',
    ].map((t) => `<li>${t}</li>`).join('');
    $('content').hidden = false;
  })
  .catch((err) => ($('error').textContent = err.message));
