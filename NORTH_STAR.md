# North Star — Crema

> **Synopsis (< 1000 chars)**
>
> Crema is a discovery catalog for Indian specialty coffee. Drinkers
> search and browse beans across 120+ micro-roasters, save what they
> want to a personal shelf, read roasters' sourcing journals, see who
> else has a bean on their shelf, and buy direct from roasters.
> Roasters get a storefront, tell sourcing stories about the farms
> they buy from, and reach an audience that's been invisible to them
> — most micro-roasters get near-zero traffic to their own sites
> today. The platform connects 120+ micro-roasters with a growing
> consumer base, without owning inventory or running logistics.
> Phase 1 builds discoverability: a complete, searchable catalog +
> shelf + roaster journals + Buy intent, with organic search (and the
> agentic-SEO distribution tier) as the top of the funnel —
> pre-revenue. Phase 2 turns Buy into a real checkout, Crema taking a
> fee on bean orders. Phase 3 owns delivery — same-city same-day,
> freshness guaranteed within 7 days of roast. Cafés are deliberately
> deferred: loyalty, supplier discovery, POS, and wholesale come back
> as a later phase once the consumer-roaster network can support a
> third participant. Build discovery first, extract second.

---

## 1. What Crema is

Crema is the discovery layer for Indian specialty coffee. Not a
marketplace (we don't move beans — yet), not a review site (we don't
rank). We are a **discovery utility** — the site you open when you
want to find a new bean, when you want to check your shelf or reorder
a bag, when you want to read the sourcing journal behind a coffee,
when you (as a roaster) want your beans found by people who'd never
otherwise have heard of you.

The catalog itself is the retention surface. People come back to
search and browse beans they can't find anywhere else, to manage the
shelf of what they own and want, and to read the roaster journals
behind each coffee. And the funnel starts *outside* the app: organic
search and the agentic-SEO distribution tier (see
[AD_MODEL.md](AD_MODEL.md)) are the top of the funnel — the
micro-roaster-invisibility thesis means discoverability, not a feed,
is what brings people in. Light social proof gives the catalog texture
without a feed: you can see who else has a bean on their shelf, and you
can comment on roaster journal articles. The shelf and the journal are
the personal tools; organic discoverability is what fills the top of
the funnel. Without discovery, Crema is a private drink tracker. With
it, Crema is how India finds its specialty coffee.

**Two participants today, one deferred:**

| Participant | Daily job | Why they stay |
|-------------|-----------|---------------|
| **Consumer** | Discover new beans, manage my shelf, read roaster journals, buy | Searchable catalog, coffee shelf, roaster journals, Buy button |
| **Roaster** | Tell my story, get discovered, sell beans | Storefront, sourcing journals, catalog analytics |

**Cafés are deliberately deferred.** Loyalty programs, supplier
discovery, POS, and wholesale commerce were originally Phase 1
surfaces alongside consumer + roaster. Trying to ship all three
participant flows in one go was too much: the consumer experience
kept getting compromised by café-side complexity (split notification
stacks, account-type guards, business chat, stamp-book UI), and
roaster sign-up suffered from ambiguity about who the audience was.
We are pulling cafés out of Phase 1 entirely. They re-enter as a
later phase, after the consumer-roaster network has proven traction.
When we come back to cafés, we expect to **rewrite the surfaces from
scratch** — not revive what was there — because the right design for
café tooling will look different by then.

The single metric that matters: **weekly actions per user.** A search,
a shelf save, a journal-article read or comment, a Buy click — any of
these count. If a user does one action per week, they're retained.
Everything we build should make one of those actions easier or more
rewarding.

---

## 2. The market

Indian specialty coffee is a fragmented, fast-growing market with no
connective tissue. There are 120+ micro-roasters and a rapidly
expanding consumer base — but no platform connects them.

### What we heard in the field

*Names anonymised. Findings based on conversations with roasters and
café owners in Goa, 2026.*

**Micro-roaster invisibility (recurring theme).** Multiple micro-
roasters we spoke with report near-zero website traffic. This isn't
isolated — it's structural. Micro-roasters don't spend on ads because
they don't trust that paid reach will convert in a market where the
dominant national brand owns consumer mindshare. The result:
excellent product, zero distribution. They roast in 600g batches,
source green beans at ~₹1,000/kg, and can't compete with the big
roaster's volume. When they introduce a new coffee, they don't want
to lead with tasting notes (too subjective). They want to tell the
sourcing story — the farm, the relationship, the processing — and
recommend a brew method. Micro-roasters compete on story and quality,
not volume. They need a megaphone, and that megaphone needs to speak
their language, not the consumer's. Crema is that megaphone — a
discovery channel they don't have to pay for upfront, where the
consumer audience builds because search-discoverable bean pages give
people a reason to land here.

**The dominant national brand** has 10-year fixed-cost farm
contracts, a massive product catalog, and retail stores. They set the
consumer expectation for what "Indian specialty coffee" looks like.
Crema doesn't compete with them — Crema is the platform where the 120
roasters who *aren't* the national brand get discovered by consumers
who want something different. The long tail is the moat.

### Café signal (preserved for the deferred phase)

We also heard strong demand from café owners — supply anxiety,
single-supplier dependency, no transparent way to discover wholesale
roasters. **A mid-size café** in Goa buys ~80 kg biweekly from a
single Bangalore-based roaster at ~₹2,500/kg wholesale (vs ~₹4,000/kg
retail). When a shipment is delayed, the menu stalls. They have no
backup supplier because they don't know who else exists at wholesale
scale. **A smaller seasonal café** is a sharper version of the same
pain — single-supplier relationship with a large roaster, no leverage
when priorities shift, no fallback. This is supply anxiety, and it's
widespread among small cafés. They need a low-friction way to say
"I'm interested" and have the right roaster hear it; they don't need
a procurement platform.

These conversations remain valid. They are the motivation for the
deferred café phase, not Phase 1. When cafés re-enter, the supplier-
discovery layer is the first surface to design — that is where the
unmet demand is sharpest.

### The structural gap

Every participant today relies on Instagram DMs, WhatsApp, word of
mouth. There is no shared surface where:
- A consumer can discover a micro-roaster they've never heard of
- A roaster can tell their sourcing story to an audience that cares
- Either of them can transact without stitching together payment
  links, bank transfers, and delivery hope

Crema is that surface. We don't need to build all of it at once. The
consumer-roaster habit comes first; the transaction layer comes when
the habit proves demand; delivery comes when transactions prove
volume; cafés come back when the network is warm enough to support a
third participant.

---

## 3. Phase plan

### Phase 1 — The Habit

Build the daily habit between consumers and roasters. By the end of
Phase 1, consumers use Crema to manage their coffee life and roasters
use it to tell their story. No money changes hands through Crema yet
— but every participant has a reason to open the app every week.

**Consumer side:** a complete, searchable catalog (the daily pull —
find beans across 120+ roasters you can't discover anywhere else),
coffee shelf (beans I own / want / have owned, the heart being the one
save-and-favorite control), roaster journals to read (sourcing stories
+ article comments), and the Buy button (outbound to roaster's site —
every click tracked as an intent signal). Organic search is the top of
the funnel; the shelf and the journals are where the habit deepens.

**Roaster side:** product catalog with sourcing journals (long-form
articles about farms and processing, not just tasting-note shorthand)
plus in-article bean placements. Catalog analytics — shelf-saves, Buy
clicks per product, and journal-article engagement — so roasters can
see what's working, built on catalog signals rather than followers.

**Platform:** the catalog is pre-rendered and emits structured data
(schema.org JSON-LD) so bean and roaster pages are crawlable by search
engines and AI assistants — that crawlability *is* the discovery
funnel. Admin traction dashboard with every metric an investor would
ask for. Catalog ingestion and enrichment run at scale via an
autonomous agent pipeline (today: ~15 roasters live, target 50+ before
Phase 2).

**Success looks like:**
- 500 registered users in one city
- 50 weekly active users
- 20+ roasters with published profiles and complete catalogs
- 200+ shelf saves per week (engagement signal)
- 50+ Buy clicks per week (intent signal)
- Organic search / AI-assistant referrals a growing share of inbound
- D7 retention ≥ 20%

---

### Phase 2 — Transactions

The habit from Phase 1 proved that consumers want to buy and roasters
want to sell. Now Crema handles money.

**B2C — Consumer purchases.** The Buy button becomes a real checkout.
Consumer taps Buy, sees price and delivery estimate, pays via UPI or
card, order goes to the roaster for fulfillment. On delivery, Crema
prompts "Add to your shelf?" — closing the loop from discovery to
purchase to ownership. Crema takes 3-5% of order
value. The roaster sets the price and ships the beans; Crema never
owns inventory.

**Promoted listings.** Roasters pay to appear higher in catalog
search and browse rankings. Simple, low-touch, intent-aligned — the
consumer is already searching for an Ethiopian; the promotion just
surfaces the relevant roaster faster.

**Premium analytics.** Roasters pay for deeper insight — cohort
retention, repeat-purchase rate, regional breakdown — beyond the free
dashboard.

**Success looks like:**
- ₹2L monthly GMV through consumer purchases
- 5+ roasters paying for promoted listings or premium analytics
- Transaction fee revenue covers infrastructure (~₹15k/month)

---

### Phase 3 — Delivery

The transaction layer from Phase 2 proved volume. Now Crema
vertically integrates consumer delivery to capture more margin and
unlock the freshness moat.

**Consumer delivery.** Same-city same-day or next-day for roasters
with local inventory. Standard inter-city shipping via courier
partners at bulk-negotiated rates that no single micro-roaster could
get alone. Crema delivery agents (or a partner fleet — Dunzo, Porter,
Shadowfax) handle the last mile.

**Freshness guarantee.** Specialty coffee peaks at 7-21 days post-
roast. If Crema controls delivery, Crema can guarantee freshness:
roast-to-door tracking ("roasted 2 days ago, shipped today, arrives
tomorrow"), a freshness badge for products delivered within 7 days
of roast, and subscription delivery coordinated with the roaster's
roast schedule so the bag ships the day after roasting. If Crema is
the only channel that offers a 3-day roast-to-door window, neither
the roaster's own website nor Amazon can compete on freshness. This
is the deepest moat.

**Success looks like:**
- 200+ consumer deliveries per month in one city
- Delivery SLA met ≥ 95%
- Delivery margin positive
- ₹10L+ monthly GMV (combined with B2C purchase volume)

---

### Phase N — Cafés re-enter (Future)

Once the consumer-roaster network is warm enough, cafés come back as
a third participant. The design will be done from scratch, not
revived from earlier code:

- **Supplier discovery** — café browses the existing roaster catalog
  (already built for consumers), filters by wholesale capacity,
  signals interest with a structured handshake. This is the surface
  with the sharpest unmet demand from the field conversations.
- **Loyalty** — stamp programs run by cafés, redeemed at the counter.
  Configurable reward, seasonal schedule. Customer scans, stamp is
  awarded.
- **POS** — café accepts payment via Crema, stamps award
  automatically, café gets a sales dashboard. Bundled loyalty makes
  Crema POS competitive against standalone POS providers.
- **B2B wholesale commerce** — structured wholesale orders with
  escrow payment. Replaces the bank-transfer + hope flow that cafés
  use today.

These are deferred until the metrics from Phase 1 (and ideally
Phase 2) prove there is a consumer-roaster network warm enough to
attract café participation. We don't have a date — entry into Phase N
is gated on traction, not on time.

---

## 4. The moat

Crema's defensibility is the **graph:**

```
Consumer ───shelf save───▶ Product ◀──sourcing journal── Roaster
    │                         │                            ▲
    │ Buy intent              │ catalog page (SEO)         │ delivery (Phase 3)
    ▼                         ▼                            │
   Purchase ─────────────────────────────────────────── Roaster (fulfilment)
```

Every action makes the graph denser. A shelf save connects a consumer
to a product. A sourcing journal connects a roaster to a farm. A Buy
click signals intent. A purchase closes the discovery-to-ownership
loop. A delivery closes the purchase loop with physical goods on a
freshness clock no one else can match.

No single participant can replicate this graph. Blue Tokai knows
their own sales but not what Nada's customers think. Nada knows their
beans but not what the broader Indian specialty audience is
discovering this week. Crema is the only entity that sees both perspectives at
once — and in Phase 3, the only entity that physically moves the
beans from roaster to consumer on a freshness window the roaster's
own logistics can't beat.

The flywheel: more roasters → more products → more catalog pages
indexed → more organic discovery for consumers → more shelf saves +
Buy clicks → more roaster revenue → more roasters. Density compounds.
When cafés re-enter in Phase N,
the graph extends with a third edge type, but the consumer-roaster
substrate has to exist first or the third edge has nothing to attach
to.

---

## 5. What we don't do

- **A whole-beans catalog, not a brew-format store.** Crema lists and
  shows coffee **beans** — whole-bean or ground. Grind is a fulfillment
  option the roaster offers (a coffee with a grind selector, or sold
  ground, is still the bean and stays); the catalog entry is the bean.
  Single-serve and non-bean **formats** are out of scope: single-serve
  drip bags / pour-over filter bags, brew bags, sachets, capsules /
  pods, instant coffee, and ready-to-drink (cans / bottles /
  concentrates). The scraper's Stage-1 filter rejects these and the
  catalog audit counts any that slip through (`non_bean_format`).
- **Not an inventory holder.** We never own beans. Even in Phase 3,
  the delivery agent picks up from the roaster and delivers to the
  buyer. Crema is a logistics coordinator, not a warehouser.
- **Not a review site.** Tasting notes are personal journal entries,
  not Yelp reviews. There is no star rating, no roaster ranking. This
  is intentional — it keeps roasters collaborative on the platform
  rather than competitive against each other.
- **Not optimising for scroll time.** There is no feed — discovery is
  search + browse, not an algorithmic timeline. No infinite scroll, no
  stories, no reels, no engagement tricks. We optimise for *finding the
  right bean fast*, not for time-on-app. The catalog serves coffee, not
  attention metrics.
- **Not building for cafés yet.** Cafés are a deferred participant,
  not a forgotten one. We will not bolt café surfaces back onto
  Phase 1 in pieces — that's how we got the complexity that drove the
  deferral in the first place. They come back as a deliberate Phase N
  design.
- **Not competing with Blue Tokai.** Their presence helps the
  platform (brand recognition attracts consumers). Our value is the
  long tail they don't serve.

---

## 6. Revenue model & ad tiers

The full monetisation model — ad tiers (promoted listings, premium
analytics, in-article placements, and the **agentic-SEO distribution
tier**) plus commerce, delivery, and café/wholesale fees — lives in
**[AD_MODEL.md](AD_MODEL.md)**, the canonical home for revenue and ad
strategy. NORTH_STAR keeps only the governing principle:

**Rule:** no revenue extraction before Phase 1 metrics are hit. The
consumer-roaster network has to be warm before anyone pays. Premature
monetisation kills the flywheel.

---

## 7. Why now

Indian specialty coffee is at an inflection point. Consumer awareness
is growing faster than the infrastructure to serve it. Blue Tokai
proved the category exists; the next wave is the 120 micro-roasters
that need a platform to find consumers and tell their story. The
window is open because:

- **No incumbent platform** connects roasters with the consumer
  audience. Individual tools exist (e-commerce for roasters,
  Instagram for discovery) but nothing ties them together with a
  daily-habit surface.
- **UPI adoption** makes in-app payments frictionless — the payment
  infrastructure that Phase 2 needs already exists and is free for
  consumers.
- **Mobile-first culture** means the entire consumer relationship to
  coffee — discovery, journaling, ownership tracking, buying —
  already lives on the phone. Crema is just consolidating those
  moments into one place.
- **Micro-roasters are hungry.** They have quality product and no
  distribution. Every one of them we talked to said the same thing:
  "we need more people to find us." Crema is the answer.

---

*This document is canonical. Implementation details live in
`BUILD_ROADMAP.md`. Architecture rules live in `CRUD_UTOPIA.md`.
Deployment + launch checklists live in `LAUNCH_TODO.md`. When a
feature request comes up, check it against the phase plan here. If it
doesn't serve the current phase, it waits.*
