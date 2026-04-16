# North Star — Crema

> **Synopsis (< 1000 chars)**
>
> Crema is a daily coffee manager for Indian specialty coffee. Consumers
> discover beans, track tasting notes, collect café stamps, and buy from
> roasters. Roasters get a storefront, tell sourcing stories, and receive
> inbound wholesale leads from cafés. Cafés run loyalty programs, source
> beans, and accept payments through point-of-sale. The platform connects
> a fragmented market — 120+ micro-roasters, hundreds of cafés, thousands
> of consumers — without owning inventory or running logistics. Phase 1
> builds the network: habit + intent + B2B discovery, all pre-revenue.
> Phase 2 turns the network into a transaction layer: consumer purchases,
> café POS, wholesale commerce. Phase 3 closes the loop by owning
> delivery. The moat is the graph: every tasting note, stamp, wholesale
> inquiry, and café menu linking a roaster's beans makes the network
> denser and harder to replicate. Revenue comes from transaction fees on
> POS, wholesale orders, promoted listings, and delivery margins — but
> only after the network is warm. Build the habit first, extract value
> second.

---

## 1. What Crema is

Crema is the operating system for Indian specialty coffee. Not a
marketplace (we don't move beans — yet), not a review site (we don't
rank), not a social network (we don't optimise for time-on-feed). We
are a **daily utility** — the app you open when you grind your morning
dose, when you walk into a café, when you want to reorder a bag, when
you (as a roaster) want to tell the story of a new lot, when you (as
a café) want to find a second supplier.

Three user types, three jobs:

| Type | Daily job | Retention hook |
|------|-----------|----------------|
| **Consumer** | Track what I drink, learn, buy more | Stamp book, tasting journal, shelf, Buy button |
| **Roaster** | Tell my story, find buyers | Storefront, sourcing posts, wholesale leads |
| **Café** | Run loyalty, source beans, serve customers | Stamp program, supplier discovery, POS |

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

### Phase 1 — The Network (where we are now)

**Goal:** Build the daily habit AND the B2B discovery layer in one
pass. By the end of Phase 1, consumers use Crema to manage their
coffee life, roasters use it to tell their story and receive
wholesale interest, and cafés use it for loyalty and sourcing. No
money changes hands through Crema yet — but every participant has a
reason to open the app every week.

#### Already built

Core consumer loops:
- Tasting journal (notes with sliders, flavor tags, brew recipe)
- Coffee shelf (open bags / on the list)
- Stamp book (café loyalty with QR scan)
- Social feed (posts, reposts, comments, likes)
- Buy button (outbound click to roaster's shop, tracked)

Seller infrastructure:
- Roaster profiles with product catalogs, in-place editing
- Café profiles with menus, hours, seasonal status, loyalty config
- Owner edit affordances (hero/logo crop, inline editing)
- Catalog-change notifications fanned out to followers

Platform:
- Admin traction dashboard (6 metric sections, time-series charts,
  info modals, investor-ready)
- Multi-account (one user + one roaster + one café simultaneously)
- CRUD Utopia architecture (registry-driven, design-token portable)

#### Still to build — consumer side

**Retention hooks:**
- Password reset, account deletion, report posts (launch-blockers)
- Contact us / feedback widget
- Onboarding nudges (empty-state prompts to first tasting note,
  first shelf add, first follow)

**Missing for pilot** (see `LAUNCH_TODO.md`):
- Postgres + object storage migration
- Env-based config, error boundaries
- App Store submission (icons, legal, TestFlight)

#### Still to build — B2B side

**1.1 "Interested" button (café → roaster)**

A café owner viewing a roaster's product page sees: **"Interested —
notify this roaster."** Creates a lightweight intent record:

```
wholesale_inquiries (
  id, cafe_slug, roaster_slug, product_id (optional),
  message (optional), volume_hint, status, created_at
)
```

The roaster gets a **business notification** (see 1.4). The
notification carries context: café name, location, current menu,
monthly volume (if set). The roaster reaches out off-platform
(email, Instagram, phone) to close.

This is the single highest-value B2B feature. A micro-roaster who
gets 3 qualified café inquiries per month through Crema has a reason
to keep their profile updated. A café that finds a second supplier
through Crema has a reason to keep their menu current.

The admin traction dashboard gains a new metric section:
**wholesale inquiries** — total, by roaster, by café, conversion
(inquiry → menu change on the café's profile = implicit close).

**1.2 Wholesale availability signal**

Roaster profiles and individual products gain:
- `wholesale_available` BOOLEAN
- `min_order_kg` INTEGER (optional)
- `wholesale_note` TEXT (optional, e.g. "DM us for pricing")

When set, a subtle **"Wholesale"** badge appears on the product card.
**Visible only to café-type accounts** — consumers never see it.
Cafés can filter the catalog to show only wholesale-available
products.

This is the supply-side counterpart to the "Interested" button. It
answers the café's question: "Can I even buy this in bulk?" without
the roaster having to publish a price list.

**1.3 Sourcing story posts (roaster storytelling)**

When a roaster introduces a new coffee, they should be able to write
a **sourcing story post**: a long-form article-style post with:

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

**1.4 Business notifications (split notification model)**

The notification dropdown gains two tabs:

- **Activity** (existing): likes, comments, follows, reposts, stamps
  received (consumer-facing)
- **Business** (new, visible only to roaster + café accounts):
  wholesale inquiries, catalog-change follower notifications,
  stamp-awarded confirmations, (future) payment + delivery
  notifications

This split is important because business signals and social signals
have different urgency profiles. A café owner doesn't want "someone
liked your post" mixed in with "a new roaster wants to supply you."
The business tab is where the money lives. Stamp confirmations live
here too — from the café owner's perspective, stamping is business
operations, not social. (The user gets a regular Activity
notification that a stamp was added to their book.)

**1.5 Brew method card (product carousel)**

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
(different card-back color or a "By the roaster" label) so users
know it's the official recommendation, not a user submission.

**1.6 Café procurement profile (lightweight)**

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

**Phase 1 success metrics:**
- 500 registered users in one city (Goa)
- 50 weekly active users
- 10 cafés with stamps enabled
- 20 roasters with profiles
- 50 wholesale inquiries per month
- 5 confirmed supplier switches (café changes a menu item to a
  roaster they found through Crema)
- 30% of active roasters have at least one sourcing story post
- Business notification tab opened by ≥ 60% of seller accounts
- D7 retention ≥ 20%

---

### Phase 2 — Transactions

**Goal:** Crema handles money. The network from Phase 1 proved that
consumers want to buy, cafés want to source, and roasters want to
sell. Now we close the loop.

#### 2.1 B2C — Consumer purchases

The Buy button currently sends the consumer to the roaster's
external website. In Phase 2, the purchase happens inside Crema:

- **In-app checkout:** Consumer taps Buy → sees price, weight,
  delivery estimate → pays via UPI / card / wallet (Razorpay or
  Juspay integration) → order created.
- **Roaster fulfills:** The roaster gets an order notification in
  the Business tab. They pack and ship. Crema provides a tracking
  link (via shipping partner API — Shiprocket, Delhivery, etc.).
- **Consumer receives:** On delivery confirmation, Crema prompts
  "Add to your shelf?" and "Write a tasting note?" — closing the
  discovery → purchase → experience loop.
- **Revenue:** Crema takes a transaction fee (3-5% of order value).
  The roaster sets the price; Crema never owns inventory.

This replaces the roaster's own e-commerce site as the primary sales
channel for consumers who discover beans through Crema. The value
proposition for the roaster: you get customers you'd never reach on
your own website. The value proposition for the consumer: you buy
from 120 roasters through one checkout, one account, one order
history.

#### 2.2 B2B — Wholesale commerce

The "Interested" button from Phase 1 becomes a structured order
flow:

- **Café places an order:** product, quantity (kg), preferred
  delivery date, delivery address. The interface is a simple form
  pre-filled from the café's procurement profile.
- **Roaster confirms:** availability, price per kg, estimated
  delivery. This is a quote, not a listing — wholesale prices are
  negotiated per-relationship, not published.
- **Payment settles through Crema:** escrow until delivery is
  confirmed by the café. If there's a dispute (short shipment,
  quality issue), Crema mediates.
- **Revenue:** Crema takes a transaction fee (2-5% of order value).
  Lower than B2C because order sizes are larger and margins are
  thinner.

This replaces the Instagram DM + bank transfer + hope-for-the-best
flow that micro-roasters and cafés currently use. The value prop is
reliability: payment is guaranteed, delivery is tracked, disputes
have a resolution path. Padaria's shipment-delay anxiety gets a
tracking number instead of a prayer.

#### 2.3 Café POS (point of sale)

The stamp system already puts Crema on the café counter. Extend it:

- **Customer scans to pay** (UPI / card / wallet) instead of just
  collecting a stamp. Stamp is awarded automatically on payment.
- **Menu-linked checkout:** The café's Crema menu becomes the POS
  menu. Customer selects a drink, pays, stamp lands.
- **Café POS dashboard:** daily sales, popular drinks, average
  ticket, peak hours, staff transactions.
- **Revenue:** Crema takes a small transaction fee (1-2%). Lower
  than standard POS providers because the loyalty program is bundled
  — the café doesn't need a separate Thrive/Square + a separate
  loyalty app.

This is the ultimate retention hook: the app is literally how you
pay for your coffee. You can't churn off something that's in your
daily payment flow.

#### 2.4 Promoted listings (low-touch revenue)

Roasters pay to appear higher in catalog search, in the Discover
tab, or in café procurement flows. This is the Google Ads model
applied to a vertical: the intent is already there (café searching
for a new Ethiopian), the promotion just surfaces relevant suppliers
faster.

**Phase 2 success metrics:**
- 10 cafés using Crema POS daily
- ₹5L monthly GMV through wholesale orders
- ₹2L monthly GMV through consumer purchases
- Transaction fee revenue covers infrastructure costs
  (~₹15k/month = self-sustaining)
- 20 roasters with at least one in-app sale per month

---

### Phase 3 — Delivery

**Goal:** Crema owns the last mile. The transaction layer from
Phase 2 proved volume; now we vertically integrate delivery to
capture more margin and solve the reliability problem that Padaria
told us about.

#### 3.1 Wholesale delivery network

- **Crema delivery agents** (or partner fleet — Dunzo, Porter,
  Shadowfax) handle roaster → café shipments within a city.
- **Guaranteed SLAs:** next-day delivery within city, 2-3 day
  inter-city. The café knows when their 80 kg is arriving — no more
  delayed-shipment anxiety.
- **Route optimization:** multiple café deliveries from the same
  roaster consolidated. A roaster shipping to 5 cafés in Goa
  doesn't make 5 separate trips.
- **Revenue:** delivery fee (₹X per kg per km) + margin on
  consolidated routes. The roaster's logistics cost drops because
  Crema batches shipments; the café's reliability goes up because
  Crema guarantees the SLA.

#### 3.2 Consumer delivery

- **Same-city same-day / next-day** for roasters with local
  inventory. Premium option for consumers who want it fresh.
- **Standard shipping** via existing courier partners for
  inter-city. Crema negotiates bulk rates across all roasters
  (volume leverage that no single micro-roaster has alone).
- **Revenue:** shipping fee passed to consumer + margin from bulk
  courier rate negotiation.

#### 3.3 Cold chain / freshness guarantee (stretch)

Specialty coffee's enemy is time. Green beans last months; roasted
beans peak at 7-21 days. If Crema controls delivery, Crema can
guarantee freshness:

- **Roast-to-door tracking:** consumer sees "roasted 2 days ago,
  shipped today, arrives tomorrow."
- **Freshness badge:** products delivered within 7 days of roast
  get a quality mark.
- **Subscription delivery:** consumer subscribes to a bean; Crema
  coordinates the roast schedule with the roaster so the bag ships
  the day after roasting.

This is the deepest moat of all: if Crema is the only channel that
guarantees a 3-day roast-to-door window, neither the roaster's own
website nor Amazon can compete on freshness.

**Phase 3 success metrics:**
- 50+ wholesale deliveries per month in one city
- 200+ consumer deliveries per month
- Average delivery SLA met ≥ 95% of the time
- Delivery margin positive (revenue from fees > cost of fleet)
- ₹20L monthly GMV (combined wholesale + consumer + POS)

---

## 4. The moat

Crema's defensibility is the **graph:**

```
Consumer ──tasting_note──▶ Product ◀──sourcing_story── Roaster
    │                         │                            │
    │ stamp / payment         │ menu_item                  │ wholesale order
    ▼                         ▼                            ▼
   Café ──────interest──────▶ Roaster
    │                                                      │
    │ POS transaction                                      │ delivery
    ▼                                                      ▼
   Consumer                                          Café (received)
```

Every action makes the graph denser:
- A tasting note connects a consumer to a product.
- A stamp (or a POS payment) connects a consumer to a café.
- A menu item connects a café to a roaster (through a product).
- A wholesale inquiry connects a café to a roaster directly.
- A wholesale order + delivery closes that connection with money.
- A sourcing story connects a roaster to a farm and a product.
- A consumer purchase closes the discovery → ownership loop.

No single participant can replicate this graph alone. Blue Tokai
knows their own sales but not what Nada's customers think. Nada
knows their beans but not which cafés would pour them. Padaria knows
their menu but not what other cafés in Goa are sourcing. Crema is
the only entity that sees all three perspectives at once — and in
Phase 3, the only entity that physically moves the beans.

The graph gets more valuable with density, and density compounds:
more roasters listed → more products for consumers to discover →
more tasting notes → more signal for cafés deciding what to stock →
more wholesale inquiries → more orders → more delivery data → better
route optimization → lower costs → more roasters motivated to use
the platform. The flywheel.

---

## 5. What we don't do

Clarity about what Crema is NOT:

- **Not an inventory holder.** We never own beans. We connect buyer
  and seller; they hold stock. Even in Phase 3, the delivery agent
  picks up from the roaster and delivers to the buyer. Crema is a
  logistics coordinator, not a warehouser.
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
| B2C checkout | New routes/specific.py composite endpoints |
| Café POS | Extension of stamp flow + payment service |
| Wholesale orders | New registry resource + escrow service |
| Delivery tracking | New service module, same envelope pattern |
| Transaction fees | Payment service module, same envelope pattern |

The design-tokens system carries to the iOS app (Expo builds native
from the same codebase). A future native Swift rewrite, if ever
needed, consumes the same `design-tokens.json` and the same API
envelope — the backend doesn't change at all.

---

## 7. Revenue model

| Stream | Phase | Mechanism | Target take rate |
|---|---|---|---|
| Promoted listings | 1+ | Roasters pay for visibility in search + discovery | ₹2-5k/mo per roaster |
| Consumer transaction fee | 2 | % of in-app purchase | 3-5% |
| Wholesale transaction fee | 2 | % of order value | 2-5% |
| Café POS fee | 2 | % of counter transaction | 1-2% |
| Premium analytics | 1+ | Deeper insights for sellers (beyond free tier) | ₹1-3k/mo |
| Delivery fee | 3 | Per-kg per-km + consolidated route margin | Variable |
| Subscription margin | 3 | Delta between bulk courier rate and consumer shipping fee | 10-15% of shipping |

**Rule: no revenue extraction before Phase 1 network metrics are
hit.** The network has to be warm before anyone pays. Premature
monetisation kills the flywheel.

Self-sustaining threshold: ~₹15k/month in transaction fees covers
infrastructure. Projected at 10 POS cafés + 50 wholesale orders +
200 consumer purchases per month in one city.

---

*This document is canonical alongside `CRUD_UTOPIA.md` and
`LAUNCH_TODO.md`. When a feature request comes up, check it against
the phase plan. If it doesn't serve the current phase's retention
hooks or the next phase's transaction layer, it waits.*
