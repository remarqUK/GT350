// sites.js
// UK marketplace definitions. Each site knows how to build a pre-filtered
// search URL (year range + GT350/GT350R keyword) and how to best-effort parse
// a fetched results page into a normalized list of listings (prices in GBP).
//
// Parsing marketplace pages from an extension is inherently fragile: many
// sites gate automated requests behind bot-detection (Cloudflare, PerimeterX,
// etc.) and change their markup often. Every parser therefore degrades
// gracefully — if it can't read listings, the UI falls back to a one-click
// deep link into the site's own (already filtered) search results.

/**
 * @typedef {Object} Filters
 * @property {number} yearMin
 * @property {number} yearMax
 * @property {'gt350'|'gt350r'|'both'} model
 * @property {string} [keyword]  Free-text override; when set it wins.
 */

/**
 * @typedef {Object} Listing
 * @property {string} title
 * @property {number|null} price   GBP
 * @property {number|null} year
 * @property {number|null} mileage
 * @property {string|null} location
 * @property {string|null} url
 * @property {string|null} image
 */

/** Build the search keyword for a given model selection. */
export function keywordFor(filters) {
  if (filters.keyword && filters.keyword.trim()) return filters.keyword.trim();
  if (filters.model === 'gt350r') return 'GT350R';
  // "GT350" matches GT350R listings too — good for "both"; the client-side
  // model filter narrows the plain-GT350 case.
  return 'GT350';
}

const enc = encodeURIComponent;

// ---- Shared parsing helpers -------------------------------------------------

const MONEY_RE = /£\s?([\d]{1,3}(?:,\d{3})+|\d{4,})/;
const USD_RE = /(?:US)?\$\s?([\d]{1,3}(?:,\d{3})+|\d{4,})/;
const YEAR_RE = /\b(20(?:1[4-9]|2[0-1]))\b/;
const MILES_RE = /([\d,]+)\s*(?:mi(?:les)?|mi\.|km)\b/i;

function toNumber(str) {
  if (str == null) return null;
  const n = Number(String(str).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function parseMoney(text) {
  const m = MONEY_RE.exec(text || '');
  return m ? toNumber(m[1]) : null;
}
// Native-currency price (USD/CAD listings show a bare "$" figure). Conversion
// to GBP happens later, in the dashboard, using the site's declared currency.
function parseUsd(text) {
  const m = USD_RE.exec(text || '');
  return m ? toNumber(m[1]) : toNumber((text || '').match(/([\d,]{5,})/)?.[1]);
}
function parseYear(text) {
  const m = YEAR_RE.exec(text || '');
  return m ? Number(m[1]) : null;
}
function parseMiles(text) {
  const m = MILES_RE.exec(text || '');
  return m ? toNumber(m[1]) : null;
}
function absUrl(href, base) {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/**
 * Generic schema.org JSON-LD extractor for Vehicle/Car/Product entities.
 * Returns [] when nothing usable is found.
 */
export function parseJsonLd(doc, base) {
  const out = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let data;
    try {
      data = JSON.parse(s.textContent);
    } catch {
      continue;
    }
    for (const node of flattenLd(data)) {
      const type = [].concat(node['@type'] || []).map((t) => String(t).toLowerCase());
      const looksVehicle =
        type.some((t) => ['car', 'vehicle', 'product', 'motorizedvehicle'].includes(t)) ||
        node.vehicleModelDate ||
        node.mileageFromOdometer;
      if (!looksVehicle) continue;

      const name = node.name || node.model || '';
      const offer = [].concat(node.offers || [])[0] || {};
      const price = toNumber(offer.price ?? node.price);
      const year =
        toNumber(node.vehicleModelDate || node.modelDate || node.productionDate) || parseYear(name);
      const mileage = toNumber(node.mileageFromOdometer?.value ?? node.mileageFromOdometer);
      const url = absUrl(offer.url || node.url, base);
      let image = node.image;
      if (Array.isArray(image)) image = image[0];
      if (image && typeof image === 'object') image = image.url;

      if (!name && !url) continue;
      out.push({
        title: String(name || 'Vehicle').trim(),
        price: price || null,
        year: year || null,
        mileage: mileage || null,
        location: node.address?.addressLocality || null,
        url,
        image: image ? absUrl(image, base) : null,
      });
    }
  }
  return out;
}

function* flattenLd(data) {
  if (data == null) return;
  if (Array.isArray(data)) {
    for (const d of data) yield* flattenLd(d);
    return;
  }
  if (typeof data !== 'object') return;
  yield data;
  if (data['@graph']) yield* flattenLd(data['@graph']);
  if (data.itemListElement) yield* flattenLd(data.itemListElement);
  if (data.item) yield* flattenLd(data.item);
}

/** Keep only plausible GT350/GT350R matches in range. */
export function filterListings(listings, filters) {
  const wantR = filters.model === 'gt350r';
  return listings.filter((l) => {
    const hay = `${l.title || ''}`.toLowerCase();
    const isGt350 = /gt350|gt\s?350|shelby/.test(hay);
    if (!isGt350 && l.title) return false;
    if (wantR && !/gt350r|gt\s?350\s?r/.test(hay)) return false;
    if (l.year && (l.year < filters.yearMin || l.year > filters.yearMax)) return false;
    return true;
  });
}

// ---- Site definitions (UK) --------------------------------------------------

export const SITES = [
  {
    id: 'autotraderuk',
    name: 'AutoTrader UK',
    color: '#e5202e',
    homepage: 'https://www.autotrader.co.uk/',
    buildSearchUrl(f) {
      const params = new URLSearchParams({
        'advertising-location': 'at_cars',
        make: 'FORD',
        model: 'MUSTANG',
        keywords: keywordFor(f),
        'year-from': String(f.yearMin),
        'year-to': String(f.yearMax),
        // AutoTrader UK needs a postcode; a national radius so a car this rare
        // isn't hidden by distance.
        postcode: f.postcode || 'LE10 3JD',
        radius: '1500',
        sort: 'relevance',
      });
      return `https://www.autotrader.co.uk/car-search?${params}`;
    },
    parse(doc) {
      const base = 'https://www.autotrader.co.uk/';
      let items = parseJsonLd(doc, base);
      if (!items.length) {
        doc.querySelectorAll('[data-testid="advertCard"], .product-card, li.search-page__result').forEach((el) => {
          const a = el.querySelector('a[href*="/car-details/"], a[href]');
          const text = el.textContent || '';
          items.push({
            title: (el.querySelector('h3, [data-testid="search-listing-title"]')?.textContent || '').trim() || 'GT350 listing',
            price: parseMoney(el.querySelector('.product-card-pricing__price, [data-testid="price"]')?.textContent || text),
            year: parseYear(text),
            mileage: parseMiles(text),
            location: (el.querySelector('[data-testid="search-listing-location"], .seller-location')?.textContent || '').trim() || null,
            url: absUrl(a?.getAttribute('href'), base),
            image: absUrl(el.querySelector('img')?.getAttribute('src'), base),
          });
        });
      }
      return items;
    },
  },
  {
    id: 'pistonheads',
    name: 'PistonHeads',
    color: '#00a3e0',
    homepage: 'https://www.pistonheads.com/buy',
    buildSearchUrl(f) {
      const params = new URLSearchParams({ keywords: `Shelby ${keywordFor(f)}` });
      return `https://www.pistonheads.com/buy/search?${params}`;
    },
    parse(doc) {
      const base = 'https://www.pistonheads.com/';
      let items = parseJsonLd(doc, base);
      if (!items.length) {
        doc.querySelectorAll('.listing-item, article.result, li[data-ad-id]').forEach((el) => {
          const a = el.querySelector('a[href]');
          const text = el.textContent || '';
          items.push({
            title: (el.querySelector('h2, h3, .listing-title')?.textContent || '').trim() || 'GT350 listing',
            price: parseMoney(text),
            year: parseYear(text),
            mileage: parseMiles(text),
            location: null,
            url: absUrl(a?.getAttribute('href'), base),
            image: absUrl(el.querySelector('img')?.getAttribute('src') || el.querySelector('img')?.getAttribute('data-src'), base),
          });
        });
      }
      return items;
    },
  },
  {
    id: 'ebayuk',
    name: 'eBay UK',
    color: '#e53238',
    homepage: 'https://www.ebay.co.uk/',
    buildSearchUrl(f) {
      const kw = `Ford Mustang Shelby ${f.model === 'gt350r' ? 'GT350R' : 'GT350'}`;
      const params = new URLSearchParams({ _nkw: kw, _sop: '12' });
      // 9801 = eBay UK Cars category.
      return `https://www.ebay.co.uk/sch/9801/i.html?${params}`;
    },
    parse(doc) {
      const base = 'https://www.ebay.co.uk/';
      const items = [];
      doc.querySelectorAll('li.s-item').forEach((el) => {
        const a = el.querySelector('a.s-item__link');
        const title = (el.querySelector('.s-item__title')?.textContent || '').trim();
        if (!title || /shop on ebay/i.test(title)) return;
        items.push({
          title,
          price: parseMoney(el.querySelector('.s-item__price')?.textContent || ''),
          year: parseYear(title),
          mileage: parseMiles(el.textContent || ''),
          location: (el.querySelector('.s-item__location')?.textContent || '').replace(/from/i, '').trim() || null,
          url: absUrl(a?.getAttribute('href'), base),
          image: absUrl(el.querySelector('.s-item__image img')?.getAttribute('src'), base),
        });
      });
      return items;
    },
  },
  {
    id: 'cazoo',
    name: 'Cazoo',
    color: '#4b2e83',
    homepage: 'https://www.cazoo.co.uk/',
    buildSearchUrl(f) {
      // Cazoo's on-site search; keyword filter carries the model.
      const params = new URLSearchParams({ query: `Ford Mustang ${keywordFor(f)}` });
      return `https://www.cazoo.co.uk/cars/?${params}`;
    },
    parse(doc) {
      return parseJsonLd(doc, 'https://www.cazoo.co.uk/');
    },
  },
  {
    id: 'carandclassic',
    name: 'Car & Classic',
    color: '#1b7f5c',
    homepage: 'https://www.carandclassic.com/',
    note: 'Classifieds + auctions',
    buildSearchUrl(f) {
      const params = new URLSearchParams({ q: `Shelby ${keywordFor(f)}` });
      return `https://www.carandclassic.com/search?${params}`;
    },
    parse(doc) {
      const base = 'https://www.carandclassic.com/';
      let items = parseJsonLd(doc, base);
      if (!items.length) {
        doc.querySelectorAll('article, .listing-card, li[data-listing]').forEach((el) => {
          const a = el.querySelector('a[href]');
          const title = (el.querySelector('h2, h3, .title')?.textContent || '').trim();
          if (!title) return;
          const text = el.textContent || '';
          items.push({
            title,
            price: parseMoney(text),
            year: parseYear(title) || parseYear(text),
            mileage: parseMiles(text),
            location: null,
            url: absUrl(a?.getAttribute('href'), base),
            image: absUrl(el.querySelector('img')?.getAttribute('src') || el.querySelector('img')?.getAttribute('data-src'), base),
          });
        });
      }
      return items;
    },
  },

  // ---- USA / Canada (prices converted to GBP + import costs) ----
  {
    id: 'autotradercom',
    name: 'AutoTrader.com',
    color: '#0a6cff',
    region: 'overseas',
    currency: 'USD',
    homepage: 'https://www.autotrader.com/',
    buildSearchUrl(f) {
      const params = new URLSearchParams({
        keywordPhrases: `Shelby ${keywordFor(f)}`,
        startYear: String(f.yearMin),
        endYear: String(f.yearMax),
        listingType: 'USED,CERTIFIED',
        sortBy: 'relevance',
      });
      return `https://www.autotrader.com/cars-for-sale/all/ford/mustang?${params}`;
    },
    parse(doc) {
      return parseJsonLd(doc, 'https://www.autotrader.com/');
    },
  },
  {
    id: 'carscom',
    name: 'Cars.com',
    color: '#7a1fa2',
    region: 'overseas',
    currency: 'USD',
    homepage: 'https://www.cars.com/',
    buildSearchUrl(f) {
      const params = new URLSearchParams({
        keyword: `Shelby ${keywordFor(f)}`,
        year_min: String(f.yearMin),
        year_max: String(f.yearMax),
        stock_type: 'all',
        sort: 'best_match_desc',
      });
      params.append('makes[]', 'ford');
      params.append('models[]', 'ford-mustang');
      return `https://www.cars.com/shopping/results/?${params}`;
    },
    parse(doc) {
      const base = 'https://www.cars.com/';
      let items = parseJsonLd(doc, base);
      if (!items.length) {
        doc.querySelectorAll('.vehicle-card').forEach((el) => {
          const text = el.textContent || '';
          const a = el.querySelector('a[href*="/vehicledetail/"], a.vehicle-card-link');
          items.push({
            title: (el.querySelector('.title, h2')?.textContent || '').trim() || 'GT350 listing',
            price: parseUsd(el.querySelector('.primary-price')?.textContent || text),
            year: parseYear(text),
            mileage: parseMiles(el.querySelector('.mileage')?.textContent || text),
            location: (el.querySelector('.dealer-name')?.textContent || '').trim() || null,
            url: absUrl(a?.getAttribute('href'), base),
            image: absUrl(el.querySelector('img')?.getAttribute('src'), base),
          });
        });
      }
      return items;
    },
  },
  {
    id: 'cargurus',
    name: 'CarGurus (US)',
    color: '#00794d',
    region: 'overseas',
    currency: 'USD',
    homepage: 'https://www.cargurus.com/',
    buildSearchUrl(f) {
      const params = new URLSearchParams({
        sourceContext: 'carGurusHomePageModel',
        distance: '50000',
        keyword: `Ford Mustang Shelby ${keywordFor(f)}`,
      });
      return `https://www.cargurus.com/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action?${params}`;
    },
    parse(doc) {
      return parseJsonLd(doc, 'https://www.cargurus.com/');
    },
  },
  {
    id: 'bringatrailer',
    name: 'Bring a Trailer',
    color: '#d6a419',
    region: 'overseas',
    currency: 'USD',
    note: 'US auctions (live + sold)',
    homepage: 'https://bringatrailer.com/',
    buildSearchUrl(f) {
      if (f.model === 'gt350r') return 'https://bringatrailer.com/search/?s=' + enc('Shelby GT350R');
      return 'https://bringatrailer.com/ford/shelby-gt350/';
    },
    parse(doc) {
      const base = 'https://bringatrailer.com/';
      const items = [];
      doc.querySelectorAll('.listing-card, .auctions-item').forEach((el) => {
        const a = el.matches('a') ? el : el.querySelector('a[href]');
        const title = (el.querySelector('.listing-card-title, h3')?.textContent || el.getAttribute('aria-label') || '').trim();
        if (!title) return;
        const text = el.textContent || '';
        items.push({
          title,
          price: parseUsd(text),
          year: parseYear(title) || parseYear(text),
          mileage: parseMiles(text),
          location: null,
          url: absUrl(a?.getAttribute('href'), base),
          image: absUrl(el.querySelector('img')?.getAttribute('src') || el.querySelector('img')?.getAttribute('data-src'), base),
        });
      });
      return items.length ? items : parseJsonLd(doc, base);
    },
  },
  {
    id: 'autotraderca',
    name: 'AutoTrader.ca',
    color: '#e5202e',
    region: 'overseas',
    currency: 'CAD',
    note: 'Canada',
    homepage: 'https://www.autotrader.ca/',
    buildSearchUrl(f) {
      const params = new URLSearchParams({
        kwd: `Shelby ${keywordFor(f)}`,
        yRng: `${f.yearMin},${f.yearMax}`,
        srt: '35',
      });
      return `https://www.autotrader.ca/cars/ford/mustang/?${params}`;
    },
    parse(doc) {
      return parseJsonLd(doc, 'https://www.autotrader.ca/');
    },
  },
];

export function siteById(id) {
  return SITES.find((s) => s.id === id) || null;
}
