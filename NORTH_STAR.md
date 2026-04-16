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

Three participants, three jobs:

| Participant | Daily job | Why they stay |
|-------------|-----------|---------------|
| **Consumer** | Track what I drink, learn, buy more | Stamp book, tasting journal, shelf, Buy button |
| **Roaster** | Tell my story, find buyers | Storefront, sourcing stories, wholesale leads |
| **Café** | Run loyalty, source beans, serve customers | Stamp program, supplier discovery, POS |

The single metric that matters: **weekly actions per user.** A tasting
note, a stamp, a Buy click, a wholesale inquiry — any of these count.
If a user does one action per week, they're retained. Everything we
build should make one of those actions easier or more rewarding.

---

## 2. The market

Indian specialty coffee is a fragmented, fast-growing market with no
connective tissue. There are 120+ micro-roasters, hundreds of cafés,
and a rapidly expanding consumer base — but no platform connects them.

### What we heard in the field

**Padaria Café (Mandrem, Goa)** buys 80 kg biweekly from Subko at
~₹2,500/kg wholesale (vs ₹4,000/kg retail). Their pain: when a
shipment is delayed, the menu stalls. They have no backup supplier
because they don't know who else exists at wholesale scale. Cafés need
supplier discovery, and they need it to be low-friction — not a
procurement platform, just a way to say "I'm interested" and have the
right roaster hear it.

**Brightside Café (Mandrem, Goa)** is a sharper version of the same
pain. Small seasonal café, single-supplier relationship with a large
roaster. When the big roaster's priorities shift — delayed shipments,
minimum-order increases, allocation changes — a café this size has no
leverage and no fallback. The anxiety isn't hypothetical; it's the
lived experience of being a small buyer dependent on a large seller in
a market with no transparent alternatives. This is supply anxiety, and
it's widespread among small cafés. Crema's wholesale discovery layer
exists specifically to give these cafés optionality — the ability to
see who else is out there, signal interest, and diversify before a
supply crisis forces their hand.

**Nada Coffee Roasters (Anjuna, Goa)** gets almost no traffic to their
website. Blue Tokai owns consumer mindshare. Nada roasts in 600g
batches — capacity-constrained, margin-sensitive, unable to supply
cafés at bulk rates except in emergencies. When they introduce a new
coffee, they don't want to lead with tasting notes (too subjective).
They want to tell the sourcing story — the farm, the relationship, the
processing — and recommend a brew method. Micro-roasters compete on
story and quality, not volume. They need a megaphone, and that
megaphone needs to speak their language, not the consumer's.

**Blue Tokai** has 10-year fixed-cost farm contracts, a massive product
catalog, and retail stores. They set the consumer expectation. Crema
doesn't compete with Blue Tokai — Crema is the platform where the 120
roasters who *aren't* Blue Tokai get discovered by the consumers and
cafés who want something different. The long tail is the moat.

### The structural gap

Every participant today relies on Instagram DMs, WhatsApp, word of
mouth. There is no shared surface where:
- A consumer can discover a micro-roaster they've never heard of
- A café can see which roasters have wholesale capacity
- A roaster can tell their sourcing story to an audience that cares
- Any of them can transact without stitching together payment links,
  bank transfers, and delivery hope

Crema is that surface. We don't need to build all of it at once. The
network comes first; the transaction layer comes when the network
proves demand; delivery comes when the transaction layer proves volume.

---

## 3. Phase plan

### Phase 1 — The Network

Build the daily habit AND the B2B discovery layer in one pass. By the
end of Phase 1, consumers use Crema to manage their coffee life,
roasters use it to tell their story and receive wholesale interest, and
cafés use it for loyalty and sourcing. No money changes hands through
Crema yet — but every participant has a reason to open the app every
week.

**Consumer side:** tasting journal, coffee shelf, stamp book, social
feed, Buy button (outbound to roaster's site — every click tracked as
an intent signal).

**Roaster side:** product catalog with sourcing stories (long-form
posts about farms and processing, not just tasting-note shorthand).
Brew method recommendations as infographic cards — the roaster's voice
alongside the consumer's tasting notes. Wholesale availability signals
visible only to café accounts, so cafés browsing the catalog know
who's open to bulk orders.

**Café side:** loyalty program (stamps via QR scan, configurable
reward, seasonal schedule). An "Interested" button on roaster product
pages that sends a qualified wholesale inquiry — café name, location,
current menu, monthly volume — directly to the roaster's business
notification tab. No transaction, just the handshake that currently
takes days over Instagram DMs.

**Platform:** split notifications (Activity for social, Business for
wholesale inquiries and stamp operations). Admin traction dashboard
with every metric an investor would ask for.

**Success looks like:**
- 500 registered users in one city
- 50 weekly active users
- 10 cafés with stamps enabled
- 20 roasters with profiles
- 50 wholesale inquiries per month
- D7 retention ≥ 20%

---

### Phase 2 — Transactions

The network from Phase 1 proved that consumers want to buy, cafés want
to source, and roasters want to sell. Now Crema handles money.

**B2C — Consumer purchases.** The Buy button becomes a real checkout.
Consumer taps Buy, sees price and delivery estimate, pays via UPI or
card, order goes to the roaster for fulfillment. On delivery, Crema
prompts "Add to your shelf? Write a tasting note?" — closing the loop
from discovery to purchase to experience. Crema takes 3-5% of order
value. The roaster sets the price and ships the beans; Crema never owns
inventory.

**B2B — Wholesale commerce.** The "Interested" button becomes a
structured order: product, quantity, delivery date. The roaster
confirms availability and quotes a price. Payment settles through Crema
in escrow until the café confirms receipt. This replaces the bank
transfer + hope-for-the-best flow. Crema takes 2-5%, lower than B2C
because order sizes are larger and margins thinner.

**Café POS.** The stamp system already puts Crema on the café counter.
Extend it: the customer scans to pay (UPI / card), the stamp is
awarded automatically on payment, and the café gets a lightweight sales
dashboard — daily revenue, popular drinks, average ticket, peak hours.
Crema takes 1-2%, lower than standard POS providers because the loyalty
program is bundled. This is the ultimate retention hook: the app is
literally how you pay for your coffee.

**Promoted listings.** Roasters pay to appear higher in catalog search
and in café procurement flows. Simple, low-touch, intent-aligned —
the café is already searching for an Ethiopian; the promotion just
surfaces the relevant supplier faster.

**Success looks like:**
- 10 cafés using Crema POS daily
- ₹5L monthly GMV through wholesale orders
- ₹2L monthly GMV through consumer purchases
- Transaction fee revenue covers infrastructure (~₹15k/month)

---

### Phase 3 — Delivery

The transaction layer from Phase 2 proved volume. Now Crema vertically
integrates delivery to capture more margin and solve the reliability
problem that cafés told us about from day one.

**Wholesale delivery.** Crema delivery agents (or a partner fleet —
Dunzo, Porter, Shadowfax) handle roaster-to-café shipments within a
city. Guaranteed SLAs: next-day in-city, 2-3 day inter-city. A roaster
shipping to 5 cafés in Goa doesn't make 5 separate trips — routes are
consolidated. The roaster's logistics cost drops; the café's
reliability goes up.

**Consumer delivery.** Same-city same-day or next-day for roasters with
local inventory. Standard inter-city shipping via courier partners at
bulk-negotiated rates that no single micro-roaster could get alone.

**Freshness guarantee.** Specialty coffee peaks at 7-21 days post-
roast. If Crema controls delivery, Crema can guarantee freshness:
roast-to-door tracking ("roasted 2 days ago, shipped today, arrives
tomorrow"), a freshness badge for products delivered within 7 days of
roast, and subscription delivery coordinated with the roaster's roast
schedule so the bag ships the day after roasting. If Crema is the only
channel that offers a 3-day roast-to-door window, neither the roaster's
own website nor Amazon can compete on freshness. This is the deepest
moat.

**Success looks like:**
- 50+ wholesale deliveries per month in one city
- 200+ consumer deliveries per month
- Delivery SLA met ≥ 95%
- Delivery margin positive
- ₹20L monthly GMV (combined)

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

Every action makes the graph denser. A tasting note connects a consumer
to a product. A stamp connects a consumer to a café. A menu item
connects a café to a roaster. A wholesale inquiry connects a café to a
roaster directly. A sourcing story connects a roaster to a farm. A
consumer purchase closes the discovery-to-ownership loop. A delivery
closes the wholesale loop with physical goods.

No single participant can replicate this graph. Blue Tokai knows their
own sales but not what Nada's customers think. Nada knows their beans
but not which cafés would pour them. Padaria knows their menu but not
what other cafés in Goa are sourcing. Crema is the only entity that
sees all three perspectives at once — and in Phase 3, the only entity
that physically moves the beans.

The flywheel: more roasters → more products → more tasting notes → more
signal for cafés → more wholesale inquiries → more orders → more
delivery data → better routes → lower costs → more roasters. Density
compounds.

---

## 5. What we don't do

- **Not an inventory holder.** We never own beans. Even in Phase 3, the
  delivery agent picks up from the roaster and delivers to the buyer.
  Crema is a logistics coordinator, not a warehouser.
- **Not a review site.** Tasting notes are personal journal entries, not
  Yelp reviews. There is no star rating, no roaster ranking. This is
  intentional — it keeps roasters collaborative on the platform rather
  than competitive against each other.
- **Not a social-media-first app.** The feed distributes sourcing
  stories and tasting notes; it does not optimise for scroll time.
  Chronological only. No algorithmic feed, no stories, no reels.
  Coffee is the content, not the container.
- **Not competing with Blue Tokai.** Their presence helps the platform
  (brand recognition attracts consumers). Our value is the long tail
  they don't serve.

---

## 6. Revenue model

| Stream | Phase | Mechanism | Take rate |
|--------|-------|-----------|-----------|
| Promoted listings | 1+ | Roasters pay for visibility in search + discovery | ₹2-5k/mo |
| Premium analytics | 1+ | Deeper seller insights beyond the free dashboard | ₹1-3k/mo |
| Consumer purchase fee | 2 | % of in-app bean purchase | 3-5% |
| Wholesale order fee | 2 | % of B2B order value | 2-5% |
| Café POS fee | 2 | % of counter transaction | 1-2% |
| Delivery fee | 3 | Per-kg per-km + route consolidation margin | Variable |
| Subscription margin | 3 | Bulk courier rate delta on recurring deliveries | 10-15% |

**Rule:** no revenue extraction before Phase 1 network metrics are hit.
The network has to be warm before anyone pays. Premature monetisation
kills the flywheel.

Self-sustaining threshold: ~₹15k/month in transaction fees covers
infrastructure. Projected at 10 POS cafés + 50 wholesale orders + 200
consumer purchases per month in one city.

---

## 7. Why now

Indian specialty coffee is at an inflection point. Consumer awareness
is growing faster than the infrastructure to serve it. Blue Tokai
proved the category exists; the next wave is the 120 micro-roasters
and hundreds of cafés that need a platform to find each other and their
customers. The window is open because:

- **No incumbent platform** connects all three participants today.
  Individual tools exist (e-commerce for roasters, POS for cafés,
  Instagram for discovery) but nothing ties them together.
- **UPI adoption** makes in-app payments frictionless — the payment
  infrastructure that Crema's Phase 2 needs already exists and is free
  for consumers.
- **Mobile-first culture** means the café counter is already a phone
  interaction (scanning for payments). Adding stamps + loyalty to that
  moment costs the consumer zero additional effort.
- **Micro-roasters are hungry.** They have quality product and no
  distribution. Every one of them we talked to said the same thing:
  "we need more people to find us." Crema is the answer.

---

*This document is canonical. Implementation details live in
`BUILD_ROADMAP.md`. Architecture rules live in `CRUD_UTOPIA.md`.
Deployment + launch checklists live in `LAUNCH_TODO.md`. When a feature
request comes up, check it against the phase plan here. If it doesn't
serve the current phase, it waits.*
