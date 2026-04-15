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

export interface CafeBarista {
  id: number;
  cafe_slug: string;
  name: string;
  photo_url: string | null;
  specialty: string | null;
  display_order: number;
  created_at: string;
}

export interface Stamp {
  id: number;
  user_id: number;
  cafe_slug: string;
  barista_id: number | null;
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
