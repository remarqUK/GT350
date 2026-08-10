// popup.js — the search launcher + live aggregator.
// Real data is read by opening each site's search in a background ("shadow")
// tab, letting it fully render in the real browser (defeating both JS-rendering
// and most bot-detection), scraping the live DOM with an injected function,
// then closing the tab. Orchestrated here in the popup so it can show live
// progress; background tabs (active:false) don't close the popup.
import { SITES, filterListings } from './sites.js';

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

const TAB_CONCURRENCY = 3;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function runSearch() {
  if (state.busy) return;
  state.busy = true;
  const filters = currentFilters();
  const results = $('#results');
  results.innerHTML = '';
  $('#status').hidden = false;
  $('#status').textContent = `Opening background tabs to read ${SITES.length} marketplaces for ${modelLabel()} (${filters.yearMin}–${filters.yearMax})…`;
  $('#searchBtn').disabled = true;

  const cards = new Map();
  for (const site of SITES) {
    const card = renderCard(site, filters);
    results.appendChild(card.el);
    cards.set(site.id, card);
  }

  const collected = [];
  let doneCount = 0;
  const onOne = () => {
    doneCount += 1;
    $('#status').textContent = `Read ${doneCount}/${SITES.length} sites · ${collected.length} listing${collected.length === 1 ? '' : 's'} so far…`;
  };

  await runPool(SITES, TAB_CONCURRENCY, async (site) => {
    const card = cards.get(site.id);
    try {
      const listings = await openAndScrape(site, filters);
      const matches = filterListings(listings, filters);
      card.setListings(matches);
      for (const l of matches) {
        collected.push({
          ...l,
          site: site.name,
          currency: site.currency || 'GBP',
          region: site.region || 'uk',
        });
      }
      // Persist incrementally so the dashboard has data even if the user
      // closes the popup mid-run.
      await persist(collected, filters);
    } catch (err) {
      card.setError(err);
    } finally {
      onOne();
    }
  });

  await persist(collected, filters);

  const total = collected.length;
  const plottable = collected.filter((l) => l.price > 0 && l.mileage > 0 && l.url).length;
  $('#status').textContent = total
    ? `Found ${total} listing${total === 1 ? '' : 's'} (${plottable} with mileage → on the dashboard).`
    : `No listings could be read. The sites may have shown a consent/robot page — try opening one with “Open ↗”.`;
  $('#summary').textContent = total ? `${total} listings` : '';
  $('#searchBtn').disabled = false;
  state.busy = false;
}

async function persist(collected, filters) {
  try {
    await chrome.storage?.local.set({
      listings: collected,
      lastSearch: { filters, count: collected.length },
    });
  } catch {
    /* ignore */
  }
}

// Run `worker` over `items` with at most `concurrency` in flight.
async function runPool(items, concurrency, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

// Open a site's search in a background tab, wait for it to render, inject the
// scraper, and return whatever it read. Always closes the tab.
async function openAndScrape(site, filters) {
  const url = site.buildSearchUrl(filters);
  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab.id;
  try {
    await waitForComplete(tabId, 20000);
    let listings = [];
    // Retry a few times: SPA content and XHR often land after "complete".
    for (let attempt = 0; attempt < 3; attempt++) {
      await delay(attempt === 0 ? 2800 : 2200);
      let res;
      try {
        res = await chrome.scripting.executeScript({
          target: { tabId },
          func: scrapeInPage,
          args: [site.id],
        });
      } catch {
        res = null;
      }
      listings = (res && res[0] && res[0].result) || [];
      if (listings.length) break;
    }
    return listings;
  } finally {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      /* already gone */
    }
  }
}

function waitForComplete(tabId, timeout) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const to = setTimeout(finish, timeout);
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => t && t.status === 'complete' && finish()).catch(() => {});
  });
}

// Injected into the page (must be fully self-contained — no closures/imports).
// Reads listings from the rendered DOM. Tries site-specific selectors, then
// schema.org JSON-LD, then a generic card heuristic; returns the first that
// yields GT350/GT350R rows.
function scrapeInPage(siteId) {
  const text = (el) => ((el && el.textContent) || '').trim();
  const num = (s) => {
    const n = Number(String(s == null ? '' : s).replace(/[^\d.]/g, ''));
    return isFinite(n) && n > 0 ? n : null;
  };
  const money = (t) => {
    const m = /[£$]\s?([\d]{1,3}(?:,\d{3})+|\d{4,})/.exec(t || '');
    return m ? num(m[1]) : null;
  };
  const miles = (t) => {
    // Require a non-digit boundary before the number and proper grouping, so a
    // price rendered next to the mileage (e.g. "£74,995 48,000 miles") can't
    // bleed its trailing digits into the reading.
    const m = /(?:^|[^\d.,$£])(\d{1,3}(?:,\d{3})+|\d{3,6})\s*(?:mi\b|miles|mi\.)/i.exec(t || '');
    return m ? num(m[1]) : null;
  };
  // Rendered text keeps price and mileage in separate lines; textContent can
  // jam them together. Prefer innerText for number scanning.
  const cardText = (el) => (el && (el.innerText || el.textContent)) || '';
  const yr = (t) => {
    const m = /\b(20(?:1[4-9]|2[0-1]))\b/.exec(t || '');
    return m ? +m[1] : null;
  };
  const abs = (h) => {
    try {
      return new URL(h, location.href).href;
    } catch {
      return null;
    }
  };
  const imgOf = (el) => {
    const i = el && el.querySelector('img');
    return (i && (i.currentSrc || i.src || i.getAttribute('data-src'))) || null;
  };

  const ebay = () => {
    const res = [];
    document.querySelectorAll('li.s-item, ul.srp-results > li').forEach((li) => {
      const a = li.querySelector('a.s-item__link, a[href*="/itm/"]');
      const title = text(li.querySelector('.s-item__title'));
      if (!a || !title || /shop on ebay/i.test(title)) return;
      res.push({
        title,
        url: abs(a.getAttribute('href')),
        price: money(text(li.querySelector('.s-item__price'))),
        mileage: miles(cardText(li)),
        year: yr(title),
        image: imgOf(li),
        location: text(li.querySelector('.s-item__location')).replace(/from/i, '').trim() || null,
      });
    });
    return res;
  };

  const jsonld = () => {
    const res = [];
    const walk = (n, cb) => {
      if (!n) return;
      if (Array.isArray(n)) return n.forEach((x) => walk(x, cb));
      if (typeof n !== 'object') return;
      cb(n);
      walk(n['@graph'], cb);
      walk(n.itemListElement, cb);
      walk(n.item, cb);
    };
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      let d;
      try {
        d = JSON.parse(s.textContent);
      } catch {
        return;
      }
      walk(d, (node) => {
        const t = [].concat(node['@type'] || []).map((x) => String(x).toLowerCase());
        const isVeh =
          t.some((x) => ['car', 'vehicle', 'product', 'motorizedvehicle'].includes(x)) ||
          node.mileageFromOdometer ||
          node.vehicleModelDate;
        if (!isVeh) return;
        const offer = [].concat(node.offers || [])[0] || {};
        let img = node.image;
        if (Array.isArray(img)) img = img[0];
        if (img && typeof img === 'object') img = img.url;
        res.push({
          title: String(node.name || node.model || 'GT350 listing').trim(),
          url: abs(offer.url || node.url),
          price: num(offer.price != null ? offer.price : node.price),
          mileage: num((node.mileageFromOdometer && node.mileageFromOdometer.value) || node.mileageFromOdometer),
          year: num(node.vehicleModelDate || node.modelDate) || yr(node.name),
          image: img ? abs(img) : null,
          location: (node.address && node.address.addressLocality) || null,
        });
      });
    });
    return res;
  };

  const generic = () => {
    const res = [];
    const seen = new Set();
    document.querySelectorAll('a[href]').forEach((a) => {
      const t = text(a);
      if (!/gt\s?350|shelby/i.test(t)) return;
      const url = abs(a.getAttribute('href'));
      if (!url || seen.has(url)) return;
      seen.add(url);
      const card = a.closest('article, li, [class*="card"], [class*="listing"], div') || a;
      const ct = cardText(card);
      res.push({
        title: (t || ct).slice(0, 140),
        url,
        price: money(ct),
        mileage: miles(ct),
        year: yr(t) || yr(ct),
        image: imgOf(card),
        location: null,
      });
    });
    return res;
  };

  let rows = /ebay/.test(siteId) ? ebay() : [];
  if (!rows.length) rows = jsonld();
  if (!rows.length) rows = generic();
  return rows.filter((x) => /gt\s?350|shelby/i.test(x.title || ''));
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
    chrome.tabs.create({ url: a.href, active: true });
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
