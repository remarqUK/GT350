// dashboard.js — renders the GT350 market view (mileage vs price).
import { SEED_LISTINGS, regionMeta, REGIONS, toGBP, FX } from './data.js';

const GBP = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat('en-GB');

const state = {
  basis: 'asking', // 'asking' | 'landed'
  listings: [],
  liveMerged: 0,
  filters: {
    status: 'all', // 'all' | 'live' | 'sold'
    model: 'all', // 'all' | 'gt350' | 'gt350r'
    regions: new Set(Object.keys(REGIONS)),
  },
};

// Points passing the current filter set. Reference stock only shows under "All".
function visible() {
  const f = state.filters;
  return state.listings.filter((p) => {
    if (f.model !== 'all' && p.model !== f.model) return false;
    if (!f.regions.has(p.region)) return false;
    if (f.status === 'live' && p.status !== 'live') return false;
    if (f.status === 'sold' && p.status !== 'sold') return false;
    return true;
  });
}

// --- data loading ------------------------------------------------------------

async function loadDataset() {
  let live = [];
  try {
    const store = await chrome.storage?.local.get('listings');
    const raw = Array.isArray(store?.listings) ? store.listings : [];
    // Only merge points we can actually plot and trust: real mileage + price.
    live = raw
      .filter((l) => l && l.price > 0 && l.mileage > 0)
      .map((l, i) => ({
        id: `fetched-${i}`,
        model: /gt350r/i.test(l.title || '') ? 'gt350r' : 'gt350',
        year: l.year || null,
        region: l.region || guessRegion(l),
        status: 'live',
        mileage: l.mileage,
        // Convert overseas asking prices to GBP up front; landed import costs
        // (duty + VAT + shipping) are applied later by the region model.
        price: toGBP(l.price, l.currency || 'GBP'),
        currency: l.currency || 'GBP',
        note: `${l.site || 'live'} — ${l.title || ''}`.trim(),
        fetched: true,
      }));
  } catch {
    live = [];
  }
  state.liveMerged = live.length;
  state.listings = [...SEED_LISTINGS, ...live];
}

function guessRegion(l) {
  // Landed-cost tier. UK marketplaces default to a car already in the UK; only
  // override when the listing text says it's a mainland-EU or overseas import.
  const s = `${l.site || ''} ${l.location || ''} ${l.title || ''}`.toLowerCase();
  if (/\bjapan|jdm|us import|american import|canada|canadian|fresh import\b/.test(s)) return 'overseas';
  if (/\beu import|european import|germany|france|netherlands|belgium|spain|italy|ireland\b/.test(s)) return 'europe';
  return 'uk';
}

// --- price basis -------------------------------------------------------------

function valueOf(pt) {
  if (state.basis === 'landed') return regionMeta(pt.region).landed(pt.price);
  return pt.price;
}

// --- stats -------------------------------------------------------------------

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function linreg(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of points) {
    const x = p.mileage;
    const y = valueOf(p);
    sx += x; sy += y; sxy += x * y; sxx += x * x;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const m = (n * sxy - sx * sy) / denom;
  const b = (sy - m * sx) / n;
  return { m, b };
}

function niceCeil(v, step) {
  return Math.ceil(v / step) * step;
}
function niceFloor(v, step) {
  return Math.floor(v / step) * step;
}

// --- rendering ---------------------------------------------------------------

const W = 720, H = 420;
const M = { top: 18, right: 74, bottom: 42, left: 60 };
const plotW = W - M.left - M.right;
const plotH = H - M.top - M.bottom;

function render() {
  const pts = visible();
  const live = pts.filter((p) => p.status === 'live');
  const sold = pts.filter((p) => p.status === 'sold');

  const chart = document.getElementById('chart');
  if (!pts.length) {
    chart.innerHTML = `<div class="chart-empty">No cars match these filters. Turn a region back on, or widen the model/status filters.</div>`;
    document.getElementById('subhead').textContent = '0 live, 0 sold';
    renderStats([]);
    return;
  }

  const values = pts.map(valueOf);
  const miles = pts.map((p) => p.mileage);

  const xMax = niceCeil(Math.max(...miles, 100000), 20000);
  const yMin = niceFloor(Math.min(...values) * 0.98, 20000);
  const yMax = niceCeil(Math.max(...values) * 1.02, 20000);

  const sx = (mi) => M.left + (mi / xMax) * plotW;
  const sy = (v) => M.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const askFit = linreg(live);
  const achFit = linreg(sold);

  // Header sentence — depreciation per 10k miles, from asking where available,
  // else from achieved (e.g. when viewing sold cars only).
  const fit = askFit || achFit;
  const slope = fit ? Math.abs(fit.m) * 10000 : 0;
  document.getElementById('subhead').textContent =
    `${live.length} live, ${sold.length} sold · every 10,000 miles is worth about ${GBP.format(Math.round(slope))}`;

  const parts = [];

  // Gridlines + axes
  for (let v = yMin; v <= yMax; v += 20000) {
    const y = sy(v);
    parts.push(`<line class="grid-line" x1="${M.left}" y1="${y}" x2="${M.left + plotW}" y2="${y}"/>`);
    parts.push(`<text class="axis-label" x="${M.left - 8}" y="${y + 3}" text-anchor="end">£${Math.round(v / 1000)}k</text>`);
  }
  for (let mi = 0; mi <= xMax; mi += 20000) {
    const x = sx(mi);
    parts.push(`<line class="grid-line" x1="${x}" y1="${M.top}" x2="${x}" y2="${M.top + plotH}"/>`);
    if (mi > 0)
      parts.push(`<text class="axis-label" x="${x}" y="${M.top + plotH + 15}" text-anchor="middle">${Math.round(mi / 1000)}k</text>`);
  }
  parts.push(`<text class="axis-title" x="${M.left + plotW / 2}" y="${H - 4}" text-anchor="middle">Mileage (miles)</text>`);
  parts.push(`<text class="axis-title" transform="translate(14 ${M.top + plotH / 2}) rotate(-90)" text-anchor="middle">Price (GBP)</text>`);

  // Trend lines (clipped to domain)
  const drawTrend = (fit, cls, tag) => {
    if (!fit) return;
    const clip = (mi) => {
      let v = fit.m * mi + fit.b;
      return v;
    };
    const x1 = 0, x2 = xMax;
    let y1 = clip(x1), y2 = clip(x2);
    parts.push(`<line class="trend ${cls}" x1="${sx(x1)}" y1="${sy(Math.max(yMin, Math.min(yMax, y1)))}" x2="${sx(x2)}" y2="${sy(Math.max(yMin, Math.min(yMax, y2)))}"/>`);
    parts.push(`<text class="trend-tag" fill="${cls === 'trend-achieved' ? 'var(--gold)' : 'var(--ink-line)'}" x="${sx(x2) + 5}" y="${sy(Math.max(yMin, Math.min(yMax, y2))) + 3}">${tag}</text>`);
  };
  drawTrend(askFit, 'trend-asking', 'Asking');
  drawTrend(achFit, 'trend-achieved', 'Achieved');

  // Points
  for (const p of pts) {
    const x = sx(p.mileage), y = sy(valueOf(p));
    const color = regionMeta(p.region).color;
    const common = `class="pt" data-id="${p.id}" tabindex="0"`;
    if (p.status === 'sold') {
      // hollow diamond
      const r = 6;
      parts.push(`<path ${common} d="M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z" fill="none" stroke="${color}" stroke-width="2"/>`);
    } else if (p.status === 'reference') {
      parts.push(`<circle ${common} class="pt pt-ring" cx="${x}" cy="${y}" r="5" stroke="var(--muted)"/>`);
    } else {
      parts.push(`<circle ${common} cx="${x}" cy="${y}" r="5" fill="${color}" stroke="var(--panel)" stroke-width="1.5"/>`);
    }
    if (p.code) {
      parts.push(`<text class="pt-label" x="${x + 8}" y="${y - 6}">${p.code}</text>`);
    }
  }

  chart.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" font-family="inherit">${parts.join('')}</svg>`;

  // Stat tiles describe the priced market that's in focus.
  const statBase = state.filters.status === 'sold' ? sold : live.length ? live : sold;
  renderStats(statBase);
  wireTooltips();
}

function renderStats(live) {
  const vals = live.map(valueOf);
  document.getElementById('statMin').textContent = vals.length ? GBP.format(Math.min(...vals)) : '—';
  document.getElementById('statMax').textContent = vals.length ? GBP.format(Math.max(...vals)) : '—';
  document.getElementById('statMedian').textContent = vals.length ? GBP.format(median(vals)) : '—';
  const avgMi = live.length ? Math.round(live.reduce((s, p) => s + p.mileage, 0) / live.length) : null;
  document.getElementById('statMiles').textContent = avgMi ? `${NUM.format(avgMi)} mi` : '—';
}

// --- advert links ------------------------------------------------------------

// The advert to open for a point. Live-fetched listings carry a real URL; seed
// cars have none, so we fall back to a pre-filled marketplace search for that
// exact spec (region-appropriate) — the user still lands on relevant results.
function advertUrl(p) {
  if (p.url) return p.url;
  const model = p.model === 'gt350r' ? 'Shelby GT350R' : 'Shelby GT350';
  const q = encodeURIComponent(`${p.year || ''} Ford Mustang ${model}`.trim());
  if (p.region === 'uk') {
    return `https://www.autotrader.co.uk/car-search?make=FORD&model=MUSTANG&keywords=${q}`;
  }
  if (p.region === 'overseas') {
    return `https://www.autotrader.com/cars-for-sale/all/ford/mustang?keywordPhrases=${q}`;
  }
  // Mainland Europe
  return `https://www.google.com/search?q=${q}+for+sale`;
}

function openAdvert(p) {
  const url = advertUrl(p);
  if (chrome?.tabs?.create) chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noopener');
}

// --- tooltip + click ---------------------------------------------------------

function wireTooltips() {
  const fig = document.querySelector('.chart-figure');
  const tip = document.getElementById('tooltip');
  const byId = new Map(state.listings.map((p) => [String(p.id), p]));

  fig.querySelectorAll('.pt').forEach((el) => {
    const p = byId.get(el.getAttribute('data-id'));
    if (p) el.setAttribute('data-url', advertUrl(p));
    const show = () => {
      if (!p) return;
      const meta = regionMeta(p.region);
      const val = valueOf(p);
      const statusLabel =
        p.status === 'sold' ? 'Achieved sale' : p.status === 'reference' ? 'Reference (excluded)' : 'For sale now';
      const basisLabel = state.basis === 'landed' ? 'Landed UK' : (p.status === 'sold' ? 'Achieved' : 'Asking');
      const linkLabel = p.url ? 'View advert →' : 'Search this car →';
      tip.innerHTML =
        `<div class="tt-title">${p.year || ''} ${p.model === 'gt350r' ? 'GT350R' : 'GT350'}</div>` +
        `<div class="tt-row">${meta.label} · ${statusLabel}</div>` +
        `<div class="tt-row">${NUM.format(p.mileage)} mi</div>` +
        `<div class="tt-price">${GBP.format(val)} <span class="tt-row" style="font-weight:400">${basisLabel}</span></div>` +
        (p.note ? `<div class="tt-row">${escapeHtml(p.note)}</div>` : '') +
        `<div class="tt-link">${linkLabel}</div>`;
      const figRect = fig.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      tip.style.left = `${r.left + r.width / 2 - figRect.left}px`;
      tip.style.top = `${r.top - figRect.top}px`;
      tip.hidden = false;
    };
    el.addEventListener('mouseenter', show);
    el.addEventListener('focus', show);
    el.addEventListener('mouseleave', () => (tip.hidden = true));
    el.addEventListener('blur', () => (tip.hidden = true));
    el.addEventListener('click', () => p && openAdvert(p));
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && p) {
        e.preventDefault();
        openAdvert(p);
      }
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// --- legend, table, toggles --------------------------------------------------

function renderLegend() {
  const el = document.getElementById('regionLegend');
  el.innerHTML = Object.entries(REGIONS)
    .map(
      ([id, meta]) =>
        `<button class="legend-item" data-region="${id}" title="Toggle ${meta.label}"><span class="dot" style="background:${meta.color}"></span>${meta.label}</button>`
    )
    .join('');
  el.querySelectorAll('[data-region]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.region;
      const regions = state.filters.regions;
      if (regions.has(id) && regions.size > 1) regions.delete(id);
      else regions.add(id);
      btn.classList.toggle('off', !regions.has(id));
      render();
      if (!document.getElementById('tableWrap').hidden) renderTable();
    });
  });
}

function renderTable() {
  const rows = visible()
    .slice()
    .sort((a, b) => valueOf(a) - valueOf(b))
    .map(
      (p) =>
        `<tr><td><a class="advert-link" href="${advertUrl(p)}" target="_blank" rel="noopener">${p.year || ''} ${p.model === 'gt350r' ? 'GT350R' : 'GT350'} →</a></td>` +
        `<td>${regionMeta(p.region).label}</td>` +
        `<td>${p.status}</td>` +
        `<td>${NUM.format(p.mileage)}</td>` +
        `<td>${GBP.format(valueOf(p))}</td></tr>`
    )
    .join('');
  document.getElementById('tableWrap').innerHTML =
    `<table><thead><tr><th>Car</th><th>Region</th><th>Status</th><th>Mileage</th><th>${
      state.basis === 'landed' ? 'Landed UK' : 'Price'
    }</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function setBasis(basis) {
  state.basis = basis;
  document.getElementById('tgAsking').classList.toggle('active', basis === 'asking');
  document.getElementById('tgAsking').setAttribute('aria-selected', String(basis === 'asking'));
  document.getElementById('tgLanded').classList.toggle('active', basis === 'landed');
  document.getElementById('tgLanded').setAttribute('aria-selected', String(basis === 'landed'));
  render();
  if (!document.getElementById('tableWrap').hidden) renderTable();
}

function updateSourceNote() {
  const el = document.getElementById('srcNote');
  const base = `Seed dataset of ${SEED_LISTINGS.length} reference cars.`;
  const merge = state.liveMerged
    ? `Merged ${state.liveMerged} live listing(s) from your last search.`
    : `Run a search from the popup to merge live listings.`;
  const fx = `FX used: $1 = £${FX.USD}, C$1 = £${FX.CAD}. Prices are estimates in GBP.`;
  el.textContent = `${base} ${merge} ${fx}`;
}

// Chip group where exactly one option is active; runs onPick(value) on change.
function wireChipGroup(containerId, dataKey, onPick) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      onPick(chip.dataset[dataKey]);
      render();
      if (!document.getElementById('tableWrap').hidden) renderTable();
    });
  });
}

// --- init --------------------------------------------------------------------

async function init() {
  renderLegend();
  await loadDataset();
  updateSourceNote();
  render();

  document.getElementById('tgAsking').addEventListener('click', () => setBasis('asking'));
  document.getElementById('tgLanded').addEventListener('click', () => setBasis('landed'));

  wireChipGroup('statusFilter', 'status', (v) => (state.filters.status = v));
  wireChipGroup('modelFilter', 'model', (v) => (state.filters.model = v));

  const tableToggle = document.getElementById('tableToggle');
  tableToggle.addEventListener('click', () => {
    const wrap = document.getElementById('tableWrap');
    const showing = wrap.hidden;
    if (showing) renderTable();
    wrap.hidden = !showing;
    tableToggle.textContent = showing ? 'Hide data table' : 'Show data table';
  });
}

init();
