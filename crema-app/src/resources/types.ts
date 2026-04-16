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
  account_type: "user" | "roaster" | "cafe";
  roaster_slug?: string;
  cafe_slug?: string;
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
  post_type: "article" | "note" | "repost" | "tasting_note";
  location: string | null;
  cafe_slug: string | null;
  images: string[];
  repost_of_id: number | null;
  repost_comment: string | null;
  original_post: Post | null;
  tasting_note_id: number | null;
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
  tasting_notes: string | null;
  origin: string | null;
  process: string | null;
  varietal: string | null;
  altitude_masl: number | null;
  bean_type: string | null;
  flavor_notes: string | null;
  weight_grams: number | null;
  price_inr: number | null;
  image_url: string | null;
  product_url: string | null;
  description_raw: string | null;
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
  specialties: string[] | null;
  website: string | null;
  city: string | null;
  logo_url: string | null;
  hero_image_url: string | null;
  hero_crop_x: number;
  hero_crop_y: number;
  hero_zoom: number;
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

// ── Cafés (see CRUD_UTOPIA.md) ──────────────────────────────────────────────

export interface Cafe {
  cafe_slug: string;
  name: string;
  about_blurb: string | null;
  cover_image_url: string | null;
  logo_url: string | null;
  hero_crop_x: number;
  hero_crop_y: number;
  hero_zoom: number;
  logo_crop_x: number;
  logo_crop_y: number;
  logo_zoom: number;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  instagram_handle: string | null;
  website: string | null;
  phone: string | null;
  hours_json: Record<string, string> | null;
  seasonal_open_month: number | null;
  seasonal_close_month: number | null;
  stamps_enabled: number;
  stamp_target: number;
  stamp_reward: string;
  // Phase 1 §2.6 — procurement profile (owner-only, shared with roasters
  // when the café opens a wholesale inquiry §2.1).
  monthly_volume_kg: number | null;
  open_to_new_roasters: number;
  procurement_note: string | null;
  stamps_given?: number;
  rewards_redeemed?: number;
  created_at: string;
  updated_at: string;
}

export interface CafeMenuItem {
  id: number;
  cafe_slug: string;
  drink_name: string;
  drink_order: number;
  roaster_slug: string | null;
  product_id: string | null;
  manual_roaster_name: string | null;
  manual_roaster_url: string | null;
  manual_bean_name: string | null;
  roast_level: string | null;
  process: string | null;
  notes: string | null;
  hide_roaster: number;
  created_at: string;
}

// CafeBarista type removed — feature cut.

export interface Stamp {
  id: number;
  user_id: number;
  cafe_slug: string;
  scanned_at: string;
}

export interface StampReward {
  id: number;
  user_id: number;
  cafe_slug: string;
  stamps_used: number;
  redeemed_at: string;
}

export interface StampBookEntry {
  cafe_slug: string;
  name: string;
  logo_url: string | null;
  city: string | null;
  state: string | null;
  stamp_target: number;
  stamp_reward: string;
  progress: number;
  total_stamps: number;
  rewards_redeemed: number;
  last_visit: string;
}

export interface QRTokenResponse {
  token: string;
  expires_at: string;
}

export interface StampResult {
  user_id: number;
  display_name: string;
  username: string;
  avatar_url: string | null;
  stamps_progress: number;
  stamp_target: number;
  reward_earned: boolean;
  total_stamps_ever: number;
  rewards_ever: number;
}

// ── Admin Traction Dashboard (see services/admin_stats.py) ──────────────────

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface EngagementStats {
  total_users: number;
  total_roasters: number;
  total_cafe_accounts: number;
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

export interface TopStampedCafe {
  cafe_slug: string;
  name: string;
  city: string | null;
  stamps: number;
}

export interface LoyaltyStats {
  total_stamps: number;
  stamps_7d: number;
  stamps_30d: number;
  stamps_90d: number;
  unique_stamped_users: number;
  avg_stamps_per_user: number;
  avg_days_between_stamps: number;
  loyal_cohort_3_plus: number;
  rewards_redeemed: number;
  reward_conversion_pct: number;
  top_cafes: TopStampedCafe[];
  daily_stamps: DailyPoint[];
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
  top_cafes: TopFollowedEntity[];
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
  avg_first_to_second_stamp_days: number;
}

export interface SupplyStats {
  roasters_total: number;
  roasters_with_profiles: number;
  roasters_with_products: number;
  roasters_with_posts: number;
  roasters_with_followers: number;
  products_total: number;
  products_available: number;
  products_with_shelf_entry: number;
  products_with_tasting_note: number;
  cafes_total: number;
  cafes_stamps_enabled: number;
  cafes_with_any_stamp: number;
  avg_menu_items_per_cafe: number;
  cafes_using_catalog_roasters: number;
  ecosystem_density_pct: number;
  // Phase 1 §2.6 procurement profile readiness
  cafes_procurement_ready: number;
  cafes_open_to_new_roasters: number;
  procurement_readiness_pct: number;
}

export interface TractionStats {
  engagement: EngagementStats;
  commerce: CommerceStats;
  loyalty: LoyaltyStats;
  network: NetworkStats;
  retention: RetentionStats;
  supply: SupplyStats;
  generated_at: string;
}
