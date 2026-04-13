/**
 * Own-profile page — Figma node 116:380
 * Hero (left photo + right info), tab bar, three tabs: Posts / Coffee Shelf / Following.
 * In-place editing for all hero fields. Followers modal (same pattern as roaster profile).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, TextInput, ScrollView, Pressable, RefreshControl,
  StyleSheet, useWindowDimensions, LayoutChangeEvent, Modal, ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Plus, Check, X, PenLine, Camera } from "lucide-react-native";
import Svg, { Path, Circle } from "react-native-svg";

import { useAuth } from "../../src/hooks/useAuth";
import { useShelves } from "../../src/hooks/useShelves";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { apiFetch, apiFetchRaw, resolveUploadUrl } from "../../src/api/client";
import { colors, fonts, SHELF_LABELS, ShelfKey } from "../../src/tokens/useTokens";

import { openPostModal, CroppedAvatar } from "../../src/components/primitives";
import PostCard from "../../src/components/domain/PostCard";
import CoffeeCard from "../../src/components/CoffeeCard";
import ComposePost from "../../src/components/ComposePost";
import ImageUploadModal from "../../src/components/ImageUploadModal";

type ProfileTab = "posts" | "shelf" | "following";
type ShelfSub = "currently_drinking" | "drank" | "want_to_try";
const SHELF_KEYS: ShelfKey[] = ["currently_drinking", "drank", "want_to_try"];
const SHELF_SUB_LABELS: Record<ShelfSub, string> = {
  currently_drinking: "Currently Drinking",
  drank: "Drank",
  want_to_try: "Want to Try",
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

// ── CoffeeGrid ──────────────────────────────────────────────────────────────

const GAP = 20;
const TARGET_CARD_W = 240;
const CARD_ASPECT = 400 / 240;
const GRID_PAD = 16;

function CoffeeGrid({
  coffees, shelfMode, activeShelf, onMove, onRemove,
}: {
  coffees: Array<{ coffee: any; entryId: string }>;
  shelfMode?: boolean;
  activeShelf?: ShelfKey;
  onMove?: (productId: string, shelf: string) => void;
  onRemove?: (entryId: string) => void;
}) {
  const [containerW, setContainerW] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerW(e.nativeEvent.layout.width);
  }, []);

  const availableWidth = containerW > 0 ? containerW - GRID_PAD * 2 : 960;
  const numCols = Math.max(1, Math.min(5, Math.round((availableWidth + GAP) / (TARGET_CARD_W + GAP))));
  const cardWidth = Math.floor((availableWidth - GAP * (numCols - 1)) / numCols);
  const cardHeight = Math.floor(cardWidth * CARD_ASPECT);

  if (coffees.length === 0) {
    return (
      <View style={g.empty}>
        <Text style={g.emptyText}>Nothing here yet.</Text>
        <Text style={g.emptySubtext}>Browse beans and tap the heart to add coffees to this shelf.</Text>
      </View>
    );
  }

  return (
    <View onLayout={onLayout} style={[g.grid, { gap: GAP, paddingHorizontal: GRID_PAD, paddingBottom: 60 }]}>
      {coffees.map(({ coffee, entryId }) => (
        <View key={entryId} style={{ width: cardWidth, height: cardHeight }}>
          <CoffeeCard
            coffee={coffee}
            width={cardWidth}
            height={cardHeight}
            shelfMode={shelfMode}
            currentShelf={activeShelf}
            onMoveShelf={onMove}
            onRemove={onRemove ? () => onRemove(entryId) : undefined}
          />
        </View>
      ))}
    </View>
  );
}

const g = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  empty: { paddingVertical: 60, alignItems: "center", paddingHorizontal: 32 },
  emptyText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.textPrimary, marginBottom: 6 },
  emptySubtext: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.textSecondary, textAlign: "center" },
});

// ── Main page ────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { user, updateProfile } = useAuth();
  const { shelves, fetchShelves, addToShelf, removeFromShelf } = useShelves();
  const { productMap } = useCoffeeData();
  const router = useRouter();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const { width: screenW } = useWindowDimensions();
  const isNarrow = screenW < 768;

  // Roasters go to their roaster profile page instead
  useEffect(() => {
    if (user?.account_type === "roaster" && user?.roaster_slug) {
      router.replace(`/roaster/${user.roaster_slug}`);
    }
  }, [user]);

  // Tab state
  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const [activeShelf, setActiveShelf] = useState<ShelfSub>("currently_drinking");

  // Data
  const POSTS_PER_PAGE = 5;
  const [posts, setPosts] = useState<any[]>([]);
  const [visiblePostCount, setVisiblePostCount] = useState(POSTS_PER_PAGE);
  const [followingList, setFollowingList] = useState<any[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Compose
  const [showCompose, setShowCompose] = useState(false);

  // ── In-place editing state ──────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(edit === "1");

  // Sync from URL param (initial load / hard refresh with ?edit=1)
  useEffect(() => {
    if (edit === "1") setIsEditing(true);
  }, [edit]);

  // Listen for edit trigger from ProfileDropdown (custom event, works even on same-route)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setIsEditing(true);
    window.addEventListener("crema:edit-profile", handler);
    return () => window.removeEventListener("crema:edit-profile", handler);
  }, []);
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
    apiFetch<{ following: string[] }>("/my-following")
      .then((d) => setMyFollows(d.slugs || d.following || []))
      .catch(() => {});
  }, [showFollowersModal, user]);

  const handleToggleFollowInModal = useCallback(async (slug: string) => {
    try {
      const res = await apiFetch<{ following: boolean }>(`/roasters/${slug}/follow`, { method: "POST" });
      setMyFollows((prev) => res.following ? [...prev, slug] : prev.filter((s) => s !== slug));
    } catch {}
  }, []);

  // ── Data loading ───────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!user) return;
    const [postsRes, followingRes, followersRes] = await Promise.allSettled([
      apiFetchRaw(`/users/${user.username}/posts`),
      apiFetchRaw("/my-following"),
      apiFetchRaw(`/followers/user_${user.id}`),
    ]);
    if (postsRes.status === "fulfilled") setPosts(postsRes.value.posts || postsRes.value || []);
    if (followingRes.status === "fulfilled") setFollowingList(followingRes.value.following || []);
    if (followersRes.status === "fulfilled") {
      setFollowerCount(followersRes.value.follower_count || 0);
      setFollowers(followersRes.value.followers || []);
    }
    fetchShelves();
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

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

  // ── Compose handlers ──────────────────────────────────────────────────
  const handlePostSubmit = async (data: any) => {
    await apiFetchRaw("/posts", {
      method: "POST",
      body: JSON.stringify({ ...data, roaster_slug: `user_${user?.id}` }),
    });
    setShowCompose(false);
    loadData();
  };

  // ── Follow toggle in following list ────────────────────────────────────
  const handleUnfollow = async (slug: string) => {
    await apiFetchRaw(`/roasters/${slug}/follow`, { method: "POST" });
    setFollowingList((prev) => prev.filter((f) => f.slug !== slug));
  };

  // ── Shelf data ─────────────────────────────────────────────────────────
  const shelfEntries = (shelves[activeShelf] || []).map((entry: any) => ({
    coffee: productMap?.get(entry.product_id) || { product_id: entry.product_id, name: entry.product_id },
    entryId: String(entry.id),
  }));

  const handleMoveShelf = (productId: string, shelf: string) => { addToShelf(productId, shelf); };
  const handleRemoveShelf = (entryId: string) => { removeFromShelf(Number(entryId)); };

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
      {/* Avatar (manual positioning for true X+Y pan) */}
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
            <Camera size={14} color="#FAF8F0" />
            <Text style={s.avatarEditText}>Change photo</Text>
          </Pressable>
        )}
      </View>

      {/* Info column (Figma 202:2831 — 291x330.7, all content confined to maxWidth 281) */}
      <View style={[s.infoCol, isNarrow && s.infoColNarrow]}>
        {/* Name (Figma 116:777 — Canela Text Regular 56.804px, #351101) */}
        {isEditing ? (
          <TextInput
            style={[s.displayName, s.inlineEdit, { maxWidth: 281 }]}
            value={editName}
            onChangeText={setEditName}
            placeholder="Your name"
            placeholderTextColor="rgba(199,186,165,0.35)"
            multiline
            maxLength={40}
          />
        ) : (
          <Text style={s.displayName}>{user.display_name}</Text>
        )}

        {/* Bio (Figma 116:776 — Inter Regular 12px, #684F44) */}
        {isEditing ? (
          <TextInput
            style={[s.bio, s.inlineEdit, { minHeight: 36, maxWidth: 281, maxHeight: 54 }]}
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
                placeholder="Favorite cafe"
                placeholderTextColor="rgba(199,186,165,0.5)"
              />
            ) : (
              <Text style={s.infoText}>{user.favorite_cafe || "—"}</Text>
            )}
          </View>
        </View>

        <View style={s.divider} />

        {/* Row 2: roast preference (Figma 202:2835 + 116:775) */}
        <View style={s.infoRow}>
          <HeroBeanIcon />
          {isEditing ? (
            <View style={{ gap: 8, maxWidth: 260 }}>
              <View>
                <Text style={s.editFieldLabel}>Roast type</Text>
                <View style={s.chipEditRow}>
                  {["light", "medium", "dark"].map((p) => (
                    <Pressable key={p} onPress={() => setEditPref(editPref === p ? "" : p)}
                      style={[s.miniChip, editPref === p && s.miniChipActive]}>
                      <Text style={[s.miniChipText, editPref === p && s.miniChipTextActive]}>
                        {p[0].toUpperCase() + p.slice(1)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View>
                <Text style={s.editFieldLabel}>Grind type</Text>
                <View style={s.chipEditRow}>
                  {["espresso", "filter"].map((b) => (
                    <Pressable key={b} onPress={() => setEditBrew(editBrew === b ? "" : b)}
                      style={[s.miniChip, editBrew === b && s.miniChipActive]}>
                      <Text style={[s.miniChipText, editBrew === b && s.miniChipTextActive]}>
                        {b[0].toUpperCase() + b.slice(1)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
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
        <PenLine size={12} color="#D798DA" strokeWidth={2} />
        <Text style={s.editBannerLabel}>Editing profile</Text>
      </View>
      <View style={s.editBannerRight}>
        <Pressable onPress={() => { setIsEditing(false); if (typeof window !== "undefined") window.history.replaceState({}, "", window.location.pathname); }} style={s.editBannerDiscard}>
          <Text style={s.editBannerDiscardText}>Discard</Text>
        </Pressable>
        <Pressable onPress={handleSaveProfile} style={s.editBannerSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator size="small" color="#FAF8F0" />
          ) : (
            <Text style={s.editBannerSaveText}>Save changes</Text>
          )}
        </Pressable>
      </View>
    </View>
  ) : null;

  // ── Tab bar ─────────────────────────────────────────────────────────
  const tabBar = (
    <View style={s.tabBar}>
      {(["posts", "shelf", "following"] as ProfileTab[]).map((tab) => (
        <Pressable key={tab} onPress={() => { setActiveTab(tab); setVisiblePostCount(POSTS_PER_PAGE); }} style={s.tab}>
          <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
            {tab === "posts" ? "POSTS" : tab === "shelf" ? "COFFEE SHELF" : "FOLLOWING"}
          </Text>
          {activeTab === tab && <View style={s.tabUnderline} />}
        </Pressable>
      ))}
    </View>
  );

  // ── Tab content ────────────────────────────────────────────────────────
  let tabContent: React.ReactNode = null;

  if (activeTab === "posts") {
    tabContent = (
      <View style={s.tabContent}>
        {showCompose && (
          <View style={s.composeWrap}>
            <ComposePost onSubmit={handlePostSubmit} onCancel={() => setShowCompose(false)} user={user} products={Array.from(productMap?.values() || [])} />
            <View style={s.postDivider} />
          </View>
        )}
        {posts.length === 0 && !showCompose ? (
          <View style={g.empty}>
            <Text style={g.emptyText}>No posts yet.</Text>
            <Text style={g.emptySubtext}>Share your first coffee moment with the + button.</Text>
          </View>
        ) : (
          posts.slice(0, visiblePostCount).map((post: any, idx: number) => (
            <View key={`post-${post.id}-${idx}`}>
              <PostCard post={post} user={user}
                onComment={(p) => openPostModal({ post: p, mode: "comment" })}
                onRepost={(p) => openPostModal({ post: p, mode: "repost" })}
                onViewOriginal={(id) => openPostModal({ postId: id, mode: "comment" })}
                isOwner={user?.id === post.user_id}
                onDelete={async (p) => { await apiFetchRaw(`/roaster-posts/${p.id}`, { method: "DELETE" }); loadData(); }}
              />
              {idx < Math.min(posts.length, visiblePostCount) - 1 && <View style={s.postDivider} />}
            </View>
          ))
        )}
      </View>
    );
  } else if (activeTab === "shelf") {
    tabContent = (
      <View style={s.tabContent}>
        <View style={s.shelfSubTabs}>
          {SHELF_KEYS.map((key) => (
            <Pressable key={key} onPress={() => setActiveShelf(key as ShelfSub)} style={s.shelfSubTab}>
              <Text style={[s.shelfSubTabText, activeShelf === key && s.shelfSubTabTextActive]}>{SHELF_SUB_LABELS[key as ShelfSub]}</Text>
              {activeShelf === key && <View style={s.shelfSubTabUnderline} />}
            </Pressable>
          ))}
        </View>
        <CoffeeGrid coffees={shelfEntries} shelfMode activeShelf={activeShelf} onMove={handleMoveShelf} onRemove={handleRemoveShelf} />
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
                <Check size={10} color="#351101" strokeWidth={2.5} />
                <Text style={s.followingBtnText}>Following</Text>
              </Pressable>
            </Pressable>
          ))
        )}
      </View>
    );
  }

  return (
    <View style={s.container}>
      {editBanner}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#351101" />}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 300) {
            if (activeTab === "posts" && visiblePostCount < posts.length) {
              setVisiblePostCount((c) => Math.min(c + POSTS_PER_PAGE, posts.length));
            }
          }
        }}
        scrollEventThrottle={400}
      >
        {!isEditing && heroContent}
        {isEditing && heroContent}
        {tabBar}
        {tabContent}
      </ScrollView>

      {/* FAB — only on posts tab, not in edit mode */}
      {activeTab === "posts" && !showCompose && !isEditing && (
        <Pressable onPress={() => setShowCompose(true)} style={s.fab}>
          <Plus size={22} color="#FAF8F0" strokeWidth={2.5} />
        </Pressable>
      )}

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
          <Pressable style={s.followersOverlay} onPress={() => setShowDrinkPicker(false)}>
            <Pressable style={s.followersModal} onPress={(e) => e.stopPropagation()}>
              <View style={s.followersHeader}>
                <Text style={s.followersTitle}>Favorite drink</Text>
                <Pressable onPress={() => setShowDrinkPicker(false)} hitSlop={8}>
                  <X size={16} color="#351101" />
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
                      {editDrink === d && <Check size={14} color="#D798DA" strokeWidth={2.5} />}
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Followers modal (same pattern as roaster profile) */}
      {showFollowersModal && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowFollowersModal(false)}>
          <Pressable style={s.followersOverlay} onPress={() => setShowFollowersModal(false)}>
            <Pressable style={s.followersModal} onPress={(e) => e.stopPropagation()}>
              <View style={s.followersHeader}>
                <Text style={s.followersTitle}>{followerCount} {followerCount === 1 ? "follower" : "followers"}</Text>
                <Pressable onPress={() => setShowFollowersModal(false)} hitSlop={8}>
                  <X size={16} color="#351101" />
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
                            <View>
                              <Text style={s.followerName}>{f.display_name}</Text>
                              {f.location ? <Text style={s.followerLocation}>{f.location}</Text> : null}
                            </View>
                          </Pressable>
                          {!isMe && (
                            <Pressable onPress={() => handleToggleFollowInModal(fSlug)} style={[s.followerFollowBtn, amFollowing && s.followerFollowBtnActive]}>
                              {amFollowing ? <Check size={10} color="#351101" strokeWidth={2.5} /> : <Plus size={10} color="#351101" strokeWidth={2.5} />}
                              <Text style={s.followerFollowBtnText}>{amFollowing ? "Following" : "Follow"}</Text>
                            </Pressable>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FAF8F0" },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#FAF8F0" },
  loadingText: { fontFamily: fonts.bodyRegular, fontSize: 16, color: "#684F44" },

  // Edit banner (matches roaster profile)
  editBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#2a0d00",
    paddingHorizontal: 20,
    height: 44,
  },
  editBannerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  editBannerLabel: { fontFamily: fonts.bodyMedium, fontSize: 12, color: "#D798DA" },
  editBannerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  editBannerDiscard: { paddingHorizontal: 12, paddingVertical: 6 },
  editBannerDiscardText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: "#FAF8F0" },
  editBannerSave: { backgroundColor: "#D798DA", borderRadius: 4, paddingHorizontal: 14, paddingVertical: 6 },
  editBannerSaveText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: "#351101" },

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

  // Avatar (Figma 116:1020 — 488.84x501.72, borderRadius 5)
  avatarWrap: {
    width: "34%",
    aspectRatio: 488.84 / 501.72,
    maxWidth: 489,
    borderRadius: 5,
    overflow: "hidden",
    position: "relative",
  } as any,
  avatarWrapNarrow: { width: "60%", maxWidth: 300 },
  avatarImgZoomWrap: { width: "100%", height: "100%" } as any,
  avatarImg: { width: "100%", height: "100%" } as any,
  avatarFallback: {
    width: "100%",
    height: "100%",
    backgroundColor: "#EFE9DB",
    alignItems: "center",
    justifyContent: "center",
  } as any,
  avatarLetter: { fontFamily: fonts.displayRegular, fontSize: 48, color: "#351101" },
  avatarDragHint: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    alignItems: "center",
    transform: [{ translateY: -10 }],
  } as any,
  avatarDragHintText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: "#FAF8F0",
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
  avatarEditText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#FAF8F0" },

  // Info column (Figma 202:2831 — 291x330.7)
  infoCol: { flex: 1, justifyContent: "center" } as any,
  infoColNarrow: { alignItems: "center" } as any,
  // Name (Figma 116:777 — Canela Text Regular 56.804px, lineHeight 66, #351101)
  displayName: {
    fontFamily: fonts.displayRegular,
    fontSize: 56.8,
    color: "#351101",
    lineHeight: 66,
  },
  // Bio (Figma 116:776 — Inter Regular 12px, lineHeight 18, #684F44)
  bio: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: "#684F44",
    marginTop: 4,
    lineHeight: 18,
  },
  // Separator lines (Figma: 280.964px wide, #D7D1C4)
  divider: {
    height: 1,
    backgroundColor: "#D7D1C4",
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
  infoText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: "#351101" },

  // In-place editing — rounded light boxes (not underlines)
  inlineEdit: {
    backgroundColor: "#EFE9DB",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  inlineEditSmall: {
    backgroundColor: "#EFE9DB",
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    minWidth: 60,
    maxWidth: 150,
  },
  editFieldLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    color: "#A09580",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  chipEditRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  miniChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "rgba(215,209,196,0.3)",
  },
  miniChipActive: { backgroundColor: "#D798DA" },
  miniChipText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#684F44" },
  miniChipTextActive: { color: "#351101" },

  // Tab bar — left edge aligns with profile image left edge (same padding as hero)
  tabBar: {
    flexDirection: "row",
    alignItems: "stretch",
    alignSelf: "center",
    width: "100%",
    maxWidth: 860,
    backgroundColor: "#FAF8F0",
    height: 80,
    gap: 48,
    borderTopWidth: 1,
    borderTopColor: "rgba(215,209,196,0.5)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(215,209,196,0.5)",
  },
  tab: { justifyContent: "center", position: "relative" } as any,
  tabText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: "#A09580", letterSpacing: 0.5, textTransform: "uppercase" },
  tabTextActive: { color: "#351101" },
  tabUnderline: { position: "absolute", bottom: -1, left: 0, right: 0, height: 4, backgroundColor: "#351101" } as any,

  tabContent: { paddingTop: 20, alignSelf: "center", width: "100%", maxWidth: 860, minHeight: 2400, paddingBottom: 100 } as any,
  postDivider: { height: 1, backgroundColor: "rgba(215,209,196,0.5)", marginVertical: 4 },
  composeWrap: { paddingHorizontal: 20, marginBottom: 12 },

  // Shelf sub-tabs
  shelfSubTabs: { flexDirection: "row", gap: 32, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: "rgba(215,209,196,0.3)", marginBottom: 16 },
  shelfSubTab: { position: "relative", paddingBottom: 8 } as any,
  shelfSubTabText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#A09580" },
  shelfSubTabTextActive: { color: "#351101" },
  shelfSubTabUnderline: { position: "absolute", bottom: -1, left: 0, right: 0, height: 3, backgroundColor: "#351101" } as any,

  // Following list
  followRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(215,209,196,0.3)" },
  followAvatar: { width: 36, height: 36, borderRadius: 18, overflow: "hidden" } as any,
  followAvatarFb: { backgroundColor: "#351101", alignItems: "center", justifyContent: "center" } as any,
  followAvatarLetter: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: "#FAF8F0" },
  followInfo: { flex: 1 },
  followName: { fontFamily: fonts.bodyMedium, fontSize: 14, color: "#351101" },
  followMeta: { fontFamily: fonts.bodyRegular, fontSize: 11, color: "#A09580", marginTop: 2 },
  followingBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, width: 88, height: 27, borderRadius: 2, backgroundColor: "#D798DA", borderWidth: 1.5, borderColor: "#D798DA" },
  followingBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: "#351101" },

  // FAB
  fab: { position: "absolute", bottom: 28, right: 28, width: 52, height: 52, borderRadius: 26, backgroundColor: "#351101", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 4 } as any,


  // Drink dot (in drink picker modal)
  drinkDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#D7D1C4" },
  drinkDotActive: { backgroundColor: "#D798DA" },

  // Followers modal
  followersOverlay: { flex: 1, backgroundColor: "rgba(104,79,68,0.6)", justifyContent: "center", alignItems: "center" },
  followersModal: { width: "90%", maxWidth: 440, backgroundColor: "#FAF8F0", borderRadius: 12, padding: 20, maxHeight: "70%" } as any,
  followersHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  followersTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: "#351101" },
  followersEmpty: { fontFamily: fonts.bodyRegular, fontSize: 13, color: "#A09580", textAlign: "center", paddingVertical: 32 },
  followerDivider: { height: 1, backgroundColor: "rgba(215,209,196,0.3)", marginVertical: 2 },
  followerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  followerInfo: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  followerAvatar: { width: 32, height: 32, borderRadius: 16, overflow: "hidden" } as any,
  followerAvatarFb: { backgroundColor: "#351101", alignItems: "center", justifyContent: "center" } as any,
  followerAvatarLetter: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: "#FAF8F0" },
  followerName: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#351101" },
  followerLocation: { fontFamily: fonts.bodyRegular, fontSize: 11, color: "#A09580" },
  followerFollowBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderColor: "#351101", borderRadius: 2, paddingHorizontal: 10, paddingVertical: 4 },
  followerFollowBtnActive: { backgroundColor: "#D798DA", borderColor: "#D798DA" },
  followerFollowBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: "#351101" },
});
