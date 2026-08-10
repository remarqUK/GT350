# GT350 Hunter — Shelby Mustang Finder (Chrome extension)

Searches multiple car marketplaces at once for a **2015–2020 Ford Mustang
Shelby GT350 / GT350R**, then plots the market as a **mileage-vs-price**
dashboard for a UK buyer — asking vs achieved prices, and the true **landed UK
cost** of importing an overseas car.

![Market dashboard](docs/dashboard-preview.png)

## What it does

- **One search, many sites.** Builds pre-filtered searches (year range +
  GT350/GT350R keyword) for every marketplace and, where a site allows it,
  previews the matching listings inline in the popup.
- **Market dashboard.** A mileage-vs-price scatter with two trend lines —
  **asking** vs **achieved (sold)** — so you can see how far asking sits above
  real evidence. Stat tiles show cheapest / median / most expensive / average
  mileage. Filter by **status** (all / for sale / sold), by **model** (GT350 /
  GT350R), and toggle **regions** on/off by tapping the legend.
- **Landed UK cost.** Toggle between raw prices and the real cost on your
  driveway. Overseas cars are converted to GBP, then **+10% import duty, +20%
  VAT, +£3,000 shipping**. UK cars land as-is.
- **Region colours.** Where the car is now — UK/Europe, USA/Canada, Japan —
  using a colourblind-safe categorical palette (validated for the dark theme).

## Marketplaces covered

**UK (GBP):** AutoTrader UK · PistonHeads · eBay UK · Cazoo · Car & Classic

**USA / Canada (converted to GBP + import costs):** AutoTrader.com · Cars.com ·
CarGurus · Bring a Trailer · AutoTrader.ca

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (the one containing
   `manifest.json`).
4. Pin **GT350 Hunter** and click the toolbar icon.

## Using it

- Set the **year range** and **GT350 / GT350R / Both**, then **Search all
  sites**. Each site card shows how many matches were read, with the top
  listings; click a card to expand.
- **Open all ↗** launches every site's pre-filtered search in its own tab.
- **📊 Market dashboard** opens the mileage-vs-price view. It plots **real
  adverts only** — the cars found by your last search that have both a price
  and a mileage — and every dot (and every data-table row) opens that exact
  advert. Before your first search it shows an empty state prompting you to run
  one.

## How the data works

- **Shadow-tab reads.** Rather than `fetch()` (which hits bot-walls and misses
  JavaScript-rendered content), a search briefly opens each site's pre-filtered
  results in a **background tab**, lets it fully render in the real browser,
  scrapes the live DOM with an injected function, then closes the tab. You'll
  see tabs open and close while it works (up to 3 at once). This needs the
  `scripting` permission.
- **Real adverts only.** The dashboard shows only cars found by a live search
  that have a price *and* a mileage *and* a URL, each linking to its actual
  advert. **eBay UK** parses most reliably; some sites still show a consent or
  robot page, in which case use their **Open ↗** link. Nothing readable found →
  the chart stays empty rather than showing placeholder cars.
- **Prices are estimates.** FX rates and the import-cost model live in
  [`src/data.js`](src/data.js) (`FX`, `importLanded`) — edit them to match
  current rates.

## Project layout

```
manifest.json          # MV3 manifest
src/
  sites.js             # marketplace definitions: search URLs, currency, region
  data.js              # FX rates, landed-cost model, region tiers
  popup.html/.css/.js  # search launcher + shadow-tab scraper
  dashboard.html/.css/.js  # mileage-vs-price market dashboard
  background.js        # service worker (defaults + context menu)
icons/                 # generated Shelby-themed icons
```

## Notes & limitations

- Prices, FX and import costs are **estimates**, not quotes — verify duty/VAT
  treatment (e.g. classic/collector reliefs) for your specific import.
- The extension only reads publicly visible search pages and never logs in on
  your behalf. Respect each marketplace's terms of use.
