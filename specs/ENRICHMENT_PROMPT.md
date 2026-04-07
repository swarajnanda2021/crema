# Data Enrichment Task for Claude Code (Haiku)

## Context

You are enriching data for an Indian specialty coffee aggregator called **Crema**. There are two JSON files that need missing fields populated by searching roaster websites:

1. **`Scraper/output/products.json`** — 559 coffee bean products
2. **`Scraper/input/manual_roasters.json`** + the roasters served by the API

## Your Job

For each item with missing data, go to the roaster's website (the `product_url` for products, or the `website` for roasters), search Google if needed, and fill in the missing fields. Write the corrections to two output files.

---

## PRODUCTS — What's Missing

| Field | Missing Count | Priority |
|---|---|---|
| `tasting_notes` | 409 / 559 (73% missing) | **HIGH** — most impactful |
| `altitude_masl` | 359 / 559 (64% missing) | MEDIUM |
| `varietal` | 190 / 559 (34% missing) | MEDIUM |
| `origin` | 146 / 559 (26% missing) | MEDIUM |
| `process` | 140 / 559 (25% missing) | MEDIUM |
| `roast_level` | 92 / 559 (16% missing — marked "Unknown") | **HIGH** |

### How to find the data

For each product with missing fields:

1. Open `product_url` in a browser (or fetch it)
2. Look for structured product info on the page: tasting notes, origin, altitude, process, varietal, roast level
3. If the product page doesn't have it, check the roaster's main shop page or product listing
4. If still not found, Google: `"{coffee_name}" "{roaster_name}" tasting notes`

### Origin field cleanup

79 products have garbage origins like:
- `"On - Chikmagalur, Karnataka Balur Estate, A 250-Ac..."` — should be `"Balur Estate, Chikmagalur"`
- `"S Of Chikmagalur"` — should be `"Chikmagalur, Karnataka"`
- `"And Attikan Estate"` — should be `"Attikan Estate, Chikmagalur"`
- `"Ent"` — should be the actual estate name

Clean these to the format: `"Estate Name, Region"` (e.g. `"Ratnagiri Estate, Chikmagalur"`)

### Output format

Write a file `Scraper/output/product_corrections.json`:
```json
[
  {
    "product_id": "blue-tokai-coffee-roasters_attikan-estate",
    "corrections": {
      "tasting_notes": "Chocolate, Citrus, Nutty",
      "origin": "Attikan Estate, Chikmagalur",
      "altitude_masl": 1200,
      "roast_level": "Medium"
    }
  }
]
```

Only include fields you actually found data for. Don't guess — if you can't find it, skip it.

---

## ROASTERS — What's Missing

53 out of 73 roasters have ZERO profile data. They need:

| Field | Missing | How to find it |
|---|---|---|
| `tagline` | 64 | `<meta name="description">` on their homepage |
| `about_blurb` | 56 | Their /about or /our-story page, first 2-3 paragraphs |
| `logo_url` | 53 | `<link rel="apple-touch-icon">` or first `<img>` in `<header>` |
| `social_links` | 56 | Footer links to instagram.com, facebook.com, twitter.com |
| `sourcing_regions` | 59 | Mentioned on about page or product pages (Chikmagalur, Coorg, Araku, etc.) |
| `specialties` | 55 | Keywords on homepage: "single origin", "small batch", "direct trade", "organic", "specialty grade" |
| `founding_year` | 69 | "Founded in YYYY", "Est. YYYY", "Since YYYY" on about page |

### Roasters to enrich (53 with zero data)

Here are their websites — visit each one:

```
7000 Steps - India's Most Remote Coffee   https://www.7000steps.com
93 Degrees Coffee Roasters                https://93degreescoffeeroasters.com
ARAKU Coffee                              http://www.arakucoffee.in
Aromas of Coorg                           https://www.aromasofcoorg.com
Black Fuel Roastery                       https://www.blackfuel.coffee
Bloom Coffee Roasters                     https://bloomcoffeeroasters.in
Caarabi Coffee Roasters                   http://www.caarabicoffee.com
Caffena Coffee                            https://caffenacoffee.com
Chariot Coffee                            https://chariotcoffee.com
Coffee Culture                            http://www.coffeeculture.co.in
Coffee Sutra                              https://sutracoffee.com
Coffeeverse                               https://coffeeverse.co.in
Corridor Seven Coffee Roasters            http://corridorseven.coffee
Cothas Coffee                             https://cothas.com
Curious Life Coffee Roasters              https://curiouslifecoffee.com
Devan's Coffee                            https://www.devans.in
Dope Coffee Roasters                      https://dopecoffee.in
Drum Coffee Roasters                      https://drumcoffee.in
Ekata Coffee Roasters                     https://ekatacoffee.in
FFOX Coffee                               https://ffoxcoffee.com
Forest Farmer Coffee Roasters             https://forestfarmercoffee.com
G-Shot Coffee Roastery                    https://gshotcoffeeroastery.com
Grey Soul Coffee Roasters                 https://greysoul.coffee
Home Blend Coffee Roasters                https://homeblendcoffee.com
Ikkis Coffee Roasters                     https://ikkiscoffee.com
Kafeido Roastery                          https://www.kafeido.com
Kaffa Cerrado                             https://kaffacerrado.com
Kapi Kottai                               https://kapikottai.coffee
Kat & Kin Coffee Roasters                 https://katandkin.in
Kallucoppa Coffee                         https://kallucoppa.com
Korebi Gourmet                            https://www.korebi.in
Korero Coffee Roasters                    https://korerocoffee.com
Kruti Coffee                              https://kruticoffee.com
La Cuppa Coffee                           https://lacuppacoffee.com
Love Kaapi                                https://lovekaapi.com
Okiru Coffee Roasters                     https://okirucoffee.com
PANDURANGA COFFEE 1938                    https://pandurangacoffee.com
Roastery of Vui                           https://roasteryofvui.com
Rossette Coffee Lab                       https://rossettecoffee.com
Siolim Coffee                             https://siolim.coffee
Takaraa Specialty Coffees                 https://takaraacoffee.com
Third Wave Coffee Roasters                https://thirdwavecoffeeroasters.com
Toise Coffee Roastery                     https://toise.coffee
WonderBean Coffee Co                      https://www.wonderbean.in
```

### Output format

Write a file `Scraper/input/roaster_corrections.json`:
```json
[
  {
    "roaster_slug": "blue-tokai-coffee-roasters",
    "corrections": {
      "tagline": "Freshly Roasted Specialty Coffee from Indian Estates",
      "about_blurb": "Founded in 2013 by Matt Chitharanjan...",
      "logo_url": "https://bluetokaicoffee.com/cdn/shop/files/bt-logo.png",
      "founding_year": 2013,
      "sourcing_regions": ["Chikmagalur", "Araku Valley", "Nilgiris"],
      "specialties": ["single-origin", "direct-trade", "specialty-grade"],
      "social_links": {
        "instagram": "https://instagram.com/bluetokaicoffee",
        "facebook": "https://facebook.com/BlueTokaiCoffee"
      }
    }
  }
]
```

---

## DUPLICATE ROASTERS TO MERGE

These are the same roaster listed multiple times (different Google Places locations):

| Domain | Duplicate Names | Keep |
|---|---|---|
| corridorseven.coffee | Corridor Seven Coffee Roasters, Corridor Seven Coffee Roastery/Standing Room, Corridor Seven Lean | Keep first only |
| kruticoffee.com | Kruti Coffee - Signature Cafe..., Kruti Coffee Marigold, Select by Kruti Coffee | Keep first only |
| coffeeculture.co.in | Coffee Culture, Coffee Culture Reserve | Keep first only |
| curiouslifecoffee.com | Curious Life Coffee Roasters: BLUE, Curious Life Coffee Roasters: RED | Keep first only |
| greysoul.coffee | Grey Soul Coffee Roasters (Bandra West), Grey Soul Coffee Roasters (Koregaon Park) | Keep first only |

Write a file `Scraper/input/roaster_dedup.json`:
```json
[
  {
    "keep_slug": "corridor-seven-coffee-roasters",
    "remove_slugs": ["corridor-seven-coffee-roasterystanding-room", "corridor-seven-lean"]
  }
]
```

---

## Approach

1. **Start with the 53 roasters with zero data** — visit each website, extract tagline/about/logo/social/regions/specialties/year
2. **Then do the 409 products missing tasting notes** — visit product pages, extract tasting notes + any other missing fields
3. **Clean up the 79 garbage origins** — fix to "Estate Name, Region" format
4. **Flag the duplicates** for dedup

Use web search (`site:roasterwebsite.com coffee tasting notes`) when the direct page doesn't have info.

## Important Rules

- Only write data you actually found on the roaster's website or a credible source
- Don't invent tasting notes or origins
- If a field can't be found, skip it — don't guess
- Clean origins should be short: "Estate Name, Region" not full sentences
- Specialties must be from this list: `single-origin`, `small-batch`, `direct-trade`, `organic`, `fair-trade`, `estate-grown`, `specialty-grade`, `women-owned`, `sustainability`, `q-grader`
- Social links: only Instagram, Facebook, Twitter/X, YouTube, LinkedIn
- Sourcing regions: use the standard names: Chikmagalur, Coorg/Kodagu, Araku Valley, Wayanad, Nilgiris, Sakleshpur, etc.
