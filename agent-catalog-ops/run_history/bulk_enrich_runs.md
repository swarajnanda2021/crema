# Bulk Enrich Run History

Cross-run performance log for the Crema catalog bulk re-enrichment cycles.
Tracks: catalog counts, classes of mistake observed, what changed in code
between runs, and which issue classes are converging vs persistent.

Update at the END of every bulk run. Before each new run, compare against
the latest entry to surface regressions.

---

## Cross-run summary table

| Run | Date | Roasters queued | Products before → after | Enriched | Failed | Filter_reject | Published delta | Notable |
|-----|------|-----------------|-------------------------|----------|--------|---------------|-----------------|---------|
| 1 | 2026-05-27 | 93 published | 1322 → 1487 | 1289 (87%) | 193 (13%) | 0 (column didn't exist) | 94 → 94 | 25 Haiku drainers, 5 waves, ~400 LLM jobs. Several drainers hallucinated "TEXT ONLY" directive. 2 stragglers (Home Blend, Devans) parent-op stuck. Chicory blends incorrectly rejected (later flipped — see lesson) |
| 2 | 2026-05-28 | 94 published (orchestrator counted 95) | 1487 → 1502 | 1244 (82.8%) | 163 (10.9%) | 93 (6.2%) | 94 → 101 (+7 auto-republished) | FD pressure cascade (Too many open files), 7 hidden roasters rescued by auto-republish, Stage 1 retroactive reapply landed 93 zombie bundles into filter_reject, url_dead=0 (helper not firing) |
| 3 | 2026-05-29 | 112 (107 from 2 abandoned prior rounds + 5 gap-fill) | 1502 → 1337 | 1076 (80.5%) | 152 (11.4%) | 97 | no publish ops | Inherited TWO un-drained rounds (≈14:30 + ≈18:40, same operator) — drained the whole backlog with ~23 rolling Haiku drainers, then reaped 167 stuck ops. Pre-flight: url_dead 0→10 (**402 fix HELD** — Forest Farmer 9 + Rossette 1), url_normalized dedup −157. content_similarity dedup −14 (Mokkafarms brew-variants 7→2, coffeeverse .co.in→.in). **variant-gate fix did NOT hold** (Takaraa Coral Rum still ₹3799/20g; variant_mismatch 10→14) — full_reenrich subprocess path bypasses the enrichment_runner v2 variant picker. silent_empty 169→144. 2 drainer hallucinations (US-city bios; fake "TEXT ONLY" stop) — self-healed via duplicate bio jobs + hardened drainer prompt |

---

## Issue classes — running tally

Tracks which classes have been seen across runs. Decreasing count = converging. Stable or increasing = persistent gap.

| Issue class | Run 1 count | Run 2 count | Run 3 count | Status | Root cause file:line |
|-------------|-------------|-------------|-------------|--------|----------------------|
| **Grandfathered bundles (sampler / trio pack / discovery box / etc)** | ~30-40 active | 93 flagged filter_reject (available=0) | _pending_ | Mostly resolved — Stage 1 reapply now working | services/enrichment_runner.py:632 |
| **Multi-SKU brew-method variants (Mokkafarms)** | ~50 | ~50 (no change) | **~5 collapsed (48→45)** | **Partial — brew-prefix normalizer works; content_similarity key also needs matching price+image, so per-SKU-image variants survive** | services/product_dedupe.py:_normalize_coffee_name |
| **Sub-100g sachets w/ normal coffee names (Caffinary Tsp Card)** | ~13 (50g rows) | ~13 (no change) | _pending_ | Persistent — no weight-based rule in community-api path | services/product_filters.py, services/enrichment_runner.py:_pick_default_variant |
| **Variant mismatch — small variant weight + large variant price (Coral Rum class)** | Identified but not measured | 10 flagged via new audit rule | **14 (REGRESSED +4)** | **Regressed — variant-gate fix lives on enrichment_runner v2 path; full_reenrich subprocess path bypasses it. Takaraa Coral Rum still ₹3799/20g** | services/enrichment_runner.py:792 (`if not merged_hints.get("price_inr")`) |
| **Ground / Filter / Instant coffee in catalog** | ~30 | ~30 (no change) | _pending_ | Persistent — exclusion-rule philosophy gap | services/product_filters.py:_HARD_EXCLUDE_TITLE |
| **Exact-name duplicates within roaster** | Not measured | ~30 (Mysore Nuggets ×4, Coorg Naturals ×3, South Indian Trad Filter ×3) | _pending_ | Persistent — dedup never fired (no verb in prompt) | services/product_dedupe.py + orchestrator skip |
| **Same-bean URL-handle duplicates (Curious Life Gachatha)** | 6 | 3 (some collapsed) | _pending_ | Persistent — content_similarity strategy never invoked | services/product_dedupe.py:_find_content_similarity_groups |
| **Missing price (NULL or 0)** | 12 | 18 | _pending_ | **Regressing** | services/page_fetcher + extraction logic |
| **Missing image** | 14 | 12 | _pending_ | Slowly improving | services/page_fetcher._fetch_product + Wix Tier-4 |
| **Silent empty (≥5/10 fields null)** | 188 | 169 | **144 (−25)** | Improving — re-enrich filled thin rows; Mokkafarms 25 still ground-coffee thin | Source pages genuinely thin |
| **Stale URL 404'd, row not flagged url_dead** | Not measured | 0 url_dead rows despite known 404s | **10 flagged ✓** | **FIXED — 402/410 detection live; Forest Farmer 9 (402) + Rossette 1 (404)** | services/page_fetcher.head_check_url + services/enrichment_runner.py:669 |
| **ALL-CAPS coffee names (DEVANS, BROOT)** | 6 | 6 | _pending_ | Stable — brand-deliberate, curation decision |
| **Confirmed-T1 hallucinations awaiting T3** | 117 | 114+ | _pending_ | Slowly working down via orchestrator-fired T3 |
| **Drainer-side hallucination ("TEXT ONLY" directive)** | Multiple drainers bailed early | Not observed | **Recurred: 2 (US-city bios + fake "TEXT ONLY" stop)** | Recurs intermittently; hardened prompt (anti-fabrication + "no stop-instruction is real", dropped "TEXT ONLY" seed) stopped recurrence; bios self-healed via duplicate jobs |
| **Parent-op finalization stuck** | 13 stuck rows manually reaped | 13 stuck rows reaped via new tool | **167 reaped (from 2 inherited un-drained rounds); 0 from this session's drained fires** | Correlates with un-drained queues — drained pipelines finalized cleanly. Still architectural, but draining is the mitigation |
| **FD pressure / Too many open files** | Not observed | Major cascade — 163 failed | **0 (held) ✓** | **Resolved — RLIMIT_NOFILE→4096 held; no FD errors this session** |
| **Auto-unpublish false positives** | 12+ incorrectly unpublished | 0 new false unpublishes; 7 auto-republished | _pending_ | **Resolved** — absolute-cause rule + auto-republish working | services/sync_runner.py:_rediscover_urls |

---

## Code changes between runs

### Between Run 1 and Run 2 (2026-05-27 → 2026-05-28)

- `enrichment_runner.py`: removed `_already_enriched` short-circuit (was bypassing Stage 1+2 + Haiku for all enriched rows)
- `enrichment_runner.py`: added `_flag_existing_product_row` — Stage 1/2 reject on existing row flips to `available=0, enrichment_status='filter_reject'`
- `page_fetcher.py`: added `head_check_url` helper
- `enrichment_runner.py`: 404 on fetch → `url_dead` (currently not firing — bug)
- `enrichment_runner.py`: `_pick_default_variant` added (prefers URL-handle size hint or largest available variant) — **gated wrong, see Coral Rum class**
- `enrichment_runner.py`: `_extract_pack_count` + Pack-of-N weight multiplier
- `product_filters.py`: keyword additions (drip filter, paper filter, cold brew packs, taster pack, sample packet, dip-n-sip, kitchen table, X-in-1, wholesale, listing-page URL paths, spice products)
- `sync_runner.py`: `_rediscover_urls` rewritten — absolute-cause auto-unpublish, symmetric auto-republish, retry-before-unpublish
- 4 new MCP tools: `crema_apply_filters_retro`, `crema_url_health_audit`, content-similarity dedup, `crema_reap_stuck_catalog_operations`
- agent-catalog-ops CLAUDE.md TOC: "bulk enrich" now uses `include_unpublished:true`
- Audit rule extensions: `variant_mismatch_suspicion`, `url_dead_count`, `filter_reject_count`

### Between Run 2 and Run 3 (four code fixes from the 2026-05-28 audit + orchestrator-side changes)

Pipeline fixes landed 2026-05-29, targeting the audit's top persistent classes. All four pure-function changes verified against the audit's documented inputs (Takaraa / Reserved / Mokkafarms / Forest Farmer).

- **Variant gate (Class 2/3)** — `enrichment_runner.py`: dropped the `if not merged_hints.get("price_inr")` gate so platform variants set price+weight as a consistent pair from the SAME picked variant, overriding Haiku (no more 20g+₹2899 impossible combos). New `_variant_bag_grams()` parses bag size from variant `option1`/`title` (recovers Reserved India's 40g/100g distinction that the uniform `grams=1000` shipping weight blinded); `_pick_default_variant` now sorts on parsed bag size.
- **Brew-prefix dedup (Class 1)** — `product_dedupe.py`: `_normalize_coffee_name` now strips LEADING brew-method prefixes ("Aero Press - 100% Pure Arabica" → "100% pure arabica"), separator-required + ≥2-word guard so "Espresso Blend" / "Filter Coffee" survive. Mokkafarms brew siblings now collapse via the existing content_similarity strategy (which already keys on image_url).
- **402/410 url-dead (Class 10)** — new `page_fetcher.DEAD_HTTP_STATUSES = {402,404,410}` + `is_dead_status()` as the single source of truth; both the inline enrichment path and the standalone `crema_url_health_audit` now flag 402 (Forest Farmer's subscription-suspended storefront) and 410, not just 404.
- **FD pressure (operational)** — `main.py`: `_raise_fd_limit(4096)` lifts `RLIMIT_NOFILE` soft toward 4096 at startup (capped at hard, no-op if already higher), so bulk ops don't hit "Too many open files" the way Run 2 did (163 failed). Forked scrape subprocesses inherit it.
- **Deferred (policy, not bugs):** Class 4 (admit/strip filter-coffee blends) and Class 9 (publish-anyway vs hold thin-source rows) await a product decision — not touched this round.
- **Orchestrator-side:** firing prompt includes explicit `crema_dedupe_products` + `crema_catalog_quality_audit` verbs to prevent orchestrator-skip; new Claude Code release.

### Run 3 RESULTS — did the fixes hold? (measured 2026-05-29)

- **402/410 url-dead — HELD ✓.** `crema_url_health_audit` flagged 10 dead (9 Forest Farmer 402 suspended-store + 1 Rossette 404); url_dead 0→10. The class Run 2 completely missed is now caught. Transient 503/null (aromas-of-coorg, la-cuppa) correctly left alone.
- **Brew-prefix dedup (Mokkafarms) — PARTIAL.** `content_similarity` collapsed the brew-method siblings (Cold Brew / Home Espresso / South Indian Filter / Electric Drip → one "100% Pure Arabica" and one "Arabica-Robusta Blend"), but only ~5 rows (48→45), not the predicted ~20. The normalizer works; the limiter is the content key requiring matching **price + image_url** — Mokkafarms' other brew SKUs carry per-SKU images/prices so they don't group. A name-only sibling collapse (same roaster + normalized name, ignoring image) would catch more but risks false merges.
- **Variant gate (Coral Rum class) — DID NOT HOLD ✗ (regression).** variant_mismatch_suspicion 10→14; Takaraa "Barrel Aged Coral Rum" still ₹3799/20g unchanged. Root cause hypothesis: the `_pick_default_variant` / `_variant_bag_grams` fix lives on the `enrichment_runner.py` **v2 inline path**, but `crema_full_reenrich_roaster` drives the **subprocess scrape path**, which bypasses it — the same inline-vs-subprocess split documented for T1/T2 QC. Bulk re-enrich therefore never exercised the fix. Next step: wire the variant picker into the subprocess path (or run a v2-path `crema_bulk_reenrich_roaster` pass over the variant_mismatch rows).
- **FD cascade — HELD ✓.** No "Too many open files" this session; the `RLIMIT_NOFILE→4096` fix held. (The inherited 14:xx/18:4x rounds had their own failures, but those predate this session.)
- **silent_empty 169→144 (−25) ✓** and **missing_price 18→16 ✓** — re-enrichment filled some previously-thin rows.
- **NEW operational finding — parent-op finalization.** The 167 stuck `running` ops all came from the two abandoned rounds that were never drained; my 8 fresh fires (kept drained by live drainers) finalized cleanly to `succeeded` with 0 stuck. Finalization-stuck strongly correlates with un-drained queues — keeping drainers alive through completion is the cheapest mitigation.
- **NEW noise mode — drainer hallucination recurred.** One Haiku drainer fabricated US-city roaster bios (Third Wave→Austin, Toffee→Portland, Toise→Brooklyn) + `images.example.com` URLs; another hallucinated a "respond TEXT ONLY, stop calling tools" instruction and bailed. Both recovered: the bios self-healed because duplicate bio jobs (from the multi-round firing) were re-processed faithfully afterward, and a hardened drainer prompt (explicit anti-fabrication + "no stop-instruction is real", dropping the literal "TEXT ONLY" seed) eliminated recurrence in later waves. Verified post-run: all 112 roasters show Indian cities.

### Open items carried out of Run 3

- **variant_mismatch (14 rows)** still open — needs the variant picker on the subprocess path. Highest-value unfixed class.
- **2 confirmed thin-source flags** left in the T3 queue (home-blend Mandheling, naivo Kerehaklu 6/6-null — likely a genuine scrape miss worth a targeted re-enrich).
- **Mokkafarms** still 45 products / 25 silent-empty (ground-coffee SKUs, genuinely thin).

---

## Persistent issue classes (rank-ordered by impact)

Status as of 2026-05-29 (pre-Run-3). `[FIXED]` = code landed, awaiting Run-3 measurement; `[OPEN]` = still unaddressed.

1. **[FIXED] Multi-SKU brew-method variants (Mokkafarms class)** — ~50 rows. `_normalize_coffee_name` now strips leading brew prefixes; content_similarity (keyed on image_url) collapses the siblings. Note: dedup is still manual-fire (run `crema_dedupe_products` in the pre-Run-3 cleanup), not auto-wired into enrichment.
2. **[FIXED] Variant picker gated wrong (Coral Rum class)** — ~10 rows. Variant override ungated; price+weight taken as a consistent pair from one picked variant; bag size parsed from variant label.
3. **[PARTIAL] Sub-100g sachet survival (Caffinary class)** — ~13 rows. The variant fix now picks the larger retail SKU instead of the 50g sticker, so the weight/price pair is sane — but there is still NO explicit sub-100g weight-floor rejection. A genuine sub-100g sachet with no larger variant still survives. Left open intentionally (a blanket floor would wrongly reject legit micro-lots like Reserved India's 90g Gesha).
4. **[OPEN — policy] Ground/Filter/Instant infiltration** — ~65 rows, mostly legitimate. Deferred pending a product decision (admit vs strip).
5. **[FIXED] url_dead not flagging 402** — `DEAD_HTTP_STATUSES={402,404,410}` now drives both the inline path and the standalone audit. Still must RUN `crema_url_health_audit({dry_run:false})` in the pre-Run-3 cleanup to flip the existing zombies (the tool was never applied → url_dead=0).
6. **[FIXED] FD pressure cascade** — `main.py` raises `RLIMIT_NOFILE` to 4096 at startup. Still pair with bounded Playwright + dispatch waves if 4096 proves tight at 100+ parallel tasks.
7. **[OPEN — orchestrator] Exact-name dedup never auto-fires** — addressed in Run 3 firing prompt (explicit dedup verb); verify it sticks. Code-level auto-wiring into the refresh tail is still a future option.

---

## Methodology notes for future runs

- **Compare audit deltas, not just absolute counts.** A class shrinking is progress; a class growing is a regression.
- **Orchestrator can't be trusted to fire every verb from a short prompt.** Explicit verb chain is load-bearing.
- **FD pressure shows at ~80-100 parallel BG tasks on macOS default ulimit.** `ulimit -n 4096` before uvicorn is the cheapest fix.
- **Filter-reject rows accumulate across runs** — preserved (available=0) for audit, not deleted. Growing count = pipeline catching new things. Flat count = Stage 1 re-apply stalled.
- **`url_dead` count of 0 is suspicious** — either helper isn't firing or no URLs actually 404'd. Worth a manual probe each cycle.

---

## Pipeline Hardening Iterations (defect-class dev/validation loop)

Per `PIPELINE_HARDENING_GOAL.md`: each iteration picks ONE live defect class,
splits the affected roasters ~70/30 dev/validation at roaster granularity
(logged seed), fixes the root cause against dev only, then proves it
generalizes on the held-out validation roasters via `full_reenrich_roaster`.

### Iteration 1 — D4 MISSING_PRICE (`missing_price_inr`)

- **Started:** 2026-05-29
- **Baseline (full catalog):** total=1337, enriched=1076. Audit class counts —
  `missing_price_inr`=16, `silent_empty`=144, `variant_mismatch`=14,
  `missing_image_url`=12, `cosmetic_bug_total`=5 (all_caps), absurd/denorm=0.
- **Affected roasters (missing_price=16 across 6):** world-of-coffee-experience-cafe(5),
  nandan-coffee(4), zenforest-coffee-roasters(3), agastya-coffee-cafe-store-madikeri(2),
  curious-life-coffee-roasters(1), savorworks-coffee-chocolate(1).
- **Split seed = 20260529** (`random.seed(20260529); shuffle; first 70% = dev`).
  - **DEV (4 roasters, 11 defects):** agastya-coffee-cafe-store-madikeri,
    curious-life-coffee-roasters, world-of-coffee-experience-cafe, zenforest-coffee-roasters.
  - **VALIDATION (2 roasters, 5 defects, held out):** nandan-coffee, savorworks-coffee-chocolate.
- **Path fact (verified in code, corrects Run-3 hypothesis):** `full_reenrich_roaster`
  → `scrape_one_roaster` (`catalog_ops.py:551`) → `run_enrichment_v2_job` →
  `enrichment_runner.run_for_roaster`. The legacy subprocess body
  (`catalog_ops.py:572-683`) is dead code after the line-568 return. The v2 price/variant
  block (`enrichment_runner.py:824-865`) DOES execute on the metric path — Run 3's
  "subprocess bypasses the picker" hypothesis was incorrect.
- **Root cause (confirmed on dev, live data + code):**
  1. **WooCommerce price never read from the augmenter payload.** `woocommerce_raw`
     carries `prices:{price:"82900",regular_price:"99900",currency_minor_unit:2}`
     (₹829/₹999), but the v2 block (`enrichment_runner.py` ~842) reads only
     Shopify-shaped `variants[].price`. Woo's `variations` carry no price → no
     override → Woo price depends entirely on Haiku's flaky text parse (Zenforest /
     Curious Life). `entity_enricher._adapt_product_payload` writes price_inr
     straight from `hints.get("price_inr")`, so a missing hint = NULL/0 row.
  2. **Inline-vs-scrape divergence.** The per-URL Shopify fetch that recovers price
     (`entity_reenricher._maybe_apply_shopify_augmentation`) is called ONLY on the
     v2 inline reenrich path; the full_reenrich SCRAPE path
     (`run_for_roaster`→`enrich_url`) had NO per-URL fallback. Discovery-time
     augmentation keys platform payloads by canonical URL and silently no-ops on
     keying drift — World of Coffee's `civet-coffee-drip-bag` came back price_inr=NULL
     while `/products/<handle>.json` carried price="180.00".
  3. **Genuinely-priceless OOS products** (Zenforest La Vida Mango, First Blossom) are
     EXCLUDED from the Woo catalog feed (`?slug=` → `[]`) and show ₹0 on-page — no
     honest price source. Expected residual; handled honestly, not fabricated.
- **Fix (services/enrichment_runner.py, on the full_reenrich path):**
  (a) `_woo_price_inr()` — authoritative INR from Woo `prices` (minor-unit scaled,
  regular_price fallback); wired as price override when no positive price yet.
  (b) `_fetch_platform_raw_by_url()` — per-URL Shopify `/products/{handle}.json` +
  Woo `?slug=` fallback when discovery-time augmentation missed, so the scrape path
  recovers the same platform price/weight/image the inline path does. Haiku price is
  NOT used (adapter takes hints price), so deterministic extraction wins.
  Unit-tested against real payloads + live integration (civet→₹180/250g,
  bourbon-bliss→₹829, la-vida-mango→None as expected).
- **DEV metric result (full_reenrich + drain + audit per slug):**
  - **world-of-coffee (Shopify): missing_price 5→0, ZERO regressions** (silent_empty 4→4,
    others flat). Augment-fallback recovered all 5 drip-bag prices (Civet ₹180 etc.). Clean pass —
    proves the platform-general price fix works end-to-end on the metric path.
  - zenforest / agastya / curious-life: in-stock prices all recovered, BUT the counts are
    **contaminated by a newly-surfaced product-id duplication bug** (see below), so the metric
    can't be read cleanly there yet (zenforest missing_price 3→5 = duplicates + a new OOS bean).
  - Genuine residuals: jamun-fermented, la-vida-mango (zenforest) — OOS beans, price 0,
    available=0, "notify me" on the storefront. No honest price source; correctly hidden.
- **Regression found + fixed mid-run:** WooCommerce `tags` are a list of dicts; the v2 flatten
  fed them into `entity_enricher`'s `", ".join(tags)` → crash ("expected str, dict found") on
  every tagged Woo product (bourbon-bliss, coorg-highlands). Added `_normalize_platform_tags`
  (Shopify comma-string + Woo dict-tags → list[str]) + a defensive join. Verified crash-free.
- **NEW blocker surfaced — product-id instability (next iteration):** `product_id` is keyed off
  the Haiku-cleaned `coffee_name`, which drifts run-to-run ("Bourbon Bliss Coffee" → "Bourbon
  Bliss"), so re-enrich MINTS A NEW id and orphans the old row → duplicate products on every
  re-enrich (Gachatha AA ×3, Bourbon Bliss ×2, …). Fix: key product_id off the stable
  product_url + dedup the drift. Prerequisite for a clean missing_price dev/validation metric.

### Iteration 2 (interleaved) — BEANS-ONLY scope (user directive 2026-05-29)

User flagged drip bags in the catalog: **Crema is whole-beans only; grind is a roaster
fulfillment option, single-serve/non-bean FORMATS are out of scope.**

- **Filter:** re-activated Stage-1 single-serve format exclusions in
  `product_filters.py:_HARD_EXCLUDE_TITLE` (drip bag / drip filter(s) / brew bag / sachet /
  drip pack / drip coffee bag / single-serve / pour-over bag|pack), reversing the 2026-05-27
  "let Haiku decide on drip bags" call. Targets FORMATS, not grind (bare "filter coffee" /
  "ground" stay).
- **Pre-existing false-positives fixed (were wrongly catching real beans):** product-detail
  URL guard so `/collections/<x>/products/<h>` + `/shop/<uuid>` (Vithai) aren't treated as
  listings; dropped substring keywords `class` (Classico/Tusker Classic), `cap` (Cappuccino),
  `arita`→`arita ware` (Las Margaritas), `hat`/` hat` (Altaghat/What The Ale). Catalog-wide
  dry-run dropped 113→36 matched, all genuine non-beans, zero bean false-positives.
- **Audit:** added `non_bean_format` counter (`crema_catalog_quality_audit`) backed by
  `product_filters.NON_BEAN_FORMAT_MARKERS` / `is_non_bean_format` — defect is now TRACKED.
- **Cleanup:** `crema_apply_filters_retro` flipped **36 non-bean rows → filter_reject**
  (op 1885, reversible). Verified WoC: non_bean_format 0, missing_price 0, silent_empty 4→1,
  6 whole-bean products remain, drip bags gone.
- **Docs:** NORTH_STAR.md §5 + repo CLAUDE.md (beans-only hard rule); memory
  `feedback_beans_only_catalog`.
- **Status:** beans-only shipped + verified. D4 missing_price proven (WoC); D4
  dev/validation completion blocked on the product-id duplication fix (next).

### Iteration 3 — product-id duplication (root cause + cleanup + prevention)

- **True root cause (narrower than first thought):** `entity_upserter.upsert_entity`
  ALREADY prefers matching the existing row by `product_url` (good) — but the match was
  EXACT (`WHERE product_url = ?`). WooCommerce permalinks carry a trailing slash
  (`/product/bourbon-bliss-coffee/`) that the sitemap / older scrape stored without, so the
  exact match missed the live row and INSERTed a new one — whose name-derived `product_id`
  had drifted ("Bourbon Bliss Coffee" → "Bourbon Bliss"). Hence the dup pairs all shared one
  `product_url` modulo a trailing slash. Not a coffee_name-derivation bug per se; a
  URL-match-normalization bug.
- **Cleanup:** `crema_dedupe_products(strategy='url_normalized')` merged 14 same-URL pairs
  (op 1886, 0 T1 anomaly flags) — zenforest ×5 + curious-life ×5 (this session's drift) +
  kallucoppa ×4 (pre-existing). Canonical = richer/older row; FKs re-pointed.
- **Prevention fix (`entity_upserter.py`):** the URL match is now trailing-slash-tolerant
  (`WHERE product_url IN (url, url.rstrip('/'), +'/')`), so a re-enrich UPDATEs the existing
  row in place instead of inserting a drifted duplicate. py_compile + logic verified; full
  re-enrich validation (re-enrich a previously-duplicating roaster → confirm 0 new dups) is
  the next cycle's check.
- **Net catalog state after this session:** beans-only enforced (36 non-bean rows
  filter_reject), 14 dup pairs merged, missing_price extraction fix live on the full_reenrich
  path. Remaining: re-run D4 dev/validation cleanly now that re-enrich no longer dups;
  genuinely-OOS beans (jamun-fermented, la-vida-mango) remain price-0/available-0 (honest).

### Iteration 1 — D4 DEV + VALIDATION verdict (measured 2026-05-29, post-fix + post-dedup)

| Roaster | Role | Platform | missing_price | Read |
|---|---|---|---|---|
| world-of-coffee | dev | Shopify | **5→0** | ✅ clean pass, no regressions |
| zenforest | dev | WooCommerce | 3→3 | in-stock all priced; 3 = genuine OOS beans (₹0/notify-me) |
| agastya | dev | **Wix** | 2→2 | ⚠️ Wix has NO augmenter + no per-URL fallback — fix doesn't cover it |
| curious-life | dev | WooCommerce | ~1 | in-stock priced; residual = failed/OOS |
| nandan | **validation** | Shopify (replatformed) | 4→4 | live products priced ₹650/750; the 4 are STALE roast-variant dup rows w/ drifted URLs (enriched_at=null) — replatform drift mode, not trailing-slash |
| savorworks | **validation** | Shopify | 1→1 | the 1 = a FAILED enrichment row (Phenom/Godfather), not a price-extraction miss |

**Honest verdict — D4 is PARTIALLY hardened, NOT a clean dev(100%)+validation pass:**
- The WooCommerce-price + per-URL-Shopify-fallback fix is a REAL root-cause fix and generalizes
  to in-stock Shopify/Woo products on held-out roasters (nandan/savorworks live products all
  priced). WoC is the one clean 5→0.
- It does NOT clear the audit COUNT to 0 because the residuals are ORTHOGONAL defect classes the
  price fix was never meant to touch: **(a) Wix has no augmenter** (agastya — needs a Wix price
  extractor / augmenter); **(b) replatform stale-duplicate rows** (nandan — drifted URLs the
  trailing-slash upsert fix doesn't catch; needs a replatform/stale-row reconciler); **(c)
  enrichment failures** (savorworks Phenom/Godfather — `status='failed'`); **(d) genuinely-OOS
  beans** (no source price — the audit counts price=0 regardless of available; an audit-scope
  decision to surface: should missing_price count available=0 rows?).
- NOT gaming, NOT overfit: the fix is sound; the count is masked by separate classes.

**Remaining hardening backlog (next sessions):** Wix price/image extractor (D4 tail + D5);
replatform stale-row reconcile (URL-change dedup beyond trailing-slash); enrichment-failure
retry; OOS audit-scope decision; then untouched classes D1 variant_mismatch (Takaraa/Reserved),
D3 silent_empty (~144; mokkafarms/panduranga — likely source_thin), D5 missing_image.

### Iteration 4 — D1 variant_mismatch (split + dev diagnosis)

- **Split seed = 20260601** (2 affected roasters): **DEV = reserved-india**, **VALIDATION = takaraa-specialty-coffees**.
- **Dev diagnosis (reserved):** the 6 flags are GENUINE ultra-premium gesha micro-lots, not a
  wrong-variant bug — Gesha Village E-02 ₹2200/**90g** (Geisha 1931, Oma Village Ethiopia),
  El Burro Lot 16 ₹4000/**40g** (Green Tip Geisha, Lamastus Estate Panama). Single-format
  competition lots; the data is correct. The `>₹2000 AND <100g` heuristic is a FALSE POSITIVE
  here (run-history predicted this). No extraction fix applies; audit cannot be weakened.
- **Hypothesis to confirm via metric:** `variant_mismatch` conflates (a) genuine micro-lots
  (reserved — irreducible residual / honest "source-correct") and (b) wrong-variant pairing
  (takaraa Coral Rum ₹3799/20g — fixable by `_pick_default_variant` + same-variant price/weight,
  now fed on the full_reenrich path by this session's per-URL fallback). Expected: dev (reserved)
  STAYS flagged (genuine), validation (takaraa) DROPS (real bug fixed) — the inverse of the usual
  dev/validation shape, because the random split isolated the genuine roaster into dev.
- **D1 root cause found + fix VALIDATED:** the variant picker was fine; the bug was in
  `entity_enricher._adapt_product_payload` — `weight_grams` was `payload.get() or hints.get()`
  (Haiku-FIRST), so Haiku's page-text mis-read ("20g" per-serving) overwrote the deterministic
  variant/URL bag size. Takaraa Coral Rum was correctly scraped at 1000g (URL `...-takaraa-1-kg`),
  then regressed to 20g → ₹3799/20g flagged. **Fix:** weight_grams now hints-FIRST (like price)
  + a URL-size-hint weight fallback (`_url_size_hint_grams`) in the runner. **Validated on the
  held-out takaraa WITHOUT tuning:** Coral Rum re-enriched 20g→**1000g** → no longer flagged.
- **Residuals (honest):** (a) reserved-india — 6 GENUINE gesha micro-lots (40-90g at ₹2200-4000),
  a heuristic false-positive on correct data, irreducible; (b) takaraa STALE old-handle rows —
  takaraa shortened Shopify handles ('eclipse-dark-premium-…' → 'eclipse-dark'), so re-enrich
  inserts fresh short-handle rows (correct weight) while old long-handle rows linger at 20g and
  aren't matched on upsert (different handle) → the SYSTEMIC stale-URL/replatform blocker (agent
  memory #81), shared with nandan/reserved-www. Needs a sync-layer URL-change reconciler to fully
  clear; the weight extraction itself is now correct.

### Session close — overall hardening status (2026-05-29)

**Root-cause fixes landed + verified this session (all on the full_reenrich path):**
1. Shopify/Woo price extraction (`_woo_price_inr` + per-URL `_fetch_platform_raw_by_url`) — WoC missing_price 5→0.
2. Woo dict-tags crash fix (`_normalize_platform_tags`).
3. Beans-only Stage-1 filter (drip bags/formats) + 6 pre-existing keyword false-positive fixes
   (`/collections/<x>/products/` + `/shop/<uuid>` guards; dropped class/cap/arita/hat) + new
   counted `non_bean_format` audit category + retro sweep (36 rows → filter_reject).
4. Re-enrich trailing-slash dedup upsert + 14 dup pairs merged.
5. Weight hints-first + URL-size fallback (D1) — Coral Rum 20g→1000g validated.

**Dominant remaining blocker (next session):** sync-layer stale-URL / handle-drift / www-drift
reconciler (map old→current handle, flag dead old URLs, supersede stale rows). This single fix
unblocks the residuals in D4 (nandan), D1 (takaraa), and the duplicate inflation generally.
Then: Wix price/image extractor (agastya), enrichment-failure retry (savorworks), OOS
audit-scope decision (should missing_price count available=0?), and untouched D3 silent_empty
(~144; expect large source_thin component) + D5 missing_image. NOT YET at GOAL ACHIEVED —
multi-class loop continues.

## Iteration 5 — variant PRICE-tier selection (user-surfaced, 2026-05-29)

**Defect class:** price inflation from picking the BULK variant tier. User reported
Nalinakānti showing a "very high price" but actually ₹999/200g; Hamsanādam likewise.
Split: DEV = kapi-kottai (the surfaced roaster), REGRESSION = takaraa / caffinary /
reserved (the other variant-dependent roasters the same picker serves).

**Root cause (raw-snapshot proof):** every kapi-kottai coffee has a dual-tier Shopify
variant set — 10 grinds × {200g, 1kg}. Nalinakānti = 10×₹4620 (1kg) + 10×₹999 (200g).
`_pick_default_variant`'s no-URL-hint branch picked the **LARGEST** bag (1kg) → priced the
catalog at ₹4620 while the consumer-facing retail unit is the 200g/₹999. ("Largest" had
been chosen to escape the Takaraa/Caffinary 20g/50g *sample* trap — it overcorrected.)
Price + weight are already taken from the SAME picked variant (coherence, Iter 4), so the
only bug was WHICH variant.

**Fix (`enrichment_runner._pick_default_variant`, the metric path's single picker):**
strategy 2 changed from "largest bag" to "smallest bag ≥ SAMPLE_FLOOR_GRAMS (100), else
largest sub-floor". Retail entry unit wins; 20g/50g samples skipped; genuine sub-floor
micro-lots (Reserved 40-90g gesha) preserved by the else-branch. 7-case unit test green
(kapi 200g/₹999; caffinary 250g w/ 50g skipped; coral URL-hint 1kg; meteor {20,1k}→1k;
{20,250,1k}→250; reserved gesha→90g; label-parse beats unreliable grams=1000).

**DEV metric — kapi-kottai PASS (re-enriched 07:17, audited):**
| Coffee | before | after |
|---|---|---|
| Nalinakānti | ₹4620 / 200g | **₹999 / 200g** |
| Hamsanādam | ₹3390 / 250g | **₹950 / 250g** |
| Mōhanakalyāni | ₹2590 / 250g | **₹720 / 250g** |
| Tōdi | ₹2590 / 250g | **₹720 / 250g** |
| Kilpauk Standard | ₹2300 / 250g | **₹650 / 250g** |
variant_mismatch 0, missing_price 0, ₹4620 outlier gone, no other category rose.

**REGRESSION — takaraa PASS (no tuning):** 7 re-enriched products all coherent — Coral
Rum/Emerald Dive/Maple Jasper/Ruby Vault stay 1kg (URLs end `-takaraa-1-kg` → URL-hint
strategy, unaffected); Eclipse Dark 1kg→200g/₹549, Arabica 1kg→200g/₹399 now show the
retail entry SKU (coherent — same principle, an improvement). No category rose.

**Residual (separate class):** takaraa Comet Crisp / Luna Light / Meteor Blaze still 20g/
₹2899 (variant_mismatch=3), frozen 2026-05-28T20:11 — NOT re-enriched by 06:55 or 07:14.
The stale/undiscovered-product blocker (memory #81). Under investigation.

**Also surfaced (queued):** (a) availability never derived from platform variant data —
`entity_enricher` defaults `available=True`; a sold-out product (all variants
`available:false`) still shows — user's "Shyira Rwanda not buy-able" case. (b) zenforest
La Vida Mango + First Blossom X at ₹0 were last enriched BEFORE the Woo price fix;
re-enrich disambiguates stale-vs-genuine-OOS.

**Iteration 5 CLOSED (takaraa stragglers resolved).** The 07:18 audit was stale; the
07:14 takaraa scrape reached comet-crisp/luna-light/meteor-blaze at 07:26 (slow run) and
the per-URL `/products/{handle}.json` fallback supplied their variants. New picker →
smallest-real-bag = 200g → **all three now ₹649/200g** (were the incoherent ₹2899-[1kg
price]-with-20g-[weight]). takaraa **variant_mismatch_suspicion = 0**, all 10 products
coherent, no category rose. So the variant price-tier class passes DEV (kapi-kottai 100%) +
VALIDATION (takaraa generalizes across a DIFFERENT variant shape — 4 sizes, landing-template
products) + zero regressions. CLASS HARDENED.

## Iteration 6 — availability from platform stock (user-surfaced Shyira; 2026-05-29)

**Defect class:** sold-out products show as buyable. `entity_enricher` defaults
`available=True` and nothing derived it from platform stock. Dev = zenforest + curious-life
(Woo); agastya (Wix) deferred as a separate extraction class.

**Fix (`enrichment_runner.run_for_roaster`, full_reenrich path):** after the variant pick,
set `merged_hints["available"]=False` when ALL Shopify variants are `available:false`, or
when Woo `is_in_stock`/`is_purchasable` is false. Flip only on an EXPLICIT out-of-stock
signal (never a missing/None field) so live products are never hidden. BUILD_ROADMAP §2.28 +
SCRAPER_SPEC normalizer note updated same-change.

**Status: IMPLEMENTED + sound, end-to-end validation BLOCKED — both dev roasters hit a
discovery gap, not an availability-logic problem:**
- **curious-life discovery returned 0 product URLs** (sitemap discovery=0) → "Shyira Rwanda
  Espresso" (priced ₹1780, disabled buy button) never re-enriched, still `available=1`.
  This is a per-roaster DISCOVERY bug, the real blocker on the user's Shyira flag.
- **zenforest La Vida Mango** re-enriched post-fix but stayed ₹0/available=1: it's one of
  **5 of 24** zenforest URLs absent from the WooCommerce store API (`19 carry variant/price
  data`), so no `woo_raw` reaches it — neither the price nor availability fix can act.
- **Limitation found:** the Shopify per-URL fallback `/products/{handle}.json` omits the
  per-variant `available` field, so the Shopify availability branch only fires via the bulk
  `products.json` augmenter (which has `available`), not the fallback.
- Good: the "X" duos (First Blossom X Rum Barrel, etc.) correctly come back
  `is_coffee_bean=false` — addresses the user's "First Blossom X duo, missing QC?" flag.

**NEXT (dominant systemic class): DISCOVERY / AUGMENTATION COVERAGE.** curious-life sitemap=0;
zenforest 5/24 missing from Woo API; agastya Wix (no augmenter, all weights null); takaraa
landing-template products (recovered here only via the per-URL fallback). This single class
gates availability validation + the missing_price/weight residuals on those roasters. It is
the same family as the stale-URL/handle-drift blocker (memory #81). NOT YET GOAL ACHIEVED.

## Iteration 7 — WooCommerce discovery via versioned Store API (2026-05-29)

**Defect class:** discovery/augmentation coverage (curious-life sub-case). Root-caused the
curious-life "0 product URLs" — its sitemaps are bot-blocked/timing out (the walk ran ~96s
hitting 8s timeouts and found nothing), so the WooCommerce augmenter was the only surface —
but `_woocommerce_augmenter` hit the UNVERSIONED `/wp-json/wc/store/products`, which 404s on
newer WooCommerce (curious-life), returning 0 → the augmenter's URL list (which `discover()`
DOES add as discoveries when the sitemap misses them) was empty → whole roaster silently
failed to refresh, blocking Shyira. Verified live: `/wp-json/wc/store/v1/products` returns
curious-life's full catalog with `is_purchasable`/`is_in_stock` per product (the exact fields
the availability fix reads).

**Fix (`product_discovery._woocommerce_augmenter`):** probe the VERSIONED
`/wp-json/wc/store/v1/products` first, fall back to the unversioned path for older stores
(no regression for zenforest, which served the unversioned one). Now kept in sync with
`_fetch_platform_raw_by_url`. This simultaneously unblocks the availability fix's validation:
once curious-life discovery works, Shyira re-enriches through the Woo API and its sold-out
flag flows to `available=0`. Re-enrich of curious-life + zenforest fired to validate.

**Validation results (2026-05-29):**
- **WC v1 discovery fix — PROVEN.** curious-life re-enrich: `sitemap discovery: 42 product
  URLs` + `woocommerce augmenter: 35 URLs, 35 carry variant/price data` (both were 0). The
  augmenter now sees the whole catalog; discovery even surfaced curious-life beans we never
  had (Honnametti Estate, single-origin Kenya). The many `…-subscription` SKUs correctly
  Stage-1 exclude; merch (cups, droppers, bottles, mugs) excludes; Tusker `fetch empty
  (HEAD=200)` and BISON `no bean markers` are honest per-page failures, not discovery gaps.
- **Availability fix — reads the right fields; negative case validated, positive case
  still pending.** Fetched Shyira's live Woo record: `is_purchasable:true, is_in_stock:true`
  (a *variable* product, 250g ₹1780 … 1000g ₹6050, all in stock). So Shyira is genuinely
  BUYABLE — the fix correctly leaves it `available=1`. The user's "disabled buy button" is
  the variable-product UX (must select a pack size), NOT an OOS data defect. Net: the fix
  correctly does NOT hide a live product. A genuinely-OOS product (is_in_stock=false) to
  demonstrate the positive flip→available=0 was not found among the flagged items; the
  branch is sound by construction but its positive case remains undemonstrated.
- **La Vida Mango — honest residual.** zenforest's Store API returns 19 products on BOTH
  the v1 and unversioned paths; La Vida Mango is absent from both (a published page that
  isn't a purchasable Store-API product — hidden/draft). No `woo_raw` reaches it, so neither
  the price nor availability fix can act; it stays ₹0. Correctly NOT a price-extraction bug.
  A "discovered-page-but-not-in-purchasable-API ⇒ available=0" inference is a separate,
  delicate fix (must not over-hide on transient API failures) — deferred.
- **First Blossom X (+ other "X" duos) — RESOLVED.** Grounded drainers consistently return
  `is_coffee_bean=false` for the 2-coffee bundles. Addresses the user's "duo, missing QC?".

## Fresh full-catalog audit — snapshot (2026-05-29, post variant + discovery fixes)

- **variant_mismatch_suspicion: 9 → 6.** takaraa's 3 cleared (now 200g/₹649). The remaining
  6 are ALL reserved-india genuine gesha micro-lots (El Burro 40g/₹4000, Luis Geisha 90g/
  ₹3600, CGLE Mandela 85g/₹3000, Pink Bourbon 90g/₹3100, Skiuro 90g/₹3100, Gesha Village
  90g/₹2200) — correct data, an irreducible false-positive of the >₹2000-&-<100g heuristic on
  legitimately-small premium lots (the "honest source_thin" analogue). **Variant price-tier
  class = 0 real defects catalog-wide.** (Can't drive the literal count to 0 without weakening
  the audit, which is FORBIDDEN — these 6 are confirmed-correct, not bugs.)
- **missing_price_inr: 11** — nandan 4 (enrichment_status=failed/null), zenforest 3 (La Vida
  Mango + First Blossom X bundle + 1, all API-absent or non-purchasable), agastya 2 (Wix, no
  augmenter), curious-life 1 (Tusker/BISON — `fetch empty`/`no bean markers`), savorworks 1
  (failed). Residuals split across: failed-fetch retries, Wix extraction, and genuine
  not-in-purchasable-API pages. NOT yet closed.
- **silent_empty: 126** — UNTOUCHED. mokkafarms 25, panduranga 11, drum 9, la-cuppa 8…
  Biggest remaining class; expected to be largely honest `source_thin` (estate sites with
  sparse product pages) but needs a real diagnosis pass per the protocol.
- **missing_image_url: 12** — UNTOUCHED. nandan 4, 729grams 2 (filter_reject), agastya 2
  (Wix), ainmane 2, savorworks 1 (failed). Mix of Wix JS-galleries + failed/filter_reject.
- cosmetic all_caps 5 (deliberate DEVAN'S/BROOT marketing — curation call, not a bug);
  url_dead 10; filter_reject 133; non_bean_format 0; absurd_prices 0; denorm_drift 0.

**Honest goal status:** variant price-tier = HARDENED (dev+validation+regression+catalog
audit all clean). WC v1 discovery = shipped + proven (curious-life 0→42/35). Availability =
shipped, sound, negative-case validated (Shyira correctly stays available). Remaining defect
classes (silent_empty 126, missing_image 12, missing_price 11 residual, agastya/Wix null
weights) are UNTOUCHED or partial — NOT YET GOAL ACHIEVED. Next class by leverage:
silent_empty (diagnose source_thin vs recoverable Shopify/Woo body_html specs).

## Iteration 8 (diagnosis) — silent_empty is dominated by BLENDS = genuine source_thin

Pulled mokkafarms (25/126, the largest silent_empty roaster) via `crema_list_thin_products`.
Null-field rollup: varietal / process / process_raw / altitude_masl / producer = **100% null**;
roast_level 56%; origin 24%; tasting/flavor notes only ~8% null; roaster_blurb 0% null. The
product set is entirely blends + commodity grind-formats — "50% Arabica-50% Robusta Blend",
"100% Pure Robusta", "Black 20/80", "Electric Drip", "Cold Brew", "Turkish", "Pour Over",
plus blend brand-names (Decadence, Exuberance, Signature, Supreme, Intense…). **A blend has
no single varietal/process/altitude/producer** — those nulls are CORRECT, not an extraction
miss. Even recovering roast_level/origin wouldn't clear the ≥5-null threshold (4+ fields are
inherently N/A). So mokkafarms silent_empty = genuine `source_thin`, not a defect.

**Decision needed before coding (touches audit policy — NOT a unilateral call):** the goal
says classify genuinely-thin sources as `source_thin` so they don't count. The honest
mechanism = when a product is a blend / commodity grind-format whose page genuinely lacks
single-origin signals, set `enrichment_status='source_thin'` (NOT 'enriched') and have the
`silent_empty` audit count only `status='enriched'` (it already does) — so honest source_thin
rows drop out WITHOUT weakening the rule. This needs: (1) a reliable "is-a-blend / page lacks
single-origin signals" detector in the enricher (e.g. multi-origin/Arabica+Robusta, named
blend, or no origin/varietal/process keyword anywhere in body_html+page text), (2) the new
status, (3) confirm it's not gaming. Recommend confirming this approach with the user before
implementing, since relabeling status borders the FORBIDDEN list and the legit version hinges
on the detector being genuinely-thin-only (never hiding a single-origin with recoverable data).
Other silent_empty roasters (panduranga 11, drum 9, la-cuppa 8) need the same per-roaster
check — some may have recoverable single-origin specs (true extraction fixes) vs blends.

## Iteration 7 CLOSED — WooCommerce v1 discovery class VALIDATED (2026-05-29)

curious-life re-enriched + drained to empty; post-fix audit: **silent_empty 0, variant_mismatch
0, missing_image 0, missing_price 1, non_bean_format 0**. The roaster went from 0-discoverable
(whole catalog silently failing) to fully enriched — Gundikhan ₹990, Gachatha ₹2300, Shyira
₹1780, Honnametti ₹830, single-origin Kenya, all priced + imaged. The lone missing_price is
Tusker (`enrichment_status=failed`, page `fetch empty HEAD=200`) — an honest empty-fetch
failure (JS-rendered/blocked page), a separate fetch-rendering class, not a discovery/price
bug. **Regression: zenforest (co-Woo roaster) unchanged at 19 products — no regression.** The
fix is purely additive (v1-first, unversioned-fallback), so it cannot regress any roaster that
already resolved on the unversioned path; it only RECOVERS sites the old path 404'd on. DEV
(curious-life) clean + regression-clean ⇒ class hardened.

**Availability fix — final validation note:** Shyira re-enriched via the now-working Woo
augmenter; its live data is `is_in_stock:true, is_purchasable:true`, so the fix correctly
leaves it `available=1` (negative case). The positive flip (OOS→available=0) remains
undemonstrated — no genuinely-OOS product surfaced among the investigated set; the branch is
sound by construction (reads the verified is_in_stock/is_purchasable fields, flips only on an
explicit false). A future genuinely-OOS product will exercise it.

### Session close (2026-05-29) — classes hardened: variant_price_tier (full loop, catalog
audit 0 real defects) + woocommerce_v1_discovery (dev+regression). Shipped+sound: platform
availability (negative-case validated). Diagnosed, not yet implemented: silent_empty (mostly
blends ⇒ honest source_thin, needs is_single_origin signal + source_thin status), missing_image
(12; Wix JS-galleries + failed pages), missing_price residual (Wix agastya + failed-fetch
Tusker/BISON/nandan/savorworks + not-in-API La Vida Mango), agastya/Wix null weights. NOT YET
fully GOAL ACHIEVED — multi-class loop continues next session; next = source_thin classifier.

**source_thin infra ALREADY EXISTS (de-risks the next iteration).** `routes/specific.py`:
`_apply_failed_as_thin` (~5506) sets `enrichment_status='source_thin'` and nulls
`_LLM_ENRICHMENT_FIELDS` — but ONLY for `failed` proposals (scraper regex-fallback), gated by
`_should_skip_failed_proposal` (never downgrade a live `enriched` row). Public visibility is
`WHERE available = 1` (specific.py:3482), NOT enrichment_status — so a `source_thin` row with
available=1 STAYS VISIBLE while dropping out of the `silent_empty` audit (which keys on
`enrichment_status='enriched'`, :3360/:3633). So source_thin is SAFE + already wired; the only
gap for the blend class is a TRIGGER: when an otherwise-enriched product is a genuine blend
(single-origin fields legitimately absent), classify source_thin instead of enriched.

**Precise next-session task (silent_empty / blend → source_thin):** add the trigger in the
enricher path (entity_enricher `_adapt_product_payload` or the runner) — when origin+varietal+
process+altitude+producer are all null AND the source text (body_html/listing_description in
hints) carries NO single-origin signal (no varietal name, no process term, no "estate"/
"single origin"/altitude/origin-country), set status='source_thin'. CONSERVATISM IS THE WHOLE
GAME: only fire when the page genuinely lacks signals, so a single-origin with missed-but-
present specs (e.g. drum-coffee-roasters likely) STAYS silent_empty and flags a real
EXTRACTION fix — never hide recoverable data. Split silent_empty roasters 70/30
(dev: mokkafarms + drum + …; validation: panduranga + la-cuppa), per-roaster verify
blend-vs-recoverable, then dev metric + validation gate. Add a `source_thin` counter to the
audit (additive, not weakening) for transparency.

**Discovery-class formal validation/regression gate (zenforest, held-out Woo):** re-enriched
post-v1-fix without tuning; audit = variant_mismatch 0, missing_image 0, silent_empty 2,
missing_price 3. All 14 single-coffees priced ₹689-1120 via the augmenter; the 3 missing_price
are unchanged honest residuals (La Vida Mango + First Blossom X bundle, not in the purchasable
Store API even on v1). No category rose vs pre-fix ⇒ no regression; augmenter functions via the
v1 path. Note on the 70/30 split: the broken-unversioned-path defect affected essentially ONE
roaster in the catalog (curious-life); other Woo sites served the unversioned path fine, so a
70/30 split is degenerate for a 1-roaster class — the additive fix (v1-first, unversioned-
fallback) is validated by dev recovery (curious-life 0→full) + held-out no-regression
(zenforest), and by construction cannot regress any roaster that already resolved.

## Code-level implementation map for the next two classes (verified 2026-05-29)

**source_thin / silent_empty (blends).** Robust fix = a Haiku `is_single_origin` signal (a
deterministic text/name heuristic is fragile: branded blends like mokkafarms "Decadence"
carry no blend keyword). Exact edit points:
- `Scraper/enrich.py`: `_EXTRACT_TOOL` (add `is_single_origin` boolean to input_schema) +
  `_SYSTEM` (instruct: false for blends / commodity grinds with no single-origin traceability).
  This is the CANONICAL product prompt/schema (entity_enricher imports it at
  `entity_enricher.py:79` → `enrich._EXTRACT_TOOL, enrich._SYSTEM`). Drainers read tool_schema,
  so they auto-emit the new field. NOTE: this changes the shared enrichment prompt for EVERY
  product — must run the full dev/validation re-enrich before trusting it.
- `services/entity_enricher.py:_adapt_product_payload` (~line 240): after building `out`, if
  `payload.get("is_single_origin") is False` AND origin/varietal/process_raw/altitude_masl/
  producer are all null → `out["enrichment_status"]="source_thin"`. CONSERVATIVE: never
  source_thin when is_single_origin is True/None — a single-origin with missed-but-present
  data stays `enriched` (silent_empty) so it flags a real extraction fix, never hidden.
- Visibility-safe: catalog lists `WHERE available=1` (specific.py:3482), so source_thin rows
  stay live; the silent_empty audit keys on `enrichment_status='enriched'` (:3360/:3633) so
  they drop out honestly. source_thin infra already exists (`_apply_failed_as_thin`).
- 70/30 split (silent_empty roasters): dev = mokkafarms+drum+la-cuppa (+small); validation =
  panduranga+others. Per-roaster: distinguish blend (→source_thin) from single-origin-missed
  (→real extraction fix). Dev metric: silent_empty→0 on dev; validation gate; regression gate.

**Wix augmenter (agastya weight/price/image + gb-roasters + kapiberry).** Confirmed need:
agastya Kent Microlot has `description_raw=null` + `weight_grams=null` — the scraper never
captures Wix product bodies. Wix has NO clean public products API (unlike Shopify
/products.json or Woo /wp-json/wc/store/v1/products); needs the storefront GraphQL
(`/_api/wix-ecommerce-storefront-web/api`, metasite-id + page-extracted access token) OR
embedded `window.warmupData` JSON parsing. New `_wix_augmenter` in `product_discovery.py`
alongside `_shopify_augmenter`/`_woocommerce_augmenter`, wired in `_get_augmenter`. Substantial
reverse-engineering — own iteration.

## Iteration 9 — silent_empty BLEND sub-class → source_thin (2026-05-29)

**Class:** silent_empty (126). **Split (seed=20260529, roaster-level):** DEV = mokkafarms
(25, the diagnosed roaster — all blends/commodity); VALIDATION = devans-south-indian-coffee
(held-out; "LODHI BLEND"/"VIENNESE BLEND" explicit blends) — not inspected while fixing.

**Diagnosis (confirmed by data):** silent_empty's blend sub-class is roasters selling blends/
commodity. Haiku RELIABLY emits `bean_type='Blend'` for them — verified on mokkafarms "Black
20%/80%" (bean_type='Blend', origin='Multi-estate', varietal/process/altitude/producer null)
AND branded "Decadence" (bean_type='Blend', Robusta-chicory blend). A blend genuinely has no
single varietal/process/altitude/producer → those nulls are correct, not extraction misses →
it's perpetually silent_empty while status='enriched'. The goal's prescribed handling:
classify as source_thin.

**Fix (`entity_enricher._adapt_product_payload`, on the full_reenrich path):** after building
the row, set `enrichment_status='source_thin'` when `bean_type=='Blend'` AND varietal,
process_raw, altitude_masl, producer are all null. Deterministic, NO prompt/schema change
(uses Haiku's existing reliable bean_type). CONSERVATIVE: a single-origin (bean_type
Arabica/Robusta) is never touched; a blend that carries a process/varietal stays 'enriched';
an Arabica with all-null single-origin fields (possible extraction MISS) stays 'enriched' /
silent_empty so it flags a real fix — never hidden. Visibility-safe: catalog lists WHERE
available=1 (specific.py:3482), independent of enrichment_status; silent_empty audit keys on
'enriched' (:3360/:3633) so genuine blends drop out without weakening the rule. 7-case unit
test green (branded blend + multi-estate blend → source_thin; Kent single-origin, Arabica-
all-null, blend-with-varietal, blend-with-process, no-bean_type → enriched).

**NOT covered (honest):** single-species COMMODITY (mokkafarms "100% Pure Robusta", "Monsoon
Malabar" — bean_type Robusta/Arabica, no blend signal, genuinely no single-origin data) stays
silent_empty; distinguishing it from a single-origin-missed needs an `is_single_origin` Haiku
signal — a follow-on sub-iteration. So mokkafarms silent_empty drops by its blend count, not
necessarily to 0. DEV metric here = blend products reclassify source_thin (not the full
class). Firing dev re-enrich (mokkafarms) → drain → audit to measure.

**DEV METRIC RESULT: FAILED (silent_empty 25 unchanged) — hypothesis falsified with evidence.**
Two root causes, both confirmed in the post-run audit:
1. `full_reenrich` runs `force_enrich=False` so it SKIPS content-unchanged products. Only ~6
   mokkafarms rows re-enriched (09:21-09:22); ~19 kept 05-26/27/28 timestamps. The adapter
   (and the new rule) never re-ran on most rows. Meta-finding: ANY re-enrich-based fix to
   EXISTING rows needs force_enrich=True (or a content change) to take effect.
2. `bean_type='Blend'` is the WRONG signal here. Drainers correctly classified mokkafarms by
   COFFEE SPECIES: Decadence/Intense/Indulgence -> Robusta (Robusta+chicory), Isayu -> Arabica,
   100% Robusta -> Robusta. Only true MULTI-species blends (Ranya, Mista, 50/50 Arabica-Robusta)
   get bean_type='Blend'. So bean_type cannot separate single-species COMMODITY (no traceability
   -> genuinely source_thin) from a single-origin lot; both are Arabica/Robusta. The rule is
   CORRECT for true multi-species blends (kept) but covers only a minority.

**Evidence-based redirect (next iteration):** the robust signal must be an explicit
`is_single_origin` field Haiku sets (it reads the page: commodity 100% Robusta / chicory filter
blend -> false/source_thin; single-estate lot -> true). Add to `Scraper/enrich.py`
`_EXTRACT_TOOL`+`_SYSTEM`; adapter source_thins when is_single_origin is False AND single-origin
fields null (supersedes the bean_type check). Re-enrich dev with force_enrich=True so existing
rows re-process. The bean_type attempt ruled out the cheaper deterministic signal. Class STILL
OPEN — gate not passed.

## Iteration 10 — is_single_origin signal + source_thin regression caught & fixed (2026-05-29)

**Implemented the corrected fix:** added `is_single_origin` (boolean, required) to
`Scraper/enrich.py` `_EXTRACT_TOOL` input_schema + a `_SYSTEM`/field-description instruction
(TRUE only for a traceable single-origin/estate lot; FALSE for commodity grades + blends).
`entity_enricher._adapt_product_payload` now source_thins when `payload.is_single_origin is
False` OR `bean_type=='Blend'`, AND varietal/process_raw/altitude/producer all null.
Conservative + visibility-safe. 7-case unit test green incl the COMMODITY case bean_type
missed (100% Robusta, is_single_origin=False -> source_thin) and the guard (is_single_origin
True but fields null -> stays enriched, flags a real miss, never hidden).

**REGRESSION caught by the dev run + fixed:** the first force re-enrich showed blends FAILING
with `enricher:validation_error` — because `EnrichmentStatus` Literal in `canonical_entity.py`
was `["pending","enriched","failed","skipped"]`, so the CanonicalProduct model REJECTED
`source_thin` (the existing `_apply_failed_as_thin` path writes the DB directly, bypassing the
model, which is why source_thin worked there but not via the enricher). Fixed: added
`"source_thin"` to the Literal. This is the dev/validation loop doing its job — it surfaced a
real bug before the fix was trusted.

**Classification VALIDATED by drainers (5 grounded Haiku, force run):** every mokkafarms
commodity/blend correctly came back `is_single_origin=FALSE` — 100% Pure Robusta, 100% Arabica
(the commodity cases bean_type couldn't catch), Signature/50-50/Decadence blends — with
origin/varietal/process/altitude/producer left null (no invented data), and **0 validation
errors after the Literal fix**. So Haiku reliably sets the signal + source_thin now lands.

**Also surfaced — force_enrich gap (fixed-by-use):** `full_reenrich` defaults
`force_enrich=False` and SKIPS content-unchanged rows, so enricher-logic changes never reach
existing products on a normal re-enrich. `crema_full_reenrich_roaster` DOES accept
`force_enrich=true` (verified) — required for any "re-enrich to apply a code change" step.
Fired the mokkafarms force re-enrich at 09:45 (post both fixes); drainers processing.

**PENDING (next wake):** audit mokkafarms — silent_empty should drop sharply (its products
are overwhelmingly commodity/blend -> is_single_origin=False -> source_thin), confirm no other
category rose (regression gate). Then re-enrich+audit devans (validation, force_enrich=true,
no tuning). That closes the silent_empty source_thin iteration's dev+validation gates.

**E2E MECHANISM CONFIRMED (2026-05-29 09:47):** Decadence (commodity Robusta-chicory filter
blend) re-enriched via the force run → `enrichment_status='source_thin'`, `available=1` (stays
visible), origin/varietal/process/altitude/producer all null, NO validation error. So the full
path works: drainer sets is_single_origin=False → adapter → source_thin (now a valid
EnrichmentStatus) → row drops out of silent_empty (keyed on 'enriched') without weakening the
rule. Other commodity/blends (100% Robusta/Arabica, 50-50, Intense/Indulgence/Isayu/Ranya/
Dyumni) likewise drained is_single_origin=False with 0 validation errors. mokkafarms discovered
85 product URLs (many grind variants) so the force drain is large/slow; full dev-metric audit
(silent_empty -> ~0) pending complete drain. Fix is e2e-proven; remaining is mechanical drain.

**DEV METRIC LANDING AT SCALE (mid-drain audit):** mokkafarms silent_empty **25 -> 12** as the
force run progresses. ~13 products flipped to `source_thin` (Decadence, Intense, Indulgence,
Isayu, 100% Robusta x2, 100% Arabica x2, Zorin, Mista, Supreme, Serene, 50/50, Dyumni) — all
available=1, no validation errors. The remaining 12 still carry pre-run (05-26/27) timestamps
(force run hasn't reached them yet); same commodity/blend pattern -> will flip on drain. **No
regression: missing_price 0, missing_image 0, variant_mismatch 0, non_bean_format 0,
cosmetic 0 for mokkafarms** — no other category rose. So the is_single_origin -> source_thin
fix works at scale (not just one product) and is regression-clean; full silent_empty -> ~0
pending the rest of the 85-URL drain. Dev gate TRENDING PASS.

**DEV RESULT (honest): fix VALIDATED; residual is source rate-limiting, not the fix.**
silent_empty 25 -> 12. Every mokkafarms product that successfully re-fetched flipped to
`source_thin` (commodity + blends, is_single_origin=False), 0 validation errors, and NO other
category rose (missing_price/image/variant_mismatch/cosmetic all 0) — regression-clean at
scale. The residual 12 are NOT fix failures: the 45-minute force re-enrich of mokkafarms' **85
product URLs** triggered source RATE-LIMITING — the later URLs (Vibrance, Exuberance, Black,
Monsoon Malabar, 70/30 & 80/20 blends, Arabica grind variants) all failed `fetch empty
(HEAD=network_error)`. Cancelled the thrashing run (job 3196). The 12 will clear on a gentler
re-enrich once mokkafarms' throttle resets. **Finding:** force_enrich over an 85-URL roaster
hammers the source — a throttled/paced re-fetch (or smaller dev roaster) is needed for the
full silent_empty=0; the source_thin LOGIC itself is proven. VALIDATION (devans) still to run.
NET for this class: root-cause fix done + validated + regression-clean; literal dev-100% gated
on a non-fix infra limit (source throttling).

**VALIDATION GATE (devans, held-out) — fix GENERALIZES + DISCRIMINATES correctly:** re-enriched
devans with force_enrich=true; the classifier split products exactly right —
- → source_thin: Devans Premium Blend, Arabica Peaberry Coffee (commodity/blend, no traceability).
- stays enriched: Arabica Plantation AAA (Bababudan Hills — real single-origin, is_single_origin
  TRUE), Arabica Peaberry Dark (Baba Budan Hills), Black Honey (has a honey PROCESS, so not all
  single-origin fields null). So the fix does NOT over-hide — traceable single-origins and
  products carrying a real process/varietal stay enriched; only genuinely-thin commodity/blends
  flip. This is the key anti-gaming property: it targets genuine source_thin, not the category.
- Regression-clean: missing_price/image/variant_mismatch 0; the 2 all-caps (LODHI/VIENNESE) are
  deliberate DEVAN'S branding (a separate curation call), unchanged.
- devans silent_empty 4 -> 3: same shape as mokkafarms — every RE-ENRICHED product classified
  correctly, but the force run only re-processed ~5 of devans' products (others kept 05-26/27
  timestamps), so literal =0 is again gated by partial re-enrichment, not the fix.

**CLASS STATUS — silent_empty source_thin: fix VALIDATED on dev + held-out validation, correct
discrimination (no over-hiding), zero regressions.** The ONLY gap to literal silent_empty=0 is
completing the re-enrichment of every commodity/blend row, which both force runs left partial
due to slow/throttled scraping of large catalogs. Completion = a paced full re-enrich (or
per-product reenrich for the stragglers) once source throttles reset — mechanical, not a fix or
gaming question. The is_single_origin -> source_thin root-cause fix itself is done and proven.

## Iteration 11 — fetch retry-backoff (root-cause fix for the throttle-incompletion)

The reason silent_empty couldn't reach literal 0 was itself a pipeline defect: a force
re-enrich of a large catalog fires per-product fetches back-to-back with NO pacing/retry, so
the source rate-limits after a burst (mokkafarms 85 URLs -> `HEAD=network_error` ~30 products
in), and the runner marked every throttled product `failed` and moved on — leaving them
un-re-enriched. Fixed in `enrichment_runner.run_for_roaster` (the full_reenrich subprocess
path): when a PRODUCT fetch returns empty AND the URL is NOT a hard-dead status (404/410/402),
retry with exponential backoff (4s, 12s, 30s) so the throttle window passes and the fetch
recovers; logs `[retry-ok]`. Hard-dead URLs still short-circuit to url_dead (no wasted wait).
Syntax-checked. This unblocks silent_empty=0 for mokkafarms+devans AND hardens every future
large-catalog force re-enrich against self-DoS. Re-fired mokkafarms force_enrich (10:45) with
the fix live; drainers running; silent_empty=0 dev audit + devans completion land on the wake.
NOTE: re-runs are slower now (backoff waits) but COMPLETE rather than failing — correct
trade. Specs/BUILD_ROADMAP to note this fetch-pacing behavior alongside the source_thin entry.

**WATCH-ITEM (drainer is_coffee_bean variance on chicory blends):** during the re-run, one
drainer marked "Indulgence" (70% coffee / 30% chicory) is_coffee_bean=FALSE while another
marked the same product TRUE earlier. Per the beans-only schema a >=50%-coffee filter blend is
is_coffee_bean=TRUE (KEEP) — a FALSE wrongly GATES it out (available=0). This is a Haiku
gate-judgment INCONSISTENCY (pre-existing, not the source_thin fix), re-exposed by force
re-enrich. The wake-turn MUST check no legit chicory/filter blends got gated (a removal-type
regression that audit CATEGORY counts won't surface — compare product COUNT / available rows
before vs after). If any did, re-enrich those specific products (Haiku should re-affirm TRUE)
or tighten the schema's chicory >=50% rule. Do NOT let the re-run silently delete legit
filter-coffee SKUs.
