// data.js
// Seed market dataset for the GT350 / GT350R (2015–2020), priced for a UK
// buyer in GBP. It powers the dashboard out of the box so the chart is
// meaningful even when live marketplace reads are blocked. Live asking
// listings gathered by the popup search are merged on top of this at runtime
// (see dashboard.js → loadDataset).
//
// Fields:
//   region : 'europe' | 'na' | 'japan'   — where the car currently is
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
  { id: 'e2', model: 'gt350', year: 2017, region: 'europe', status: 'live', mileage: 47000, price: 71000 },
  { id: 'e3', model: 'gt350r', year: 2016, region: 'europe', status: 'live', mileage: 71000, price: 74000, code: 'E3', note: 'GT350R, track pack' },
  { id: 'e4', model: 'gt350', year: 2018, region: 'europe', status: 'live', mileage: 71500, price: 58500 },
  { id: 'e5', model: 'gt350', year: 2019, region: 'europe', status: 'live', mileage: 72500, price: 47500 },
  { id: 'e6', model: 'gt350', year: 2016, region: 'europe', status: 'live', mileage: 86000, price: 49000 },
  { id: 'e7', model: 'gt350', year: 2020, region: 'europe', status: 'live', mileage: 97000, price: 52000 },

  { id: 'n1', model: 'gt350', year: 2016, region: 'na', status: 'live', mileage: 38000, price: 72500 },
  { id: 'n2', model: 'gt350r', year: 2017, region: 'na', status: 'live', mileage: 62000, price: 80500, code: 'N2', note: 'GT350R, one owner' },
  { id: 'n3', model: 'gt350', year: 2018, region: 'na', status: 'live', mileage: 70000, price: 55000 },
  { id: 'n4', model: 'gt350', year: 2019, region: 'na', status: 'live', mileage: 74000, price: 51000 },
  { id: 'n5', model: 'gt350', year: 2016, region: 'na', status: 'live', mileage: 88000, price: 47000 },
  { id: 'n6', model: 'gt350', year: 2017, region: 'na', status: 'live', mileage: 100500, price: 48500 },

  { id: 'j1', model: 'gt350', year: 2016, region: 'japan', status: 'live', mileage: 83000, price: 79500 },
  { id: 'j2', model: 'gt350r', year: 2017, region: 'japan', status: 'live', mileage: 95000, price: 66000 },
  { id: 'j3', model: 'gt350', year: 2018, region: 'japan', status: 'live', mileage: 96000, price: 64500 },
  { id: 'j4', model: 'gt350', year: 2019, region: 'japan', status: 'live', mileage: 101000, price: 56500, code: 'J4', note: 'Japan, low-owner' },
  { id: 'j5', model: 'gt350', year: 2016, region: 'japan', status: 'live', mileage: 99000, price: 62000 },
  { id: 'j6', model: 'gt350', year: 2020, region: 'japan', status: 'live', mileage: 104000, price: 55500 },
  { id: 'j7', model: 'gt350', year: 2017, region: 'japan', status: 'live', mileage: 100000, price: 53500 },

  // ---- Completed sales (achieved evidence) ----
  { id: 's1', model: 'gt350', year: 2016, region: 'europe', status: 'sold', mileage: 36000, price: 68000, note: 'Sold — UK auction' },
  { id: 's2', model: 'gt350', year: 2017, region: 'europe', status: 'sold', mileage: 55000, price: 60500, note: 'Sold — private' },
  { id: 's3', model: 'gt350r', year: 2016, region: 'na', status: 'sold', mileage: 69000, price: 63500, note: 'Sold — dealer' },
  { id: 's4', model: 'gt350', year: 2018, region: 'na', status: 'sold', mileage: 71000, price: 57500, note: 'Sold — Manor, TX (confirmed)' },
  { id: 's5', model: 'gt350', year: 2019, region: 'na', status: 'sold', mileage: 86000, price: 49500, note: 'Sold — auction' },
  { id: 's6', model: 'gt350', year: 2016, region: 'na', status: 'sold', mileage: 100000, price: 47000, note: 'Sold — retail' },

  // ---- Reference stock, excluded from the trend ----
  { id: 'r1', model: 'gt350r', year: 2016, region: 'europe', status: 'reference', mileage: 14000, price: 83000, note: 'Delivery-mileage collector car — excluded' },
  { id: 'r2', model: 'gt350r', year: 2020, region: 'na', status: 'reference', mileage: 70000, price: 92000, note: 'Heritage Edition ask, unconfirmed — excluded' },
  { id: 'r3', model: 'gt350', year: 2017, region: 'europe', status: 'reference', mileage: 40000, price: 85000, note: 'Unconfirmed forum ask — excluded' },
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
// For an overseas import: take the GBP-converted price, add 10% import duty,
// add 20% VAT, then add £3,000 shipping. Cars already in the UK land as-is.
export const UK_SHIPPING = 3000;
export function importLanded(priceGBP) {
  return Math.round(priceGBP * 1.1 * 1.2 + UK_SHIPPING);
}

// Region metadata: display label, chart hue (validated dark-mode categorical
// slots 1–3), and how to land the car in the UK.
export const REGIONS = {
  europe: {
    label: 'UK / Europe',
    color: '#3987e5',
    // Car is already in the UK market — no import duty/VAT/shipping to add.
    landed: (price) => price,
  },
  na: {
    label: 'USA / Canada',
    color: '#d95926',
    landed: importLanded,
  },
  japan: {
    label: 'Japan',
    color: '#199e70',
    landed: importLanded,
  },
};

export function regionMeta(id) {
  return REGIONS[id] || { label: id, color: '#8b949e', landed: (p) => p };
}
