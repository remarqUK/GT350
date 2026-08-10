// data.js
// Seed market dataset for the GT350 / GT350R (2015–2020), priced for a UK
// buyer in GBP. It powers the dashboard out of the box so the chart is
// meaningful even when live marketplace reads are blocked. Live asking
// listings gathered by the popup search are merged on top of this at runtime
// (see dashboard.js → loadDataset).
//
// Fields:
//   region : 'uk' | 'europe' | 'overseas'  — landed-cost tier (where the car is)
//   status : 'live'  — for sale now, price is the asking price
//            'sold'  — a completed sale, price is what it actually made
//            'reference' — notable stock excluded from the trend (outlier / unconfirmed)
//   mileage: miles
//   price  : GBP (asking for live, achieved for sold)
//   code   : short label drawn directly on the chart for standout cars
//   note   : shown in the tooltip

export const SEED_LISTINGS = [
  // ---- Live inventory (asking prices) ----
  { id: 'e1', model: 'gt350', year: 2016, region: 'europe', status: 'live', mileage: 34000, price: 78500, code: '', note: 'Germany, Avalanche Grey' },
  { id: 'e2', model: 'gt350', year: 2017, region: 'uk', status: 'live', mileage: 47000, price: 71000 },
  { id: 'e3', model: 'gt350r', year: 2016, region: 'europe', status: 'live', mileage: 71000, price: 74000, code: 'E3', note: 'Germany — GT350R, track pack' },
  { id: 'e4', model: 'gt350', year: 2018, region: 'uk', status: 'live', mileage: 71500, price: 58500 },
  { id: 'e5', model: 'gt350', year: 2019, region: 'uk', status: 'live', mileage: 72500, price: 47500 },
  { id: 'e6', model: 'gt350', year: 2016, region: 'uk', status: 'live', mileage: 86000, price: 49000 },
  { id: 'e7', model: 'gt350', year: 2020, region: 'uk', status: 'live', mileage: 97000, price: 52000 },

  { id: 'n1', model: 'gt350', year: 2016, region: 'overseas', status: 'live', mileage: 38000, price: 72500 },
  { id: 'n2', model: 'gt350r', year: 2017, region: 'overseas', status: 'live', mileage: 62000, price: 80500, code: 'N2', note: 'GT350R, one owner' },
  { id: 'n3', model: 'gt350', year: 2018, region: 'overseas', status: 'live', mileage: 70000, price: 55000 },
  { id: 'n4', model: 'gt350', year: 2019, region: 'overseas', status: 'live', mileage: 74000, price: 51000 },
  { id: 'n5', model: 'gt350', year: 2016, region: 'overseas', status: 'live', mileage: 88000, price: 47000 },
  { id: 'n6', model: 'gt350', year: 2017, region: 'overseas', status: 'live', mileage: 100500, price: 48500 },

  { id: 'j1', model: 'gt350', year: 2016, region: 'overseas', status: 'live', mileage: 83000, price: 79500 },
  { id: 'j2', model: 'gt350r', year: 2017, region: 'overseas', status: 'live', mileage: 95000, price: 66000 },
  { id: 'j3', model: 'gt350', year: 2018, region: 'overseas', status: 'live', mileage: 96000, price: 64500 },
  { id: 'j4', model: 'gt350', year: 2019, region: 'overseas', status: 'live', mileage: 101000, price: 56500, code: 'J4', note: 'Japan, low-owner' },
  { id: 'j5', model: 'gt350', year: 2016, region: 'overseas', status: 'live', mileage: 99000, price: 62000 },
  { id: 'j6', model: 'gt350', year: 2020, region: 'overseas', status: 'live', mileage: 104000, price: 55500 },
  { id: 'j7', model: 'gt350', year: 2017, region: 'overseas', status: 'live', mileage: 100000, price: 53500 },

  // ---- Completed sales (achieved evidence) ----
  { id: 's1', model: 'gt350', year: 2016, region: 'uk', status: 'sold', mileage: 36000, price: 68000, note: 'Sold — UK auction' },
  { id: 's2', model: 'gt350', year: 2017, region: 'uk', status: 'sold', mileage: 55000, price: 60500, note: 'Sold — private' },
  { id: 's3', model: 'gt350r', year: 2016, region: 'overseas', status: 'sold', mileage: 69000, price: 63500, note: 'Sold — dealer' },
  { id: 's4', model: 'gt350', year: 2018, region: 'overseas', status: 'sold', mileage: 71000, price: 57500, note: 'Sold — Manor, TX (confirmed)' },
  { id: 's5', model: 'gt350', year: 2019, region: 'overseas', status: 'sold', mileage: 86000, price: 49500, note: 'Sold — auction' },
  { id: 's6', model: 'gt350', year: 2016, region: 'overseas', status: 'sold', mileage: 100000, price: 47000, note: 'Sold — retail' },

  // ---- Reference stock, excluded from the trend ----
  { id: 'r1', model: 'gt350r', year: 2016, region: 'uk', status: 'reference', mileage: 14000, price: 83000, note: 'Delivery-mileage collector car — excluded' },
  { id: 'r2', model: 'gt350r', year: 2020, region: 'overseas', status: 'reference', mileage: 70000, price: 92000, note: 'Heritage Edition ask, unconfirmed — excluded' },
  { id: 'r3', model: 'gt350', year: 2017, region: 'europe', status: 'reference', mileage: 40000, price: 85000, note: 'Netherlands — unconfirmed forum ask, excluded' },
];

// --- Currency ---------------------------------------------------------------
// Approximate FX rates to GBP. These are editable defaults; a production build
// would refresh them from a rates API. Live overseas listings are converted to
// GBP with these before anything else happens.
export const FX = { GBP: 1, USD: 0.79, CAD: 0.58, EUR: 0.85 };

export function toGBP(price, currency = 'GBP') {
  const rate = FX[currency] != null ? FX[currency] : 1;
  return Math.round(price * rate);
}

// --- Landed UK cost ---------------------------------------------------------
// Any import outside the UK carries 10% duty + 20% VAT on the GBP-converted
// price, plus shipping. Mainland Europe is a short haul; the US/Canada/Japan
// is a container across an ocean. Cars already in the UK land as-is.
export const OVERSEAS_SHIPPING = 3000; // US / Canada / Japan
export const EU_SHIPPING = 600; // mainland Europe (ferry / short transporter)
export function importLanded(priceGBP, shipping = OVERSEAS_SHIPPING) {
  return Math.round(priceGBP * 1.1 * 1.2 + shipping);
}

// Region = landed-cost tier. Colours use validated dark-mode categorical slots
// 1–3 (a scatter can't stay colourblind-safe past three), so the US, Canada
// and Japan — which now share one import formula — sit in a single "Overseas"
// tier. The tooltip still names the actual source.
export const REGIONS = {
  uk: {
    label: 'UK',
    color: '#3987e5',
    // Already in the UK market — no duty/VAT/shipping to add.
    landed: (price) => price,
  },
  europe: {
    label: 'Europe',
    color: '#d95926',
    // Mainland EU import: 10% duty + 20% VAT + short-haul shipping.
    landed: (price) => importLanded(price, EU_SHIPPING),
  },
  overseas: {
    label: 'USA / Canada / Japan',
    color: '#199e70',
    // Overseas import: 10% duty + 20% VAT + £3,000 shipping.
    landed: (price) => importLanded(price, OVERSEAS_SHIPPING),
  },
};

export function regionMeta(id) {
  return REGIONS[id] || { label: id, color: '#8b949e', landed: (p) => p };
}
