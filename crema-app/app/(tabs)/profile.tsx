/**
 * Own-profile page — Figma node 116:380
 * Hero (left photo + right info), tab bar, three tabs: Posts / Coffee Shelf / Following.
 * In-place editing for all hero fields. Followers modal (same pattern as roaster profile).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, TextInput, ScrollView, Pressable, RefreshControl,
  StyleSheet, useWindowDimensions, LayoutChangeEvent, Modal, ActivityIndicator,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Plus, Check, X, PenLine, Camera, Coffee } from "lucide-react-native";
import Svg, { Path, Circle } from "react-native-svg";

import { useAuth } from "../../src/hooks/useAuth";
import { listen } from "../../src/utils/events";
import { useShelves } from "../../src/hooks/useShelves";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useBreakpoint } from "../../src/hooks/useBreakpoint";
import { onChromeScroll } from "../../src/utils/chromeScroll";
import { hidePost, dislikePost, confirmAndReport } from "../../src/utils/postMenuActions";
import { apiFetchRaw, resolveUploadUrl } from "../../src/api/client";
import { t, SHELF_LABELS, makeStyles } from "../../src/tokens/useTokens";

type ShelfKey = "open_bags" | "on_the_list";

import PostCard from "../../src/components/domain/PostCard";
import { openPostModal, openComposePost, ConfirmDeleteModal, useTabSlider } from "../../src/components/primitives";
import Animated from "react-native-reanimated";
import CropGestureWrap from "../../src/components/shell/CropGestureWrap";
import CoffeeCard from "../../src/components/CoffeeCard";
import ComposePost from "../../src/components/ComposePost";
import ImageUploadModal from "../../src/components/ImageUploadModal";
import Navbar from "../../src/components/Navbar";
import CremaLogo from "../../src/components/CremaLogo";
import TractionDashboard from "../../src/components/admin/TractionDashboard";
import CatalogOps from "../../src/components/admin/CatalogOps";
import SupportInbox from "../../src/components/admin/SupportInbox";
import { useFloatingFab } from "../../src/contexts/FloatingFabContext";
import FabPill from "../../src/components/primitives/FabPill";

type ProfileTab = "posts" | "shelf" | "following" | "analytics" | "catalog" | "inbox";

// Admin check — defense in depth: slug match + flag match. The backend
// endpoint enforces this same predicate on /api/stats/traction, so a
// tampered client still can't read admin data.
function isAdminUser(u: any): boolean {
  return !!u && u.is_admin === 1 && u.username === "crema";
}
const SHELF_KEYS: ShelfKey[] = ["open_bags", "on_the_list"];
const SHELF_SECTION_LABELS: Record<ShelfKey, string> = {
  open_bags: "Open Bags",
  on_the_list: "On the List",
};

const DRINK_OPTIONS = ["Cortado", "Espresso", "Cappuccino", "Latte", "Flat White", "Americano", "Pour Over", "Cold Brew", "Mocha", "Macchiato", "Filter Coffee"];

// ── Hero icons — exact Figma SVG paths, #D798DA (Bright Purple) ─────────────

// Figma node 119:1054 — coffee cup (15.05x15.05 → viewBox 0 0 16.55 16.55)
function HeroCoffeeIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 16.55 16.55" fill="none">
      <Path d="M0.75 15.8H6.556M6.556 15.8H6.651M6.556 15.8C3.345 15.775 0.75 13.01 0.75 9.604V5.994C0.75 5.543 1.095 5.177 1.522 5.177H11.685C12.111 5.177 12.457 5.543 12.457 5.994V6.062M6.651 15.8H12.457M6.651 15.8C9.862 15.775 12.457 13.01 12.457 9.604M12.457 6.062H13.711C14.866 6.062 15.802 7.053 15.802 8.276C15.802 9.498 14.866 10.489 13.711 10.489H12.457V9.604M12.457 6.062V9.604M9.948 0.75L9.112 2.521M7.44 0.75L6.603 2.521M4.931 0.75L4.095 2.521" stroke="#D798DA" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Figma node 191:2512 — heart / cafe (16.97x16 → viewBox 0 0 16.97 16)
function HeroHeartIcon() {
  return (
    <Svg width={15} height={14} viewBox="0 0 16.97 16" fill="none">
      <Path d="M8.483 3.616C6.765 -0.649 0.75 -0.195 0.75 5.256C0.75 10.708 8.483 15.25 8.483 15.25C8.483 15.25 16.217 10.708 16.217 5.256C16.217 -0.195 10.202 -0.649 8.483 3.616Z" stroke="#D798DA" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Figma node 202:2835 — coffee bean / roast (15x15, filled path)
function HeroBeanIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 15 15" fill="none">
      <Path d="M5.032 0.023C3.93 0.114 2.917 0.471 2.107 1.048C1.301 1.629 0.569 2.663 0.237 3.683C0.039 4.282 -0.004 4.579 0 5.298C0.013 7.989 0.875 10.017 2.831 11.972C4.649 13.789 6.812 14.827 9.104 14.99C9.897 15.046 10.995 14.857 11.732 14.538C13.442 13.798 14.442 12.558 14.877 10.637C15.006 10.069 15.041 8.979 14.946 8.334C14.657 6.362 13.688 4.523 12.094 2.93C11.366 2.202 10.741 1.72 9.785 1.152C8.371 0.303 6.644 -0.106 5.032 0.023ZM6.799 1.617C9.978 2.284 12.895 5.251 13.395 8.329C13.498 8.975 13.468 10.146 13.33 10.637C13.244 10.947 13.244 10.951 12.865 10.779C12.37 10.551 11.904 10.418 11.344 10.34C10.116 10.164 9.436 9.832 8.932 9.152C8.535 8.618 8.423 8.316 8.242 7.343C7.988 5.948 7.652 5.233 6.924 4.514C6.54 4.131 6.023 3.774 5.519 3.533C5.166 3.365 4.58 3.21 3.882 3.106C3.27 3.012 2.598 2.783 2.598 2.667C2.598 2.512 3.723 1.823 4.201 1.685C4.959 1.466 5.954 1.44 6.799 1.617ZM2.62 4.394C2.801 4.45 3.262 4.557 3.645 4.631C4.589 4.811 4.804 4.872 5.205 5.078C5.627 5.294 6.006 5.655 6.256 6.09C6.506 6.512 6.571 6.723 6.73 7.623C6.945 8.803 7.161 9.371 7.63 9.983C8.234 10.775 9.177 11.429 10.013 11.645C10.194 11.692 10.56 11.761 10.832 11.8C11.34 11.873 11.68 11.955 12.171 12.131L12.46 12.235L12.322 12.385C11.848 12.902 10.969 13.285 9.944 13.419C9.466 13.479 8.639 13.449 8.178 13.35C7.079 13.122 5.756 12.48 4.774 11.701C4.33 11.352 3.361 10.387 3.055 9.991C2.374 9.122 1.93 8.08 1.65 6.71C1.457 5.772 1.444 5.38 1.581 4.704C1.642 4.398 1.693 4.114 1.693 4.067C1.693 3.989 1.719 3.998 1.995 4.135C2.159 4.217 2.443 4.334 2.62 4.394Z" fill="#D798DA" />
    </Svg>
  );
}

// Figma node 119:1035 — people / followers (19.56x16.55 → scaled to 18x15)
function HeroPeopleIcon() {
  return (
    <Svg width={18} height={15} viewBox="0 0 19.56 16.55" fill="none">
      <Path d="M18.812 15.802C18.812 14.054 17.137 12.567 14.798 12.016M12.791 15.802C12.791 13.585 10.096 11.788 6.771 11.788C3.446 11.788 0.75 13.585 0.75 15.802M12.791 8.778C15.008 8.778 16.805 6.981 16.805 4.764C16.805 2.547 15.008 0.75 12.791 0.75M6.771 8.778C4.554 8.778 2.757 6.981 2.757 4.764C2.757 2.547 4.554 0.75 6.771 0.75C8.987 0.75 10.784 2.547 10.784 4.764C10.784 6.981 8.987 8.778 6.771 8.778Z" stroke="#D798DA" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Figma node 116:1029 — map pin / location (13.96x17.3 → scaled to 12x16)
function HeroPinIcon() {
  return (
    <Svg width={12} height={16} viewBox="0 0 13.96 17.3" fill="none">
      <Path d="M0.75 6.914C0.75 11.234 4.529 14.806 6.202 16.176C6.441 16.372 6.562 16.471 6.741 16.521C6.88 16.56 7.085 16.56 7.224 16.521C7.403 16.471 7.523 16.373 7.763 16.176C9.436 14.806 13.215 11.234 13.215 6.914C13.215 5.279 12.558 3.711 11.39 2.555C10.221 1.399 8.636 0.75 6.983 0.75C5.33 0.75 3.744 1.4 2.575 2.555C1.407 3.711 0.75 5.279 0.75 6.914Z" stroke="#D798DA" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.202 6.092C5.202 7.076 5.999 7.873 6.982 7.873C7.966 7.873 8.763 7.076 8.763 6.092C8.763 5.109 7.966 4.311 6.982 4.311C5.999 4.311 5.202 5.109 5.202 6.092Z" stroke="#D798DA" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function HeroEditIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 16 16" fill="none">
      <Circle cx={8} cy={8} r={7} stroke="#D798DA" strokeWidth={1} />
      <Path d="M9.5 4.5l2 2M4 12l.5-2.5L10 4l2 2-5.5 5.5L4 12z" stroke="#D798DA" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ── ShelfCarousel — horizontal scroll of coffee cards ────────────────────────

// Portrait (web wide): 240 × 400. Landscape (mobile, §2.33):
// the card flips to a 370 × 251 landscape frame — we sample the
// viewport so a single card nearly fills it, matching the Figma
// "tap one at a time" swipe idiom on phones.
const CAROUSEL_CARD_W = 240;
const CAROUSEL_CARD_H = Math.floor(240 * (400 / 240));
const CAROUSEL_CARD_W_MOBILE = 340;
const CAROUSEL_CARD_H_MOBILE = Math.floor(CAROUSEL_CARD_W_MOBILE * (251 / 370));
const CAROUSEL_GAP = 16;
const CAROUSEL_PAD = 20;

function ShelfCarousel({
  coffees, shelfMode, activeShelf, onMove, onRemove, popularity, isOwner = true, onAddToShelf,
}: {
  coffees: Array<{ coffee: any; entryId: string }>;
  shelfMode?: boolean;
  activeShelf?: ShelfKey;
  onMove?: (productId: string, shelf: string) => void;
  onRemove?: (entryId: string) => void;
  popularity?: Record<string, number>;
  isOwner?: boolean;
  onAddToShelf?: (productId: string) => void;
}) {
  const { isMobile } = useBreakpoint();
  const cardW = isMobile ? CAROUSEL_CARD_W_MOBILE : CAROUSEL_CARD_W;
  const cardH = isMobile ? CAROUSEL_CARD_H_MOBILE : CAROUSEL_CARD_H;
  const g = useGStyles();
  if (coffees.length === 0) {
    return (
      <View style={g.empty}>
        <Text style={g.emptyText}>Nothing here yet.</Text>
        <Text style={g.emptySubtext}>Browse beans and tap the heart to add coffees to this shelf.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: CAROUSEL_PAD, gap: CAROUSEL_GAP, paddingBottom: 8 }}
    >
      {coffees.map(({ coffee, entryId }) => (
        <View key={entryId} style={{ width: cardW, height: cardH }}>
          <CoffeeCard
            coffee={coffee}
            width={cardW}
            height={cardH}
            shelfMode={shelfMode}
            isOwner={isOwner}
            currentShelf={activeShelf}
            onMoveShelf={onMove}
            onRemove={onRemove ? () => onRemove(entryId) : undefined}
            onAddToShelf={!isOwner ? onAddToShelf : undefined}
            userCount={popularity?.[coffee.product_id] || 0}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const useGStyles = makeStyles((t) => ({
  empty: { paddingVertical: 60, alignItems: "center", paddingHorizontal: 32 },
  emptyText: { fontFamily: t.font["body.semibold"], fontSize: 15, color: t.color["text.primary"], marginBottom: 6 },
  emptySubtext: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.secondary"], textAlign: "center" },
}));

// ── Main page ────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { user, loading: authLoading, updateProfile } = useAuth();
  const { shelves, fetchShelves, addToShelf, removeFromShelf } = useShelves();
  const { productMap } = useCoffeeData();
  const router = useRouter();
  const { edit, tab: tabParam } = useLocalSearchParams<{ edit?: string; tab?: string }>();
  const { width: screenW } = useWindowDimensions();
  const isNarrow = screenW < 768;
  const { isMobile } = useBreakpoint();
  const s = useStyles();
  const g = useGStyles();

  // Sellers (roasters) go to their storefront page instead
  useEffect(() => {
    if (user?.account_type === "roaster" && user?.roaster_slug) {
      router.replace(`/roaster/${user.roaster_slug}`);
    }
  }, [user]);

  // Tab state. Initial value honours the optional `?tab=` query param so
  // deep-link returns from descendant pages (e.g. admin/roaster back
  // button when the back-stack is empty) land on the right tab.
  const [activeTab, setActiveTab] = useState<ProfileTab>(() => {
    const valid: ProfileTab[] = ["posts", "shelf", "following", "analytics", "catalog", "inbox"];
    return (tabParam && valid.includes(tabParam as ProfileTab)) ? (tabParam as ProfileTab) : "posts";
  });
  const tabSlider = useTabSlider(activeTab);
  // No more sub-tab state — both shelf sections render at once

  // Data
  const POSTS_PER_PAGE = 5;
  const [posts, setPosts] = useState<any[]>([]);
  const [visiblePostCount, setVisiblePostCount] = useState(POSTS_PER_PAGE);
  // (The previous `fabVisible` scroll-depth gate was removed in
  // §2.40.18 — the FAB now lives at root layout via
  // `useFloatingFab` and anchors to the relative wrapper's stable
  // bottom edge, so it can't collide with the in-page tab strip
  // anyway.)
  const [followingList, setFollowingList] = useState<any[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [popularity, setPopularity] = useState<Record<string, number>>({});

  // Edit + delete confirm state — compose now goes through
  // GlobalComposePost at root layout.
  const [postToDelete, setPostToDelete] = useState<any>(null);
  const [shelfEntryToRemove, setShelfEntryToRemove] = useState<number | null>(null);

  // ── In-place editing state ──────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(edit === "1");

  // Sync from URL param (initial load / hard refresh with ?edit=1)
  useEffect(() => {
    if (edit === "1") setIsEditing(true);
  }, [edit]);

  // Listen for edit trigger from ProfileDropdown (works even on same-route,
  // cross-platform via the events helper).
  useEffect(() => listen("crema:edit-profile", () => setIsEditing(true)), []);

  // Register the "Create post" FabPill at root layout via
  // FloatingFabContext (§2.40.18). Renders ONLY on the personal
  // Posts tab and not while editing the profile — same conditions
  // as the prior inline circular FAB. Anchored to the relative
  // wrapper's stable bottom edge so it doesn't jitter on
  // chrome-scroll. The composer config still posts to
  // `/roaster-posts` with the legacy `user_<id>` slug — every
  // post-type owned by a user historically routes through that
  // table.
  useFloatingFab(
    user && activeTab === "posts" && !isEditing ? (
      <FabPill
        testID="fab-compose-post"
        icon={<Plus size={17} color={t.color["text.on-light"]} strokeWidth={2.5} />}
        label="Create post"
        onPress={() =>
          openComposePost({
            endpoint: "/roaster-posts",
            extraData: { roaster_slug: `user_${user.id}` },
            refetchEventName: "crema:profile-posts-updated",
          })
        }
        style={{ position: "absolute" as any, bottom: 28, right: 28 }}
      />
    ) : null,
  );
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editDrink, setEditDrink] = useState("");
  const [editCafe, setEditCafe] = useState("");
  const [editPref, setEditPref] = useState("");
  const [editBrew, setEditBrew] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [editCropX, setEditCropX] = useState(50);
  const [editCropY, setEditCropY] = useState(50);
  const [editZoom, setEditZoom] = useState(1);
  const [imgAspect, setImgAspect] = useState(1.5); // natural w/h ratio, default landscape
  const [avatarContainerW, setAvatarContainerW] = useState(0);
  const [avatarContainerH, setAvatarContainerH] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, cropX: 50, cropY: 50 });
  const avatarWrapRef = useRef<View>(null);
  const [showAvatarUpload, setShowAvatarUpload] = useState(false);
  const [showDrinkPicker, setShowDrinkPicker] = useState(false);

  // Sync edit form when entering edit mode
  useEffect(() => {
    if (isEditing && user) {
      setEditName(user.display_name || "");
      setEditBio(user.bio || "");
      setEditDrink(user.favorite_drink || "");
      setEditCafe(user.favorite_cafe || "");
      setEditPref(user.coffee_preference || "");
      setEditBrew(user.brewing_style || "");
      setEditLocation(user.location || "");
      setEditAvatar(user.avatar_url || "");
      setEditCropX(user.avatar_crop_x ?? 50);
      setEditCropY(user.avatar_crop_y ?? 50);
      setEditZoom(user.avatar_zoom ?? 1);
    }
  }, [isEditing, user]);

  // ── Avatar drag-to-reposition (both X and Y, same pattern as roaster hero) ──
  const handleAvatarDragStart = useCallback((ev: any) => {
    if (!isEditing) return;
    ev.preventDefault();
    dragStartRef.current = { x: ev.clientX, y: ev.clientY, cropX: editCropX, cropY: editCropY };
    setIsDragging(true);

    const handleMove = (e: MouseEvent) => {
      const rect = (avatarWrapRef.current as any)?.getBoundingClientRect?.();
      const containerW = rect?.width || 400;
      const containerH = rect?.height || 400;
      const deltaX = e.clientX - dragStartRef.current.x;
      const deltaY = e.clientY - dragStartRef.current.y;
      const deltaPctX = (deltaX / containerW) * 100;
      const deltaPctY = (deltaY / containerH) * 100;
      setEditCropX(Math.max(0, Math.min(100, dragStartRef.current.cropX - deltaPctX)));
      setEditCropY(Math.max(0, Math.min(100, dragStartRef.current.cropY - deltaPctY)));
    };
    const handleUp = () => {
      setIsDragging(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [isEditing, editCropX, editCropY]);

  // ── Pinch-to-zoom (trackpad pinch fires wheel events with ctrlKey on web) ──
  const handleAvatarWheel = useCallback((e: any) => {
    if (!isEditing) return;
    if (!e.ctrlKey) return; // Only respond to pinch gesture, not regular scroll
    e.preventDefault();
    // Pinch out (zoom in) = negative deltaY, pinch in (zoom out) = positive deltaY
    const delta = -e.deltaY * 0.01;
    setEditZoom((z) => Math.round(Math.max(1, Math.min(5, z + delta)) * 100) / 100);
  }, [isEditing]);

  // ── Followers modal state (same pattern as roaster profile) ─────────
  const [followers, setFollowers] = useState<any[]>([]);
  const [showFollowersModal, setShowFollowersModal] = useState(false);
  const [myFollows, setMyFollows] = useState<string[]>([]);

  useEffect(() => {
    if (!showFollowersModal || !user) return;
    (async () => {
      const raw = await apiFetchRaw<any>("/my-following");
      const d = raw?.data ?? raw;
      setMyFollows(d.slugs || d.following || []);
    })().catch(() => {});
  }, [showFollowersModal, user]);

  const handleToggleFollowInModal = useCallback(async (slug: string) => {
    try {
      const raw = await apiFetchRaw<any>(`/roasters/${slug}/follow`, { method: "POST" });
      const res = raw?.data ?? raw;
      setMyFollows((prev) => res.following ? [...prev, slug] : prev.filter((s) => s !== slug));
    } catch (e) { console.warn("Follow toggle failed:", e); }
  }, []);

  // ── Data loading ───────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!user) return;
    const [postsRes, followingRes, followersRes] = await Promise.allSettled([
      apiFetchRaw(`/users/${user.username}/posts`),
      apiFetchRaw("/my-following"),
      apiFetchRaw(`/followers/user_${user.id}`),
    ]);
    if (postsRes.status === "fulfilled") {
      const raw = postsRes.value;
      const d = raw?.data ?? raw;
      setPosts(Array.isArray(d?.posts ?? d) ? (d?.posts ?? d) : []);
    }
    if (followingRes.status === "fulfilled") {
      const raw = followingRes.value;
      const d = raw?.data ?? raw;
      setFollowingList(d.following || []);
    }
    if (followersRes.status === "fulfilled") {
      const raw = followersRes.value;
      const d = raw?.data ?? raw;
      setFollowerCount(d.follower_count || 0);
      setFollowers(d.followers || []);
    }
    fetchShelves();
    apiFetchRaw("/products/popularity").then((r: any) => {
      const d = r?.data ?? r;
      setPopularity(typeof d === "object" && !Array.isArray(d) ? d : {});
    }).catch(() => {});
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);
  // Re-fetch after the sitewide composer submits a profile post.
  useEffect(() => listen("crema:profile-posts-updated", () => loadData()), [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handlePinToggle = useCallback(async (postId: number) => {
    try { await apiFetchRaw(`/posts/${postId}/pin`, { method: "PUT" }); await loadData(); }
    catch (e: any) { console.warn("Pin toggle error:", e.message); }
  }, [loadData]);

  // Edit post routes through GlobalComposePost now — no local handler.

  // ── Save profile (in-place edit) ───────────────────────────────────────
  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await updateProfile({
        display_name: editName || undefined,
        bio: editBio || undefined,
        favorite_drink: editDrink || undefined,
        favorite_cafe: editCafe || undefined,
        coffee_preference: editPref || undefined,
        brewing_style: editBrew || undefined,
        location: editLocation || undefined,
        avatar_url: editAvatar || undefined,
        avatar_crop_x: editCropX,
        avatar_crop_y: editCropY,
        avatar_zoom: editZoom,
      });
      setIsEditing(false);
      // Remove ?edit param from URL
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", window.location.pathname);
      }
      loadData();
    } catch (e) {
      console.warn("Save error:", e);
    } finally {
      setSaving(false);
    }
  };

  // Compose + edit now route through the sitewide GlobalComposePost
  // at root layout via the `openComposePost` event helper — no local
  // compose state or submit handler. (§2.40.3 / §2.40.6)

  // ── Follow toggle in following list ────────────────────────────────────
  const handleUnfollow = async (slug: string) => {
    await apiFetchRaw(`/roasters/${slug}/follow`, { method: "POST" });
    setFollowingList((prev) => prev.filter((f) => f.slug !== slug));
  };

  // ── Shelf data — both sections rendered simultaneously ─────────────────
  const shelfSections = SHELF_KEYS.map((key) => ({
    key,
    label: SHELF_SECTION_LABELS[key],
    entries: (shelves[key] || [])
      .map((entry: any) => ({
        coffee: productMap?.get(entry.product_id),
        entryId: String(entry.id),
      }))
      .filter((e: any) => e.coffee?.coffee_name)  // skip ghost entries with no matching product
      .filter((e: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.coffee?.product_id === e.coffee?.product_id) === i),  // deduplicate by product_id
  }));

  const handleMoveShelf = (productId: string, shelf: string) => { addToShelf(productId, shelf); };
  const handleRemoveShelf = (entryId: string) => {
    setShelfEntryToRemove(Number(entryId));
  };

  // Session hydrating (e.g. after an account switch's hard-reload):
  // paint the pulsing Crema logo instead of the "Log in" prompt, so
  // the swap from one profile to the next never flashes an
  // unauthenticated-looking screen. The prompt stays for real
  // not-signed-in users once hydration settles.
  if (authLoading) {
    return (
      <View style={s.loadingWrap}>
        <CremaLogo width={180} height={38} />
      </View>
    );
  }
  if (!user) {
    return (
      <View style={s.loadingWrap}>
        <Text style={s.loadingText}>Log in to see your profile</Text>
      </View>
    );
  }

  // ── Roast preference label ─────────────────────────────────────────────
  const prefVal = isEditing ? editPref : (user.coffee_preference || "");
  const brewVal = isEditing ? editBrew : (user.brewing_style || "");
  const roastLabel = (() => {
    if (!prefVal && !brewVal) return null;
    const prefText = prefVal === "light" ? "Light" : prefVal === "medium" ? "Medium" : prefVal === "dark" ? "Dark" : "";
    const brewText = brewVal === "espresso" ? "Espresso" : brewVal === "filter" ? "Filter" : "";
    return `${prefText}${brewText ? " " + brewText : ""} Roast Drinker`.trim();
  })();

  const displayAvatar = isEditing ? editAvatar : user.avatar_url;

  // ── Hero section (Figma 116:380) ───────────────────────────────────────

  const heroContent = (
    <View style={[s.hero, isNarrow && s.heroNarrow]}>
      {/* Avatar (manual positioning for true X+Y pan).
         Web: DOM `onMouseDown` + `onWheel` handlers below. Native:
         `CropGestureWrap` delegates to `Gesture.Pan` + `Gesture.Pinch`
         which call the same setEditCrop* / setEditZoom setters. (§2.36) */}
      <CropGestureWrap
        enabled={!!isEditing}
        containerW={avatarContainerW || 350}
        containerH={avatarContainerH || 360}
        cropX={editCropX} cropY={editCropY} zoom={editZoom}
        onCrop={(x, y) => { setEditCropX(x); setEditCropY(y); }}
        onZoom={(z) => setEditZoom(z)}
      >
      <View
        ref={avatarWrapRef}
        style={[
          s.avatarWrap,
          isNarrow && s.avatarWrapNarrow,
          isEditing && { cursor: isDragging ? "grabbing" : "grab" },
        ]}
        onLayout={(e) => { setAvatarContainerW(e.nativeEvent.layout.width); setAvatarContainerH(e.nativeEvent.layout.height); }}
        {...(isEditing ? { onMouseDown: handleAvatarDragStart, onWheel: handleAvatarWheel } : {})}
      >
        {displayAvatar ? (() => {
          const cW = avatarContainerW || 350;
          const cH = avatarContainerH || 360;
          const zoom = isEditing ? editZoom : (user.avatar_zoom ?? 1);
          const cx = isEditing ? editCropX : (user.avatar_crop_x ?? 50);
          const cy = isEditing ? editCropY : (user.avatar_crop_y ?? 50);
          const containerAspect = cW / cH;
          const MIN_OVER = 1.2;
          // Size image so it overflows container in BOTH dimensions
          let iW: number, iH: number;
          if (imgAspect > containerAspect) {
            // Image is wider → height fits tightly, scale both by MIN_OVER * zoom
            iH = cH * MIN_OVER * zoom;
            iW = iH * imgAspect;
          } else {
            // Image is taller → width fits tightly
            iW = cW * MIN_OVER * zoom;
            iH = iW / imgAspect;
          }
          const tx = -(iW - cW) * (cx / 100);
          const ty = -(iH - cH) * (cy / 100);
          return (
            <Image
              source={{ uri: resolveUploadUrl(displayAvatar) }}
              style={{ position: "absolute", width: iW, height: iH, left: tx, top: ty } as any}
              contentFit="fill"
              onLoad={(e: any) => {
                const src = e?.source;
                if (src?.width && src?.height) setImgAspect(src.width / src.height);
              }}
            />
          );
        })() : (
          <View style={s.avatarFallback}>
            <Text style={s.avatarLetter}>{(user.display_name || "?")[0].toUpperCase()}</Text>
          </View>
        )}
        {isEditing && !isDragging && (
          <View style={s.avatarDragHint} pointerEvents="none">
            <Text style={s.avatarDragHintText}>Drag to reposition · Pinch to zoom</Text>
          </View>
        )}
        {isEditing && (
          <Pressable onPress={() => setShowAvatarUpload(true)} style={s.avatarEditBtn}>
            <Camera size={14} color={t.color["text.on-cta"]} />
            <Text style={s.avatarEditText}>Change photo</Text>
          </Pressable>
        )}
      </View>
      </CropGestureWrap>

      {/* Info column (Figma 202:2831 — 291x330.7, all content confined to maxWidth 281) */}
      <View style={[s.infoCol, isNarrow && s.infoColNarrow]}>
        {/* Name (Figma 116:777 — Canela Text Regular 56.804px, #351101).
            Single-line in both modes. Dropping multiline + maxWidth is
            what kept the line-box identical between <Text> and <TextInput>;
            previously the input wrapped names like "Aayushi Kapadia" to two
            lines while the display <Text> rendered them on one, and that
            2-line-vs-1-line delta was the biggest info-column height
            swing after the roast picker. */}
        {isEditing ? (
          <TextInput
            style={[s.displayName, s.inlineEdit]}
            value={editName}
            onChangeText={setEditName}
            placeholder="Your name"
            placeholderTextColor="rgba(199,186,165,0.35)"
            maxLength={40}
          />
        ) : (
          <Text style={[s.displayName, isNarrow && s.displayNameNarrow]}>{user.display_name}</Text>
        )}

        {/* Bio (Figma 116:776 — Inter Regular 12px, #684F44).
            The bio slot reserves a fixed minHeight in BOTH modes so the
            info column doesn't grow/shrink when toggling edit. Users with
            no bio see 36px of empty space in display mode — that's the
            price of a stable hero layout, and it reads as intentional
            breathing room rather than emptiness. */}
        <View style={s.bioSlot}>
          {isEditing ? (
            <TextInput
              style={[s.bio, s.inlineEdit, s.bioInput]}
              value={editBio}
              onChangeText={setEditBio}
              placeholder="Tell us about yourself..."
              placeholderTextColor="rgba(199,186,165,0.35)"
              multiline
              maxLength={160}
            />
          ) : (
            user.bio ? <Text style={[s.bio, { maxWidth: 291 }]}>{user.bio}</Text> : null
          )}
        </View>

        <View style={s.divider} />

        {/* Row 1: favorite drink (Figma 119:1054 + 116:780) | cafe (191:2512 + 124:1487) */}
        <View style={s.infoRow}>
          <View style={s.infoItem}>
            <HeroCoffeeIcon />
            {isEditing ? (
              <Pressable onPress={() => setShowDrinkPicker(true)}>
                <Text style={[s.infoText, !editDrink && { color: "rgba(199,186,165,0.5)" }]}>
                  {editDrink || "Select drink"}
                </Text>
              </Pressable>
            ) : (
              <Text style={s.infoText}>{user.favorite_drink || "—"}</Text>
            )}
          </View>
          <View style={s.infoItem}>
            <HeroHeartIcon />
            {isEditing ? (
              <TextInput
                style={[s.infoText, s.inlineEditSmall]}
                value={editCafe}
                onChangeText={setEditCafe}
                placeholder="Favorite café"
                placeholderTextColor="rgba(199,186,165,0.5)"
                maxLength={60}
              />
            ) : (
              <Text style={s.infoText}>{user.favorite_cafe || "—"}</Text>
            )}
          </View>
        </View>

        <View style={s.divider} />

        {/* Row 2: roast preference (Figma 202:2835 + 116:775).
            Edit mode renders one flat chip row (3 roast + divider + 2 grind)
            instead of the earlier two-labelled-section widget. The original
            widget was ~70px tall vs ~18px for display — single-row chips
            bring it down to ~18px, matching the display so toggling edit
            doesn't grow the info column here. */}
        <View style={s.infoRow}>
          <HeroBeanIcon />
          {isEditing ? (
            <View style={s.chipEditRow}>
              {["light", "medium", "dark"].map((p) => (
                <Pressable key={p} onPress={() => setEditPref(editPref === p ? "" : p)}
                  style={[s.miniChip, editPref === p && s.miniChipActive]}>
                  <Text style={[s.miniChipText, editPref === p && s.miniChipTextActive]}>
                    {p[0].toUpperCase() + p.slice(1)}
                  </Text>
                </Pressable>
              ))}
              <View style={s.chipGroupSep} />
              {["espresso", "filter"].map((b) => (
                <Pressable key={b} onPress={() => setEditBrew(editBrew === b ? "" : b)}
                  style={[s.miniChip, editBrew === b && s.miniChipActive]}>
                  <Text style={[s.miniChipText, editBrew === b && s.miniChipTextActive]}>
                    {b[0].toUpperCase() + b.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={s.infoText}>{roastLabel || "—"}</Text>
          )}
        </View>

        <View style={s.divider} />

        {/* Row 3: followers (Figma 119:1035 + 119:1037) | location (116:1029 + 116:1030) */}
        <View style={s.infoRow}>
          <Pressable onPress={() => setShowFollowersModal(true)} style={s.infoItem}>
            <HeroPeopleIcon />
            <Text style={s.infoText}>{followerCount} followers</Text>
          </Pressable>
          <View style={s.infoItem}>
            <HeroPinIcon />
            {isEditing ? (
              <TextInput
                style={[s.infoText, s.inlineEditSmall]}
                value={editLocation}
                onChangeText={setEditLocation}
                placeholder="Location"
                placeholderTextColor="rgba(199,186,165,0.5)"
              />
            ) : (
              <Text style={s.infoText}>{user.location || "—"}</Text>
            )}
          </View>
        </View>

        <View style={s.divider} />
      </View>
    </View>
  );

  // ── Edit banner (same pattern as roaster profile) ──────────────────────
  const editBanner = isEditing ? (
    <View style={s.editBanner}>
      <View style={s.editBannerLeft}>
        <PenLine size={12} color={t.color.accent} strokeWidth={2} />
        <Text style={s.editBannerLabel}>Editing profile</Text>
      </View>
      <View style={s.editBannerRight}>
        <Pressable
          onPress={() => {
            // Reset every edit field back to the user's current value
            // so re-entering edit later starts from a clean slate.
            // The in-form state (editName / editBio / etc.) persists
            // between sessions otherwise and can cause the next edit
            // to seem "stuck" on stale values after a discard.
            // (§2.40.5)
            if (user) {
              setEditName(user.display_name || "");
              setEditBio(user.bio || "");
              setEditDrink(user.favorite_drink || "");
              setEditCafe(user.favorite_cafe || "");
              setEditPref(user.coffee_preference || "");
              setEditBrew(user.brewing_style || "");
              setEditLocation(user.location || "");
              setEditAvatar(user.avatar_url || "");
              setEditCropX(user.avatar_crop_x ?? 50);
              setEditCropY(user.avatar_crop_y ?? 50);
              setEditZoom(user.avatar_zoom ?? 1);
            }
            setIsEditing(false);
            // Clear the `?edit=1` param properly through the router so
            // Expo Router's cached search param doesn't linger and
            // re-trigger edit mode on a later mount.
            router.replace("/profile");
          }}
          style={s.editBannerDiscard}
        >
          <Text style={s.editBannerDiscardText}>Discard</Text>
        </Pressable>
        <Pressable onPress={handleSaveProfile} style={s.editBannerSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator size="small" color={t.color["text.on-cta"]} />
          ) : (
            <Text style={s.editBannerSaveText}>Save changes</Text>
          )}
        </Pressable>
      </View>
    </View>
  ) : null;

  // ── Tab bar ─────────────────────────────────────────────────────────
  // Two extra tabs ("SITE ANALYTICS", "CATALOG OPS") appear only on the
  // Crema admin's own profile. Other users — and the admin viewing other
  // users' profiles (handled by user/[username].tsx) — see only the base
  // four. SITE ANALYTICS holds the read-only metrics dashboard; CATALOG
  // OPS holds the write/run-job actions for the scraper + taste graph.
  const isAdmin = isAdminUser(user);
  const baseTabs: ProfileTab[] = ["posts", "shelf", "following"];
  const visibleTabs: ProfileTab[] = isAdmin
    ? [...baseTabs, "analytics", "catalog", "inbox"]
    : baseTabs;
  const baseLabel = (tab: ProfileTab) =>
    tab === "posts"
      ? "POSTS"
      : tab === "shelf"
      ? "COFFEE SHELF"
      : tab === "following"
      ? "FOLLOWING"
      : tab === "analytics"
      ? "SITE ANALYTICS"
      : tab === "catalog"
      ? "CATALOG OPS"
      : "INBOX";

  const tabChildren = (
    <>
      {visibleTabs.map((tab) => (
        <Pressable
          key={tab}
          onPress={() => {
            tabSlider.slideTo(tab);
            setActiveTab(tab);
            setVisiblePostCount(POSTS_PER_PAGE);
          }}
          ref={tabSlider.trackTab(tab)}
          style={s.tab}
        >
          <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
            {baseLabel(tab)}
          </Text>
        </Pressable>
      ))}
      <Animated.View
        pointerEvents="none"
        style={[s.tabUnderlineAnimated, tabSlider.underlineStyle]}
      />
    </>
  );

  // Mobile: tabs ride in a horizontal ScrollView so users can swipe
  // to reach tabs that overflow the viewport (POSTS / SHELF /
  // STAMPS / FOLLOWING / ANALYTICS — 5 wide tabs don't fit in
  // 390 px). Wide web keeps the flat flex row.
  const tabBar = isMobile ? (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.tabBarMobileOuter}
      contentContainerStyle={s.tabBarMobileInner}
    >
      {tabChildren}
    </ScrollView>
  ) : (
    <View style={s.tabBar}>{tabChildren}</View>
  );

  // ── Tab content ────────────────────────────────────────────────────────
  let tabContent: React.ReactNode = null;

  if (activeTab === "posts") {
    tabContent = (
      <View style={s.tabContent}>
        {posts.length === 0 ? (
          <View style={g.empty}>
            <Text style={g.emptyText}>No posts yet.</Text>
            <Text style={g.emptySubtext}>Share your first coffee moment with the + button.</Text>
          </View>
        ) : (
          posts.slice(0, visiblePostCount).map((post: any, idx: number) => {
            const card = (
              <PostCard post={post} user={user}
                onOpen={(p) => openPostModal({ post: p, mode: "view" })}
                onComment={(p) => openPostModal({ post: p, mode: "comment" })}
                onRepost={(p) => openPostModal({ post: p, mode: "repost" })}
                onViewOriginal={(id) => openPostModal({ postId: id, mode: "comment" })}
                onHide={(p) => hidePost(p.id)}
                onReport={(p) => confirmAndReport(p.id)}
                onDislike={(p) => dislikePost(p.id)}
                isOwner={user?.id === post.user_id}
                onEdit={(p) => openComposePost({
                  editPostId: p.id,
                  initialData: {
                    body: p.teaser || (p as any).body,
                    images: (p as any).images || [],
                    location: p.location || "",
                  },
                })}
                onPin={(p) => handlePinToggle(p.id)}
                onDelete={(p) => setPostToDelete(p)}
              />
            );
            return (
              <View key={`post-${post.id}-${idx}`}>
                {/* SwipeToCommit retired in §2.40.22 — visible
                    action bar under each post is the affordance. */}
                {card}
                {idx < Math.min(posts.length, visiblePostCount) - 1 && <View style={s.postDivider} />}
              </View>
            );
          })
        )}
      </View>
    );
  } else if (activeTab === "shelf") {
    tabContent = (
      <View style={s.tabContent}>
        {shelfSections.map((section) => (
          <View key={section.key} style={s.shelfSection}>
            <Text style={s.shelfSectionTitle}>{section.label}</Text>
            <View style={s.shelfSectionMeta}>
              <Coffee size={15} color={t.color.accent} />
              <Text style={s.shelfSectionCount}>
                {section.entries.length} {section.entries.length === 1 ? "Coffee" : "Coffees"}
              </Text>
            </View>
            <View style={s.shelfSectionDivider} />
            <ShelfCarousel coffees={section.entries} shelfMode isOwner activeShelf={section.key as ShelfKey} onMove={handleMoveShelf} onRemove={handleRemoveShelf} popularity={popularity} />
          </View>
        ))}
      </View>
    );
  } else if (isAdmin && activeTab === "analytics") {
    tabContent = (
      <View style={s.adminTabContent}>
        <TractionDashboard />
      </View>
    );
  } else if (isAdmin && activeTab === "catalog") {
    tabContent = (
      <View style={s.adminTabContent}>
        <CatalogOps />
      </View>
    );
  } else if (isAdmin && activeTab === "inbox") {
    tabContent = (
      <View style={s.adminTabContent}>
        <SupportInbox />
      </View>
    );
  } else if (activeTab === "following") {
    tabContent = (
      <View style={s.tabContent}>
        {followingList.length === 0 ? (
          <View style={g.empty}>
            <Text style={g.emptyText}>Not following anyone yet.</Text>
            <Text style={g.emptySubtext}>Discover roasters and coffee lovers to follow.</Text>
          </View>
        ) : (
          followingList.map((f: any) => (
            <Pressable key={f.slug} onPress={() => { if (f.is_roaster) router.push(`/roaster/${f.slug}`); else router.push(`/user/${f.username}`); }} style={s.followRow}>
              {f.avatar_url ? (
                <Image source={{ uri: resolveUploadUrl(f.avatar_url) }} style={s.followAvatar} contentFit="cover" />
              ) : (
                <View style={[s.followAvatar, s.followAvatarFb]}>
                  <Text style={s.followAvatarLetter}>{(f.display_name || "?")[0].toUpperCase()}</Text>
                </View>
              )}
              <View style={s.followInfo}>
                <Text style={s.followName}>{f.display_name}</Text>
                <Text style={s.followMeta}>{f.follower_count} follower{f.follower_count !== 1 ? "s" : ""}</Text>
              </View>
              <Pressable onPress={(e) => { e.stopPropagation(); handleUnfollow(f.slug); }} style={s.followingBtn}>
                <Check size={10} color={t.color["text.primary"]} strokeWidth={2.5} />
                <Text style={s.followingBtnText}>Following</Text>
              </Pressable>
            </Pressable>
          ))
        )}
      </View>
    );
  }

  return (
    <View testID="profile-screen" style={s.container}>
      {/* The FloatingFabProvider used to be mounted here so the admin
          Catalog Ops Journals panel could register its Refresh FAB at
          this flex:1 container's level. It now lives at root layout
          (§2.40.18) so registered FABs anchor to the relative
          wrapper's stable bottom edge instead of `s.container` (which
          re-layouts on every chrome-scroll frame, producing the FAB
          jitter the user reported). ArticlesPanel's `useFloatingFab`
          call works unchanged — context propagates from root. */}
      {editBanner}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.color["text.primary"]} />}
        showsVerticalScrollIndicator={false}
        // iOS: scroll the focused TextInput into view automatically
        // when the keyboard appears (RN ≥0.73). Without this the
        // Catalog Ops "Onboard Roaster" URL field gets covered when
        // tapped — there's no other surface inside the admin profile
        // tab that takes input, so this is a no-op for the rest of
        // the page.
        automaticallyAdjustKeyboardInsets={true}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // Pin the tab strip (2nd child) to the top once it scrolls
        // past the viewport edge. Without this the tabBar passes
        // through the bottom-right FAB during a scroll motion (the
        // FAB is `position: absolute` outside this ScrollView), and
        // the user briefly sees the FAB sitting on top of
        // "FOLLOWING" / "COFFEE SHELF" labels.
        //
        // Index reasoning (corrected 2026-05-01): RN Fabric / iOS
        // *does not* count `false`/`null` children toward the native
        // view tree — `stickyHeaderIndices` operates on native
        // indices, not React tree indices. A previous attempt used
        // two `{cond && heroContent}` slots assuming both occupied a
        // slot; the inactive `false` slot was elided and `[2]`
        // pointed at `tabContent` instead of `tabBar`, freezing the
        // entire scrollable body to the top and silently disabling
        // vertical scroll on the Catalog Ops tab. Single hero slot
        // with a `key` to preserve the on-toggle remount behaviour.
        stickyHeaderIndices={[1]}
        onScroll={(e) => {
          onChromeScroll(e);
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 300) {
            if (activeTab === "posts" && visiblePostCount < posts.length) {
              setVisiblePostCount((c) => Math.min(c + POSTS_PER_PAGE, posts.length));
            }
          }
        }}
        scrollEventThrottle={16}
      >
        <View key={isEditing ? "hero-edit" : "hero-view"}>{heroContent}</View>
        {tabBar}
        {tabContent}
      </ScrollView>

      {/* The "Create post" pill that used to render here as an
          inline circular FAB (Plus icon, Espresso bg) is now
          registered via `useFloatingFab` higher in this component
          (§2.40.18). It renders at the root-layout
          `FloatingFabProvider`'s level, anchored to the relative
          wrapper's stable bottom edge — no chrome-scroll jitter.
          Visual is the Crema-pink Figma 864:3286 pill, matching
          the home feed exactly. The conditions (activeTab=posts,
          !isEditing) and composer config (endpoint, extraData,
          refetchEventName) live in the useFloatingFab call. */}

      {/* Avatar upload modal */}
      <ImageUploadModal
        visible={showAvatarUpload}
        title="Profile Photo"
        purpose="post"
        currentUrl={editAvatar ? resolveUploadUrl(editAvatar) : undefined}
        onConfirm={(url) => { setEditAvatar(url); setShowAvatarUpload(false); }}
        onClose={() => setShowAvatarUpload(false)}
      />

      {/* Drink picker modal (follower-modal style) */}
      {showDrinkPicker && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowDrinkPicker(false)}>
          <View style={s.followersOverlayWrap}>
            <Pressable style={s.followersOverlayBg} onPress={() => setShowDrinkPicker(false)} />
            <View style={s.followersModal}>
              <View style={s.followersHeader}>
                <Text style={s.followersTitle}>Favorite drink</Text>
                <Pressable onPress={() => setShowDrinkPicker(false)} hitSlop={14} accessibilityLabel="Close drink picker">
                  <X size={16} color={t.color["text.primary"]} />
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 400 }}>
                {DRINK_OPTIONS.map((d, idx) => (
                  <View key={d}>
                    {idx > 0 && <View style={s.followerDivider} />}
                    <Pressable
                      onPress={() => { setEditDrink(d); setShowDrinkPicker(false); }}
                      style={s.followerRow}
                    >
                      <View style={s.followerInfo}>
                        <View style={[s.drinkDot, editDrink === d && s.drinkDotActive]} />
                        <Text style={s.followerName}>{d}</Text>
                      </View>
                      {editDrink === d && <Check size={14} color={t.color.accent} strokeWidth={2.5} />}
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {/* Followers modal (same pattern as roaster profile) */}
      {showFollowersModal && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowFollowersModal(false)}>
          <View style={s.followersOverlayWrap}>
            <Pressable style={s.followersOverlayBg} onPress={() => setShowFollowersModal(false)} />
            <View style={s.followersModal}>
              <View style={s.followersHeader}>
                <Text style={s.followersTitle}>{followerCount} {followerCount === 1 ? "follower" : "followers"}</Text>
                <Pressable onPress={() => setShowFollowersModal(false)} hitSlop={14} accessibilityLabel="Close followers list">
                  <X size={16} color={t.color["text.primary"]} />
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 400 }}>
                {followers.length === 0 ? (
                  <Text style={s.followersEmpty}>No followers yet</Text>
                ) : (
                  followers.map((f: any, idx: number) => {
                    const isMe = user && (f.user_id === user.id || f.username === user.username);
                    const fSlug = f.roaster_slug || `user_${f.user_id}`;
                    const amFollowing = myFollows.includes(fSlug);
                    return (
                      <View key={f.user_id || idx}>
                        {idx > 0 && <View style={s.followerDivider} />}
                        <View style={s.followerRow}>
                          <Pressable onPress={() => { setShowFollowersModal(false); router.push(`/user/${f.username}`); }} style={s.followerInfo}>
                            {f.avatar_url ? (
                              <Image source={{ uri: resolveUploadUrl(f.avatar_url) }} style={s.followerAvatar} contentFit="cover" />
                            ) : (
                              <View style={[s.followerAvatar, s.followerAvatarFb]}>
                                <Text style={s.followerAvatarLetter}>{(f.display_name || "?")[0].toUpperCase()}</Text>
                              </View>
                            )}
                            <View style={{ flexShrink: 1 }}>
                              <Text style={s.followerName} numberOfLines={1}>
                                {(f.display_name?.length || 0) > 25 ? f.display_name.slice(0, 25) + "…" : f.display_name}
                              </Text>
                              {f.location ? <Text style={s.followerLocation} numberOfLines={1}>{f.location}</Text> : null}
                            </View>
                          </Pressable>
                          {!isMe && (
                            <Pressable onPress={() => handleToggleFollowInModal(fSlug)} style={[s.followerFollowBtn, amFollowing && s.followerFollowBtnActive]}>
                              {amFollowing ? <Check size={10} color={t.color["text.primary"]} strokeWidth={2.5} /> : <Plus size={10} color={t.color["text.primary"]} strokeWidth={2.5} />}
                              <Text style={s.followerFollowBtnText}>{amFollowing ? "Following" : "Follow"}</Text>
                            </Pressable>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {/* Edit post routes to the sitewide composer (GlobalComposePost)
          via the `openComposePost` helper — same mid-band treatment
          as the Home FAB so chrome stays painted on mobile. */}

      <ConfirmDeleteModal
        visible={!!postToDelete}
        title="Delete this post?"
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!postToDelete) return;
          await apiFetchRaw(`/posts/${postToDelete.id}`, { method: "DELETE" });
          loadData();
        }}
        onClose={() => setPostToDelete(null)}
      />

      <ConfirmDeleteModal
        visible={shelfEntryToRemove != null}
        title="Take off shelf?"
        confirmLabel="Remove"
        onConfirm={async () => {
          if (shelfEntryToRemove != null) await removeFromShelf(shelfEntryToRemove);
        }}
        onClose={() => setShelfEntryToRemove(null)}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const useStyles = makeStyles((t) => ({
  container: { flex: 1, backgroundColor: t.color.bg },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: t.color.bg },
  loadingText: { fontFamily: t.font["body.regular"], fontSize: 16, color: t.color["text.secondary"] },

  // Edit banner — positioned as a sticky overlay at the top of the
  // profile card so toggling edit mode doesn't shove the hero + image
  // down 44px (which the eye reads as "the avatar moved / resized").
  // Keeping the discard/save controls always-visible at the top of
  // the viewport is also nicer UX than inline-above-the-hero.
  editBanner: {
    position: Platform.OS === "web" ? ("sticky" as any) : "absolute",
    top: 0, left: 0, right: 0,
    zIndex: 100,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: t.color["roaster.panel"],
    paddingHorizontal: 20,
    height: 44,
  } as any,
  editBannerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  editBannerLabel: { fontFamily: t.font["body.medium"], fontSize: 12, color: t.color.accent },
  editBannerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  editBannerDiscard: { paddingHorizontal: 12, paddingVertical: 6 },
  editBannerDiscardText: { fontFamily: t.font["body.medium"], fontSize: 12, color: t.color["text.on-cta"] },
  editBannerSave: { backgroundColor: t.color.accent, borderRadius: 4, paddingHorizontal: 14, paddingVertical: 6 },
  editBannerSaveText: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.primary"] },

  // Hero — centered on screen
  hero: {
    flexDirection: "row",
    justifyContent: "center",
    alignSelf: "center",
    width: "100%",
    maxWidth: 860,
    paddingTop: 40,
    paddingBottom: 32,
    gap: 48,
  } as any,
  heroNarrow: {
    flexDirection: "column",
    alignItems: "center",
    gap: 20,
    paddingTop: 24,
    paddingBottom: 24,
  },

  // Avatar sizing matches Figma node 202:2548 — 488.68 × 501.72 at
  // the 1440 design viewport (33.94% of width, aspect 1:1.027).
  // Shared with app/user/[username].tsx so the avatar has the same
  // dimensions on a user's own profile and on anyone else's view.
  //
  // alignSelf "flex-start" is load-bearing: the hero row's default
  // stretch was fighting the aspectRatio on Expo Web, so any time
  // the info column grew in edit mode the avatar's height stretched
  // with it — which re-fired onLayout with new cH, which re-ran the
  // MIN_OVER × zoom math, which visibly rescaled the image. Pinning
  // to flex-start lets aspectRatio win; the container stays the
  // same pixel size no matter what the sibling column does.
  avatarWrap: {
    alignSelf: "flex-start",
    width: "34%",
    aspectRatio: 488.68 / 501.72,
    maxWidth: 489,
    borderRadius: 5,
    overflow: "hidden",
    position: "relative",
  } as any,
  // `alignSelf: "center"` explicitly overrides the load-bearing
  // `flex-start` above so that on narrow (single-column) hero the
  // avatar sits under the centered name — not hugging the left
  // edge. Matches the symmetry of /user/[username] on mobile.
  avatarWrapNarrow: { width: "60%", maxWidth: 300, alignSelf: "center" },
  avatarImgZoomWrap: { width: "100%", height: "100%" } as any,
  avatarImg: { width: "100%", height: "100%" } as any,
  avatarFallback: {
    width: "100%",
    height: "100%",
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  avatarLetter: { fontFamily: t.font.display, fontSize: 48, color: t.color["text.primary"] },
  avatarDragHint: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    alignItems: "center",
    transform: [{ translateY: -10 }],
  } as any,
  avatarDragHintText: {
    fontFamily: t.font["body.medium"],
    fontSize: 11,
    color: t.color["text.on-cta"],
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  avatarEditBtn: {
    position: "absolute",
    bottom: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
  } as any,
  avatarEditText: { fontFamily: t.font["body.medium"], fontSize: 11, color: t.color["text.on-cta"] },

  // Info column (Figma 202:2831 — 291x330.7)
  infoCol: { flex: 1, justifyContent: "center" } as any,
  infoColNarrow: { alignItems: "center" } as any,
  // Name (Figma 116:777 — Canela Text Regular 56.804px, lineHeight 66, #351101).
  // `numberOfLines` deliberately omitted so long names wrap to a
  // second line instead of getting cut off mid-word.
  displayName: {
    fontFamily: t.font.display,
    fontSize: 56.8,
    color: t.color["text.primary"],
    lineHeight: 66,
  },
  // Mobile: halve the display name — 56px is oppressive on a 375px
  // viewport. `font.display` (32) is the nearest ladder value.
  displayNameNarrow: {
    fontSize: t.size["font.display"],
    lineHeight: 38,
  },
  // Bio (Figma 116:776 — Inter Regular 12px, lineHeight 18, #684F44)
  bio: {
    fontFamily: t.font["body.regular"],
    fontSize: 12,
    color: t.color["text.secondary"],
    marginTop: 4,
    lineHeight: 18,
  },
  // Slot reserves the same vertical space in display + edit so the
  // hero stays pixel-stable through the toggle. 36 matches the old
  // edit-mode minHeight so users who already had a bio don't see any
  // change.
  bioSlot: { minHeight: 36, maxWidth: 291 } as any,
  bioInput: { minHeight: 36, maxHeight: 54, maxWidth: 281 } as any,
  // Separator lines (Figma: 280.964px wide, #D7D1C4)
  divider: {
    height: 1,
    backgroundColor: t.color.border,
    maxWidth: 281,
    width: "100%",
    marginVertical: 8,
  } as any,
  // Info rows — icons at x=0, text at x=24, second column at x=96/122
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 2,
  },
  infoItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  // Info text (Figma: Inter Medium 14px, #351101)
  infoText: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color["text.primary"] },

  // In-place editing — cream background only, NO padding change.
  // The display-mode <Text> has 0 padding; the edit-mode <TextInput>
  // used to add 6/10 which grew every field by 12×20px and shoved
  // neighbours around. Keeping padding at 0 means the field looks
  // the same size edit vs display; the cream background is the only
  // visual cue that it's editable.
  inlineEdit: {
    backgroundColor: t.color["card.info"],
    borderRadius: 8,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  inlineEditSmall: {
    backgroundColor: t.color["card.info"],
    borderRadius: 6,
    paddingVertical: 0,
    paddingHorizontal: 0,
    minWidth: 60,
    maxWidth: 150,
  },
  chipEditRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  // Thin vertical rule between the roast chips and the grind chips.
  // Visual separator that matches the "Medium · Espresso" display read.
  chipGroupSep: { width: 1, height: 12, backgroundColor: t.color.border, marginHorizontal: 4 } as any,
  miniChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "rgba(215,209,196,0.3)",
  },
  miniChipActive: { backgroundColor: t.color.accent },
  miniChipText: { fontFamily: t.font["body.medium"], fontSize: 11, color: t.color["text.secondary"] },
  miniChipTextActive: { color: t.color["text.primary"] },

  // Tab bar — left edge aligns with profile image left edge (same padding as hero)
  tabBar: {
    flexDirection: "row",
    alignItems: "stretch",
    alignSelf: "center",
    width: "100%",
    maxWidth: 860,
    backgroundColor: t.color.bg,
    height: 80,
    gap: 48,
    borderTopWidth: 1,
    borderTopColor: t.color.border,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  // Mobile: match the Discover tab bar (Figma 63:5927) exactly —
  // 60-px tall, 24-px (t.spacing["2xl"]) gap between labels,
  // 32-px left padding so the active underline lines up with the
  // hero image's left edge. RN's ScrollView only accepts
  // sizing/visual properties on its outer `style`; layout props
  // like flexDirection / alignItems / gap MUST live in
  // `contentContainerStyle`, so we split the bar into two styles.
  tabBarMobileOuter: {
    height: (t.size as any)["tabbar.mobile.height"],
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "center",
    width: "100%",
    maxWidth: 860,
    backgroundColor: t.color.bg,
    borderTopWidth: 1,
    borderTopColor: t.color.border,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  } as any,
  tabBarMobileInner: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: t.spacing["2xl"],
    paddingHorizontal: t.spacing["3xl"],
    height: "100%" as any,
  } as any,
  tab: { justifyContent: "center", position: "relative" } as any,
  tabText: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.muted"], letterSpacing: 0.5, textTransform: "uppercase" },
  tabTextActive: { color: t.color["text.primary"] },
  tabUnderline: { position: "absolute", bottom: -1, left: 0, right: 0, height: 4, backgroundColor: t.color["text.primary"] } as any,
  // Animated counterpart — chrome only; `useTabSlider` owns
  // position / left / width / opacity.
  tabUnderlineAnimated: {
    bottom: -1,
    height: 4,
    backgroundColor: t.color["text.primary"],
  } as any,
  adminTabContent: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 860,
    paddingBottom: 100,
  } as any,

  tabContent: { paddingTop: 20, alignSelf: "center", width: "100%", maxWidth: 860, minHeight: 2400, paddingBottom: 100 } as any,
  postDivider: { height: 1, backgroundColor: t.color.border, marginVertical: 4 },
  composeWrap: { paddingHorizontal: 20, marginBottom: 12 },

  // Shelf sub-tabs
  shelfSection: { marginBottom: 40 },
  shelfSectionTitle: { fontFamily: t.font.display, fontSize: 35, color: t.color["text.primary"], lineHeight: 42, paddingHorizontal: 20, marginTop: 16 },
  shelfSectionMeta: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, marginTop: 8, marginBottom: 12 },
  shelfSectionCount: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color["text.primary"] },
  shelfSectionDivider: { height: 1, backgroundColor: t.color.divider, marginHorizontal: 20, marginBottom: 16 },

  // Following list
  followRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.color.border },
  followAvatar: { width: 36, height: 36, borderRadius: 18, overflow: "hidden" } as any,
  followAvatarFb: { backgroundColor: t.color["accent.cta"], alignItems: "center", justifyContent: "center" } as any,
  followAvatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.on-cta"] },
  followInfo: { flex: 1 },
  followName: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color["text.primary"] },
  followMeta: { fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.muted"], marginTop: 2 },
  followingBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, width: 88, height: 27, borderRadius: 2, backgroundColor: t.color.accent, borderWidth: 1.5, borderColor: t.color.accent },
  followingBtnText: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.primary"] },



  // Drink dot (in drink picker modal)
  drinkDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.color.border },
  drinkDotActive: { backgroundColor: t.color.accent },

  // Followers / picker modals
  followersOverlayWrap: { flex: 1, justifyContent: "center", alignItems: "center" } as any,
  followersOverlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(104,79,68,0.6)" } as any,
  followersModal: { width: "90%", maxWidth: 440, backgroundColor: t.color.bg, borderRadius: 12, padding: 20, maxHeight: "70%", zIndex: 1 } as any,
  editPostOverlayWrap: { flex: 1, justifyContent: "center", alignItems: "center" } as any,
  editPostOverlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" } as any,
  editPostModal: { width: "90%", maxWidth: 680, backgroundColor: t.color.bg, borderRadius: 12, overflow: "hidden", maxHeight: "85%", zIndex: 1 } as any,
  followersHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  // Café picker search input — sits above the scrolling list.
  cafePickerSearchWrap: { marginBottom: 10 } as any,
  cafePickerSearchInput: {
    fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.primary"],
    backgroundColor: t.color["card.front"],
    borderWidth: 1, borderColor: t.color.border,
    borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 9,
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}),
  } as any,
  followersTitle: { fontFamily: t.font["body.semibold"], fontSize: 16, color: t.color["text.primary"] },
  followersEmpty: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.muted"], textAlign: "center", paddingVertical: 32 },
  followerDivider: { height: 1, backgroundColor: "rgba(215,209,196,0.3)", marginVertical: 2 },
  followerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  followerInfo: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  followerAvatar: { width: 32, height: 32, borderRadius: 16, overflow: "hidden" } as any,
  followerAvatarFb: { backgroundColor: t.color["accent.cta"], alignItems: "center", justifyContent: "center" } as any,
  followerAvatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.on-cta"] },
  followerName: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.primary"] },
  followerLocation: { fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.muted"] },
  followerFollowBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderColor: t.color["accent.cta"], borderRadius: 2, paddingHorizontal: 10, paddingVertical: 4 },
  followerFollowBtnActive: { backgroundColor: t.color.accent, borderColor: t.color.accent },
  followerFollowBtnText: { fontFamily: t.font["body.semibold"], fontSize: 11, color: t.color["text.primary"] },
}));
