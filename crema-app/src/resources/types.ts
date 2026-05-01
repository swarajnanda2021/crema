/**
 * TypeScript interfaces for all CRUD resources.
 *
 * These match the EXACT shapes returned by the backend envelope.
 * When building an iOS app, these become Swift Codable structs.
 */

// ── Envelope ────────────────────────────────────────────────────────────────

export interface Envelope<T> {
  data: T;
  meta: {
    resource: string;
    total?: number;
    limit?: number;
    offset?: number;
  };
}

export interface ToggleResult {
  toggled: boolean;
  count: number;
}

// ── Users ───────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  username: string;
  display_name: string;
  bio?: string;
  avatar_url?: string;
  location?: string;
  coffee_preference?: "light" | "medium" | "dark";
  brewing_style?: "espresso" | "filter" | "both";
  favorite_drink?: string;
  favorite_cafe?: string;
  avatar_crop_x: number;
  avatar_crop_y: number;
  avatar_zoom: number;
  account_type: "user" | "roaster";
  roaster_slug?: string;
  is_admin?: number;
  created_at: string;
}

// ── Posts ────────────────────────────────────────────────────────────────────

export interface Post {
  id: number;
  user_id: number;
  roaster_slug: string;
  title: string;
  teaser: string;
  external_url: string | null;
  cover_image_url: string | null;
  post_type: "article" | "note" | "repost" | "tasting_note" | "sourcing_story";
  location: string | null;
  images: string[];
  repost_of_id: number | null;
  repost_comment: string | null;
  original_post: Post | null;
  tasting_note_id: number | null;
  // Phase 1 §2.3 — long-form body for sourcing stories. Null for every
  // other post_type. The `teaser` field is still the feed-surface excerpt.
  body_full: string | null;
  is_featured: boolean | number;
  is_pinned: boolean | number;
  featured_order: number | null;
  published_at: string;
  created_at: string;
  updated_at: string | null;
  // Joined author
  author: {
    username: string;
    display_name: string;
    avatar_url: string | null;
    avatar_crop_x: number;
    avatar_crop_y: number;
    avatar_zoom: number;
  };
  // Counts
  like_count: number;
  comment_count: number;
  repost_count: number;
  liked_by_me: boolean;
}

// ── Comments ────────────────────────────────────────────────────────────────

export interface Comment {
  id: number;
  user_id: number;
  post_id: number;
  comment: string;
  parent_id: number | null;
  created_at: string;
  updated_at: string | null;
  user: {
    id: number;
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
  like_count: number;
  liked_by_me: boolean;
}

// ── Products ────────────────────────────────────────────────────────────────

export interface Product {
  product_id: string;
  roaster_slug: string;
  roaster_name: string | null;
  coffee_name: string;
  roast_level: string | null;
  /** Verbatim roaster term (Vienna / Full City+ / Espresso roast). */
  roast_level_name: string | null;
  tasting_notes: string | null;
  origin: string | null;
  process: string | null;
  /** Verbatim process text — preserves experimental specificity. */
  process_raw: string | null;
  /** Standardization output — one of the 8 canonical buckets
   * (Washed/Natural/Honey/Anaerobic/Wet-Hulled/Monsooned/Experimental/Decaf).
   * Drives the BEANS Process filter chip set so 60+ raw process strings
   * collapse to 8 chips. The display column (`process`) holds Haiku's
   * cleaned method name for the CoffeeCard. */
  process_canonical: string | null;
  varietal: string | null;
  /** Standardization output — canonical cultivar name (or
   * "Multi-cultivar"). Replaces the regex backfill once a
   * standardization run completes. */
  varietal_canonical: string | null;
  altitude_masl: number | null;
  bean_type: string | null;
  /** Standardization output — species inferred from the variety
   * tree. Consumer chips read COALESCE(bean_type_canonical, bean_type). */
  bean_type_canonical: string | null;
  flavor_notes: string | null;
  /** Regex-derived legacy chip column. Consumer Discover chips now
   * read `origin_estate_canonical` first; this stays for any pages
   * that haven't migrated. */
  origin_region: string | null;
  /** Standardization output — estate name normalised to "X Estate",
   * or one of "Multi-estate" / "International" / "Unknown". The
   * Discover Location filter hides Unknown. */
  origin_estate_canonical: string | null;
  /** Natural mutation — currently only "Peaberry" populates. NOT a
   * varietal; lives in its own filter section. */
  morphology: string | null;
  weight_grams: number | null;
  price_inr: number | null;
  image_url: string | null;
  product_url: string | null;
  description_raw: string | null;
  /** Sonnet-distilled third-person narrative about THIS bean. */
  roaster_blurb: string | null;
  /** Producer / family / individual who grew the bean. */
  producer: string | null;
  /** Brew recommendation as JSON: { method, dose_grams, ratio, water_temp_celsius, notes }. */
  brew_recommendation_json: string | null;
  /** "pending" | "enriched" | "failed" | "deferred" */
  enrichment_status: string | null;
  available: boolean | number;
  source: "scraped" | "manual" | "roaster";
  created_at: string;
}

// ── Shelves ─────────────────────────────────────────────────────────────────

export type ShelfCategory = "open_bags" | "on_the_list";

export interface ShelfEntry {
  id: number;
  user_id: number;
  product_id: string;
  shelf: ShelfCategory;
  added_at: string;
  moved_at: string;
}

export type GroupedShelves = Record<ShelfCategory, ShelfEntry[]>;

// ── Tasting Notes ───────────────────────────────────────────────────────────

export interface TastingNote {
  id: number;
  user_id: number;
  product_id: string;
  acidity: number | null;
  body: number | null;
  sweetness: number | null;
  aftertaste: number | null;
  flavor_tags: string[] | null;
  brew_method: string | null;
  drink_style: string | null;
  milk_type: string | null;
  dose_grams: number | null;
  yield_grams: number | null;
  water_ml: number | null;
  extraction_time_secs: number | null;
  water_temp_celsius: number | null;
  grind_size: string | null;
  brew_ratio: string | null;
  blend_components: any[] | null;
  comment: string | null;
  created_at: string;
  updated_at: string | null;
  author: {
    username: string;
    display_name: string;
    avatar_url: string | null;
    location: string | null;
  };
}

// ── Notifications ───────────────────────────────────────────────────────────

export type NotificationType = "like" | "comment" | "follow" | "repost" | "comment_like" | "reply";

export interface Notification {
  id: number;
  user_id: number;
  type: NotificationType;
  actor_id: number;
  post_id: number | null;
  comment_id: number | null;
  read: boolean | number;
  created_at: string;
  actor: {
    username: string;
    display_name: string;
    avatar_url: string | null;
    avatar_crop_x: number;
    avatar_crop_y: number;
    avatar_zoom: number;
  };
}

// ── Roaster Profiles ────────────────────────────────────────────────────────

export interface RoasterProfile {
  roaster_slug: string;
  name: string | null;
  about_blurb: string | null;
  tagline: string | null;
  specialties: string[] | null;
  website: string | null;
  city: string | null;
  state: string | null;
  instagram_handle: string | null;
  contact_email: string | null;
  logo_url: string | null;
  hero_image_url: string | null;
  hero_crop_x: number;
  hero_crop_y: number;
  hero_zoom: number;
  // Phase 1 — admin-controlled Discover-visibility flag. Newly enriched
  // roasters land at `0` and only flip to `1` when the admin reviews the
  // synthesized bio in the Catalog Ops drawer and toggles "Publish".
  published: number;
  // Subfields computed via subquery on the roaster_profiles registry
  // entry — the ROASTERS grid uses these to render the status caption
  // ("✓ Scraper · 24 coffees" / "⊘ Unverified") without a second
  // roundtrip. Both are number-or-null because the join may miss when
  // the websites disagree on https/www. drift.
  products_count?: number;
  scrape_ready?: number;
  /**
   * Per-roaster site prompt addendum. Sonnet writes this once after
   * the first per-roaster Haiku enrichment run completes; Haiku
   * prepends it to the base extraction system prompt on every
   * subsequent run for this roaster. Visible to admin on the
   * roaster page so they can read what Haiku is being told.
   */
  enrichment_prompt_hint: string | null;
  /**
   * ISO timestamp of the most recent Sonnet meta-call that wrote
   * `enrichment_prompt_hint`. Distinct from `updated_at` (which
   * moves on any profile edit) so the admin page can surface
   * accurate hint freshness.
   */
  enrichment_prompt_hint_updated_at: string | null;
  updated_at: string | null;
}

// ── Follows ─────────────────────────────────────────────────────────────────

export interface FollowInfo {
  slug: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  account_type: string;
  roaster_slug: string | null;
  follower_count: number;
  is_roaster: boolean;
}

// ── Brew methods (Phase 1 §2.5) ─────────────────────────────────────────────

export type BrewMethodKind =
  | "espresso"
  | "pour_over"
  | "aeropress"
  | "french_press"
  | "cold_brew"
  | "moka"
  | "other";

export interface BrewMethod {
  id: number;
  product_id: string;
  roaster_slug: string;
  user_id: number;
  method: BrewMethodKind;
  dose_grams: number | null;
  yield_grams: number | null;
  water_ml: number | null;
  ratio: string | null;
  brew_time_secs: number | null;
  bloom_secs: number | null;
  water_temp_celsius: number | null;
  grind_size: string | null;
  grind_setting: string | null;
  notes: string | null;
  fields_json: Record<string, any> | null;
  created_at: string;
  updated_at: string | null;
  author_display_name: string | null;
  author_username: string | null;
}

// ── Admin Traction Dashboard (see services/admin_stats.py) ──────────────────

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface EngagementStats {
  total_users: number;
  total_roasters: number;
  dau: number;
  wau: number;
  mau: number;
  writers: number;
  writer_pct: number;
  mean_notes_per_writer: number;
  median_notes_per_writer: number;
  posts_per_active_user_per_week: number;
  total_posts: number;
  total_comments: number;
  comments_per_post: number;
  like_distribution: Record<"0" | "1-5" | "6-20" | "21+" | string, number>;
  total_reposts: number;
  repost_rate_pct: number;
  daily_signups: DailyPoint[];
  daily_active_users: DailyPoint[];
  daily_posts: DailyPoint[];
}

export interface MonthlyClickPoint {
  month: string;
  clicks: number;
}

export interface ClicksBySource {
  source_page: string;
  clicks: number;
}

export interface TopClickedProduct {
  product_id: string;
  roaster_slug: string;
  coffee_name: string | null;
  roaster_name: string | null;
  clicks: number;
}

export interface CommerceStats {
  total_clicks: number;
  monthly_clicks: MonthlyClickPoint[];
  daily_clicks: DailyPoint[];
  clicks_by_source: ClicksBySource[];
  top_products: TopClickedProduct[];
  funnel: {
    clicked: number;
    shelved: number;
    rated: number;
    full_funnel: number;
  };
}

export interface TopFollowedEntity {
  slug: string;
  name: string;
  city: string | null;
  followers: number;
}

export interface NetworkStats {
  total_follows: number;
  unique_followers: number;
  avg_follows_per_user: number;
  top_roasters: TopFollowedEntity[];
  reciprocal_pairs: number;
  shared_shelf_pairs_3_plus: number;
}

export interface RetentionCohort {
  week: string;
  week_start: string | null;
  signups: number;
  d1: number;
  d7: number;
  d30: number;
  d1_pct: number;
  d7_pct: number;
  d30_pct: number;
}

export interface RetentionStats {
  cohorts: RetentionCohort[];
  writer_retention_30d_pct: number;
  writers_total: number;
}

export interface TractionStats {
  engagement: EngagementStats;
  commerce: CommerceStats;
  network: NetworkStats;
  retention: RetentionStats;
  generated_at: string;
}

// ── Catalog Ops admin tabs (v0) ────────────────────────────────────────────

/** A roaster website the scraper crawls. The admin tab edits this list. */
export interface RoasterSource {
  id: number;
  name: string;
  website: string;
  shop_url: string | null;
  platform: string | null;
  city: string | null;
  state: string | null;
  enabled: number;
  added_at: string;
  last_scraped_at: string | null;
  // Computed via subquery in the registry — `roaster_slug` is the
  // `roaster_profiles` slug whose website matches this row, and
  // `products_count` is how many rows the marketplace currently
  // carries for that slug. Surfaces "23 coffees in catalog" on each
  // source so the admin can judge importance at a glance.
  roaster_slug: string | null;
  products_count: number;
}

/** Audit row written by the admin DELETE-roaster endpoint just before
 *  the actual hard-delete. The "Recently deleted" admin section reads
 *  this — re-enrichment from `website` recreates the profile if the
 *  deletion was a mistake. */
export interface DeletedRoaster {
  id: number;
  roaster_slug: string;
  name: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  deleted_at: string;
  deleted_by: number | null;
}

/** Background job tracked in the `jobs` table. */
export interface CatalogJob {
  id: number;
  kind: "scrape" | "geolocate" | "tree_validate" | "standardize" | "manual_sold_out";
  status: "queued" | "running" | "succeeded" | "failed";
  started_by: number;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  log_tail: string | null;
  result_summary: Record<string, any> | string | null;
  created_at: string;
}

/** One row per catalog tag → SCA-tree address resolution. */
export interface ScaAddress {
  tag: string;
  address_t1: string | null;
  address_t2: string | null;
  address_t3: string | null;
  is_null: number;
  source: "haiku" | "admin_override" | "imported";
  classified_at: string;
  model_version: string | null;
}

/** Stored SCA tree, exactly one row marked is_active=1. */
export interface ScaTreeVersion {
  id: number;
  uploaded_at: string;
  uploaded_by: number | null;
  tree_json: string;
  is_active: number;
  notes: string | null;
}

/** Top-section stats for the Taste Graph sub-tab. */
export interface GeolocateStats {
  total_catalog_tags: number;
  geolocated: number;
  null_resolved: number;
  unclassified: number;
  total_classified_rows: number;
}

/** Per-task summary for the STANDARDIZATION sub-tab. Each block carries
 * `total` (distinct input strings in the in-stock catalog) and
 * `classified` (rows in the address table). The breakdown fields below
 * differ per task — origins surface multi-estate / international /
 * unknown counts, varietals surface multi-cultivar + morphology hits,
 * roast / process surface their canonical-bucket distributions. */
export interface StandardizeStats {
  tasting: {
    total: number;
    classified: number;
    geolocated: number;
    unclassified: number;
  };
  origin: {
    total: number;
    classified: number;
    unclassified: number;
    specific_estate: number;
    multi_estate: number;
    international: number;
    unknown: number;
  };
  varietal: {
    total: number;
    classified: number;
    unclassified: number;
    specific_varietal: number;
    multi_cultivar: number;
    with_morphology: number;
  };
  roast: {
    total: number;
    classified: number;
    unclassified: number;
    buckets: Record<string, number>;
  };
  process: {
    total: number;
    classified: number;
    unclassified: number;
    buckets: Record<string, number>;
  };
}

/** Per-task exemplar-cache status surfaced by
 * /api/admin/standardize/exemplars. `regenerate_next` is the toggle the
 * admin flips to force a resample on the next run; `generated_at`
 * answers "when was this list last refreshed?". */
export interface StandardizeExemplarStatus {
  regenerate_next: boolean;
  generated_at: string | null;
  /**
   * Cached exemplar list, parsed from the row's `exemplars_json`. The
   * shape varies by task (e.g. tasting uses `{tag, address}`, origin
   * uses `{input, estate}`); admin UI renders these as raw key/value
   * pairs so ops can see exactly what Haiku is being primed with.
   */
  exemplars: any[];
}
export type StandardizeTask =
  | "tasting"
  | "origin"
  | "varietal"
  | "roast"
  | "process";

export type StandardizeExemplarMap = Record<
  StandardizeTask,
  StandardizeExemplarStatus
>;

/** Read-only payload from /api/admin/standardize/trees — both reference
 * trees ship in code, so the inspect modal renders these verbatim. */
export interface StandardizeTrees {
  sca_tree: any;
  variety_tree: any;
}

/** Diff bucket returned by the tree-upload validation step. */
export interface TreeDiffBucket {
  count: number;
  items: Array<{
    tag: string;
    address?: string[] | null;
    old_address?: string[];
    new_paths?: string[][];
  }>;
}

export interface TreeUploadResult {
  version_id: number;
  diff: {
    still_valid: TreeDiffBucket;
    now_invalid: TreeDiffBucket;
    would_change_meaning: TreeDiffBucket;
  };
}

/** Proposed product change from a scrape (or manual sold-out) job. */
export interface ScrapeProposal {
  id: number;
  job_id: number;
  product_id: string;
  change_type:
    | "insert"
    | "update"
    | "restore_available"
    | "mark_sold_out";
  proposed_state: any | null;
  prev_state: any | null;
  status: "pending" | "applied" | "rejected" | "reverted";
  applied_at: string | null;
  reverted_at: string | null;
  rejected_at: string | null;
  created_at: string;
}
