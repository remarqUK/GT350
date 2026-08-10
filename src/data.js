// data.js
// Market model for the GT350 / GT350R (2015–2020), for a UK buyer in GBP.
// The dashboard plots real adverts only — cars found by the popup's live
// search (see dashboard.js → loadDataset). This module supplies the currency
// conversion, the landed-cost model, and the region (landed-cost tier)
// metadata those adverts are scored against.

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
