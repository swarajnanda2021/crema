/**
 * CRUD Utopia — café profile page. Mirrors roaster/[slug].tsx structure:
 * split panel layout, three tabs (Bio / Coffee Menu / Posts), owner edit mode.
 * See CRUD_UTOPIA.md at repo root.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View, Text, ScrollView, Pressable, StyleSheet, TextInput,
  ActivityIndicator, useWindowDimensions, Image as RNImage,
  Platform, Animated, Easing, Modal,
} from "react-native";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Check, Coffee, Camera, ExternalLink, PenLine, Plus, Trash2, Users } from "lucide-react-native";
import Svg, { Path } from "react-native-svg";
import { t } from "../../src/tokens/useTokens";
import { apiFetchRaw, resolveUploadUrl } from "../../src/api/client";
import { openExternal } from "../../src/utils/openExternal";
import { useAuth } from "../../src/hooks/useAuth";
import Navbar from "../../src/components/Navbar";
import ScannerModal from "../../src/components/ScannerModal";
import ImageUploadModal from "../../src/components/ImageUploadModal";
import PostPromptModal from "../../src/components/PostPromptModal";
import ComposePost from "../../src/components/ComposePost";
import PostCard from "../../src/components/domain/PostCard";
import BusinessAnalytics from "../../src/components/analytics/BusinessAnalytics";
import CremaLogo from "../../src/components/CremaLogo";
import { openPostModal } from "../../src/components/primitives";
import type { Cafe, CafeMenuItem } from "../../src/resources/types";

const NAVBAR_H = 72;

// ── Local SVG icons matching roaster profile language ───────────────────────

function MapPinIcon({ color = t.color.accent }: { color?: string }) {
  return (
    <Svg width={12} height={16} viewBox="0 0 13.9649 17.3005" fill="none">
      <Path d="M0.75 6.9138C0.75 11.2337 4.52909 14.806 6.20182 16.1756C6.44121 16.3716 6.56234 16.4708 6.74095 16.5211C6.88002 16.5602 7.0847 16.5602 7.22378 16.5211C7.40271 16.4707 7.523 16.3725 7.76329 16.1757C9.43602 14.8061 13.2149 11.234 13.2149 6.9142C13.2149 5.2794 12.5583 3.71137 11.3895 2.55539C10.2207 1.39942 8.63552 0.75 6.98257 0.75C5.32961 0.75 3.74427 1.39952 2.57545 2.55549C1.40664 3.71147 0.75 5.27901 0.75 6.9138Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.20178 6.09214C5.20178 7.0756 5.99903 7.87285 6.98249 7.87285C7.96595 7.87285 8.76321 7.0756 8.76321 6.09214C8.76321 5.10868 7.96595 4.31142 6.98249 4.31142C5.99903 4.31142 5.20178 5.10868 5.20178 6.09214Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ExternalLinkIcon({ color = t.color.accent }: { color?: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 15.5 15.5" fill="none">
      <Path d="M5.41685 1.68333H3.73685C2.69142 1.68333 2.16831 1.68333 1.76901 1.88679C1.41778 2.06575 1.13242 2.35111 0.953455 2.70234C0.750001 3.10165 0.750001 3.62475 0.750001 4.67018V11.7635C0.750001 12.8089 0.750001 13.3314 0.953455 13.7307C1.13242 14.0819 1.41778 14.3678 1.76901 14.5467C2.16792 14.75 2.69039 14.75 3.73378 14.75H10.8329C11.8763 14.75 12.398 14.75 12.7969 14.5467C13.1481 14.3678 13.4344 14.0817 13.6134 13.7304C13.8167 13.3315 13.8167 12.8096 13.8167 11.7662V10.0833M14.75 5.41667V0.75M14.75 0.75H10.0833M14.75 0.75L8.21667 7.28333" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function InstagramIcon({ color = t.color.accent }: { color?: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 16 16" fill="none">
      <Path d="M11 1H5C2.79086 1 1 2.79086 1 5V11C1 13.2091 2.79086 15 5 15H11C13.2091 15 15 13.2091 15 11V5C15 2.79086 13.2091 1 11 1Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M11.5 7.6C11.6233 8.4317 11.4811 9.2811 11.0938 10.0277C10.7064 10.7743 10.0938 11.3796 9.343 11.7574C8.5922 12.1352 7.7412 12.2664 6.9114 12.1322C6.0815 11.9979 5.3146 11.6051 4.7204 11.0094C4.1262 10.4137 3.7355 9.6457 3.6038 8.8157C3.4721 7.9856 3.6063 7.135 3.987 6.3854C4.3677 5.6358 4.9748 5.0249 5.7224 4.6398C6.4699 4.2547 7.3197 4.1149 8.151 4.24C8.999 4.3676 9.7837 4.7626 10.39 5.367C10.9963 5.9714 11.3934 6.7551 11.5 7.6Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M11.5 4.5H11.508" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function UsersMetaIcon() {
  return <Users size={14} color={t.color.accent} strokeWidth={2} />;
}

// Same heart glyph as user profile's HeroHeartIcon — pink accent,
// matched stroke. Keeps the design language consistent across
// profiles and café pages.
function CafeHeartIcon() {
  return (
    <Svg width={14} height={13} viewBox="0 0 16.97 16" fill="none">
      <Path
        d="M8.483 3.616C6.765 -0.649 0.75 -0.195 0.75 5.256C0.75 10.708 8.483 15.25 8.483 15.25C8.483 15.25 16.217 10.708 16.217 5.256C16.217 -0.195 10.202 -0.649 8.483 3.616Z"
        stroke={t.color.accent}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function CafeFollowButton({
  following, onToggle,
}: {
  following: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable onPress={onToggle} style={[fb.btn, following && fb.btnFollowing]}>
      {!following && <Plus size={10} color={t.color["text.on-dark"]} strokeWidth={2.5} />}
      {following && <Check size={10} color={t.color["text.primary"]} strokeWidth={2.5} />}
      <Text style={[fb.text, following && fb.textFollowing]}>
        {following ? "Following" : "Follow"}
      </Text>
    </Pressable>
  );
}

const fb = StyleSheet.create({
  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 4, width: 71, height: 27, borderRadius: 2,
    borderWidth: 1.5, borderColor: t.color["text.on-dark"],
  },
  btnFollowing: { width: 88, backgroundColor: t.color.accent, borderColor: t.color.accent },
  text: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.on-dark"] },
  textFollowing: { color: t.color["text.primary"] },
});

function formatSeasonal(open: number | null, close: number | null): string {
  if (open == null || close == null) return "Open year-round";
  const openName = MONTHS[Math.max(0, Math.min(11, open - 1))];
  const closeName = MONTHS[Math.max(0, Math.min(11, close - 1))];
  return `Open ${openName}–${closeName}`;
}
const DAYS_OF_WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

type TabKey = "bio" | "menu" | "posts" | "analytics";

const TAB_LABEL: Record<TabKey, string> = {
  bio: "BIO",
  menu: "COFFEE MENU",
  posts: "POSTS",
  analytics: "ANALYTICS",
};

export default function CafeDetailPage() {
  const { slug, edit } = useLocalSearchParams<{ slug: string; edit?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { width: winW, height: winH } = useWindowDimensions();

  const [cafe, setCafe] = useState<Cafe | null>(null);
  const [menu, setMenu] = useState<CafeMenuItem[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("bio");

  // Owner state
  const isOwner = user?.account_type === "cafe" && user?.cafe_slug === slug;
  const [isEditing, setIsEditing] = useState(false);
  const [editAbout, setEditAbout] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editInstagram, setEditInstagram] = useState("");
  const [editWebsite, setEditWebsite] = useState("");
  const [editCover, setEditCover] = useState<string>("");
  const [editLogo, setEditLogo] = useState<string>("");
  const [showCoverUpload, setShowCoverUpload] = useState(false);
  const [showLogoUpload, setShowLogoUpload] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Hero (cover) drag-to-reposition — mirrors roaster hero pattern.
  const [editHeroCropX, setEditHeroCropX] = useState(50);
  const [editHeroCropY, setEditHeroCropY] = useState(50);
  const [editHeroZoom, setEditHeroZoom] = useState(1);
  const [heroImgAspect, setHeroImgAspect] = useState(1.5);
  const [heroContW, setHeroContW] = useState(0);
  const [heroContH, setHeroContH] = useState(0);
  const [isDraggingHero, setIsDraggingHero] = useState(false);
  const heroWrapRef = useRef<View>(null);
  const heroDragRef = useRef({ x: 0, y: 0, cropX: 50, cropY: 50 });

  // Logo drag-to-reposition (same pattern as the user avatar, since the
  // logo renders as a circle in the navbar and on the profile).
  const [editLogoCropX, setEditLogoCropX] = useState(50);
  const [editLogoCropY, setEditLogoCropY] = useState(50);
  const [editLogoZoom, setEditLogoZoom] = useState(1);
  const [logoImgAspect, setLogoImgAspect] = useState(1);
  const [logoContW, setLogoContW] = useState(0);
  const [logoContH, setLogoContH] = useState(0);
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);
  const logoWrapRef = useRef<View>(null);
  const logoDragRef = useRef({ x: 0, y: 0, cropX: 50, cropY: 50 });

  // Seasonal + loyalty editables
  const [editSeasonalOpen, setEditSeasonalOpen] = useState<number | null>(null);
  const [editSeasonalClose, setEditSeasonalClose] = useState<number | null>(null);
  const [editStampsEnabled, setEditStampsEnabled] = useState(true);
  const [editStampTarget, setEditStampTarget] = useState(10);
  const [editStampReward, setEditStampReward] = useState("Free coffee");
  const [showSeasonalPicker, setShowSeasonalPicker] = useState(false);
  const [showRewardPicker, setShowRewardPicker] = useState(false);

  // Follow state (café can be followed just like a roaster; target_type
  // discriminates on the follows table).
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);

  // Two people-list modals, same pattern as the roaster profile's
  // followers modal. Lazy-fetch on open so the café page loads fast
  // even when both lists are big.
  const [showFollowersModal, setShowFollowersModal] = useState(false);
  const [followersList, setFollowersList] = useState<any[]>([]);
  const [showRegularsModal, setShowRegularsModal] = useState(false);
  const [regularsList, setRegularsList] = useState<any[]>([]);

  // Post-prompt state — after a menu mutation succeeds we offer the owner
  // a chance to announce the change in a post.
  const [postPrompt, setPostPrompt] = useState<{
    title: string; body: string; teaser: string;
  } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerPrefill, setComposerPrefill] = useState<string>("");

  // Auto-open edit mode from ?edit=1 query (set by navbar dropdown)
  useEffect(() => { if (edit === "1" && isOwner) setIsEditing(true); }, [edit, isOwner]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cafeRes, menuRes, postsRes] = await Promise.all([
        apiFetchRaw<any>(`/cafe_profiles/${slug}`),
        apiFetchRaw<any>(`/cafe_profiles/${slug}/cafe_menu_items?limit=50`).catch(() => ({ data: [] })),
        apiFetchRaw<any>(`/posts?limit=50`).catch(() => ({ data: [] })),
      ]);
      const cafeData = cafeRes?.data ?? cafeRes;
      const menuData = menuRes?.data ?? menuRes;
      const postsData = postsRes?.data ?? postsRes;

      setCafe(cafeData);
      setMenu(Array.isArray(menuData) ? menuData : []);
      // Filter posts: own (post.cafe_slug == slug) or mentioning
      const ownPosts = (Array.isArray(postsData) ? postsData : []).filter((p: any) => p.cafe_slug === slug);
      setPosts(ownPosts);

      if (cafeData) {
        setEditAbout(cafeData.about_blurb || "");
        setEditAddress(cafeData.address || "");
        setEditInstagram(cafeData.instagram_handle || "");
        setEditWebsite(cafeData.website || "");
        setEditCover(cafeData.cover_image_url || "");
        setEditLogo(cafeData.logo_url || "");
        setEditHeroCropX(cafeData.hero_crop_x ?? 50);
        setEditHeroCropY(cafeData.hero_crop_y ?? 50);
        setEditHeroZoom(cafeData.hero_zoom ?? 1);
        setEditLogoCropX(cafeData.logo_crop_x ?? 50);
        setEditLogoCropY(cafeData.logo_crop_y ?? 50);
        setEditLogoZoom(cafeData.logo_zoom ?? 1);
        setEditSeasonalOpen(cafeData.seasonal_open_month ?? null);
        setEditSeasonalClose(cafeData.seasonal_close_month ?? null);
        setEditStampsEnabled(cafeData.stamps_enabled === 1);
        setEditStampTarget(cafeData.stamp_target ?? 10);
        setEditStampReward(cafeData.stamp_reward || "Free coffee");
      }
    } catch (e) {
      console.warn("Café fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Follow status + count — mirrors the roaster page. Café slugs live on
  // the same `follows` table (uniqueness is per (user, slug) regardless
  // of target kind) so the existing /follow-status + /followers endpoints
  // work with the café slug directly.
  useEffect(() => {
    apiFetchRaw<any>(`/follow-status/${slug}`)
      .then((res) => setFollowing(Boolean((res?.data ?? res)?.following)))
      .catch(() => {});
    apiFetchRaw<any>(`/followers/${slug}`)
      .then((res) => {
        const d = res?.data ?? res;
        setFollowerCount(d?.follower_count || 0);
      })
      .catch(() => {});
  }, [slug]);

  const handleFollowToggle = useCallback(async () => {
    if (!user) { router.push("/auth"); return; }
    try {
      const raw = await apiFetchRaw<any>(`/roasters/${slug}/follow`, { method: "POST" });
      const d = raw?.data ?? raw;
      setFollowing(Boolean(d.following));
      setFollowerCount(d.follower_count ?? followerCount);
    } catch (e) {
      console.warn("Follow toggle failed:", e);
    }
  }, [slug, user, router, followerCount]);

  const handleSave = useCallback(async () => {
    try {
      await apiFetchRaw(`/cafe_profiles/${slug}`, {
        method: "PUT",
        body: JSON.stringify({
          about_blurb: editAbout,
          address: editAddress,
          instagram_handle: editInstagram || null,
          website: editWebsite || null,
          cover_image_url: editCover || null,
          logo_url: editLogo || null,
          hero_crop_x: editHeroCropX,
          hero_crop_y: editHeroCropY,
          hero_zoom: editHeroZoom,
          logo_crop_x: editLogoCropX,
          logo_crop_y: editLogoCropY,
          logo_zoom: editLogoZoom,
          seasonal_open_month: editSeasonalOpen,
          seasonal_close_month: editSeasonalClose,
          stamps_enabled: editStampsEnabled ? 1 : 0,
          stamp_target: editStampTarget,
          stamp_reward: editStampReward || "Free coffee",
        }),
      });
      setIsEditing(false);
      await fetchAll();
    } catch (e) {
      console.warn("Café save failed:", e);
    }
  }, [
    slug, editAbout, editAddress, editInstagram, editWebsite, editCover, editLogo,
    editHeroCropX, editHeroCropY, editHeroZoom,
    editLogoCropX, editLogoCropY, editLogoZoom,
    editSeasonalOpen, editSeasonalClose,
    editStampsEnabled, editStampTarget, editStampReward,
    fetchAll,
  ]);

  // ── Hero drag-to-reposition (mirrors the roaster hero pattern) ──────────
  const handleHeroDragStart = useCallback((e: any) => {
    if (!isEditing) return;
    e.preventDefault();
    heroDragRef.current = { x: e.clientX, y: e.clientY, cropX: editHeroCropX, cropY: editHeroCropY };
    setIsDraggingHero(true);
    const handleMove = (ev: MouseEvent) => {
      const el = heroWrapRef.current as unknown as HTMLElement;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setEditHeroCropX(Math.max(0, Math.min(100,
        heroDragRef.current.cropX - ((ev.clientX - heroDragRef.current.x) / rect.width) * 100)));
      setEditHeroCropY(Math.max(0, Math.min(100,
        heroDragRef.current.cropY - ((ev.clientY - heroDragRef.current.y) / rect.height) * 100)));
    };
    const handleUp = () => {
      setIsDraggingHero(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [isEditing, editHeroCropX, editHeroCropY]);

  const handleHeroWheel = useCallback((e: any) => {
    if (!isEditing || !e.ctrlKey) return;
    e.preventDefault();
    setEditHeroZoom((z) =>
      Math.round(Math.max(1, Math.min(5, z - e.deltaY * 0.01)) * 100) / 100,
    );
  }, [isEditing]);

  // ── Logo drag-to-reposition — same math, smaller container ──────────────
  const handleLogoDragStart = useCallback((e: any) => {
    if (!isEditing) return;
    e.preventDefault();
    logoDragRef.current = { x: e.clientX, y: e.clientY, cropX: editLogoCropX, cropY: editLogoCropY };
    setIsDraggingLogo(true);
    const handleMove = (ev: MouseEvent) => {
      const el = logoWrapRef.current as unknown as HTMLElement;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setEditLogoCropX(Math.max(0, Math.min(100,
        logoDragRef.current.cropX - ((ev.clientX - logoDragRef.current.x) / rect.width) * 100)));
      setEditLogoCropY(Math.max(0, Math.min(100,
        logoDragRef.current.cropY - ((ev.clientY - logoDragRef.current.y) / rect.height) * 100)));
    };
    const handleUp = () => {
      setIsDraggingLogo(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [isEditing, editLogoCropX, editLogoCropY]);

  const handleLogoWheel = useCallback((e: any) => {
    if (!isEditing || !e.ctrlKey) return;
    e.preventDefault();
    setEditLogoZoom((z) =>
      Math.round(Math.max(1, Math.min(5, z - e.deltaY * 0.01)) * 100) / 100,
    );
  }, [isEditing]);

  // Seasonal status text
  const seasonalText = useMemo(() => {
    if (!cafe) return null;
    const open = cafe.seasonal_open_month;
    const close = cafe.seasonal_close_month;
    if (open == null || close == null) return "Open year-round";
    return `Open ${MONTHS[open - 1]}–${MONTHS[close - 1]} (closed ${MONTHS[close % 12]}–${MONTHS[open - 2 < 0 ? 11 : open - 2]})`;
  }, [cafe]);

  // Layout: split panel on web (>800px), stacked on mobile
  const isWide = winW >= 800;

  if (loading || !cafe) {
    // Match the rest of the site's buffering language — pulsing
    // Crema logo instead of a generic spinner so profile switches
    // into a café page read as a real site transition.
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Navbar />
        <View style={s.loadingWrap}>
          <CremaLogo width={180} height={38} />
        </View>
      </>
    );
  }

  const heroImage = cafe.cover_image_url ? resolveUploadUrl(cafe.cover_image_url) : null;
  const heroFallback = `https://www.google.com/s2/favicons?domain=${cafe.instagram_handle || cafe.website || ""}&sz=128`;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Navbar />

      {isOwner && isEditing && (
        <View style={s.editBanner}>
          <View style={s.editBannerLeft}>
            <PenLine size={12} color={t.color.accent} />
            <Text style={s.editBannerLabel}>Editing café</Text>
          </View>
          <View style={s.editBannerRight}>
            <Pressable onPress={() => setIsEditing(false)} style={s.discardBtn}>
              <Text style={s.discardText}>Discard</Text>
            </Pressable>
            <Pressable onPress={handleSave} style={s.saveBtn}>
              <Text style={s.saveText}>Save changes</Text>
            </Pressable>
          </View>
        </View>
      )}

      {isWide ? (
        // Wide layout: full-height row with two independent scroll columns (matches roaster page)
        <View style={[s.pageContainer, { height: winH - NAVBAR_H }]}>
          <View style={s.leftPanelWide}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.leftPanelInner}>
            <Pressable onPress={() => router.back()} style={s.backBtn}>
              <ArrowLeft size={16} color={t.color["text.on-dark"]} />
              <Text style={s.backText}>Back</Text>
            </Pressable>

            {/* Logo — circular, drag-to-reposition + pinch-to-zoom in edit mode.
                Same math as the user avatar / roaster hero crop. */}
            <View
              ref={logoWrapRef}
              style={[
                s.logoWrap,
                isEditing && (isDraggingLogo ? ({ cursor: "grabbing" } as any) : ({ cursor: "grab" } as any)),
              ]}
              onLayout={(e) => { setLogoContW(e.nativeEvent.layout.width); setLogoContH(e.nativeEvent.layout.height); }}
              {...(isEditing && Platform.OS === "web" ? { onMouseDown: handleLogoDragStart, onWheel: handleLogoWheel } : {})}
            >
              {(isEditing ? editLogo : cafe.logo_url) ? (() => {
                const cW = logoContW || 120, cH = logoContH || 120;
                const zoom = isEditing ? editLogoZoom : (cafe.logo_zoom ?? 1);
                const cx = isEditing ? editLogoCropX : (cafe.logo_crop_x ?? 50);
                const cy = isEditing ? editLogoCropY : (cafe.logo_crop_y ?? 50);
                const contAspect = cW / cH;
                const MIN_OVER = 1.2;
                let iW: number, iH: number;
                if (logoImgAspect > contAspect) { iH = cH * MIN_OVER * zoom; iW = iH * logoImgAspect; }
                else { iW = cW * MIN_OVER * zoom; iH = iW / logoImgAspect; }
                const tx = -(iW - cW) * (cx / 100), ty = -(iH - cH) * (cy / 100);
                return (
                  <Image
                    source={{ uri: resolveUploadUrl(isEditing ? editLogo : cafe.logo_url || "") }}
                    style={{ position: "absolute", width: iW, height: iH, left: tx, top: ty } as any}
                    contentFit="fill"
                    onLoad={(e: any) => { const src = e?.source; if (src?.width && src?.height) setLogoImgAspect(src.width / src.height); }}
                  />
                );
              })() : (
                <View style={s.logoFallback}>
                  <Text style={s.logoInitial}>{(cafe.name || "?")[0].toUpperCase()}</Text>
                </View>
              )}
              {isEditing && !isDraggingLogo && (editLogo || cafe.logo_url) && (
                <View style={s.logoDragHint} pointerEvents="none">
                  <Text style={s.logoDragHintText}>Drag · Pinch to zoom</Text>
                </View>
              )}
              {isEditing && (
                <Pressable onPress={() => setShowLogoUpload(true)} style={s.logoEditBtn} hitSlop={8}>
                  <Camera size={14} color={t.color["text.on-dark"]} />
                </Pressable>
              )}
            </View>

            <Text style={s.cafeName}>{cafe.name}</Text>

            {isEditing ? (
              <TextInput
                style={[s.aboutText, s.inlineEdit, { minHeight: 60 }]}
                value={editAbout}
                onChangeText={setEditAbout}
                multiline
                placeholder="Tell people about your café…"
                placeholderTextColor="rgba(199,186,165,0.4)"
              />
            ) : cafe.about_blurb ? (
              <Text style={s.aboutBlurb}>{cafe.about_blurb}</Text>
            ) : null}

            {/* Seasonal badge — tappable in edit mode to open picker */}
            {(isEditing || seasonalText) && (
              <Pressable
                onPress={isEditing ? () => setShowSeasonalPicker(true) : undefined}
                style={[s.seasonalBadge, isEditing && s.editableChip]}
              >
                <Text style={s.seasonalText}>
                  {isEditing
                    ? formatSeasonal(editSeasonalOpen, editSeasonalClose)
                    : seasonalText}
                </Text>
                {isEditing && <PenLine size={10} color={t.color["text.on-dark"]} strokeWidth={2} />}
              </Pressable>
            )}

            {/* Meta rows — match roaster profile pattern: icon + Inter medium, no underline */}
            <View style={s.metaRows}>
              {(cafe.address || isEditing) && (
                isEditing ? (
                  <View style={s.metaItem}>
                    <MapPinIcon />
                    <TextInput
                      style={[s.metaText, s.inlineEditMeta]}
                      value={editAddress}
                      onChangeText={setEditAddress}
                      placeholder="Address"
                      placeholderTextColor="rgba(199,186,165,0.4)"
                    />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => cafe.address && openExternal(`https://maps.google.com/?q=${encodeURIComponent(cafe.address)}`)}
                    style={s.metaItem}
                  >
                    <MapPinIcon />
                    <Text style={s.metaText} numberOfLines={2}>{cafe.address}</Text>
                  </Pressable>
                )
              )}
              {(cafe.instagram_handle || isEditing) && (
                isEditing ? (
                  <View style={s.metaItem}>
                    <InstagramIcon />
                    <TextInput
                      style={[s.metaText, s.inlineEditMeta]}
                      value={editInstagram}
                      onChangeText={setEditInstagram}
                      placeholder="Instagram handle"
                      placeholderTextColor="rgba(199,186,165,0.4)"
                    />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => openExternal(`https://instagram.com/${cafe.instagram_handle}`)}
                    style={s.metaItem}
                  >
                    <InstagramIcon />
                    <Text style={s.metaText}>@{cafe.instagram_handle}</Text>
                  </Pressable>
                )
              )}
              {(cafe.website || isEditing) && (
                isEditing ? (
                  <View style={s.metaItem}>
                    <ExternalLinkIcon />
                    <TextInput
                      style={[s.metaText, s.inlineEditMeta]}
                      value={editWebsite}
                      onChangeText={setEditWebsite}
                      placeholder="Website URL"
                      placeholderTextColor="rgba(199,186,165,0.4)"
                    />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => cafe.website && openExternal(cafe.website)}
                    style={s.metaItem}
                  >
                    <ExternalLinkIcon />
                    <Text style={s.metaText}>Website</Text>
                  </Pressable>
                )
              )}
              {/* Followers + Regulars — side-by-side, both tappable.
                 Followers use the existing list endpoint; regulars
                 use /cafes/{slug}/regulars. Both open a person-list
                 modal (same pattern as roaster profile). */}
              <View style={[s.metaItem, { gap: 16, flexDirection: "row" }]}>
                <Pressable
                  onPress={async () => {
                    setShowFollowersModal(true);
                    try {
                      const res = await apiFetchRaw<any>(`/followers/${slug}`);
                      const d = res?.data ?? res;
                      setFollowersList(Array.isArray(d?.followers) ? d.followers : []);
                    } catch { setFollowersList([]); }
                  }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <UsersMetaIcon />
                  <Text style={s.metaText}>
                    {followerCount} {followerCount === 1 ? "follower" : "followers"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    setShowRegularsModal(true);
                    try {
                      const res = await apiFetchRaw<any>(`/cafes/${slug}/regulars`);
                      const d = res?.data ?? res;
                      setRegularsList(Array.isArray(d) ? d : []);
                    } catch { setRegularsList([]); }
                  }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <CafeHeartIcon />
                  <Text style={s.metaText}>
                    {cafe.love_count || 0} {cafe.love_count === 1 ? "regular" : "regulars"}
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* §2.17 — the wholesale procurement block that used to live
               here (monthly_volume_kg / open_to_new_roasters / procurement_note)
               was removed. Once an inquiry thread exists, the conversation
               carries the context; the public profile block was a
               pre-emptive sales sheet the café didn't ask to fill. DB
               columns remain for legacy rows but are no longer captured
               or displayed. */}

            {/* Follow button — only shown to non-owners, mirrors roaster */}
            {!isOwner && (
              <View style={{ marginTop: 16, flexDirection: "row" }}>
                <CafeFollowButton following={following} onToggle={handleFollowToggle} />
              </View>
            )}

            {/* Owner triggers edit mode via the navbar profile dropdown — no inline button needed */}
          </ScrollView>
          </View>

          {/* RIGHT PANEL — independent scroll so columns are flush full-height */}
          <View style={s.rightPanelWide}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }}>
            <View
              ref={heroWrapRef}
              style={[
                s.heroWrap,
                isEditing && (isDraggingHero ? ({ cursor: "grabbing" } as any) : ({ cursor: "grab" } as any)),
              ]}
              onLayout={(e) => { setHeroContW(e.nativeEvent.layout.width); setHeroContH(e.nativeEvent.layout.height); }}
              {...(isEditing && Platform.OS === "web" ? { onMouseDown: handleHeroDragStart, onWheel: handleHeroWheel } : {})}
            >
              {(isEditing ? editCover : cafe.cover_image_url) ? (() => {
                const cW = heroContW || 800, cH = heroContH || 334;
                const zoom = isEditing ? editHeroZoom : (cafe.hero_zoom ?? 1);
                const cx = isEditing ? editHeroCropX : (cafe.hero_crop_x ?? 50);
                const cy = isEditing ? editHeroCropY : (cafe.hero_crop_y ?? 50);
                const contAspect = cW / cH;
                const MIN_OVER = 1.15;
                let iW: number, iH: number;
                if (heroImgAspect > contAspect) { iH = cH * MIN_OVER * zoom; iW = iH * heroImgAspect; }
                else { iW = cW * MIN_OVER * zoom; iH = iW / heroImgAspect; }
                const tx = -(iW - cW) * (cx / 100), ty = -(iH - cH) * (cy / 100);
                return (
                  <Image
                    source={{ uri: resolveUploadUrl(isEditing ? editCover : cafe.cover_image_url || "") }}
                    style={{ position: "absolute", width: iW, height: iH, left: tx, top: ty } as any}
                    contentFit="fill"
                    onLoad={(e: any) => { const src = e?.source; if (src?.width && src?.height) setHeroImgAspect(src.width / src.height); }}
                  />
                );
              })() : (
                <View style={s.heroFallback}>
                  <Coffee size={64} color={t.color["text.muted"]} />
                </View>
              )}
              {isEditing && !isDraggingHero && (editCover || cafe.cover_image_url) && (
                <View style={s.heroDragHint} pointerEvents="none">
                  <Text style={s.heroDragHintText}>Drag to reposition · Pinch to zoom</Text>
                </View>
              )}
              {isEditing && (
                <Pressable onPress={() => setShowCoverUpload(true)} style={s.heroEditBtn}>
                  <Camera size={14} color={t.color["text.on-dark"]} />
                  <Text style={s.heroEditBtnText}>Change cover</Text>
                </Pressable>
              )}
            </View>

            <View style={s.rightInner}>
              <View style={s.tabs}>
                {(
                  isOwner
                    ? ["bio", "menu", "posts", "analytics"] as TabKey[]
                    : ["bio", "menu", "posts"] as TabKey[]
                ).map((tab) => (
                  <Pressable key={tab} onPress={() => setActiveTab(tab)} style={s.tabBtn}>
                    <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
                      {TAB_LABEL[tab]}
                    </Text>
                    {activeTab === tab && <View style={s.tabUnderline} />}
                  </Pressable>
                ))}
              </View>

              {activeTab === "bio" && (
                <BioTab
                  cafe={cafe}
                  isOwner={isOwner}
                  isEditing={isEditing}
                  editStampsEnabled={editStampsEnabled}
                  onStampsEnabledChange={setEditStampsEnabled}
                  editStampTarget={editStampTarget}
                  onStampTargetChange={setEditStampTarget}
                  editStampReward={editStampReward}
                  onOpenRewardPicker={() => setShowRewardPicker(true)}
                  onScan={() => setShowScanner(true)}
                />
              )}
              {activeTab === "menu" && (
                <MenuTab
                  cafe_slug={slug}
                  menu={menu}
                  isOwner={isOwner}
                  isEditing={isEditing}
                  onChange={fetchAll}
                  onCatalogChange={(change, subject) => {
                    if (!isOwner) return;
                    const verbMap: Record<string, { title: string; verb: string }> = {
                      added:   { title: "Menu added", verb: "added" },
                      updated: { title: "Menu updated", verb: "updated" },
                      removed: { title: "Menu removed", verb: "removed" },
                    };
                    const info = verbMap[change] || verbMap.updated;
                    setPostPrompt({
                      title: info.title,
                      body: `You just ${info.verb} "${subject}" on the menu.`,
                      teaser:
                        change === "added"
                          ? `We just added ${subject} to the menu. Come give it a try!`
                          : change === "removed"
                          ? `${subject} has been taken off the menu for now.`
                          : `We've updated ${subject} on the menu.`,
                    });
                  }}
                />
              )}
              {activeTab === "posts" && (
                <PostsTab posts={posts} onRefresh={fetchAll} />
              )}
              {activeTab === "analytics" && isOwner && (
                <BusinessAnalytics kind="cafe" slug={slug} />
              )}
            </View>
          </ScrollView>
          </View>
        </View>
      ) : (
        // Narrow layout: single scroll, left panel stacked above right panel
        <ScrollView style={{ flex: 1, backgroundColor: t.color.bg }} contentContainerStyle={{ paddingBottom: 60 }}>
          <View style={s.leftPanel}>
            <Pressable onPress={() => router.back()} style={s.backBtn}>
              <ArrowLeft size={16} color={t.color["text.on-dark"]} />
              <Text style={s.backText}>Back</Text>
            </Pressable>
            <View
              ref={logoWrapRef}
              style={[
                s.logoWrap,
                isEditing && (isDraggingLogo ? ({ cursor: "grabbing" } as any) : ({ cursor: "grab" } as any)),
              ]}
              onLayout={(e) => { setLogoContW(e.nativeEvent.layout.width); setLogoContH(e.nativeEvent.layout.height); }}
              {...(isEditing && Platform.OS === "web" ? { onMouseDown: handleLogoDragStart, onWheel: handleLogoWheel } : {})}
            >
              {(isEditing ? editLogo : cafe.logo_url) ? (() => {
                const cW = logoContW || 120, cH = logoContH || 120;
                const zoom = isEditing ? editLogoZoom : (cafe.logo_zoom ?? 1);
                const cx = isEditing ? editLogoCropX : (cafe.logo_crop_x ?? 50);
                const cy = isEditing ? editLogoCropY : (cafe.logo_crop_y ?? 50);
                const contAspect = cW / cH;
                const MIN_OVER = 1.2;
                let iW: number, iH: number;
                if (logoImgAspect > contAspect) { iH = cH * MIN_OVER * zoom; iW = iH * logoImgAspect; }
                else { iW = cW * MIN_OVER * zoom; iH = iW / logoImgAspect; }
                const tx = -(iW - cW) * (cx / 100), ty = -(iH - cH) * (cy / 100);
                return (
                  <Image
                    source={{ uri: resolveUploadUrl(isEditing ? editLogo : cafe.logo_url || "") }}
                    style={{ position: "absolute", width: iW, height: iH, left: tx, top: ty } as any}
                    contentFit="fill"
                    onLoad={(e: any) => { const src = e?.source; if (src?.width && src?.height) setLogoImgAspect(src.width / src.height); }}
                  />
                );
              })() : (
                <View style={s.logoFallback}><Text style={s.logoInitial}>{(cafe.name || "?")[0].toUpperCase()}</Text></View>
              )}
              {isEditing && (
                <Pressable onPress={() => setShowLogoUpload(true)} style={s.logoEditBtn} hitSlop={8}>
                  <Camera size={14} color={t.color["text.on-dark"]} />
                </Pressable>
              )}
            </View>
            <Text style={s.cafeName}>{cafe.name}</Text>
            {isEditing ? (
              <TextInput style={[s.aboutText, s.inlineEdit, { minHeight: 60 }]} value={editAbout} onChangeText={setEditAbout} multiline placeholder="Tell people about your café…" placeholderTextColor="rgba(199,186,165,0.4)" />
            ) : cafe.about_blurb ? (
              <Text style={s.aboutBlurb}>{cafe.about_blurb}</Text>
            ) : null}
            {seasonalText && (
              <View style={s.seasonalBadge}><Text style={s.seasonalText}>{seasonalText}</Text></View>
            )}
            <View style={s.metaRows}>
              {cafe.address && (
                <Pressable onPress={() => openExternal(`https://maps.google.com/?q=${encodeURIComponent(cafe.address!)}`)} style={s.metaItem}>
                  <MapPinIcon /><Text style={s.metaText} numberOfLines={2}>{cafe.address}</Text>
                </Pressable>
              )}
              {cafe.instagram_handle && (
                <Pressable onPress={() => openExternal(`https://instagram.com/${cafe.instagram_handle}`)} style={s.metaItem}>
                  <InstagramIcon /><Text style={s.metaText}>@{cafe.instagram_handle}</Text>
                </Pressable>
              )}
              {cafe.website && (
                <Pressable onPress={() => openExternal(cafe.website!)} style={s.metaItem}>
                  <ExternalLinkIcon /><Text style={s.metaText}>Website</Text>
                </Pressable>
              )}
              <View style={[s.metaItem, { gap: 16, flexDirection: "row" }]}>
                <Pressable
                  onPress={async () => {
                    setShowFollowersModal(true);
                    try {
                      const res = await apiFetchRaw<any>(`/followers/${slug}`);
                      const d = res?.data ?? res;
                      setFollowersList(Array.isArray(d?.followers) ? d.followers : []);
                    } catch { setFollowersList([]); }
                  }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <UsersMetaIcon />
                  <Text style={s.metaText}>
                    {followerCount} {followerCount === 1 ? "follower" : "followers"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    setShowRegularsModal(true);
                    try {
                      const res = await apiFetchRaw<any>(`/cafes/${slug}/regulars`);
                      const d = res?.data ?? res;
                      setRegularsList(Array.isArray(d) ? d : []);
                    } catch { setRegularsList([]); }
                  }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <CafeHeartIcon />
                  <Text style={s.metaText}>
                    {cafe.love_count || 0} {cafe.love_count === 1 ? "regular" : "regulars"}
                  </Text>
                </Pressable>
              </View>
            </View>
            {!isOwner && (
              <View style={{ marginTop: 12, flexDirection: "row" }}>
                <CafeFollowButton following={following} onToggle={handleFollowToggle} />
              </View>
            )}
          </View>
          <View style={s.heroWrap}>
            {cafe.cover_image_url ? (
              <Image source={{ uri: resolveUploadUrl(cafe.cover_image_url) }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
            ) : (
              <View style={s.heroFallback}><Coffee size={64} color={t.color["text.muted"]} /></View>
            )}
          </View>
          <View style={s.rightInner}>
            <View style={s.tabs}>
              {(["bio", "menu", "posts"] as TabKey[]).map((tab) => (
                <Pressable key={tab} onPress={() => setActiveTab(tab)} style={s.tabBtn}>
                  <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
                    {tab === "bio" ? "BIO" : tab === "menu" ? "COFFEE MENU" : "POSTS"}
                  </Text>
                  {activeTab === tab && <View style={s.tabUnderline} />}
                </Pressable>
              ))}
            </View>
            {activeTab === "bio" && (
              <BioTab
                cafe={cafe}
                isOwner={isOwner}
                isEditing={isEditing}
                editStampsEnabled={editStampsEnabled}
                onStampsEnabledChange={setEditStampsEnabled}
                editStampTarget={editStampTarget}
                onStampTargetChange={setEditStampTarget}
                editStampReward={editStampReward}
                onOpenRewardPicker={() => setShowRewardPicker(true)}
                onScan={() => setShowScanner(true)}
              />
            )}
            {activeTab === "menu" && (
              <MenuTab
                cafe_slug={slug}
                menu={menu}
                isOwner={isOwner}
                isEditing={isEditing}
                onChange={fetchAll}
                onCatalogChange={(change, subject) => {
                  if (!isOwner) return;
                  const verbMap: Record<string, { title: string; verb: string }> = {
                    added:   { title: "Menu added", verb: "added" },
                    updated: { title: "Menu updated", verb: "updated" },
                    removed: { title: "Menu removed", verb: "removed" },
                  };
                  const info = verbMap[change] || verbMap.updated;
                  setPostPrompt({
                    title: info.title,
                    body: `You just ${info.verb} "${subject}" on the menu.`,
                    teaser:
                      change === "added"
                        ? `We just added ${subject} to the menu. Come give it a try!`
                        : change === "removed"
                        ? `${subject} has been taken off the menu for now.`
                        : `We've updated ${subject} on the menu.`,
                  });
                }}
              />
            )}
            {activeTab === "posts" && (<PostsTab posts={posts} onRefresh={fetchAll} />)}
            {activeTab === "analytics" && isOwner && (
              <BusinessAnalytics kind="cafe" slug={slug} />
            )}
          </View>
        </ScrollView>
      )}

      {showScanner && (
        <ScannerModal
          cafeSlug={slug}
          onClose={() => setShowScanner(false)}
        />
      )}

      <ImageUploadModal
        visible={showCoverUpload}
        title="Upload Cover Image"
        purpose="hero"
        currentUrl={editCover}
        onConfirm={(url) => setEditCover(url)}
        onClose={() => setShowCoverUpload(false)}
      />
      <ImageUploadModal
        visible={showLogoUpload}
        title="Upload Logo"
        purpose="logo"
        currentUrl={editLogo}
        onConfirm={(url) => setEditLogo(url)}
        onClose={() => setShowLogoUpload(false)}
      />

      {/* Seasonal picker — open/close months + year-round toggle */}
      <SeasonalPicker
        visible={showSeasonalPicker}
        openMonth={editSeasonalOpen}
        closeMonth={editSeasonalClose}
        onChange={(o, c) => { setEditSeasonalOpen(o); setEditSeasonalClose(c); }}
        onClose={() => setShowSeasonalPicker(false)}
      />

      {/* Reward picker — choose what "X stamps for a ___" is from the
          café's menu drinks (cafés can also type a custom reward). To
          turn the loyalty program off, hit the trash button on the bio
          stats sentence. */}
      <RewardPicker
        visible={showRewardPicker}
        value={editStampReward}
        menu={menu}
        onChange={setEditStampReward}
        onClose={() => setShowRewardPicker(false)}
      />

      {/* Post-prompt after a menu mutation */}
      <PostPromptModal
        visible={!!postPrompt}
        title={postPrompt?.title || ""}
        body={postPrompt?.body || ""}
        onConfirm={() => {
          setComposerPrefill(postPrompt?.teaser || "");
          setComposerOpen(true);
          setPostPrompt(null);
        }}
        onClose={() => setPostPrompt(null)}
      />

      {/* FAB — owner, posts tab. Same floating composer the roaster
          profile + feed use, so café owners get a standalone "write a
          post" entry point instead of only the menu-mutation-triggered
          PostPromptModal. */}
      {isOwner && !isEditing && activeTab === "posts" && (
        <Pressable onPress={() => { setComposerPrefill(""); setComposerOpen(true); }} style={s.fab}>
          <Plus size={22} color={t.color["text.on-dark"]} strokeWidth={2.5} />
        </Pressable>
      )}

      {/* Composer modal, pre-filled with the post-prompt teaser when
          launched from a catalog change, empty when opened from the FAB.
          Reuses the site's floating overlay pattern (same as the feed
          composer). */}
      <Modal
        visible={composerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setComposerOpen(false)}
      >
        <View style={s.composerOverlayWrap}>
          <Pressable style={s.composerOverlayBg} onPress={() => setComposerOpen(false)} />
          <View style={s.composerCard}>
            <ComposePost
              onSubmit={async (data) => {
                try {
                  // Posts published from a café owner are auto-tagged to
                  // their own café so followers see the update land under
                  // the café's feed.
                  await apiFetchRaw("/roaster-posts", {
                    method: "POST",
                    body: JSON.stringify({ ...data, cafe_slug: slug, roaster_slug: `user_${user?.id}` }),
                  });
                  setComposerOpen(false);
                  fetchAll();
                } catch (e) { console.warn("Post create failed:", e); }
              }}
              onCancel={() => setComposerOpen(false)}
              user={user}
              products={[]}
              initialData={{ body: composerPrefill, images: [], location: "" }}
            />
          </View>
        </View>
      </Modal>

      {/* Followers + Regulars list modals — tappable from the meta
         row in the left info column. Clicking a row navigates to
         that user's profile. */}
      <PeopleListModal
        visible={showFollowersModal}
        title={`Followers · ${followerCount}`}
        people={followersList}
        onClose={() => setShowFollowersModal(false)}
        onPick={(u) => { setShowFollowersModal(false); router.push(`/user/${u.username}` as any); }}
      />
      <PeopleListModal
        visible={showRegularsModal}
        title={`Regulars · ${cafe?.love_count || 0}`}
        people={regularsList}
        onClose={() => setShowRegularsModal(false)}
        onPick={(u) => { setShowRegularsModal(false); router.push(`/user/${u.username}` as any); }}
      />
    </>
  );
}

// ── People list modal (shared: followers + regulars) ───────────────────

function PeopleListModal({
  visible, title, people, onClose, onPick,
}: {
  visible: boolean; title: string;
  people: any[];
  onClose: () => void;
  onPick: (u: any) => void;
}) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={plm.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={plm.card}>
          <View style={plm.header}>
            <Text style={plm.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={plm.close}>×</Text>
            </Pressable>
          </View>
          {people.length === 0 ? (
            <Text style={plm.empty}>No one yet.</Text>
          ) : (
            <View>
              {people.map((u, idx) => (
                <View key={u.id || u.username}>
                  {idx > 0 && <View style={plm.divider} />}
                  <Pressable onPress={() => onPick(u)} style={plm.row}>
                    {u.avatar_url ? (
                      <Image
                        source={{ uri: resolveUploadUrl(u.avatar_url) }}
                        style={plm.avatar}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={[plm.avatar, plm.avatarFallback]}>
                        <Text style={plm.avatarLetter}>
                          {(u.display_name || u.username || "?")[0].toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={plm.name} numberOfLines={1}>{u.display_name || u.username}</Text>
                      <Text style={plm.username} numberOfLines={1}>@{u.username}</Text>
                    </View>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const plm = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" } as any,
  card: { backgroundColor: "#FAF8F0", borderRadius: 12, width: "90%", maxWidth: 420, maxHeight: "70%", overflow: "hidden" } as any,
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "rgba(53,17,1,0.08)" } as any,
  title: { fontFamily: t.font["body.semibold"], fontSize: 15, color: t.color["text.primary"] },
  close: { fontSize: 22, color: t.color["text.primary"], lineHeight: 22 } as any,
  empty: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.muted"], textAlign: "center", paddingVertical: 28 } as any,
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 10 } as any,
  avatar: { width: 38, height: 38, borderRadius: 19 } as any,
  avatarFallback: { backgroundColor: t.color["text.primary"], alignItems: "center", justifyContent: "center" } as any,
  avatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 14, color: "#FAF8F0" },
  name: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.primary"] },
  username: { fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.muted"], marginTop: 1 } as any,
  divider: { height: 1, backgroundColor: "rgba(53,17,1,0.05)", marginHorizontal: 20 } as any,
});

// ── Bio Tab ────────────────────────────────────────────────────────────────

function BioTab({
  cafe, isOwner, isEditing,
  editStampsEnabled, onStampsEnabledChange,
  editStampTarget, onStampTargetChange,
  editStampReward, onOpenRewardPicker,
  onScan,
}: {
  cafe: Cafe;
  isOwner: boolean;
  isEditing: boolean;
  editStampsEnabled: boolean;
  onStampsEnabledChange: (v: boolean) => void;
  editStampTarget: number;
  onStampTargetChange: (n: number) => void;
  editStampReward: string;
  onOpenRewardPicker: () => void;
  onScan: () => void;
}) {
  const hours = cafe.hours_json;
  const displayReward = isEditing ? editStampReward : (cafe.stamp_reward || "free coffee");
  // Loyalty visibility:
  //   • Public: only shown when stamps_enabled === 1.
  //   • Editing owner: always shown — either the full stats sentence
  //     (enabled) or an "Enable loyalty" affordance (disabled).
  const loyaltyOn = isEditing ? editStampsEnabled : cafe.stamps_enabled === 1;
  return (
    <View style={s.tabContent}>
      {loyaltyOn && (
        <View style={s.statsRowInline}>
          <Text style={s.statsSentence}>
            <Text style={s.statsNumber}>{cafe.stamps_given ?? 0}</Text> stamps given out ·{" "}
            <Text style={s.statsNumber}>{cafe.rewards_redeemed ?? 0}</Text>{" "}
            {displayReward.toLowerCase()}{(cafe.rewards_redeemed ?? 0) === 1 ? "" : "s"} claimed ·{" "}
            {isEditing ? (
              <Text style={[s.statsNumber, s.editableInline]} onPress={() => {
                // Cycle through common targets — 5/8/10/12/15
                const options = [5, 8, 10, 12, 15];
                const idx = options.indexOf(editStampTarget);
                onStampTargetChange(options[(idx + 1) % options.length]);
              }}>
                {editStampTarget}
              </Text>
            ) : (
              <Text style={s.statsNumber}>{cafe.stamp_target}</Text>
            )}{" "}stamps for a{" "}
            {isEditing ? (
              <Text style={s.editableInline} onPress={onOpenRewardPicker}>
                {displayReward.toLowerCase()}
              </Text>
            ) : (
              displayReward.toLowerCase()
            )}.
          </Text>
          {isOwner && !isEditing && (
            <Pressable onPress={onScan} style={s.scanIconBtn} hitSlop={8} accessibilityLabel="Scan QR to stamp">
              <Camera size={18} color={t.color["text.primary"]} />
            </Pressable>
          )}
          {isOwner && isEditing && (
            <Pressable
              onPress={() => onStampsEnabledChange(false)}
              style={s.loyaltyDisableBtn}
              hitSlop={8}
              accessibilityLabel="Disable loyalty program"
            >
              {/* Matches the coffee-card delete button: cream circle +
                  primary-dark trash icon (see CoffeeCard.binBtn). */}
              <Trash2 size={14} color={t.color["text.primary"]} strokeWidth={1.5} />
            </Pressable>
          )}
        </View>
      )}
      {isEditing && !loyaltyOn && (
        <Pressable
          onPress={() => onStampsEnabledChange(true)}
          style={s.loyaltyEnableBtn}
          accessibilityLabel="Enable loyalty program"
        >
          <Plus size={14} color={t.color["text.primary"]} strokeWidth={2} />
          <Text style={s.loyaltyEnableText}>Enable loyalty program</Text>
        </Pressable>
      )}

      {/* Hours */}
      {hours && Object.keys(hours).length > 0 && (
        <View style={s.hoursBlock}>
          <Text style={s.sectionTitle}>Hours</Text>
          {DAYS_OF_WEEK.map((d) => (
            <View key={d} style={s.hoursRow}>
              <Text style={s.hoursDay}>{DAY_LABELS[d]}</Text>
              <Text style={s.hoursTime}>{hours[d] || "Closed"}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Menu Tab ───────────────────────────────────────────────────────────────

function MenuTab({
  cafe_slug, menu, isOwner, isEditing, onChange, onCatalogChange,
}: {
  cafe_slug: string;
  menu: CafeMenuItem[];
  isOwner: boolean;
  isEditing: boolean;
  onChange: () => void;
  onCatalogChange?: (change: "added" | "updated" | "removed", subject: string) => void;
}) {
  const router = useRouter();

  // Group by drink_name so multi-bean drinks stack as carousel slides
  const grouped = useMemo(() => {
    const map = new Map<string, CafeMenuItem[]>();
    for (const item of menu) {
      const key = item.drink_name;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [menu]);

  const handleDelete = async (id: number) => {
    // Capture subject before deletion so the prompt reads sensibly
    const item = menu.find((m) => m.id === id);
    const subject = item
      ? `${item.drink_name}${item.manual_bean_name ? ` (${item.manual_bean_name})` : ""}`
      : "a menu item";
    try {
      await apiFetchRaw(`/cafe_menu_items/${id}`, { method: "DELETE" });
      onChange();
      onCatalogChange?.("removed", subject);
    } catch (e) { console.warn("Menu delete failed:", e); }
  };

  const handleUpdate = async (id: number, body: Partial<CafeMenuItem>) => {
    try {
      await apiFetchRaw(`/cafe_menu_items/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      onChange();
      const item = menu.find((m) => m.id === id);
      const subject = item
        ? `${item.drink_name}${body.manual_bean_name || item.manual_bean_name ? ` (${body.manual_bean_name ?? item.manual_bean_name})` : ""}`
        : "a menu item";
      onCatalogChange?.("updated", subject);
    } catch (e) { console.warn("Menu update failed:", e); }
  };

  const handleAddBean = async (drink_name: string, body: Partial<CafeMenuItem>) => {
    try {
      await apiFetchRaw("/cafe_menu_items", {
        method: "POST",
        body: JSON.stringify({ cafe_slug, drink_name, ...body }),
      });
      onChange();
      const subject = body.manual_bean_name
        ? `${drink_name} (${body.manual_bean_name})`
        : drink_name;
      onCatalogChange?.("added", subject);
    } catch (e) { console.warn("Menu add bean failed:", e); }
  };

  if (menu.length === 0) {
    return (
      <View style={s.tabContent}>
        <View style={s.emptyState}>
          <Coffee size={32} color={t.color["text.muted"]} />
          <Text style={s.emptyText}>{isOwner ? "Add your first drink to the menu" : "No menu yet"}</Text>
        </View>
        {isOwner && (
          <AddMenuItemForm cafe_slug={cafe_slug} onAdded={onChange} />
        )}
      </View>
    );
  }

  return (
    <View style={s.tabContent}>
      {/* §2.10 (v2) — true tabular menu. Each drink is one block with
         a horizontal divider between blocks. Within a block every
         roaster is its own row with five vertically-aligned columns:
         **Drink** (only on the first row of the block) | **Roaster**
         (clickable) | **Roast** | **Tasting Notes** | **Actions**.
         An "Add roaster" row sits at the end of each block in edit
         mode so a café can layer another supplier under the same
         drink without opening the full Add-drink form. */}
      <View style={s.menuTable}>
        {/* §2.24a — column header row. Same column widths as the data
           rows so everything aligns. Uppercase + letter-spaced + muted
           so it reads as metadata, not another drink row. */}
        <View style={s.menuHeaderRow}>
          <View style={s.menuColDrink}>
            <Text style={s.menuHeaderCell}>Drink</Text>
          </View>
          <View style={s.menuColRoaster}>
            <Text style={s.menuHeaderCell}>Roaster</Text>
          </View>
          <View style={s.menuColRoast}>
            <Text style={s.menuHeaderCell}>Roast</Text>
          </View>
          <View style={s.menuColPrice}>
            <Text style={s.menuHeaderCell}>Price</Text>
          </View>
          <View style={s.menuColNotes}>
            <Text style={s.menuHeaderCell}>Tasting Notes</Text>
          </View>
          <View style={s.menuColActions} />
        </View>
        {grouped.map(([drinkName, items], drinkIdx) => (
          <View key={drinkName} style={s.menuDrink}>
            {drinkIdx > 0 && <View style={s.menuDrinkDivider} />}
            {items.map((item, beanIdx) => {
              const slug = item.roaster_slug;
              const derivedFromSlug = slug
                ? String(slug).replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
                : null;
              // Display roaster name with priority: joined name,
              // derived from slug, manual name, or manual bean name
              // as a last resort when no roaster was picked.
              const roasterLabel = item.roaster_name
                || derivedFromSlug
                || item.manual_roaster_name
                || item.manual_bean_name
                || "\u2014";
              // Price — prefers the menu item's own field, falls back
              // to the joined catalog product price (not all menu
              // items carry an explicit price today; §2.10b tracks a
              // scraper follow-up for the rest).
              const price = (item as any).price_inr ?? (item as any).product?.price_inr ?? null;
              return (
                <View key={item.id ?? `${drinkName}-${beanIdx}`} style={s.menuRow}>
                  {/* Col 1 — Drink name (first row only) */}
                  <View style={s.menuColDrink}>
                    {beanIdx === 0 && (
                      <Text style={s.menuDrinkName} numberOfLines={1}>{drinkName}</Text>
                    )}
                  </View>

                  {/* Col 2 — Roaster. Name is plain (no underline);
                     a small crema-pink external-link icon after it
                     signals "tap to visit the roaster". */}
                  <View style={s.menuColRoaster}>
                    {slug ? (
                      <Pressable
                        onPress={() => router.push(`/roaster/${slug}` as any)}
                        style={s.menuRoasterPressable}
                      >
                        <Text style={s.menuRoasterText} numberOfLines={1}>{roasterLabel}</Text>
                        <ExternalLink size={11} color={t.color.accent} strokeWidth={1.8} />
                      </Pressable>
                    ) : (
                      <Text style={s.menuRoasterText} numberOfLines={1}>{roasterLabel}</Text>
                    )}
                  </View>

                  {/* Col 3 — Roast level */}
                  <View style={s.menuColRoast}>
                    <Text style={s.menuCellText} numberOfLines={1}>
                      {item.roast_level || "\u2014"}
                    </Text>
                  </View>

                  {/* Col 4 — Price */}
                  <View style={s.menuColPrice}>
                    <Text style={s.menuCellText} numberOfLines={1}>
                      {price != null ? `\u20B9 ${price}` : "\u2014"}
                    </Text>
                  </View>

                  {/* Col 5 — Tasting notes (`notes` in the schema) */}
                  <View style={s.menuColNotes}>
                    <Text style={s.menuCellMuted} numberOfLines={2}>
                      {item.notes || "\u2014"}
                    </Text>
                  </View>

                  {/* Col 6 — Actions (delete, only in edit mode) */}
                  <View style={s.menuColActions}>
                    {isOwner && isEditing && item.id != null && (
                      <Pressable onPress={() => handleDelete(item.id!)} hitSlop={8} style={s.menuRowAction}>
                        <Trash2 size={14} color={t.color["text.secondary"]} />
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}

            {/* Inline "add roaster" row — only in edit mode. Opens a
               compact sub-form to layer another supplier under the
               same drink without the full Add-drink form below. */}
            {isOwner && isEditing && (
              <AddRoasterToDrinkRow
                drinkName={drinkName}
                onSubmit={(body) => handleAddBean(drinkName, body)}
              />
            )}
          </View>
        ))}
      </View>

      {/* "Add drink" is available to owners any time; this is the
         existing new-drink form repurposed for the table. */}
      {isOwner && (
        <AddMenuItemForm cafe_slug={cafe_slug} onAdded={onChange} />
      )}
    </View>
  );
}

// §2.10 — inline "add another roaster" row for a specific drink.
// Collapsed by default; expands into Roaster / Roast / Notes inputs
// and a small Save.
function AddRoasterToDrinkRow({
  drinkName, onSubmit,
}: {
  drinkName: string;
  onSubmit: (body: Partial<CafeMenuItem>) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [roasterName, setRoasterName] = useState("");
  const [roast, setRoast] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [notes, setNotes] = useState("");

  const reset = () => {
    setRoasterName(""); setRoast(""); setPriceInput(""); setNotes(""); setOpen(false);
  };

  const save = async () => {
    if (!roasterName.trim() && !roast.trim() && !priceInput.trim() && !notes.trim()) {
      setOpen(false); return;
    }
    await onSubmit({
      manual_roaster_name: roasterName.trim() || null,
      roast_level: roast.trim() || null,
      price_inr: priceInput ? parseInt(priceInput, 10) : null,
      notes: notes.trim() || null,
    } as any);
    reset();
  };

  if (!open) {
    return (
      <View style={s.menuRow}>
        <View style={s.menuColDrink} />
        <View style={{ flexDirection: "row", flex: 1 }}>
          <Pressable onPress={() => setOpen(true)} style={s.menuAddRoasterRow}>
            <Plus size={12} color={t.color.accent} />
            <Text style={s.menuAddRoasterText}>Add a roaster</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={s.menuRow}>
      <View style={s.menuColDrink} />
      <View style={s.menuColRoaster}>
        <TextInput
          value={roasterName}
          onChangeText={setRoasterName}
          placeholder={`Roaster for ${drinkName}`}
          placeholderTextColor={t.color["text.muted"]}
          style={s.menuInlineInput}
        />
      </View>
      <View style={s.menuColRoast}>
        <TextInput
          value={roast}
          onChangeText={setRoast}
          placeholder="Roast"
          placeholderTextColor={t.color["text.muted"]}
          style={s.menuInlineInput}
        />
      </View>
      <View style={s.menuColPrice}>
        {/* Price is captured as a plain number input so it merges
           into the same column as the displayed `\u20B9 ###`. */}
        <TextInput
          value={priceInput}
          onChangeText={(v) => setPriceInput(v.replace(/[^0-9]/g, ""))}
          placeholder="\u20B9"
          placeholderTextColor={t.color["text.muted"]}
          keyboardType="numeric"
          style={s.menuInlineInput}
        />
      </View>
      <View style={s.menuColNotes}>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Tasting notes"
          placeholderTextColor={t.color["text.muted"]}
          style={s.menuInlineInput}
        />
      </View>
      <View style={[s.menuColActions, { flexDirection: "row", gap: 6 }]}>
        <Pressable onPress={reset} hitSlop={6}>
          <Text style={s.menuInlineCancel}>Cancel</Text>
        </Pressable>
        <Pressable onPress={save} hitSlop={6} style={s.menuInlineSaveBtn}>
          <Text style={s.menuInlineSaveText}>Save</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Row layout: drink name on left, horizontal scroll of bean cards on right.
// Multi-roaster drinks become natural carousels — swipe the cards to see alternates.
function DrinkRow({
  drinkName, items, isOwner, isEditing,
  onDelete, onUpdate, onAddBean, onTapRoaster, onTapProduct,
}: {
  drinkName: string;
  items: CafeMenuItem[];
  isOwner: boolean;
  isEditing: boolean;
  onDelete: (id: number) => void;
  onUpdate: (id: number, body: Partial<CafeMenuItem>) => void;
  onAddBean: (body: Partial<CafeMenuItem>) => void;
  onTapRoaster: (slug: string) => void;
  onTapProduct: (productId: string) => void;
}) {
  // Track a synthetic "just-added" id for slide-in animation. When the
  // AddBeanCard opens its form and fires onAddBean, we bump a trigger
  // so the next render plays the slide animation on the newest card.
  const [slideSeed, setSlideSeed] = useState(0);
  const handleAdd = (body: Partial<CafeMenuItem>) => {
    setSlideSeed((n) => n + 1);
    onAddBean(body);
  };
  return (
    <View style={s.drinkRow}>
      <View style={s.drinkLabel}>
        <Text style={s.drinkRowName}>{drinkName}</Text>
        {items.length > 1 && (
          <Text style={s.drinkRowCount}>{items.length} options</Text>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingRight: 8 }}
        style={s.drinkScroll}
      >
        {items.map((item, idx) => (
          <BeanCard
            key={item.id}
            item={item}
            isOwner={isOwner}
            isEditing={isEditing}
            isNewest={idx === items.length - 1}
            slideSeed={slideSeed}
            onDelete={() => onDelete(item.id)}
            onUpdate={(body) => onUpdate(item.id, body)}
            onTapRoaster={onTapRoaster}
            onTapProduct={onTapProduct}
          />
        ))}
        {/* Owner add-bean placeholder — always present, regardless of
            isEditing. Tapping slides an inline compose form into the same
            card slot. */}
        {isOwner && (
          <AddBeanCard onAdd={handleAdd} />
        )}
      </ScrollView>
    </View>
  );
}

// Bean card — uses the same CoffeeLabel design language as the rest of the site.
// Canela display for bean name, "By Roaster" row, divider, Inter 10.2px for meta.
// Compact variant of CoffeeLabel adapted for a café menu context.
function BeanCard({
  item, isOwner, isEditing, isNewest, slideSeed,
  onDelete, onUpdate, onTapRoaster, onTapProduct,
}: {
  item: CafeMenuItem;
  isOwner: boolean;
  isEditing: boolean;
  isNewest: boolean;
  slideSeed: number;
  onDelete: () => void;
  onUpdate: (body: Partial<CafeMenuItem>) => void;
  onTapRoaster: (slug: string) => void;
  onTapProduct: (productId: string) => void;
}) {
  // Slide-in animation — only played on the newest card after slideSeed
  // changes (i.e. a new bean was just added to this drink).
  const slide = useRef(new Animated.Value(0)).current;
  const prevSeed = useRef(slideSeed);
  useEffect(() => {
    if (slideSeed !== prevSeed.current && isNewest) {
      slide.setValue(120);
      Animated.timing(slide, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
    prevSeed.current = slideSeed;
  }, [slideSeed, isNewest, slide]);

  // In-place edit state — only populated when isEditing && card tapped.
  const [editMode, setEditMode] = useState(false);
  const [eBeanName, setEBeanName] = useState(item.manual_bean_name || "");
  const [eRoastLevel, setERoastLevel] = useState(item.roast_level || "");
  const [eProcess, setEProcess] = useState(item.process || "");
  useEffect(() => {
    if (!editMode) {
      setEBeanName(item.manual_bean_name || "");
      setERoastLevel(item.roast_level || "");
      setEProcess(item.process || "");
    }
  }, [item, editMode]);

  const showRoaster = !!item.roaster_slug && item.hide_roaster !== 1;
  const isHidden = !!item.roaster_slug && item.hide_roaster === 1;
  const beanName = item.manual_bean_name || item.product_id || "—";
  const roasterName = item.roaster_slug
    ? item.roaster_slug.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
    : null;

  const detailLine = [
    item.process ? `${item.process} Process` : null,
    item.roast_level ? `${item.roast_level} Roast` : null,
  ].filter(Boolean).join(" \u2022 ");

  const saveEdit = () => {
    onUpdate({
      manual_bean_name: eBeanName.trim() || null as any,
      roast_level: eRoastLevel.trim() || null as any,
      process: eProcess.trim() || null as any,
    });
    setEditMode(false);
  };

  if (editMode) {
    return (
      <Animated.View style={[s.beanCard, { transform: [{ translateX: slide }] }] as any}>
        <TextInput
          style={s.beanEditName}
          value={eBeanName}
          onChangeText={setEBeanName}
          placeholder="Bean name"
          placeholderTextColor={t.color["text.muted"]}
        />
        <View style={s.beanCardDivider} />
        <View style={{ flexDirection: "row", gap: 6 }}>
          <TextInput
            style={[s.beanEditMeta, { flex: 1 }]}
            value={eRoastLevel}
            onChangeText={setERoastLevel}
            placeholder="Roast"
            placeholderTextColor={t.color["text.muted"]}
          />
          <TextInput
            style={[s.beanEditMeta, { flex: 1 }]}
            value={eProcess}
            onChangeText={setEProcess}
            placeholder="Process"
            placeholderTextColor={t.color["text.muted"]}
          />
        </View>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
          <Pressable onPress={() => setEditMode(false)} style={[s.beanEditCancel, { flex: 1 }]}>
            <Text style={s.beanEditCancelText}>Cancel</Text>
          </Pressable>
          <Pressable onPress={saveEdit} style={[s.beanEditSave, { flex: 1 }]}>
            <Text style={s.beanEditSaveText}>Save</Text>
          </Pressable>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[s.beanCard, { transform: [{ translateX: slide }] }] as any}>
      {isOwner && (
        <View style={s.beanCardActions}>
          {isEditing && (
            <Pressable onPress={() => setEditMode(true)} style={s.beanCardEdit}>
              <PenLine size={12} color="#684F44" />
            </Pressable>
          )}
          <Pressable onPress={onDelete} style={s.beanCardDelete}>
            <Trash2 size={12} color="#684F44" />
          </Pressable>
        </View>
      )}

      {/* Bean name — Canela 22.7, #351101 — same as CoffeeLabel coffeeName */}
      <Pressable
        onPress={() => item.product_id && onTapProduct(item.product_id)}
        disabled={!item.product_id}
      >
        <Text style={s.beanCardCoffeeName} numberOfLines={2}>{beanName}</Text>
      </Pressable>

      {/* Roaster row — "By " plain + tappable name (or "Roaster undisclosed") */}
      {showRoaster && roasterName ? (
        <View style={s.beanCardRoasterRow}>
          <Text style={s.beanCardRoasterLabel}>By </Text>
          <Pressable onPress={() => onTapRoaster(item.roaster_slug!)} style={s.beanCardRoasterPressable}>
            <Text style={s.beanCardRoasterLabel} numberOfLines={1}>{roasterName}</Text>
          </Pressable>
        </View>
      ) : isHidden ? (
        <View style={s.beanCardRoasterRow}>
          <Text style={s.beanCardRoasterLabel}>Roaster undisclosed</Text>
        </View>
      ) : null}

      {/* Divider line — same #C7BAA5 as CoffeeLabel */}
      {detailLine ? <View style={s.beanCardDivider} /> : null}

      {/* Process • Roast — Inter 10.2px, #684F44 — exactly CoffeeLabel.detailText */}
      {detailLine ? (
        <Text style={s.beanCardDetail} numberOfLines={1}>{detailLine}</Text>
      ) : null}
    </Animated.View>
  );
}

// AddBeanCard — empty-card placeholder with a centered +. Tapping slides
// an inline compose form into the same slot. Matches the roaster
// EditableCoffeeCard pattern but sized for the café menu context.
function AddBeanCard({ onAdd }: { onAdd: (body: Partial<CafeMenuItem>) => void }) {
  const [mode, setMode] = useState<"placeholder" | "editing">("placeholder");
  const [beanName, setBeanName] = useState("");
  const [roastLevel, setRoastLevel] = useState("");
  const [processVal, setProcessVal] = useState("");
  const slide = useRef(new Animated.Value(0)).current;

  const openEdit = () => {
    setMode("editing");
    slide.setValue(80);
    Animated.timing(slide, {
      toValue: 0, duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };
  const submit = () => {
    if (!beanName.trim() && !roastLevel.trim() && !processVal.trim()) {
      setMode("placeholder");
      return;
    }
    onAdd({
      manual_bean_name: beanName.trim() || null as any,
      roast_level: roastLevel.trim() || null as any,
      process: processVal.trim() || null as any,
    });
    setBeanName("");
    setRoastLevel("");
    setProcessVal("");
    setMode("placeholder");
  };

  if (mode === "placeholder") {
    return (
      <Pressable onPress={openEdit} style={[s.beanCard, s.addBeanPlaceholder]}>
        <Plus size={22} color={t.color.accent} strokeWidth={2} />
        <Text style={s.addBeanPlaceholderText}>Add bean</Text>
      </Pressable>
    );
  }

  return (
    <Animated.View style={[s.beanCard, { transform: [{ translateX: slide }] }] as any}>
      <TextInput
        style={s.beanEditName}
        value={beanName}
        onChangeText={setBeanName}
        placeholder="Bean name"
        placeholderTextColor={t.color["text.muted"]}
        autoFocus
      />
      <View style={s.beanCardDivider} />
      <View style={{ flexDirection: "row", gap: 6 }}>
        <TextInput
          style={[s.beanEditMeta, { flex: 1 }]}
          value={roastLevel}
          onChangeText={setRoastLevel}
          placeholder="Roast"
          placeholderTextColor={t.color["text.muted"]}
        />
        <TextInput
          style={[s.beanEditMeta, { flex: 1 }]}
          value={processVal}
          onChangeText={setProcessVal}
          placeholder="Process"
          placeholderTextColor={t.color["text.muted"]}
        />
      </View>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
        <Pressable onPress={() => setMode("placeholder")} style={[s.beanEditCancel, { flex: 1 }]}>
          <Text style={s.beanEditCancelText}>Cancel</Text>
        </Pressable>
        <Pressable onPress={submit} style={[s.beanEditSave, { flex: 1 }]}>
          <Text style={s.beanEditSaveText}>Add</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function AddMenuItemForm({ cafe_slug, onAdded }: { cafe_slug: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [drinkName, setDrinkName] = useState("");
  const [roasterSlug, setRoasterSlug] = useState<string | null>(null);
  const [roasterPickerOpen, setRoasterPickerOpen] = useState(false);
  const [roasterQuery, setRoasterQuery] = useState("");
  const [roasters, setRoasters] = useState<Array<{ roaster_slug: string; name: string | null }>>([]);
  const [manualBeanName, setManualBeanName] = useState("");
  const [roastLevel, setRoastLevel] = useState("");
  const [process, setProcess] = useState("");
  const [hideRoaster, setHideRoaster] = useState(false);

  // Load roaster catalog when the picker opens
  useEffect(() => {
    if (roasters.length > 0 || !roasterPickerOpen) return;
    apiFetchRaw<any>("/roaster_profiles?limit=200")
      .then((r) => {
        const data = r?.data ?? r;
        setRoasters(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
  }, [roasterPickerOpen, roasters.length]);

  const filteredRoasters = useMemo(() => {
    if (!roasterQuery) return roasters.slice(0, 50);
    const q = roasterQuery.toLowerCase();
    return roasters
      .filter((r) => (r.name || r.roaster_slug || "").toLowerCase().includes(q))
      .slice(0, 50);
  }, [roasters, roasterQuery]);

  const selectedRoasterName = roasterSlug
    ? (roasters.find((r) => r.roaster_slug === roasterSlug)?.name || roasterSlug.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()))
    : null;

  const handleAdd = async () => {
    if (!drinkName.trim()) return;
    try {
      await apiFetchRaw("/cafe_menu_items", {
        method: "POST",
        body: JSON.stringify({
          cafe_slug,
          drink_name: drinkName.trim(),
          roaster_slug: roasterSlug,
          manual_bean_name: manualBeanName.trim() || null,
          roast_level: roastLevel.trim() || null,
          process: process.trim() || null,
          hide_roaster: hideRoaster ? 1 : 0,
        }),
      });
      setDrinkName("");
      setRoasterSlug(null);
      setManualBeanName("");
      setRoastLevel("");
      setProcess("");
      setHideRoaster(false);
      setOpen(false);
      onAdded();
    } catch (e) { console.warn("Menu add failed:", e); }
  };

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={s.addMenuBtn}>
        <Plus size={16} color={t.color.accent} />
        <Text style={s.addMenuBtnText}>Add drink to menu</Text>
      </Pressable>
    );
  }

  return (
    <View style={s.addMenuForm}>
      <TextInput style={s.addMenuInput} value={drinkName} onChangeText={setDrinkName} placeholder="Drink name (e.g. Pour Over)" placeholderTextColor={t.color["text.muted"]} />

      {/* Roaster picker — only catalog roasters; leave blank if not in our catalog */}
      <Pressable onPress={() => setRoasterPickerOpen(true)} style={s.addMenuInput}>
        <Text style={selectedRoasterName ? s.pickerSelectedText : s.pickerPlaceholder}>
          {selectedRoasterName || "Pick a roaster (optional, from catalog)"}
        </Text>
      </Pressable>
      {selectedRoasterName && (
        <Pressable onPress={() => setRoasterSlug(null)}>
          <Text style={s.clearText}>× clear roaster</Text>
        </Pressable>
      )}

      <TextInput style={s.addMenuInput} value={manualBeanName} onChangeText={setManualBeanName} placeholder="Bean name (optional)" placeholderTextColor={t.color["text.muted"]} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput style={[s.addMenuInput, { flex: 1 }]} value={roastLevel} onChangeText={setRoastLevel} placeholder="Roast" placeholderTextColor={t.color["text.muted"]} />
        <TextInput style={[s.addMenuInput, { flex: 1 }]} value={process} onChangeText={setProcess} placeholder="Process" placeholderTextColor={t.color["text.muted"]} />
      </View>
      <Pressable onPress={() => setHideRoaster(!hideRoaster)} style={s.checkRow}>
        <View style={[s.checkbox, hideRoaster && s.checkboxChecked]}>
          {hideRoaster && <Text style={s.checkmark}>{"\u2713"}</Text>}
        </View>
        <Text style={s.checkLabel}>Hide roaster credit (safeguard sourcing)</Text>
      </Pressable>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable onPress={() => setOpen(false)} style={[s.discardBtn, { flex: 1 }]}>
          <Text style={s.discardText}>Cancel</Text>
        </Pressable>
        <Pressable onPress={handleAdd} style={[s.saveBtn, { flex: 1 }]}>
          <Text style={s.saveText}>Add drink</Text>
        </Pressable>
      </View>

      {roasterPickerOpen && (
        <View style={s.roasterPickerOverlay}>
          <View style={s.roasterPickerCard}>
            <Text style={s.roasterPickerTitle}>Pick a roaster</Text>
            <TextInput
              style={s.addMenuInput}
              value={roasterQuery}
              onChangeText={setRoasterQuery}
              placeholder="Search roasters…"
              placeholderTextColor={t.color["text.muted"]}
            />
            <ScrollView style={{ maxHeight: 280 }}>
              {filteredRoasters.map((r) => (
                <Pressable
                  key={r.roaster_slug}
                  onPress={() => {
                    setRoasterSlug(r.roaster_slug);
                    setRoasterPickerOpen(false);
                    setRoasterQuery("");
                  }}
                  style={s.roasterPickerRow}
                >
                  <Text style={s.roasterPickerName}>{r.name || r.roaster_slug}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => setRoasterPickerOpen(false)} style={s.discardBtn}>
              <Text style={s.discardText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Posts Tab ──────────────────────────────────────────────────────────────

function PostsTab({ posts, onRefresh }: { posts: any[]; onRefresh: () => void }) {
  if (posts.length === 0) {
    return (
      <View style={s.tabContent}>
        <View style={s.emptyState}>
          <Text style={s.emptyText}>No posts yet</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={s.tabContent}>
      {posts.map((p) => (
        <PostCard
          key={p.id}
          post={p}
          onComment={(post) => openPostModal({ postId: post.id, mode: "comment" })}
          onRepost={(post) => openPostModal({ postId: post.id, mode: "repost" })}
        />
      ))}
    </View>
  );
}

// ── Pickers: Seasonal + Reward (floating modals, site language) ───────────

function SeasonalPicker({
  visible, openMonth, closeMonth, onChange, onClose,
}: {
  visible: boolean;
  openMonth: number | null;
  closeMonth: number | null;
  onChange: (open: number | null, close: number | null) => void;
  onClose: () => void;
}) {
  // Year-round is its own explicit toggle — previously it was derived from
  // "o == null || c == null", which made picking a month on one side silently
  // fail to turn year-round off. Now the state machine is: yearRound flips
  // on/off directly; picking a month auto-flips it off and auto-fills a
  // sensible default for the other side so the user can confirm immediately.
  const [yearRound, setYearRound] = useState<boolean>(
    openMonth == null || closeMonth == null,
  );
  const [o, setO] = useState<number | null>(openMonth);
  const [c, setC] = useState<number | null>(closeMonth);
  useEffect(() => {
    setO(openMonth);
    setC(closeMonth);
    setYearRound(openMonth == null || closeMonth == null);
  }, [openMonth, closeMonth, visible]);

  const pickOpen = (m: number) => {
    setYearRound(false);
    setO(m);
    if (c == null) setC(m); // default close = same month so Done is valid
  };
  const pickClose = (m: number) => {
    setYearRound(false);
    setC(m);
    if (o == null) setO(m);
  };
  const pickYearRound = () => {
    setYearRound(true);
    // Intentionally keep o / c so toggling back is painless
  };

  return (
    <FloatingModal
      visible={visible}
      title="Seasonal schedule"
      onClose={onClose}
      onConfirm={() => {
        onChange(yearRound ? null : o, yearRound ? null : c);
        onClose();
      }}
    >
      <Pressable
        onPress={pickYearRound}
        style={[sp.yearRoundBtn, yearRound && sp.yearRoundBtnActive]}
      >
        <Text style={[sp.yearRoundText, yearRound && sp.yearRoundTextActive]}>
          Open year-round
        </Text>
      </Pressable>
      <Text style={sp.label}>Opens in</Text>
      <View style={sp.monthGrid}>
        {MONTHS.map((m, i) => {
          const active = !yearRound && o === i + 1;
          return (
            <Pressable
              key={m}
              onPress={() => pickOpen(i + 1)}
              style={[sp.monthChip, active && sp.monthChipActive]}
            >
              <Text style={[sp.monthText, active && sp.monthTextActive]}>{m}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={sp.label}>Closes after</Text>
      <View style={sp.monthGrid}>
        {MONTHS.map((m, i) => {
          const active = !yearRound && c === i + 1;
          return (
            <Pressable
              key={m}
              onPress={() => pickClose(i + 1)}
              style={[sp.monthChip, active && sp.monthChipActive]}
            >
              <Text style={[sp.monthText, active && sp.monthTextActive]}>{m}</Text>
            </Pressable>
          );
        })}
      </View>
    </FloatingModal>
  );
}

function RewardPicker({
  visible, value, menu, onChange, onClose,
}: {
  visible: boolean;
  value: string;
  menu: CafeMenuItem[];
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value, visible]);
  // Distinct drink names from the current menu, pre-formatted as reward
  // strings ("Free espresso", "Free pour over", …).
  const presets = useMemo(() => {
    const seen = new Set<string>();
    const arr: string[] = ["Free coffee"];
    seen.add("free coffee");
    for (const m of menu) {
      const d = m.drink_name?.trim();
      if (!d) continue;
      const pill = `Free ${d.toLowerCase()}`;
      if (!seen.has(pill.toLowerCase())) {
        seen.add(pill.toLowerCase());
        arr.push(pill);
      }
    }
    return arr;
  }, [menu]);
  return (
    <FloatingModal
      visible={visible}
      title="Reward"
      onClose={onClose}
      onConfirm={() => { onChange(text.trim() || "Free coffee"); onClose(); }}
    >
      {/* Compact layout: pill-wrap of presets + a single-line custom input. */}
      <View style={sp.presetWrap}>
        {presets.map((p) => {
          const active = p.toLowerCase() === text.trim().toLowerCase();
          return (
            <Pressable
              key={p}
              onPress={() => setText(p)}
              style={[sp.presetPill, active && sp.presetPillActive]}
            >
              <Text style={[sp.presetPillText, active && sp.presetPillTextActive]}>
                {p}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Or write your own…"
        placeholderTextColor="rgba(104,79,68,0.4)"
        style={sp.customInput}
      />
    </FloatingModal>
  );
}

// Minimal reusable floating modal that follows the site's PostModal
// pattern (overlayWrap + backdrop blur + card + X).
function FloatingModal({
  visible, title, onClose, onConfirm, children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onConfirm?: () => void;
  children: React.ReactNode;
}) {
  // Local import to avoid pulling the whole Modal namespace when unused
  const { Modal } = require("react-native");
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={sp.overlayWrap}>
        <Pressable style={sp.overlayBg} onPress={onClose} />
        <View style={sp.card}>
          <View style={sp.header}>
            <Text style={sp.title}>{title}</Text>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              {onConfirm ? (
                <Pressable onPress={onConfirm} style={sp.doneBtn}>
                  <Text style={sp.doneText}>Done</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={onClose} hitSlop={8}>
                <Text style={sp.closeText}>Close</Text>
              </Pressable>
            </View>
          </View>
          <ScrollView contentContainerStyle={sp.body}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const sp = StyleSheet.create({
  overlayWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    ...(Platform.OS === "web" ? ({ backdropFilter: "blur(35px)", WebkitBackdropFilter: "blur(35px)" } as any) : {}),
  } as any,
  overlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: t.color.overlay } as any,
  card: {
    backgroundColor: t.color.bg,
    borderRadius: t.radius.lg,
    width: "92%",
    maxWidth: 440,
    maxHeight: "85%",
    overflow: "hidden",
    zIndex: 1,
  } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  },
  title: { fontFamily: t.font["body.semibold"], fontSize: t.size["font.lg"], color: t.color["text.primary"] },
  doneBtn: {
    backgroundColor: t.color.accent,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xs,
    borderRadius: t.radius.sm,
  },
  doneText: { fontFamily: t.font["body.semibold"], fontSize: t.size["font.sm"], color: t.color["text.primary"] },
  closeText: { fontFamily: t.font["body.medium"], fontSize: t.size["font.sm"], color: t.color["text.muted"] },
  body: { padding: t.spacing.xl, gap: t.spacing.md },

  // Seasonal picker
  yearRoundBtn: {
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: t.color.border,
    alignItems: "center",
    marginBottom: t.spacing.sm,
  },
  yearRoundBtnActive: {
    backgroundColor: t.color.accent,
    borderColor: t.color.accent,
  },
  yearRoundText: { fontFamily: t.font["body.medium"], fontSize: t.size["font.sm"], color: t.color["text.primary"] },
  yearRoundTextActive: { color: t.color["text.primary"] },
  label: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: t.spacing.sm,
    marginBottom: t.spacing.xs,
  },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 } as any,
  monthChip: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: t.radius.sm,
    backgroundColor: t.color["card.info"],
  },
  monthChipActive: { backgroundColor: t.color.accent },
  monthText: { fontFamily: t.font["body.medium"], fontSize: t.size["font.sm"], color: t.color["text.secondary"] },
  monthTextActive: { color: t.color["text.primary"] },

  // Reward picker — horizontal pill chips, no headers for a tighter modal
  presetWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  } as any,
  presetPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: t.radius.full,
    backgroundColor: t.color["card.info"],
  },
  presetPillActive: { backgroundColor: t.color.accent },
  presetPillText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  },
  presetPillTextActive: { color: t.color["text.primary"] },
  customInput: {
    backgroundColor: t.color["card.info"],
    borderRadius: t.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
    outlineStyle: "none" as any,
  } as any,
});

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 100 },
  scroll: { flex: 1, backgroundColor: t.color.bg },
  scrollContent: { paddingTop: NAVBAR_H, paddingBottom: 60 },
  scrollContentWide: { paddingHorizontal: 0 },

  // Wide layout: full-height row with two flush columns (matches roaster page)
  pageContainer: { flexDirection: "row", overflow: "hidden" } as any,

  layout: { flexDirection: "column" },
  layoutWide: { flexDirection: "row", width: "100%" } as any,

  // Left panel — dark brown, matches roaster profile (42% width on wide, full on narrow)
  leftPanel: {
    paddingHorizontal: 24, paddingVertical: 24,
    backgroundColor: t.color["roaster.panel"],
  },
  // Match roaster profile widths/padding exactly. Width + horizontal padding on outer View
  // (so percentage is relative to viewport like roaster), inner ScrollView fills with vertical padding.
  leftPanelWide: {
    width: "42%",
    flexShrink: 0,
    backgroundColor: t.color["roaster.panel"],
    height: "100%",
    paddingHorizontal: "3.5%" as any,  // ≈ 6.25% of 42% column width — matches roaster's inset
  } as any,
  leftPanelInner: {
    paddingTop: 126, paddingBottom: 60,
  } as any,

  rightPanel: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 24, backgroundColor: t.color.bg } as any,
  rightPanelWide: { flex: 1, minWidth: 0, backgroundColor: t.color.bg, height: "100%" } as any,
  rightInner: { paddingHorizontal: 24, paddingTop: 0 } as any,

  // Logo — circle, sits above name
  logoWrap: {
    width: 96, height: 96,
    borderRadius: 48,
    overflow: "hidden",
    backgroundColor: t.color["card.front"],
    marginBottom: 20,
    position: "relative",
  } as any,
  logoFallback: { flex: 1, alignItems: "center", justifyContent: "center" } as any,
  logoInitial: { fontFamily: t.font.display, fontSize: 44, color: t.color["text.muted"] },
  logoEditBtn: {
    position: "absolute", bottom: 4, right: 4,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(53,17,1,0.85)",
    alignItems: "center", justifyContent: "center",
  },

  // Hero (right panel top) — full-width landscape
  heroWrap: {
    width: "100%",
    height: 280,
    backgroundColor: t.color["card.info"],
    overflow: "hidden",
    marginBottom: 16,
    position: "relative",
  } as any,
  heroFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  heroEditBtn: {
    position: "absolute", bottom: 12, right: 12,
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: "rgba(53,17,1,0.85)", borderRadius: 4,
  },
  heroEditBtnText: {
    fontFamily: t.font["body.medium"], fontSize: 12, color: t.color["text.on-dark"],
  },
  heroDragHint: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    alignItems: "center",
    transform: [{ translateY: -10 }],
  } as any,
  heroDragHintText: {
    fontFamily: t.font["body.medium"],
    fontSize: 11,
    color: t.color["text.on-dark"],
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  logoDragHint: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    alignItems: "center",
    transform: [{ translateY: -9 }],
  } as any,
  logoDragHintText: {
    fontFamily: t.font["body.medium"],
    fontSize: 9,
    color: t.color["text.on-dark"],
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },

  backBtn: {
    flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 60,
    alignSelf: "flex-start", paddingVertical: 4,
  },
  backText: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color.divider },

  cafeName: {
    fontFamily: t.font.display, fontSize: 48, color: t.color["text.on-dark"],
    lineHeight: 54, marginTop: 4, marginBottom: 12,
  },
  aboutBlurb: {
    fontFamily: t.font["body.regular"], fontSize: 12, color: t.color.divider,
    lineHeight: 18, marginBottom: 16,
  },
  aboutText: {
    fontFamily: t.font["body.regular"], fontSize: 12, color: t.color.divider,
    lineHeight: 18,
  },
  inlineEdit: {
    backgroundColor: "rgba(255,255,255,0.06)",
    color: t.color["text.on-dark"],
    paddingHorizontal: 8, paddingVertical: 6,
    borderRadius: 4,
  } as any,

  seasonalBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 12,
    marginBottom: 16,
  },
  seasonalText: { fontFamily: t.font["body.medium"], fontSize: 11, color: t.color["text.on-dark"], letterSpacing: 0.3 },

  metaRows: { gap: 8, marginBottom: 20 },
  metaItem: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 2 } as any,
  metaText: {
    fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.on-dark"],
    flex: 1, flexShrink: 1, lineHeight: 18,
  } as any,
  inlineEditMeta: {
    fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.on-dark"],
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3,
    flex: 1,
  } as any,

  // Wholesale procurement block (Phase 1 §2.6) — owner-only panel sitting
  // between the public meta rows and the follow CTA.
  procurementBlock: {
    marginBottom: 20, paddingTop: 14, paddingBottom: 4,
    borderTopWidth: 1, borderTopColor: "rgba(215,209,196,0.18)",
  } as any,
  procurementTitle: {
    fontFamily: t.font["body.semibold"], fontSize: 11, color: t.color["text.on-dark"],
    letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4,
  } as any,
  procurementHint: {
    fontFamily: t.font["body.regular"], fontSize: 11, color: "rgba(215,209,196,0.6)",
    fontStyle: "italic", marginBottom: 12,
  } as any,
  procurementRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 4,
  } as any,
  procurementRowNote: { alignItems: "flex-start" } as any,
  procurementLabel: {
    fontFamily: t.font["body.medium"], fontSize: 12, color: "rgba(215,209,196,0.75)",
    width: 140,
  } as any,
  procurementValue: {
    fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.on-dark"],
  } as any,
  procurementInput: { width: 90, flex: 0 } as any,
  procurementNoteInput: { minHeight: 56, paddingVertical: 6 } as any,
  procurementToggle: {
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1, borderColor: "rgba(215,209,196,0.25)",
  } as any,
  procurementToggleOn: {
    backgroundColor: "rgba(215,209,196,0.2)",
    borderColor: "rgba(215,209,196,0.55)",
  } as any,
  procurementToggleText: {
    fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.on-dark"],
    letterSpacing: 0.3,
  } as any,

  // (Edit profile + Scan QR are now wired through navbar dropdown / bio scan icon)

  // Tabs
  // height: 80 matches the roaster profile's rightTabBar + the
  // user profile's tabBar so all three business/account tabstrips
  // read at the same vertical rhythm. Button is relative-positioned
  // with no padding — text centers vertically inside the 80px row,
  // letting tabUnderline's `bottom: -1` ride the parent's border.
  tabs: { flexDirection: "row", alignItems: "stretch", gap: 32, height: 80, borderBottomWidth: 1, borderBottomColor: "rgba(215,209,196,0.5)", marginBottom: 20 },
  tabBtn: { justifyContent: "center", position: "relative" } as any,
  tabText: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.muted"], letterSpacing: 0.5 },
  tabTextActive: { color: t.color["text.primary"] },
  tabUnderline: { position: "absolute", bottom: -1, left: 0, right: 0, height: 3, backgroundColor: t.color["text.primary"] } as any,

  tabContent: { gap: 24 },

  sectionTitle: {
    fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.muted"],
    letterSpacing: 0.5, marginBottom: 12, textTransform: "uppercase",
  },

  // Stamps stats — inline sentence + optional compact scan icon (owner only)
  statsRowInline: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  statsSentence: {
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: "#684F44",
    lineHeight: 20,
    flex: 1,
  } as any,
  statsNumber: {
    fontFamily: t.font["body.semibold"],
    color: "#351101",
  },
  scanIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 1, borderColor: "#D7D1C4",
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  // Inline editable token — draws attention as tappable (matches the
  // inlineEdit bubble used elsewhere in edit mode).
  editableInline: {
    backgroundColor: "rgba(215,152,218,0.25)",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    color: t.color["text.primary"],
    fontFamily: t.font["body.semibold"],
  } as any,
  editableChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  } as any,
  loyaltyEnableBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color["card.front"],
  },
  loyaltyEnableText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  },
  // Small trash button that sits next to the editable stats sentence
  // and turns the loyalty program off. Reuses the coffee-card delete
  // language (cream circle + dark primary trash glyph) — same visual
  // weight as CoffeeCard.binBtn, scaled for an inline row.
  loyaltyDisableBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.color["card.info"],
  },
  composerOverlayWrap: {
    flex: 1, justifyContent: "center", alignItems: "center",
    ...(Platform.OS === "web" ? ({ backdropFilter: "blur(35px)", WebkitBackdropFilter: "blur(35px)" } as any) : {}),
  } as any,
  composerOverlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: t.color.overlay } as any,
  composerCard: {
    width: "90%", maxWidth: 680, backgroundColor: t.color.bg,
    borderRadius: t.radius.lg, overflow: "hidden", maxHeight: "85%", zIndex: 1,
  } as any,

  // Matches the feed + roaster FABs: dark primary disc pinned to the
  // bottom-right, cream plus icon, soft shadow. Only shown on the Posts
  // tab to café owners (not editing).
  fab: {
    position: "absolute", bottom: 28, right: 28,
    width: t.size["fab.size"], height: t.size["fab.size"], borderRadius: t.size["fab.size"] / 2,
    alignItems: "center", justifyContent: "center",
    backgroundColor: t.color["text.primary"],
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 8,
  } as any,

  // Baristas
  // (baristas feature removed; styles dropped)

  // Hours
  hoursBlock: {},
  hoursRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.color["border.light"] },

  // §2.10 — tabular menu (v2). Five columns per row, vertical-divider-less
  // grid separated into drink blocks by full-width horizontal
  // dividers. Every cell left-aligns to its column's leading edge so
  // the entire table reads as one scannable grid — mirrors the hours
  // table but with more columns.
  menuTable: { marginTop: 8 } as any,
  // §2.24a — column-header row. Uppercase + letter-spaced + muted so
  // it reads as metadata, not a row. Bottom border echoes the hours
  // table's per-row rule.
  menuHeaderRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: t.color["border.light"],
  } as any,
  menuHeaderCell: {
    fontFamily: t.font["body.medium"], fontSize: 10,
    color: t.color["text.muted"],
    letterSpacing: 0.6,
    textTransform: "uppercase",
  } as any,
  // §2.24b — tighter rows. menuDrink no longer carries its own
  // vertical padding; rows (and the divider margin) handle all
  // spacing so per-row density matches the opening-hours table.
  menuDrink: { paddingVertical: 0 } as any,
  menuDrinkDivider: {
    height: 1, backgroundColor: t.color["border.light"],
    marginVertical: 6,
  } as any,
  menuRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 6,
  } as any,
  // Column widths. Drink / roast / price / actions are fixed so they
  // align vertically across every drink block. Roaster + notes are
  // flex so they absorb the remaining width.
  menuColDrink: { width: 110, paddingRight: 12 } as any,
  menuColRoaster: { flex: 1.2, paddingRight: 12, minWidth: 0 } as any,
  menuColRoast: { width: 100, paddingRight: 12 } as any,
  menuColPrice: { width: 80, paddingRight: 12 } as any,
  menuColNotes: { flex: 1.6, paddingRight: 12, minWidth: 0 } as any,
  menuColActions: { width: 50, alignItems: "flex-end" } as any,

  // Drink label uses the same Inter body face as the hours table —
  // not Canela. Keeps the table reading as a plain list of facts,
  // not a feature copy block.
  menuDrinkName: {
    fontFamily: t.font["body.medium"], fontSize: 13,
    color: t.color["text.primary"],
  },
  // Roaster cell: name + pink external-link icon in a single row.
  // No underline — the pink icon carries the "tap to visit" signal.
  menuRoasterPressable: {
    flexDirection: "row", alignItems: "center", gap: 5,
  } as any,
  menuRoasterText: {
    fontFamily: t.font["body.medium"], fontSize: 13,
    color: t.color["text.primary"],
  } as any,
  menuCellText: {
    fontFamily: t.font["body.regular"], fontSize: 13,
    color: t.color["text.secondary"],
  },
  menuCellMuted: {
    fontFamily: t.font["body.regular"], fontSize: 13,
    color: t.color["text.secondary"],
    lineHeight: 17,
  },
  menuRowAction: {
    padding: 4,
    alignItems: "center", justifyContent: "center",
  } as any,

  // Inline "add roaster" expand-in-place form inside a drink block.
  menuAddRoasterRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 4, paddingHorizontal: 2,
  } as any,
  menuAddRoasterText: {
    fontFamily: t.font["body.medium"], fontSize: 12,
    color: t.color.accent, letterSpacing: 0.2,
  },
  menuInlineInput: {
    fontFamily: t.font["body.regular"], fontSize: 12.5,
    color: t.color["text.primary"],
    paddingVertical: 4, paddingHorizontal: 6,
    backgroundColor: t.color["card.info"],
    borderRadius: 4,
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}),
  } as any,
  menuInlineCancel: {
    fontFamily: t.font["body.medium"], fontSize: 11,
    color: t.color["text.muted"],
    paddingHorizontal: 4, paddingVertical: 4,
  },
  menuInlineSaveBtn: {
    backgroundColor: t.color["text.primary"],
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4,
  } as any,
  menuInlineSaveText: {
    fontFamily: t.font["body.semibold"], fontSize: 11,
    color: t.color["text.on-dark"],
  },
  hoursDay: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.primary"] },
  hoursTime: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.secondary"] },

  // Menu / drink card
  // Menu row layout: drink name (left) + horizontal scroll of bean cards (right)
  drinkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 20,
    paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: t.color["border.light"],
  } as any,
  drinkLabel: { width: 140, flexShrink: 0, paddingTop: 6 } as any,
  drinkRowName: {
    fontFamily: t.font.display, fontSize: 24, color: t.color["text.primary"],
    lineHeight: 28,
  },
  drinkRowCount: {
    fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.muted"],
    marginTop: 4, letterSpacing: 0.3,
  },
  drinkScroll: { flex: 1, minWidth: 0 } as any,

  // Bean card — borrows CoffeeLabel design language: cream bg #EFE9DB, Canela name,
  // "By Roaster" row, divider, Inter 10.2px detail.
  beanCard: {
    width: 200,
    backgroundColor: "#EFE9DB",
    borderRadius: 5,
    padding: 14,
    position: "relative",
  } as any,
  beanCardActions: {
    position: "absolute", top: 6, right: 6, flexDirection: "row", gap: 4, zIndex: 2,
  } as any,
  beanCardDelete: {
    padding: 4,
  } as any,
  beanCardEdit: {
    padding: 4,
  } as any,
  // In-place edit inputs — borrow the same cream bg as the card, just
  // enlarge slightly for affordance.
  beanEditName: {
    fontFamily: t.font.display,
    fontSize: 20,
    color: t.color["text.primary"],
    paddingVertical: 4,
    paddingHorizontal: 4,
    outlineStyle: "none" as any,
    backgroundColor: t.color["card.front"],
    borderRadius: 4,
  } as any,
  beanEditMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: t.color["card.front"],
    borderRadius: 4,
    outlineStyle: "none" as any,
  } as any,
  beanEditCancel: {
    paddingVertical: 6,
    borderRadius: 4,
    alignItems: "center",
    borderWidth: 1,
    borderColor: t.color.border,
  },
  beanEditCancelText: {
    fontFamily: t.font["body.medium"], fontSize: 11, color: t.color["text.secondary"],
  },
  beanEditSave: {
    paddingVertical: 6,
    borderRadius: 4,
    alignItems: "center",
    backgroundColor: t.color.accent,
  },
  beanEditSaveText: {
    fontFamily: t.font["body.semibold"], fontSize: 11, color: t.color["text.primary"],
  },
  // Add-bean placeholder: centered plus, dashed-style border via
  // accent.soft bg so it reads as affordance without a heavy outline.
  addBeanPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: t.color["accent.soft"],
  } as any,
  addBeanPlaceholderText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color.accent,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  // Canela Text Regular, 22.7px, #351101 — exact match to CoffeeLabel.coffeeName
  beanCardCoffeeName: {
    fontFamily: t.font.display,
    fontSize: 22.7,
    color: "#351101",
    lineHeight: 27,
  },
  beanCardRoasterRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    overflow: "hidden",
  },
  beanCardRoasterLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: 10.9,
    color: "#684F44",
  },
  beanCardRoasterPressable: { flexShrink: 1, overflow: "hidden" } as any,
  // Divider — same #C7BAA5 as CoffeeLabel
  beanCardDivider: {
    height: 1,
    backgroundColor: "#C7BAA5",
    marginTop: 7,
    marginBottom: 7,
  },
  // Inter Regular 10.2px #684F44 — matches CoffeeLabel.detailText
  beanCardDetail: {
    fontFamily: t.font["body.regular"],
    fontSize: 10.2,
    color: "#684F44",
  },

  // Add menu form
  addMenuBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    padding: 16, borderWidth: 1, borderStyle: "dashed", borderColor: t.color.border, borderRadius: 8,
  },
  addMenuBtnText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color.accent },
  addMenuForm: { gap: 8, padding: 16, backgroundColor: t.color["card.info"], borderRadius: 8 },
  pickerSelectedText: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color["text.primary"] },
  pickerPlaceholder: { fontFamily: t.font["body.regular"], fontSize: 14, color: t.color["text.muted"] },
  clearText: { fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["accent.cta"], marginTop: -4 },
  roasterPickerOverlay: {
    position: "absolute" as any, top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center", zIndex: 100,
  },
  roasterPickerCard: {
    width: "90%", maxWidth: 360,
    backgroundColor: t.color.bg, borderRadius: 8, padding: 16, gap: 8,
  },
  roasterPickerTitle: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.primary"], marginBottom: 4 },
  roasterPickerRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.color["border.light"] } as any,
  roasterPickerName: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.primary"] },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 } as any,
  checkbox: {
    width: 18, height: 18, borderRadius: 3, borderWidth: 1.5, borderColor: t.color.border,
    alignItems: "center", justifyContent: "center", backgroundColor: t.color["card.front"],
  },
  checkboxChecked: { backgroundColor: t.color.accent, borderColor: t.color.accent },
  checkmark: { color: t.color["text.primary"], fontSize: 12, fontWeight: "700" as any },
  checkLabel: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.secondary"] },
  addMenuInput: {
    fontFamily: t.font["body.regular"], fontSize: 14, color: t.color["text.primary"],
    backgroundColor: t.color["card.front"],
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4,
    borderWidth: 1, borderColor: t.color["border.light"],
  },

  // Empty
  emptyState: { paddingVertical: 40, alignItems: "center", gap: 12 },
  emptyText: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.muted"] },

  // Posts (placeholder until full PostCard wired in)
  postCard: { padding: 16, backgroundColor: t.color["card.front"], borderRadius: 8 },
  postAuthor: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.primary"], marginBottom: 4 },
  postBody: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.secondary"] },

  // Edit banner
  editBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 24, paddingVertical: 10,
    backgroundColor: t.color["roaster.panel"],
  },
  editBannerLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  editBannerLabel: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color.accent },
  editBannerRight: { flexDirection: "row", gap: 8 },
  discardBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  discardText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.on-dark"] },
  saveBtn: { paddingHorizontal: 14, paddingVertical: 6, backgroundColor: t.color.accent, borderRadius: 4 },
  saveText: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.primary"] },
});
