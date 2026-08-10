// popup.js — the search launcher + live aggregator.
import { SITES, keywordFor, filterListings } from './sites.js';

const $ = (sel) => document.querySelector(sel);
const YEARS = [2015, 2016, 2017, 2018, 2019, 2020];
const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

const state = { model: 'both', busy: false };

// --- init --------------------------------------------------------------------

function fillYears() {
  const min = $('#yearMin'), max = $('#yearMax');
  for (const y of YEARS) {
    min.add(new Option(String(y), String(y)));
    max.add(new Option(String(y), String(y)));
  }
  min.value = '2015';
  max.value = '2020';
}

function currentFilters() {
  return {
    yearMin: Number($('#yearMin').value),
    yearMax: Number($('#yearMax').value),
    model: state.model,
  };
}

function setModel(m) {
  state.model = m;
  document.querySelectorAll('.seg').forEach((b) => {
    const on = b.dataset.model === m;
    b.setAttribute('aria-checked', String(on));
  });
  chrome.storage?.local.set({ prefs: currentFilters() });
}

async function restorePrefs() {
  try {
    const { prefs } = (await chrome.storage?.local.get('prefs')) || {};
    if (prefs) {
      if (prefs.yearMin) $('#yearMin').value = String(prefs.yearMin);
      if (prefs.yearMax) $('#yearMax').value = String(prefs.yearMax);
      if (prefs.model) setModel(prefs.model);
    }
  } catch {
    /* first run */
  }
}

// --- search ------------------------------------------------------------------

async function runSearch() {
  if (state.busy) return;
  state.busy = true;
  const filters = currentFilters();
  const results = $('#results');
  results.innerHTML = '';
  $('#status').hidden = false;
  $('#status').textContent = `Searching ${SITES.length} marketplaces for ${modelLabel()} (${filters.yearMin}–${filters.yearMax})…`;
  $('#searchBtn').disabled = true;

  const cards = new Map();
  for (const site of SITES) {
    const card = renderCard(site, filters);
    results.appendChild(card.el);
    cards.set(site.id, card);
  }

  const collected = [];
  await Promise.allSettled(
    SITES.map(async (site) => {
      const card = cards.get(site.id);
      try {
        const listings = await fetchSite(site, filters);
        const matches = filterListings(listings, filters);
        card.setListings(matches);
        for (const l of matches) {
          collected.push({
            ...l,
            site: site.name,
            currency: site.currency || 'GBP',
            region: site.region || 'europe',
          });
        }
      } catch (err) {
        card.setError(err);
      }
    })
  );

  // Persist for the dashboard (only points we can actually plot).
  try {
    await chrome.storage?.local.set({
      listings: collected,
      lastSearch: { filters, count: collected.length },
    });
  } catch {
    /* ignore */
  }

  const total = collected.length;
  $('#status').textContent = total
    ? `Found ${total} matching listing${total === 1 ? '' : 's'} across ${SITES.length} sites.`
    : `No listings could be read inline. Use each site's “Open ↗” — filters are already applied.`;
  $('#summary').textContent = total ? `${total} listings` : '';
  $('#searchBtn').disabled = false;
  state.busy = false;
}

async function fetchSite(site, filters) {
  const url = site.buildSearchUrl(filters);
  const res = await fetch(url, { credentials: 'omit', redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return site.parse(doc, filters) || [];
}

// --- rendering ---------------------------------------------------------------

function renderCard(site, filters) {
  const el = document.createElement('div');
  el.className = 'site-card collapsed';
  const searchUrl = site.buildSearchUrl(filters);
  const cur = site.currency && site.currency !== 'GBP' ? ` · ${site.currency}→£` : '';
  el.innerHTML = `
    <div class="site-head">
      <span class="site-dot" style="background:${site.color}"></span>
      <span>
        <span class="site-name">${site.name}</span>
        ${site.note ? `<span class="site-note"> · ${site.note}</span>` : ''}${cur ? `<span class="site-note">${cur}</span>` : ''}
      </span>
      <span class="site-count">
        <span class="pill loading"><span class="spinner"></span></span>
        <a class="open-link" href="${searchUrl}" data-open target="_blank" rel="noopener">Open ↗</a>
      </span>
    </div>
    <div class="site-body"></div>`;

  const head = el.querySelector('.site-head');
  const body = el.querySelector('.site-body');
  const pill = el.querySelector('.pill');

  head.addEventListener('click', (e) => {
    if (e.target.closest('[data-open]')) return;
    el.classList.toggle('collapsed');
  });
  el.querySelector('[data-open]').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: searchUrl, active: false });
  });

  return {
    el,
    setListings(list) {
      if (!list.length) {
        pill.className = 'pill warn';
        pill.textContent = '0';
        body.innerHTML = `<div class="empty">Nothing read inline. Open the site's search ↗ — it's pre-filtered.</div>`;
        return;
      }
      pill.className = 'pill ok';
      pill.textContent = String(list.length);
      el.classList.remove('collapsed');
      body.innerHTML = list.slice(0, 8).map((l) => listingRow(l, site)).join('');
    },
    setError() {
      pill.className = 'pill warn';
      pill.textContent = '—';
      body.innerHTML = `<div class="empty">Couldn't read listings (site may block automated access). Open the search ↗.</div>`;
    },
  };
}

function listingRow(l, site) {
  const priceTxt = l.price
    ? (site.currency && site.currency !== 'GBP' ? `${site.currency} ${l.price.toLocaleString()}` : GBP.format(l.price))
    : '—';
  const meta = [l.year, l.mileage ? `${l.mileage.toLocaleString()} mi` : null, l.location]
    .filter(Boolean)
    .join(' · ');
  const href = l.url || site.buildSearchUrl(currentFilters());
  return `
    <a class="listing" href="${href}" data-listing target="_blank" rel="noopener">
      ${l.image ? `<img class="listing-thumb" src="${l.image}" alt="" loading="lazy"/>` : '<span class="listing-thumb"></span>'}
      <span class="listing-main">
        <span class="listing-title">${escapeHtml(l.title)}</span>
        <span class="listing-meta">${escapeHtml(meta || '')}</span>
      </span>
      <span class="listing-price">${priceTxt}</span>
    </a>`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function modelLabel() {
  return state.model === 'gt350r' ? 'GT350R' : state.model === 'gt350' ? 'GT350' : 'GT350 / GT350R';
}

// --- actions -----------------------------------------------------------------

function openAll() {
  const filters = currentFilters();
  for (const site of SITES) {
    chrome.tabs.create({ url: site.buildSearchUrl(filters), active: false });
  }
}

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard.html') });
}

// Delegate listing clicks (open in background tab).
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-listing]');
  if (a) {
    e.preventDefault();
    chrome.tabs.create({ url: a.href, active: false });
  }
});

// --- wire up -----------------------------------------------------------------

function main() {
  fillYears();
  restorePrefs();

  document.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => setModel(b.dataset.model)));
  $('#searchBtn').addEventListener('click', runSearch);
  $('#openAllBtn').addEventListener('click', openAll);
  $('#dashboardBtn')?.addEventListener('click', openDashboard);
  ['#yearMin', '#yearMax'].forEach((s) => $(s).addEventListener('change', () => chrome.storage?.local.set({ prefs: currentFilters() })));

  $('#prefsToggle').addEventListener('click', () => {
    const a = $('#about');
    a.hidden = !a.hidden;
  });
  $('#sortBy')?.addEventListener('change', () => {}); // sort handled by dashboard; kept for parity
}

main();
