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

const state = { model: 'both', busy: false, quiet: true };

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

// Normalise a UK postcode to "OUTWARD INWARD" (inward = last 3 chars).
function normalizePostcode(raw) {
  const s = String(raw || '').toUpperCase().replace(/\s+/g, '').trim();
  if (s.length < 5) return s;
  return `${s.slice(0, -3)} ${s.slice(-3)}`;
}

function currentFilters() {
  return {
    yearMin: Number($('#yearMin').value),
    yearMax: Number($('#yearMax').value),
    model: state.model,
    postcode: normalizePostcode($('#postcode').value) || 'LE10 3JD',
  };
}

function savePrefs() {
  chrome.storage?.local.set({ prefs: { ...currentFilters(), quiet: state.quiet } });
}

function setModel(m) {
  state.model = m;
  document.querySelectorAll('.seg').forEach((b) => {
    const on = b.dataset.model === m;
    b.setAttribute('aria-checked', String(on));
  });
  savePrefs();
}

async function restorePrefs() {
  try {
    const { prefs } = (await chrome.storage?.local.get('prefs')) || {};
    if (prefs) {
      if (prefs.yearMin) $('#yearMin').value = String(prefs.yearMin);
      if (prefs.yearMax) $('#yearMax').value = String(prefs.yearMax);
      if (prefs.postcode) $('#postcode').value = prefs.postcode;
      if (prefs.model) setModel(prefs.model);
      if (typeof prefs.quiet === 'boolean') {
        state.quiet = prefs.quiet;
        $('#quietMode').checked = prefs.quiet;
      }
    }
  } catch {
    /* first run */
  }
}

// --- search ------------------------------------------------------------------

// Only the ACTIVE tab in a window renders normally (background tabs are
// "hidden" and many sites defer rendering), so we scrape sequentially with one
// visible tab in a dedicated helper window.
const TAB_CONCURRENCY = 1;
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

  // In quiet mode the shadow tabs live in a minimised background window so they
  // don't flicker in front of the user.
  const host = await makeHostWindow(state.quiet);
  try {
    await runPool(SITES, TAB_CONCURRENCY, async (site) => {
      const card = cards.get(site.id);
      try {
        const { rows, debug } = await openAndScrape(site, filters, host.windowId);
        console.log('[GT350]', site.name, debug, `${rows.length} raw`);
        const matches = filterListings(rows, filters);
        card.setListings(matches, debug);
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
  } finally {
    await host.close();
  }

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

// Create the window that hosts the shadow tabs. In quiet mode this is a
// dedicated minimised, unfocused window; otherwise tabs open in the current
// window. Returns { windowId, close() }.
async function makeHostWindow(quiet) {
  if (chrome.windows?.create) {
    try {
      // Normal (not minimised) so its active tab actually renders; unfocused in
      // quiet mode so it sits behind your current window.
      const win = await chrome.windows.create({
        focused: !quiet,
        state: 'normal',
        width: 1200,
        height: 900,
        url: 'about:blank',
      });
      return {
        windowId: win.id,
        close: async () => {
          try {
            await chrome.windows.remove(win.id);
          } catch {
            /* already gone */
          }
        },
      };
    } catch {
      /* fall through to current-window tabs */
    }
  }
  return { windowId: undefined, close: async () => {} };
}

// Open a site's search in a VISIBLE tab (active in the helper window so it
// renders), wait for it to load, dismiss cookie-consent, then poll the DOM.
// Returns { rows, debug }. Always closes the tab.
async function openAndScrape(site, filters, windowId) {
  const url = site.buildSearchUrl(filters);
  const createProps = { url, active: true };
  if (windowId != null) createProps.windowId = windowId;
  const tab = await chrome.tabs.create(createProps);
  const tabId = tab.id;
  try {
    await waitForComplete(tabId, 25000);
    await tryDismissConsent(tabId);

    let out = { rows: [], debug: null };
    // Poll: SPA content + XHR often land seconds after "complete".
    for (let i = 0; i < 8; i++) {
      await delay(1200);
      out = await runScrape(tabId, site.id);
      if (out.rows && out.rows.length) break;
      if (i === 2) await tryDismissConsent(tabId); // consent may have re-shown
    }
    return out;
  } finally {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      /* already gone */
    }
  }
}

async function runScrape(tabId, siteId) {
  try {
    // Scrape every same-origin frame and merge — some sites iframe their
    // results. (Third-party frames we lack host permission for are skipped.)
    const res = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: scrapeInPage,
      args: [siteId],
    });
    const results = (res || []).map((r) => r && r.result).filter((r) => r && Array.isArray(r.rows));
    if (!results.length) return { rows: [], debug: { error: 'no result' } };

    const rows = [];
    const seen = new Set();
    let debug = null;
    for (const r of results) {
      for (const row of r.rows) {
        const k = row.url || row.title;
        if (k && !seen.has(k)) {
          seen.add(k);
          rows.push(row);
        }
      }
      // Prefer the frame that found the most / mentioned the car most.
      const score = (d) => (d ? (d.rows || 0) * 1000 + (d.mentions || 0) : -1);
      if (score(r.debug) > score(debug)) debug = r.debug;
    }
    debug = { ...(debug || {}), frames: results.length, rows: rows.length };
    debug.sample = results.flatMap((r) => (r.debug && r.debug.sample) || []).slice(0, 3);
    return { rows, debug };
  } catch (e) {
    return { rows: [], debug: { error: String((e && e.message) || e) } };
  }
}

// Best-effort: click a cookie/consent "accept" control so results can render.
// Only injectable into frames we have host permission for (inline CMPs like
// OneTrust); third-party iframe CMPs can't be reached and will show in debug.
async function tryDismissConsent(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const rx = /accept all|accept & continue|agree|allow all|i accept|accept cookies|got it|continue|yes/i;
        const ot = document.querySelector('#onetrust-accept-btn-handler, [data-testid="accept-all"], .accept-all');
        if (ot) {
          try { ot.click(); } catch {}
        }
        const btns = document.querySelectorAll('button, a[role="button"], [role="button"], input[type="submit"], input[type="button"]');
        for (const b of btns) {
          const t = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim();
          if (t && rx.test(t) && t.length < 40) {
            try { b.click(); } catch {}
          }
        }
      },
    });
  } catch {
    /* consent frame not injectable */
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
    // eBay ships several layouts (legacy .s-item and the newer .s-card /
    // .su-card-container). Cover them all.
    document
      .querySelectorAll('li.s-item, .s-item, .s-card, .su-card-container, ul.srp-results > li')
      .forEach((li) => {
        const a = li.querySelector('a.s-item__link, a.su-link, a[href*="/itm/"]');
        const title =
          text(li.querySelector('.s-item__title, .su-styled-text.primary, [role="heading"]')) || text(a);
        if (!a || !title || /shop on ebay/i.test(title)) return;
        res.push({
          title,
          url: abs(a.getAttribute('href')),
          price: money(text(li.querySelector('.s-item__price, .su-styled-text.positive')) || cardText(li)),
          mileage: miles(cardText(li)),
          year: yr(title),
          image: imgOf(li),
          location: text(li.querySelector('.s-item__location')).replace(/^from /i, '').trim() || null,
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

  const RE = /gt\s?-?350|shelby/i;

  const generic = () => {
    const res = [];
    const seen = new Set();
    // Look at listing-shaped containers whose text mentions the car — the model
    // is often a subtitle ("Ford Mustang" heading + "5.2 V8 GT350" below), so
    // matching the container, not just the heading, is what catches them.
    const cards = document.querySelectorAll(
      'article, li, [class*="card"], [class*="listing"], [class*="result"], [class*="product"], [class*="vehicle"], [data-testid*="listing" i], [data-testid*="advert" i], [data-testid*="result" i]'
    );
    cards.forEach((card) => {
      const ct = cardText(card);
      if (!RE.test(ct)) return;
      const a = card.querySelector('a[href]');
      const url = a && abs(a.getAttribute('href'));
      if (!url || seen.has(url) || /^javascript:/i.test(url)) return;
      seen.add(url);
      const h = card.querySelector('h1, h2, h3, h4, [class*="title" i], [data-testid*="title" i]');
      let title = (text(h) || text(a) || '').trim();
      // Ensure the title carries the GT350/Shelby token so downstream filters
      // keep it even when the heading is just "Ford Mustang".
      if (!RE.test(title)) {
        const m = ct.match(/([\w.\-/ ]*?(?:shelby|gt\s?-?350r?)[\w.\-/ ]*)/i);
        title = `${title ? title + ' ' : ''}${m ? m[1].trim() : 'GT350'}`.trim();
      }
      res.push({
        title: title.slice(0, 140),
        url,
        price: money(ct),
        mileage: miles(ct),
        year: yr(title) || yr(ct),
        image: imgOf(card),
        location: null,
      });
    });
    return res;
  };

  let rows = /ebay/.test(siteId) ? ebay() : [];
  if (!rows.length) rows = jsonld();
  if (!rows.length) rows = generic();
  rows = rows.filter((x) => RE.test(x.title || ''));

  // Diagnostics so a 0 result is explainable without the DOM in front of us.
  let mentions = 0;
  try {
    mentions = (((document.body && document.body.innerText) || '').match(/gt\s?-?350|shelby/gi) || []).length;
  } catch {
    mentions = 0;
  }
  // Capture a few real container snippets that mention the car, so selectors
  // can be written against the actual DOM without seeing the live page.
  const sample = [];
  try {
    const cand = document.querySelectorAll('a[href], h1, h2, h3, h4, [class*="title"], [class*="Title"]');
    const used = new Set();
    for (const n of cand) {
      if (!RE.test(n.textContent || '')) continue;
      const c =
        n.closest('article, li, [class*="card"], [class*="listing"], [class*="result"], [class*="product"], [class*="vehicle"]') ||
        n.parentElement ||
        n;
      if (used.has(c)) continue;
      used.add(c);
      sample.push((c.outerHTML || '').replace(/\s+/g, ' ').slice(0, 600));
      if (sample.length >= 3) break;
    }
  } catch {
    /* ignore */
  }

  const debug = {
    href: location.href,
    title: document.title,
    consent: !!document.querySelector(
      '#onetrust-banner-sdk, [id*="sp_message"], [class*="consent"], [class*="cookie" i], [aria-label*="consent" i]'
    ),
    sItems: document.querySelectorAll('.s-item, .s-card, .su-card-container').length,
    anchors: document.querySelectorAll('a[href]').length,
    ld: document.querySelectorAll('script[type="application/ld+json"]').length,
    mentions,
    rows: rows.length,
    sample,
  };
  return { rows, debug };
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
    setListings(list, debug) {
      if (!list.length) {
        pill.className = 'pill warn';
        pill.textContent = '0';
        body.innerHTML = `<div class="empty">${emptyReason(debug)}</div>${diagHtml(debug)}`;
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

// Collapsible raw diagnostics (incl. sample listing HTML) to copy and share.
function diagHtml(debug) {
  if (!debug) return '';
  const json = JSON.stringify(debug, null, 2);
  return `<details class="diag">
      <summary>Diagnostics <button class="link" data-copy>copy</button></summary>
      <pre>${escapeHtml(json)}</pre>
    </details>`;
}

// Turn a scrape debug blob into a short human reason for a 0 result.
function emptyReason(d) {
  if (!d) return 'Nothing read. Open the search ↗ — it\'s pre-filtered.';
  if (d.error) return `Couldn't read the page (${escapeHtml(d.error)}). Open the search ↗.`;
  if (d.consent) return 'Blocked by a cookie/consent wall. Open the search ↗ once and accept, then retry.';
  if (d.mentions > 0) {
    return `Page mentions GT350 ${d.mentions}× but I couldn't parse cards (ld+json:${d.ld}, cards:${d.sItems}). Open ↗ and I'll tune it.`;
  }
  return `No GT350 matches on the page (title: “${escapeHtml((d.title || '').slice(0, 40))}”). Open the search ↗.`;
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
    return;
  }
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    e.preventDefault();
    const pre = copy.closest('.diag')?.querySelector('pre');
    if (pre) {
      navigator.clipboard?.writeText(pre.textContent).then(() => {
        copy.textContent = 'copied';
        setTimeout(() => (copy.textContent = 'copy'), 1200);
      });
    }
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
  ['#yearMin', '#yearMax', '#postcode'].forEach((s) => $(s).addEventListener('change', savePrefs));
  $('#quietMode').addEventListener('change', (e) => {
    state.quiet = e.target.checked;
    savePrefs();
  });

  $('#prefsToggle').addEventListener('click', () => {
    const a = $('#about');
    a.hidden = !a.hidden;
  });
}

main();
