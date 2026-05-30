# North Star — Crema

> **Synopsis (< 1000 chars)**
>
> Crema is a daily coffee manager for Indian specialty consumers.
> Drinkers discover beans through a chronological feed, track tasting
> notes, build a shelf of what they own, and buy from roasters.
> Roasters get a storefront, tell sourcing stories about the farms
> they buy from, and reach an audience that's been invisible to them
> — most micro-roasters get near-zero traffic to their own sites
> today. The platform connects 120+ micro-roasters with a growing
> consumer base, without owning inventory or running logistics.
> Phase 1 builds the daily habit: feed + journal + shelf + Buy
> intent, pre-revenue. Phase 2 turns Buy into a real checkout, Crema
> taking a fee on bean orders. Phase 3 owns delivery — same-city
> same-day, freshness guaranteed within 7 days of roast. Cafés are
> deliberately deferred: loyalty, supplier discovery, POS, and
> wholesale come back as a later phase once the consumer-roaster
> network can support a third participant. Build the habit first,
> extract second.

---

## 1. What Crema is

Crema is the operating system for Indian specialty coffee. Not a
marketplace (we don't move beans — yet), not a review site (we don't
rank). We are a **daily utility with a social spine** — the app you
open when you grind your morning dose, when you want to see what your
friends are drinking, when you want to reorder a bag, when you (as a
roaster) want to tell the story of a new lot.

The social feed is not decoration — it is the primary retention
surface for consumers. People come back to see what others are
posting: a friend's tasting note on a new Ethiopian, a roaster's
sourcing story from a Chikmagalur farm, a stranger's pour-over set-up
at home. The feed turns private coffee habits into a shared
experience. It's where discovery happens organically — a user sees a
bean in someone else's post, taps through to the product page, adds
it to their shelf, and eventually buys. The tasting journal and the
shelf are personal tools; the feed is what makes them social. Without
it, Crema is a drink tracker. With it, Crema is a community.

**Two participants today, one deferred:**

| Participant | Daily job | Why they stay |
|-------------|-----------|---------------|
| **Consumer** | See what others are drinking, share what I'm tasting, discover new beans, buy | Social feed, tasting journal, shelf, Buy button |
| **Roaster** | Tell my story, reach an audience, sell beans | Storefront, sourcing stories, audience analytics |

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

The single metric that matters: **weekly actions per user.** A post,
a like, a tasting note, a Buy click — any of these count. If a user
does one action per week, they're retained. Everything we build
should make one of those actions easier or more rewarding.

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
consumer audience builds because the feed gives people a reason to
browse.

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

**Consumer side:** social feed (the daily pull — see what friends and
followed roasters are posting, discover beans through other people's
experiences), tasting journal, coffee shelf (beans I own / have
owned), Buy button (outbound to roaster's site — every click tracked
as an intent signal). The feed is the top of the funnel; the journal
and shelf are where the habit deepens.

**Roaster side:** product catalog with sourcing stories (long-form
posts about farms and processing, not just tasting-note shorthand).
Brew method recommendations as infographic cards — the roaster's
voice alongside the consumer's tasting notes. Audience analytics —
followers, post reach, Buy clicks per product — so roasters can see
what's working.

**Platform:** notifications surface follow / like / comment / Buy-
click activity. Admin traction dashboard with every metric an
investor would ask for. Catalog ingestion and enrichment runs at
scale (today: ~15 roasters live, target 50+ before Phase 2).

**Success looks like:**
- 500 registered users in one city
- 50 weekly active users
- 20+ roasters with published profiles and complete catalogs
- 100+ posts per week (feed activity)
- 50+ Buy clicks per week (intent signal)
- D7 retention ≥ 20%

---

### Phase 2 — Transactions

The habit from Phase 1 proved that consumers want to buy and roasters
want to sell. Now Crema handles money.

**B2C — Consumer purchases.** The Buy button becomes a real checkout.
Consumer taps Buy, sees price and delivery estimate, pays via UPI or
card, order goes to the roaster for fulfillment. On delivery, Crema
prompts "Add to your shelf? Write a tasting note?" — closing the loop
from discovery to purchase to experience. Crema takes 3-5% of order
value. The roaster sets the price and ships the beans; Crema never
owns inventory.

**Promoted listings.** Roasters pay to appear higher in catalog
search and feed discovery. Simple, low-touch, intent-aligned — the
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
Consumer ──tasting_note──▶ Product ◀──sourcing_story── Roaster
    │                         │                            ▲
    │ shelf / Buy intent      │ feed post                  │ delivery (Phase 3)
    ▼                         ▼                            │
   Purchase ─────────────────────────────────────────── Roaster (fulfilment)
```

Every action makes the graph denser. A tasting note connects a
consumer to a product. A sourcing story connects a roaster to a farm.
A shelf entry marks ownership. A Buy click signals intent. A purchase
closes the discovery-to-ownership loop. A delivery closes the
purchase loop with physical goods on a freshness clock no one else
can match.

No single participant can replicate this graph. Blue Tokai knows
their own sales but not what Nada's customers think. Nada knows their
beans but not who the broader Indian specialty audience is following
this week. Crema is the only entity that sees both perspectives at
once — and in Phase 3, the only entity that physically moves the
beans from roaster to consumer on a freshness window the roaster's
own logistics can't beat.

The flywheel: more roasters → more products → more tasting notes →
more discovery for consumers → more Buy clicks → more roaster revenue
→ more roasters. Density compounds. When cafés re-enter in Phase N,
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
- **Not optimising for scroll time.** The social feed is central to
  retention — it's how consumers discover beans and stay connected to
  the community — but it is not engineered for addiction.
  Chronological only. No algorithmic ranking, no stories, no reels,
  no engagement tricks. The feed serves coffee, not attention
  metrics.
- **Not building for cafés yet.** Cafés are a deferred participant,
  not a forgotten one. We will not bolt café surfaces back onto
  Phase 1 in pieces — that's how we got the complexity that drove the
  deferral in the first place. They come back as a deliberate Phase N
  design.
- **Not competing with Blue Tokai.** Their presence helps the
  platform (brand recognition attracts consumers). Our value is the
  long tail they don't serve.

---

## 6. Revenue model

| Stream | Phase | Mechanism | Take rate |
|--------|-------|-----------|-----------|
| Promoted listings | 2+ | Roasters pay for visibility in search + feed discovery | ₹2-5k/mo |
| Premium analytics | 2+ | Deeper seller insights beyond the free dashboard | ₹1-3k/mo |
| Consumer purchase fee | 2 | % of in-app bean purchase | 3-5% |
| Delivery fee | 3 | Per-kg per-km + route consolidation margin | Variable |
| Subscription margin | 3 | Bulk courier rate delta on recurring deliveries | 10-15% |
| Café POS fee | N | % of counter transaction | 1-2% |
| Wholesale order fee | N | % of B2B order value | 2-5% |

**Rule:** no revenue extraction before Phase 1 metrics are hit. The
consumer-roaster network has to be warm before anyone pays. Premature
monetisation kills the flywheel.

Self-sustaining threshold: ~₹15k/month in transaction fees covers
infrastructure. Projected at 200 consumer purchases per month + a
handful of paying roasters in one city.

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
