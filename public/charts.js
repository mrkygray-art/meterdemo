// Small shared helpers: formatting, a tooltip, and a bar chart (plain SVG, no library).

const fmt = {
  money: (cents, currency = 'usd') =>
    (cents / 100).toLocaleString(undefined, { style: 'currency', currency: currency.toUpperCase() }),
  num: (n) => Math.round(n).toLocaleString(),
  pct: (p) => (p === null || p === undefined ? '-' : `${Math.round(p * 100)}%`),
  day: (t) => new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  month: (t) => new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }),
  esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]),
};

const tip = {
  el: null,
  show(evt, html) {
    this.el = this.el || document.getElementById('tooltip');
    this.el.innerHTML = html;
    this.el.hidden = false;
    const pad = 12;
    const x = Math.min(evt.clientX + pad, window.innerWidth - this.el.offsetWidth - pad);
    this.el.style.left = `${x}px`;
    this.el.style.top = `${Math.max(evt.clientY - this.el.offsetHeight - pad, pad)}px`;
  },
  hide() {
    if (this.el) this.el.hidden = true;
  },
};

// A "nice" axis maximum split into 4 gridlines (e.g. 0, 5K, 10K, 15K, 20K).
function niceMax(v) {
  const step = Math.pow(10, Math.floor(Math.log10(v / 4)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step * 4 >= v) return m * step * 4;
  return v;
}
const shortNum = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : String(Math.round(n)));

// Rounded top (4px), square base on the baseline.
function roundedTop(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Stacked bars. bars: [{ label, parts: [value, value], tip }], classes: one per part.
function stackedBars(el, bars, { height = 220, classes = ['seg-input'], labelEvery = 1 } = {}) {
  const width = el.clientWidth || 800;
  const m = { top: 12, right: 8, bottom: 26, left: 48 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;
  const totals = bars.map((b) => b.parts.reduce((a, v) => a + v, 0));
  const max = niceMax(Math.max(...totals, 1));
  const slot = w / bars.length;
  const bw = Math.max(1, Math.min(slot - Math.max(2, slot * 0.25), 40));

  let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">`;
  for (let i = 0; i <= 4; i++) {
    const y = m.top + h - (h * i) / 4;
    svg += `<line x1="${m.left}" x2="${width - m.right}" y1="${y}" y2="${y}" class="grid"/>`;
    svg += `<text x="${m.left - 8}" y="${y + 4}" text-anchor="end" class="axis">${shortNum((max * i) / 4)}</text>`;
  }
  bars.forEach((b, i) => {
    const x = m.left + i * slot + (slot - bw) / 2;
    let base = m.top + h;
    b.parts.forEach((v, p) => {
      const ph = (v / max) * h;
      if (ph <= 0) return;
      const top = p === b.parts.length - 1 || b.parts.slice(p + 1).every((n) => !n);
      // 2px surface gap between stacked segments
      const segH = Math.max(ph - (p > 0 ? 2 : 0), 0.5);
      const y = base - ph;
      svg += top
        ? `<path d="${roundedTop(x, y, bw, segH)}" class="${classes[p]}"/>`
        : `<rect x="${x}" y="${y}" width="${bw}" height="${segH}" class="${classes[p]}"/>`;
      base = y;
    });
    svg += `<rect x="${m.left + i * slot}" y="${m.top}" width="${slot}" height="${h}" class="hit" data-i="${i}"/>`;
    if (i % labelEvery === 0) svg += `<text x="${x + bw / 2}" y="${height - 8}" text-anchor="middle" class="axis">${fmt.esc(b.label)}</text>`;
  });
  el.innerHTML = svg + '</svg>';
  el.querySelectorAll('.hit').forEach((r) => {
    const b = bars[+r.dataset.i];
    r.addEventListener('mousemove', (e) => tip.show(e, b.tip));
    r.addEventListener('mouseleave', () => tip.hide());
  });
}
