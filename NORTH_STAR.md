# North Star — Crema

> **Synopsis (< 1000 chars)**
>
> Crema is a daily coffee manager for Indian specialty coffee. Consumers
> discover beans, track tasting notes, collect café stamps, and buy from
> roasters. Roasters get a storefront, tell sourcing stories, and receive
> inbound wholesale leads from cafés. Cafés run loyalty programs, source
> beans, and (eventually) accept payments through point-of-sale. The
> platform connects a fragmented market — 120+ micro-roasters, hundreds
> of cafés, thousands of discerning consumers — without owning inventory
> or running logistics. Phase 1 is education and habit (B2C). Phase 2 is
> intent and discovery (B2B). Phase 3 is transactions and payments (POS +
> wholesale commerce). The moat is the graph: every tasting note, every
> stamp, every wholesale inquiry, every café menu linking a roaster's
> beans makes the network denser and harder to replicate. Revenue comes
> from promoted listings, per-lead fees on wholesale inquiries, and
> transaction fees on café POS — but only after the network is warm.
> Build the habit first, extract value second.

---

## 1. What Crema is

Crema is the operating system for Indian specialty coffee. Not a
marketplace (we don't move beans), not a review site (we don't rank),
not a social network (we don't optimise for time-on-feed). We are a
**daily utility** — the app you open when you grind your morning dose,
when you walk into a café, when you want to reorder a bag, when you
(as a roaster) want to tell the story of a new lot, when you (as a
café) want to find a second supplier.

Three user types, three jobs:

| Type | Daily job | Retention hook |
|------|-----------|----------------|
| **Consumer** | Track what I drink, learn, buy more | Stamp book, tasting journal, shelf, Buy button |
| **Roaster** | Tell my story, find buyers | Storefront, sourcing posts, wholesale leads |
| **Café** | Run loyalty, source beans, serve customers | Stamp program, supplier discovery, (future) POS |

The single metric that matters: **weekly actions per user.** A tasting
note, a stamp, a Buy click, a wholesale inquiry — any of these count.
If a user does one action per week, they're retained. Everything we
build should make one of those actions easier or more rewarding.

---

## 2. What we learned from the field

### Padaria Café (Mandrem, Goa)
- 80 kg biweekly from Subko. Pays ~₹2,500/kg wholesale vs Subko's
  ₹4,000/kg retail.
- Pain: shipment delays cause menu anxiety. They have no backup
  supplier because they don't know who else is available at wholesale.
- Implication: **cafés need supplier discovery.** Crema already knows
  every roaster's catalog and every café's menu. The missing piece is
  a way for the café to say "I'm interested" and for the roaster to
  see the signal.

### Nada Coffee Roasters (Anjuna, Goa)
- Very little website traction. Blue Tokai owns consumer mindshare
  through scale, retail stores, and SEO.
- Micro-roasters (600g batch size, ~550g yield) are capacity-
  constrained. They source green beans at ~₹1,000/kg, roast small
  lots, and can't supply cafés at competitive bulk rates except in
  emergencies. Volume pricing kicks in around 1,000+ kg from a
  farmer — 30% discount territory.
- **Storytelling mismatch:** Nada's sourcer said they don't want to
  lead with tasting notes (too subjective). They want to talk about
  the sourcing journey, the farm, and the recommended brew method.
  Our current product-card UX pushes the part of the story roasters
  care least about telling.
- Implication: **the product card needs a sourcing-story layer and a
  brew-method card.** Tasting notes are the consumer's voice; the
  roaster's voice is the origin story and the extraction recipe.

### Blue Tokai (the elephant)
- 10-year fixed-cost farm contracts. Massive product catalog that
  moves slowly. They set the consumer expectation for what "Indian
  specialty coffee" looks like.
- Crema doesn't compete with Blue Tokai. Crema is the platform where
  the 120 roasters who *aren't* Blue Tokai get discovered by the
  consumers and cafés who want something different. Our catalog IS
  our moat — it's the long tail that no single roaster owns.

---

## 3. Phase plan

### Phase 1 — Habit (where we are now)

**Goal:** Make Crema the app consumers open daily for coffee.

Core loops already built:
- Tasting journal (notes with sliders, flavor tags, brew recipe)
- Coffee shelf (open bags / on the list)
- Stamp book (café loyalty with QR scan)
- Social feed (posts, reposts, comments, likes)
- Roaster profiles with product catalogs
- Café profiles with menus, hours, seasonal status
- Admin traction dashboard (all metrics, investor-ready)

What's missing for pilot (see `LAUNCH_TODO.md`):
- Password reset, account deletion, report posts
- Postgres + object storage migration
- App Store submission (icons, legal, TestFlight)

Retention hooks that drive weekly actions:
- **Buy button** — outbound click to roaster's shop. Already tracked
  in click_events. Every click is an intent signal.
- **Stamp collection** — café owners stamp users via camera scan.
  Every stamp is a visit signal.
- **Tasting notes** — the highest-effort action, the deepest
  engagement signal, and the one that generates the most valuable
  data for roasters.

**Phase 1 is about density:** more users tasting, more roasters
listed, more cafés running stamps. The network gets useful at ~500
active users in one city.

---

### Phase 2 — Intent (next)

**Goal:** Connect the B2B side. Cafés discover roasters. Roasters
discover demand. No transactions — just the handshake.

Features to build:

#### 2.1 "Interested" button (café → roaster)

A café owner viewing a roaster's product page sees: **"Interested —
notify this roaster."** Creates a lightweight intent record:

```
wholesale_inquiries (
  id, cafe_slug, roaster_slug, product_id (optional),
  message (optional), volume_hint, status, created_at
)
```

The roaster gets a **business notification** (separate tab in the
notifications dropdown — see 2.4). The notification carries context:
café name, location, current menu, monthly volume (if set). The
roaster reaches out off-platform (email, Instagram, phone) to close.

This is the single highest-value B2B feature. A micro-roaster who
gets 3 qualified café inquiries per month through Crema has a reason
to keep their profile updated. A café that finds a second supplier
through Crema has a reason to keep their menu current.

The admin traction dashboard gains a new metric section:
**wholesale inquiries** — total, by roaster, by café, conversion
(inquiry → menu change on the café's profile = implicit close).

#### 2.2 Wholesale availability signal

Roaster profiles and individual products gain:
- `wholesale_available` BOOLEAN
- `min_order_kg` INTEGER (optional)
- `wholesale_note` TEXT (optional, e.g. "DM us for pricing")

When set, a subtle **"Wholesale"** badge appears on the product card.
**Visible only to café-type accounts** — consumers never see it.
Cafés can filter the catalog to show only wholesale-available products.

This is the supply-side counterpart to the "Interested" button. It
answers the café's question: "Can I even buy this in bulk?" without
the roaster having to publish a price list.

#### 2.3 Sourcing story posts (roaster storytelling)

The roaster's storytelling problem isn't a data-model problem — it's
a post-type problem. When a roaster introduces a new coffee, they
should be able to write a **sourcing story post**: a long-form
article-style post with:

- Text body (increased character limit — 2000+ chars)
- Multiple photos (farm, processing, cupping)
- Auto-detected URLs (same link-preview mechanism as the feed)
- Tagged product (links to the product card)
- Tagged farm / origin (free text initially; structured later)

This is a new `post_type: "sourcing_story"` in the existing posts
system. It renders as a richer card in the feed — hero image, longer
teaser, "Read full story" expansion. The roaster writes it once; it
lives on their profile AND in their followers' feeds AND on the
product page as linked content.

The key insight from Nada: **tasting notes are the consumer's
contribution; the sourcing story is the roaster's contribution.**
Both live on the same product page, but they come from different
people with different motivations.

#### 2.4 Business notifications (split notification model)

The notification dropdown gains two tabs:

- **Activity** (existing): likes, comments, follows, reposts, stamps
  received (consumer-facing)
- **Business** (new, visible only to roaster + café accounts):
  wholesale inquiries, catalog-change follower notifications,
  stamp-awarded confirmations, (future) payment notifications

This split is important because business signals and social signals
have different urgency profiles. A café owner doesn't want "someone
liked your post" mixed in with "a new roaster wants to supply you."
The business tab is where the money lives.

#### 2.5 Brew method card (product carousel)

The product page's carousel currently shows tasting-note cards
submitted by users. Add a **brew method card** — submitted by the
roaster, one per brew method they recommend:

- Method: espresso / V60 / Chemex / AeroPress / moka pot / French
  press / cold brew
- Fields vary by method:
  - **Espresso**: dose (g), yield (g), ratio (e.g. 1:2), time (s),
    temperature (°C), grind size
  - **Pour-over (V60/Chemex)**: dose, water (ml), ratio, bloom time,
    total brew time, grind size, pour pattern notes
  - **AeroPress**: dose, water, steep time, inverted (y/n), grind
  - **Moka pot / French press**: dose, water, steep time
  - **Cold brew**: dose, water, steep hours

Renders as an infographic-style card in the carousel alongside
tasting-note cards. The roaster's brew card is distinguished visually
(maybe a different card-back color or a "By the roaster" label) so
users know it's the official recommendation, not a user submission.

#### 2.6 Café procurement profile (lightweight)

Optional fields on café_profiles, visible only to roasters who
receive an inquiry:

- `monthly_volume_kg` INTEGER
- `open_to_new_roasters` BOOLEAN
- `procurement_note` TEXT (e.g. "Looking for a single-origin
  Ethiopian for our new pour-over program")

This enriches the "Interested" notification so the roaster can
qualify the lead without a back-and-forth. A roaster seeing "Padaria,
160 kg/month, currently pours Subko, open to new roasters" knows
exactly whether this is worth a phone call.

---

### Phase 3 — Transactions (later)

**Goal:** Crema handles money. Two revenue surfaces:

#### 3.1 Café POS (point of sale)

The stamp system already puts Crema on the café counter. Extend it:

- Customer scans to pay (UPI / card / wallet) instead of just
  collecting a stamp. Stamp is awarded automatically on payment.
- The café gets a lightweight POS dashboard: daily sales, popular
  drinks, average ticket, peak hours.
- Crema takes a small transaction fee (1-2%).

This is the ultimate retention hook: the app is literally how you pay
for your coffee. You can't churn off something that's in your daily
payment flow.

**Prerequisite:** PCI compliance, UPI integration (Razorpay / Juspay),
and the café trust that comes from Phase 1-2 adoption.

#### 3.2 Wholesale commerce

The "Interested" button from Phase 2 becomes a structured order flow:

- Café places an order (product, quantity, delivery date)
- Roaster confirms availability + price
- Payment settles through Crema (escrow until delivery confirmed)
- Crema takes a transaction fee (2-5%)

This replaces the Instagram DM + bank transfer + hope-for-the-best
flow that micro-roasters and cafés currently use. The value prop is
reliability: payment is guaranteed, delivery is tracked, disputes
have a resolution path.

**Prerequisite:** working "Interested" pipeline from Phase 2 with
enough volume to justify the logistics investment. Probably 50+
inquiries per month in one city before this makes sense.

#### 3.3 Promoted listings (low-touch revenue)

Roasters pay to appear higher in catalog search, in the "Discover"
tab, or in café procurement flows. This is the Google Ads model
applied to a vertical: the intent is already there (café searching
for a new Ethiopian), the promotion just surfaces relevant suppliers
faster.

**Prerequisite:** search + discovery features from Phase 1-2 with
enough traffic to make impressions meaningful.

---

## 4. The moat

Crema's defensibility is the **graph:**

```
Consumer ──tasting_note──▶ Product ◀──sourcing_story── Roaster
    │                         │                            │
    │ stamp                   │ menu_item                  │ wholesale
    ▼                         ▼                            ▼
   Café ──────interest──────▶ Roaster
```

Every action makes the graph denser:
- A tasting note connects a consumer to a product.
- A stamp connects a consumer to a café.
- A menu item connects a café to a roaster (through a product).
- A wholesale inquiry connects a café to a roaster directly.
- A sourcing story connects a roaster to a farm and a product.

No single participant can replicate this graph alone. Blue Tokai
knows their own sales but not what Nada's customers think. Nada knows
their beans but not which cafés would pour them. Padaria knows their
menu but not what other cafés in Goa are sourcing. Crema is the only
entity that sees all three perspectives at once.

The graph gets more valuable with density, and density compounds:
more roasters listed → more products for consumers to discover → more
tasting notes → more signal for cafés deciding what to stock → more
wholesale inquiries → more roasters motivated to keep profiles
current. The flywheel.

---

## 5. What we don't do

Clarity about what Crema is NOT:

- **Not a logistics company.** We don't ship beans. We connect buyer
  and seller; they handle fulfillment. (Phase 3 may add delivery
  tracking, but not delivery itself.)
- **Not a review site.** We don't aggregate star ratings or rank
  roasters. Tasting notes are personal journal entries, not Yelp
  reviews. The absence of a ranking system is intentional — it keeps
  roasters collaborative rather than competitive on the platform.
- **Not a social-media-first app.** The feed exists to distribute
  sourcing stories and tasting notes, not to maximise scroll time.
  There is no algorithmic feed (chronological only), no stories
  feature, no reels. Coffee is the content, not the container.
- **Not competing with Blue Tokai.** Blue Tokai is the Starbucks of
  Indian specialty. They can be on the platform alongside 120 other
  roasters, and their presence helps the platform (consumers
  recognise the brand), but our value proposition is the long tail
  they don't serve.

---

## 6. Architecture alignment (CRUD Utopia)

The CRUD Utopia architecture (see `CRUD_UTOPIA.md`) was designed to
make every phase buildable without rewrites:

| Phase feature | Architecture surface |
|---|---|
| Wholesale inquiries | New registry resource, notification hook |
| Brew method cards | New registry resource nested under products |
| Sourcing story posts | New post_type in existing posts resource |
| Business notifications | Notification type + split rendering |
| Wholesale badge | Field on product / roaster_profile + conditional render |
| Café POS | New routes/specific.py composite endpoints |
| Transaction fees | New service module, same envelope pattern |

The design-tokens system carries to the iOS app (Expo builds native
from the same codebase). A future native Swift rewrite, if ever
needed, consumes the same `design-tokens.json` and the same API
envelope — the backend doesn't change at all.

---

## 7. Success metrics by phase

### Phase 1 (Habit)
- 500 registered users in one city (Goa)
- 50 weekly active users
- 10 cafés with stamps enabled
- 20 roasters with profiles
- D7 retention ≥ 20%

### Phase 2 (Intent)
- 50 wholesale inquiries per month
- 5 confirmed supplier switches (café changes a menu item to a
  roaster they found through Crema)
- 30% of active roasters have at least one sourcing story post
- Business notification tab opened by ≥ 60% of seller accounts

### Phase 3 (Transactions)
- 10 cafés using Crema POS daily
- ₹5L monthly GMV through wholesale orders
- Transaction fee revenue covers infrastructure costs
  (~₹15k/month = self-sustaining)

---

## 8. Revenue model (eventual, not now)

| Stream | Phase | Mechanism | Target take rate |
|---|---|---|---|
| Promoted listings | 2+ | Roasters pay for visibility in search + discovery | ₹2-5k/mo per roaster |
| Wholesale lead fee | 2+ | Per qualified inquiry or flat monthly | ₹500/lead or ₹3k/mo |
| Café POS fee | 3 | % of transaction | 1-2% |
| Wholesale transaction fee | 3 | % of order value | 2-5% |
| Premium analytics | 2+ | Deeper insights for sellers (beyond free tier) | ₹1-3k/mo |

**Rule: no revenue extraction before Phase 2 metrics are hit.** The
network has to be warm before anyone pays. Premature monetisation
kills the flywheel.

---

*This document is canonical alongside `CRUD_UTOPIA.md` and
`LAUNCH_TODO.md`. When a feature request comes up, check it against
the phase plan. If it doesn't serve the current phase's retention
hooks or the next phase's intent signals, it waits.*
