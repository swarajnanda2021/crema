/**
 * Roaster Profile Page — unified for all visitors + roaster owner mode.
 *
 * Public visitor:  left panel (about, meta, Follow) + right scroll (hero, featured posts, coffee grid)
 * Owner (isOwner): same page, NO Follow button, + star-toggle management, + compose new post form
 *
 * Navbar user-icon already routes roaster accounts here instead of /profile.
 */

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  View, Text, ScrollView, Pressable, StyleSheet, Modal,
  LayoutChangeEvent, Platform, Animated, Easing, TextInput, ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import Svg, { Circle, G, Path } from "react-native-svg";
import { Plus, X, PenLine, Camera, MapPin, Check, Link } from "lucide-react-native";
import ImageUploadModal from "../../src/components/ImageUploadModal";

import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useRoasterProfiles } from "../../src/hooks/useRoasterProfiles";
import { useAuth } from "../../src/hooks/useAuth";
import { apiFetch } from "../../src/api/client";
import { fonts, colors } from "../../src/theme/colors";
import CoffeeCard from "../../src/components/CoffeeCard";
import Navbar from "../../src/components/Navbar";
import { HeartOutlineIcon, HeartFilledOutlineIcon, CartIcon } from "../../src/components/icons/FigmaIcons";

const liningNumerals = Platform.OS === "web"
  ? { fontFeatureSettings: "'lnum', 'pnum'" } as any
  : {};

// ── Figma MCP localhost SVG assets (Rectangle 234 / Frame 722, node 96:8655 / 163:2328) ──
const FIGMA_BACK_ARROW     = "http://localhost:3845/assets/258b4df2171b8c3fd18f751b3cd93df5e9bc0e3a.svg";
const FIGMA_SHARE_ICON     = "http://localhost:3845/assets/73a3490dfe017b6c6d09ffe81f7fa967b808e05e.svg";
const FIGMA_WEBSITE_ICON   = "http://localhost:3845/assets/c8b1c717f262fb5c8267b41ffb94e03f9f30e3a2.svg";
const FIGMA_FOLLOWERS_ICON = "http://localhost:3845/assets/24115d6a26d4b35414125e4d31aa30ab00a5efc0.svg";
const FIGMA_CITY_ICON      = "http://localhost:3845/assets/34b74a6440e0a03457339dd5236601f37c6a31c8.svg";
const FIGMA_PLUS_ICON      = "http://localhost:3845/assets/f9b31cb40af6488f3e9140aca17c71a98e3f3c64.svg";

// ── Figma MCP localhost SVG assets (Frame 720 — post card) ──────────────────
const FIGMA_POST_HEART     = "http://localhost:3845/assets/3e92b5cd93aafa2a17dd1b9b331c5338e18ac639.svg";
const FIGMA_POST_COMMENT   = "http://localhost:3845/assets/71167aa5e804a3f44c93add7f2445f77d514d0af.svg";
const FIGMA_POST_SHARE     = "http://localhost:3845/assets/12186c3d643c443d0ef02bb899348e1c0cdf0973.svg";
const FIGMA_POST_MAPPIN    = "http://localhost:3845/assets/e5bb5db86d84a07e96f6d7e2803da172dc94dd29.svg";

// ── Icons ─────────────────────────────────────────────────────────────────────

// Figma imgVector4 — back chevron from Rectangle 234
function BackArrowIcon() {
  return <Image source={{ uri: FIGMA_BACK_ARROW }} style={{ width: 7, height: 14 }} contentFit="contain" />;
}

// Figma imgVector3 — map pin from Rectangle 234
function MapPinIcon() {
  return <Image source={{ uri: FIGMA_CITY_ICON }} style={{ width: 12, height: 16 }} contentFit="contain" />;
}

// Figma imgVector1 — external link / website icon from Rectangle 234
function ExternalLinkIcon() {
  return <Image source={{ uri: FIGMA_WEBSITE_ICON }} style={{ width: 14, height: 14 }} contentFit="contain" />;
}

// Figma imgVector2 — users / followers icon from Rectangle 234
function UsersIcon() {
  return <Image source={{ uri: FIGMA_FOLLOWERS_ICON }} style={{ width: 18, height: 15 }} contentFit="contain" />;
}

function ShareInlineIcon({ color = "#A09580" }: { color?: string }) {
  return (
    <Svg width={12} height={14} viewBox="0 0 14 16" fill="none">
      <Path d="M12 5.5C13.1 5.5 14 4.6 14 3.5C14 2.4 13.1 1.5 12 1.5C10.9 1.5 10 2.4 10 3.5C10 4.6 10.9 5.5 12 5.5ZM2 9.5C3.1 9.5 4 8.6 4 7.5C4 6.4 3.1 5.5 2 5.5C0.9 5.5 0 6.4 0 7.5C0 8.6 0.9 9.5 2 9.5ZM12 13.5C13.1 13.5 14 12.6 14 11.5C14 10.4 13.1 9.5 12 9.5C10.9 9.5 10 10.4 10 11.5C10 12.6 10.9 13.5 12 13.5ZM3.7 8.5L10.3 11.5M10.3 3.5L3.7 6.5" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Figma imgShareIcon — upload/share icon from Rectangle 234 (SHARE row in left panel)
function LeftPanelShareIcon() {
  return <Image source={{ uri: FIGMA_SHARE_ICON }} style={{ width: 14, height: 16 }} contentFit="contain" />;
}

// Comment bubble icon for post action bar — matches Figma design style
function CommentIcon({ color = "#A09580" }: { color?: string }) {
  return (
    <Svg width={14} height={13} viewBox="0 0 14 13" fill="none">
      <Path
        d="M7 1C3.69 1 1 3.24 1 6C1 7.35 1.6 8.58 2.6 9.5L2 12L4.87 10.5C5.55 10.83 6.26 11 7 11C10.31 11 13 8.76 13 6C13 3.24 10.31 1 7 1Z"
        stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
      />
    </Svg>
  );
}

function StarIcon({ filled = false }: { filled?: boolean }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill={filled ? "#D798DA" : "none"}>
      <Path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" stroke={filled ? "#D798DA" : "#A09580"} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return "just now";
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d`;
    return new Date(dateStr).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  } catch { return ""; }
}

// ── Photo gallery ─────────────────────────────────────────────────────────────
// Figma node 151:2264 — 3-column portrait layout, each ~232×311px, 10px gap, r=5
//
// 1 image  → full-width landscape (height 240)
// 2 images → 2 equal columns, full width, 311px tall, 10px gap
// 3 images → 3 equal columns, full width, 311px tall, 10px gap  (Figma spec)
// 4+ images → horizontal carousel, each image same per-col size as 3-up layout

const PG_IMG_HEIGHT = 311;
const PG_GAP = 10;
const PG_RADIUS = 5;

function PhotoGallery({ images, onPress }: { images: string[]; onPress?: () => void }) {
  const [containerWidth, setContainerWidth] = useState(0);

  if (!images || images.length === 0) return null;

  // 1 image — full-width landscape
  if (images.length === 1) {
    return (
      <Pressable onPress={onPress} style={pg.singleWrap}>
        <Image source={{ uri: images[0] }} style={pg.singleImg} contentFit="cover" />
      </Pressable>
    );
  }

  // 2–3 images — equal flex columns filling full width, 311px tall
  if (images.length <= 3) {
    return (
      <View style={pg.rowWrap}>
        {images.map((uri, i) => (
          <Pressable key={i} onPress={onPress} style={pg.colWrap}>
            <Image source={{ uri }} style={pg.colImg} contentFit="cover" />
          </Pressable>
        ))}
      </View>
    );
  }

  // 4+ → horizontal carousel, each image at the same width as one col in the 3-up grid
  const imgW = containerWidth > 0
    ? Math.floor((containerWidth - PG_GAP * 2) / 3)
    : 220;

  return (
    <View
      onLayout={e => setContainerWidth(e.nativeEvent.layout.width)}
      style={pg.carouselOuter}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: PG_GAP }}
      >
        {images.map((uri, i) => (
          <Pressable key={i} onPress={onPress}>
            <Image
              source={{ uri }}
              style={{ width: imgW, height: PG_IMG_HEIGHT, borderRadius: PG_RADIUS }}
              contentFit="cover"
            />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const pg = StyleSheet.create({
  // 1 image — landscape
  singleWrap: { marginBottom: 16 } as any,
  singleImg: { width: "100%" as any, height: 240, borderRadius: PG_RADIUS },
  // 2–3 images — portrait row
  rowWrap: {
    flexDirection: "row",
    gap: PG_GAP,
    marginBottom: 16,
  } as any,
  colWrap: { flex: 1, borderRadius: PG_RADIUS, overflow: "hidden" } as any,
  colImg: { width: "100%" as any, height: PG_IMG_HEIGHT },
  // 4+ carousel outer
  carouselOuter: { marginBottom: 16 },
});

// ── Coffee grid ───────────────────────────────────────────────────────────────

// Figma card spec: 240×372 (image 160px, info 212px)
const GAP = 12;
const TARGET_CARD_W = 240;
const CARD_ASPECT = 372 / 240;
const GRID_PAD = 20;

function CoffeeGrid({
  coffees, isOwner, onDeleteProduct,
  roasterName, onSaveCard,
}: {
  coffees: any[];
  isOwner?: boolean;
  onDeleteProduct?: (id: string) => void;
  roasterName?: string;
  onSaveCard?: (data: any) => Promise<void>;
}) {
  const [containerW, setContainerW] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerW(e.nativeEvent.layout.width);
  }, []);
  const available = containerW > 0 ? containerW - GRID_PAD * 2 : 800;
  const numCols = Math.max(1, Math.min(4, Math.round((available + GAP) / (TARGET_CARD_W + GAP))));
  const cardW = Math.floor((available - GAP * (numCols - 1)) / numCols);
  const cardH = Math.floor(cardW * CARD_ASPECT);

  if (coffees.length === 0 && !isOwner) {
    return (
      <View style={cg.empty}>
        <Text style={cg.emptyText}>No coffees listed yet.</Text>
      </View>
    );
  }
  return (
    <View onLayout={onLayout} style={[cg.grid, { gap: GAP, paddingHorizontal: GRID_PAD }]}>
      {coffees.map((c) => (
        <View key={c.product_id || c.id} style={{ width: cardW, height: cardH }}>
          <CoffeeCard
            coffee={c}
            width={cardW}
            height={cardH}
            shelfMode={isOwner && !!onDeleteProduct}
            onRemove={isOwner && onDeleteProduct ? () => onDeleteProduct(c.product_id || c.id) : undefined}
          />
        </View>
      ))}
      {/* Always show editable placeholder at END for owner */}
      {isOwner && roasterName && onSaveCard && containerW > 0 && (
        <View key="__editable__" style={{ width: cardW, height: cardH }}>
          <EditableCoffeeCard
            roasterName={roasterName}
            width={cardW}
            height={cardH}
            onSave={onSaveCard}
          />
        </View>
      )}
    </View>
  );
}

const cg = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  empty: { paddingVertical: 48, alignItems: "center" },
  emptyText: { fontFamily: fonts.bodyRegular, fontSize: 14, color: "#684F44" },
});

// ── Roaster Post Card ─────────────────────────────────────────────────────────

// ── Roaster Post Card (Frame 720 design) ─────────────────────────────────────

function RoasterPostCard({
  post,
  roasterName,
  avatarUrl,
  city,
  onFeatureToggle,
  isOwner,
}: {
  post: any;
  roasterName: string;
  avatarUrl?: string | null;
  city?: string | null;
  onFeatureToggle?: (id: number) => void;
  isOwner?: boolean;
}) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount] = useState(0);
  const scaleAnim = useState(new Animated.Value(1))[0];

  const handleLike = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.3, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    setLiked((l) => !l);
    setLikeCount((c) => liked ? c - 1 : c + 1);
  };

  const handleOpen = () => {
    if (post.external_url) Linking.openURL(post.external_url);
  };

  return (
    <View style={pc.card}>

      {/* ── Header: avatar + name + timestamp + subtitle ── */}
      <View style={pc.header}>
        <View>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={pc.avatar} contentFit="cover" />
          ) : (
            <View style={[pc.avatar, pc.avatarFallback]}>
              <Text style={pc.avatarLetter}>{(roasterName || "R")[0].toUpperCase()}</Text>
            </View>
          )}
        </View>
        <View style={pc.headerMeta}>
          <View style={pc.nameRow}>
            <Text style={pc.authorName}>{roasterName}</Text>
            <Text style={pc.timestamp}>{timeAgo(post.published_at)}</Text>
          </View>
          <Text style={pc.subtitle}>{post.post_type === "note" ? "Posted a note" : "Posted about an article"}</Text>
        </View>
        {/* Star toggle — owner only */}
        {isOwner && onFeatureToggle && (
          <Pressable
            onPress={() => onFeatureToggle(post.id)}
            style={[pc.featureBtn, post.is_featured && pc.featureBtnActive]}
            hitSlop={8}
          >
            <StarIcon filled={post.is_featured} />
            <Text style={[pc.featureBtnText, post.is_featured && pc.featureBtnTextActive]}>
              {post.is_featured ? `Featured #${post.featured_order}` : "Feature"}
            </Text>
          </Pressable>
        )}
      </View>

      {/* ── Body text (teaser at Figma 16.764px) ── */}
      <Pressable onPress={handleOpen}>
        <Text style={pc.body}>{post.teaser}</Text>
      </Pressable>

      {/* ── Location row ── */}
      {(post.location || city) ? (
        <View style={pc.locationRow}>
          <Image source={{ uri: FIGMA_POST_MAPPIN }} style={pc.mapPinIcon} contentFit="contain" />
          <Text style={pc.locationText}>{post.location || city}</Text>
        </View>
      ) : null}

      {/* ── Photo gallery ── */}
      <PhotoGallery images={post.images || (post.cover_image_url ? [post.cover_image_url] : [])} onPress={handleOpen} />

      {/* ── Action bar (heart + count | comment + count | share) ── */}
      <View style={pc.actionBar}>
        {/* Heart */}
        <Pressable onPress={handleLike} style={pc.actionBtn}>
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            {liked
              ? <HeartFilledOutlineIcon size={16} color="#D798DA" />
              : <Image source={{ uri: FIGMA_POST_HEART }} style={pc.actionIcon} contentFit="contain" />}
          </Animated.View>
          <Text style={[pc.actionCount, liked && { color: "#D798DA" }]}>{likeCount}</Text>
        </Pressable>
        {/* Comment */}
        <View style={pc.actionBtn}>
          <Image source={{ uri: FIGMA_POST_COMMENT }} style={pc.actionIcon} contentFit="contain" />
          <Text style={pc.actionCount}>{commentCount}</Text>
        </View>
        {/* Share */}
        <Pressable
          onPress={() => {
            if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
              navigator.clipboard.writeText(post.external_url || window.location.href);
            }
          }}
          style={pc.actionBtn}
        >
          <Image source={{ uri: FIGMA_POST_SHARE }} style={pc.shareIcon} contentFit="contain" />
        </Pressable>
        {/* Article link */}
        {post.external_url && (
          <Pressable onPress={handleOpen} style={pc.readMore}>
            <Text style={pc.readMoreText}>Read →</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const pc = StyleSheet.create({
  // Figma: white card, generous padding
  card: {
    backgroundColor: "#FAF8F0",
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 20,
  },
  // Header
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 14,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    overflow: "hidden",
  } as any,
  avatarFallback: {
    backgroundColor: "#351101",
    alignItems: "center",
    justifyContent: "center",
  } as any,
  avatarLetter: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: "#FAF8F0" },
  headerMeta: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "baseline", gap: 5 },
  // Figma: Inter Medium 11.848px #351101
  authorName: { fontFamily: fonts.bodyMedium, fontSize: 11.8, color: "#351101" },
  // Figma: Inter Medium 10.058px #A09580
  timestamp: { fontFamily: fonts.bodyMedium, fontSize: 10, color: "#A09580" },
  // Figma: Inter Medium 10.058px #684F44
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 10, color: "#684F44", marginTop: 2 },
  // Feature star badge
  featureBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: 4, borderWidth: 1, borderColor: "rgba(160,149,128,0.3)",
  },
  featureBtnActive: { borderColor: "rgba(215,152,218,0.4)", backgroundColor: "rgba(215,152,218,0.08)" },
  featureBtnText: { fontFamily: fonts.bodyMedium, fontSize: 10, color: "#A09580" },
  featureBtnTextActive: { color: "#D798DA" },
  // Body text: Figma Inter Regular 16.764px #351101 line-height 23.469px
  body: {
    fontFamily: fonts.bodyRegular,
    fontSize: 16.8,
    color: "#351101",
    lineHeight: 23.5,
    marginBottom: 10,
  },
  // Location row: Figma map pin + Inter Medium 11.848px #351101
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 14,
  },
  mapPinIcon: { width: 11, height: 14 },
  locationText: { fontFamily: fonts.bodyMedium, fontSize: 11.8, color: "#351101" },
  // Photo: Figma 311px tall, rounded 5px
  photoWrap: { borderRadius: 5, overflow: "hidden", marginBottom: 16 } as any,
  photo: { width: "100%" as any, height: 311, borderRadius: 5 },
  // Action bar: Figma icons + counts side by side
  actionBar: { flexDirection: "row", alignItems: "center", gap: 20 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  // Figma heart: 15.998×14.185px
  actionIcon: { width: 16, height: 14 },
  // Figma share: 11.874×14.249px
  shareIcon: { width: 12, height: 14 },
  // Figma count: Inter Medium 11.848px #351101
  actionCount: { fontFamily: fonts.bodyMedium, fontSize: 11.8, color: "#351101" },
  readMore: { marginLeft: "auto" as any },
  readMoreText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#351101", textDecorationLine: "underline" },
});

// ── Follow button ─────────────────────────────────────────────────────────────

// Figma imgVector — the "+" icon in the Follow button (from Rectangle 234)
function FigmaPlusIcon() {
  return (
    <Image
      source={{ uri: FIGMA_PLUS_ICON }}
      style={{ width: 8, height: 8, transform: [{ rotate: "45deg" }] }}
      contentFit="contain"
    />
  );
}

function FollowButton({ following, onToggle }: { following: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={[fb.btn, following && fb.btnFollowing]}>
      {!following && <FigmaPlusIcon />}
      <Text style={[fb.text, following && fb.textFollowing]}>
        {following ? "Following" : "Follow"}
      </Text>
    </Pressable>
  );
}

const fb = StyleSheet.create({
  // Figma: Follow button exactly 71×27px, border 1.5px #faf8f0, border-radius 2px
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    width: 71,
    height: 27,
    borderRadius: 2,
    borderWidth: 1.5,
    borderColor: "#FAF8F0",
  },
  btnFollowing: { backgroundColor: "#FAF8F0" },
  plus: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: "#FAF8F0", lineHeight: 17 },
  text: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: "#FAF8F0", lineHeight: 15 },
  textFollowing: { color: "#351101" },
});

// ── New Post compose form (owner only) ────────────────────────────────────────

function ComposePostForm({
  onSubmit,
  onCancel,
  loading,
}: {
  onSubmit: (data: { title: string; teaser: string; external_url: string; cover_image_url: string; post_type: string; location: string; images: string[] }) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [postType, setPostType] = useState<"article" | "note">("article");
  const [title, setTitle] = useState("");
  const [teaser, setTeaser] = useState("");
  const [url, setUrl] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([""]);
  const [location, setLocation] = useState("");

  const isNote = postType === "note";
  const canSubmit = teaser.trim().length > 0 && teaser.trim().length <= 300 &&
    (isNote || title.trim().length > 0);

  const addImageField = () => setImageUrls((prev) => [...prev, ""]);
  const updateImageUrl = (idx: number, val: string) =>
    setImageUrls((prev) => prev.map((u, i) => (i === idx ? val : u)));
  const removeImageUrl = (idx: number) =>
    setImageUrls((prev) => prev.filter((_, i) => i !== idx));

  return (
    <View style={cf.wrap}>
      <View style={cf.header}>
        <Text style={cf.heading}>New post</Text>
        <Pressable onPress={onCancel} hitSlop={8}>
          <X size={16} color="#A09580" />
        </Pressable>
      </View>

      {/* Post type toggle */}
      <View style={cf.typeRow}>
        <Pressable
          onPress={() => setPostType("article")}
          style={[cf.typeBtn, !isNote && cf.typeBtnActive]}
        >
          <Text style={[cf.typeBtnText, !isNote && cf.typeBtnTextActive]}>Article</Text>
        </Pressable>
        <Pressable
          onPress={() => setPostType("note")}
          style={[cf.typeBtn, isNote && cf.typeBtnActive]}
        >
          <Text style={[cf.typeBtnText, isNote && cf.typeBtnTextActive]}>Note</Text>
        </Pressable>
      </View>

      {!isNote && (
        <>
          <Text style={cf.label}>Title *</Text>
          <TextInput
            style={cf.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Gangecool Estate"
            placeholderTextColor="#C7BAA5"
          />
        </>
      )}

      <Text style={cf.label}>
        {isNote ? "Note *" : "Teaser *"} <Text style={cf.labelMeta}>{teaser.length}/300</Text>
      </Text>
      <TextInput
        style={[cf.input, cf.textarea]}
        value={teaser}
        onChangeText={setTeaser}
        placeholder={isNote ? "What's on your mind…" : "A short description (up to 300 chars) that appears in the feed…"}
        placeholderTextColor="#C7BAA5"
        multiline
        numberOfLines={3}
      />

      {isNote && (
        <>
          <Text style={cf.label}>Location</Text>
          <TextInput
            style={cf.input}
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Nada, Anjuna"
            placeholderTextColor="#C7BAA5"
          />
        </>
      )}

      {!isNote && (
        <>
          <Text style={cf.label}>Article URL</Text>
          <TextInput
            style={cf.input}
            value={url}
            onChangeText={setUrl}
            placeholder="https://…"
            placeholderTextColor="#C7BAA5"
            autoCapitalize="none"
            keyboardType="url"
          />
        </>
      )}

      <Text style={cf.label}>
        Images <Text style={cf.labelMeta}>(portrait for notes · max 3 visible, scroll beyond)</Text>
      </Text>
      {imageUrls.map((val, idx) => (
        <View key={idx} style={cf.imageRow}>
          <TextInput
            style={[cf.input, { flex: 1 }]}
            value={val}
            onChangeText={(v) => updateImageUrl(idx, v)}
            placeholder="https://…"
            placeholderTextColor="#C7BAA5"
            autoCapitalize="none"
            keyboardType="url"
          />
          {imageUrls.length > 1 && (
            <Pressable onPress={() => removeImageUrl(idx)} hitSlop={8} style={cf.removeBtn}>
              <X size={13} color="#A09580" />
            </Pressable>
          )}
        </View>
      ))}
      <Pressable onPress={addImageField} style={cf.addImageBtn}>
        <Plus size={11} color="#684F44" strokeWidth={2} />
        <Text style={cf.addImageText}>Add image</Text>
      </Pressable>

      <View style={cf.actions}>
        <Pressable onPress={onCancel} style={cf.cancelBtn}>
          <Text style={cf.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            const imgs = imageUrls.map((u) => u.trim()).filter(Boolean);
            canSubmit && onSubmit({
              title: isNote ? (teaser.trim().slice(0, 60) || "Note") : title.trim(),
              teaser: teaser.trim(),
              external_url: url.trim(),
              cover_image_url: imgs[0] || "",
              post_type: postType,
              location: location.trim(),
              images: imgs,
            });
          }}
          style={[cf.submitBtn, !canSubmit && cf.submitBtnDisabled]}
          disabled={!canSubmit || loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FAF8F0" />
          ) : (
            <Text style={cf.submitText}>Post to feed</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ── Inline editable coffee card (owner: add bean flow) ────────────────────────
// Placeholder: Figma 249:3318 — cream card, 1.5px #C7BAA5 border, centered + circle
// Edit form:   Figma 249:3486 — slides in from right, fonts match CoffeeLabel exactly

const FIGMA_PLUS_CIRCLE = "http://localhost:3845/assets/8182ea219df131a1b7ca4a7f642682c8be601932.svg";
// Figma 267:3624 — accept: pink circle, brown checkmark
const FIGMA_ACCEPT_BTN = "http://localhost:3845/assets/d153680d1349e19a705c9c0d77c35690ee19a2c4.svg";
// Figma 267:3661 — reject: brown circle, white X
const FIGMA_REJECT_BTN = "http://localhost:3845/assets/d7a931d010019b53a34ac6d27ac929a105917afa.svg";
const IMAGE_RATIO_CARD = 160 / 372;

function EditableCoffeeCard({
  roasterName,
  width,
  height,
  onSave,
}: {
  roasterName: string;
  width: number;
  height: number;
  onSave: (data: any) => Promise<void>;
}) {
  const [mode, setMode] = useState<"placeholder" | "editing">("placeholder");

  // Field states
  const [coffeeName, setCoffeeName] = useState("");
  const [beanType, setBeanType] = useState("");
  const [processVal, setProcessVal] = useState("");
  const [roastLevel, setRoastLevel] = useState("");
  const [tastingNotes, setTastingNotes] = useState("");
  const [origin, setOrigin] = useState("");
  const [varietal, setVarietal] = useState("");
  const [altitudeMasl, setAltitudeMasl] = useState("");
  const [flavorNotes, setFlavorNotes] = useState("");
  const [priceInr, setPriceInr] = useState("");
  const [weightGrams, setWeightGrams] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [cropY, setCropY] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const imgDragRef = useRef({ y: 0, cropY: 50 });
  const imgWrapRef = useRef<View>(null);

  // Edit form slides in from right over placeholder
  const editSlideAnim = useRef(new Animated.Value(width)).current;
  // Exit on save
  const saveAnim = useRef(new Animated.Value(1)).current;

  const resetFields = useCallback(() => {
    setCoffeeName(""); setBeanType(""); setProcessVal(""); setRoastLevel("");
    setTastingNotes(""); setOrigin(""); setVarietal(""); setAltitudeMasl("");
    setFlavorNotes(""); setPriceInr(""); setWeightGrams(""); setProductUrl("");
    setShowUrlInput(false); setImageUrl(""); setCropY(50);
    setShowImageModal(false); setSaving(false);
  }, []);

  const handleOpenEdit = useCallback(() => {
    setMode("editing");
    editSlideAnim.setValue(width);
    saveAnim.setValue(1);
    Animated.timing(editSlideAnim, {
      toValue: 0, duration: 260, useNativeDriver: true,
      easing: Easing.out(Easing.cubic),
    }).start();
  }, [editSlideAnim, width]);

  const handleCancel = useCallback(() => {
    Animated.timing(editSlideAnim, {
      toValue: width, duration: 200, useNativeDriver: true,
      easing: Easing.in(Easing.cubic),
    }).start(() => {
      setMode("placeholder");
      resetFields();
    });
  }, [editSlideAnim, width, resetFields]);

  const handleImgDragStart = useCallback((e: any) => {
    e.preventDefault();
    imgDragRef.current = { y: e.clientY, cropY };
    setIsDragging(true);
    const handleMove = (ev: MouseEvent) => {
      const el = (imgWrapRef.current as unknown as HTMLElement);
      if (!el) return;
      const h = el.getBoundingClientRect().height;
      const delta = ((ev.clientY - imgDragRef.current.y) / h) * 100;
      setCropY(Math.max(0, Math.min(100, imgDragRef.current.cropY - delta)));
    };
    const handleUp = () => {
      setIsDragging(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [cropY]);

  const handleSave = useCallback(async () => {
    if (!coffeeName.trim() || saving) return;
    const data = {
      coffee_name: coffeeName.trim(),
      bean_type: beanType.trim() || null,
      process: processVal.trim() || null,
      roast_level: roastLevel.trim() || null,
      tasting_notes: tastingNotes.trim() || null,
      origin: origin.trim() || null,
      varietal: varietal.trim() || null,
      altitude_masl: altitudeMasl ? parseInt(altitudeMasl) : null,
      flavor_notes: flavorNotes.trim() || null,
      price_inr: priceInr ? parseFloat(priceInr) : null,
      weight_grams: weightGrams ? parseInt(weightGrams) : null,
      product_url: productUrl.trim() || null,
      image_url: imageUrl || null,
      description_raw: null,
    };
    Animated.sequence([
      Animated.timing(saveAnim, { toValue: 1.03, duration: 120, useNativeDriver: true }),
      Animated.timing(saveAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(async () => {
      setSaving(true);
      await onSave(data);
      setSaving(false);
      // Reset back to placeholder
      setMode("placeholder");
      resetFields();
      editSlideAnim.setValue(width);
      saveAnim.setValue(1);
    });
  }, [coffeeName, beanType, processVal, roastLevel, tastingNotes, origin, varietal,
      altitudeMasl, flavorNotes, priceInr, weightGrams, productUrl, imageUrl, saving, onSave, width, resetFields]);

  const imageH = Math.round(height * IMAGE_RATIO_CARD);
  const infoH = height - imageH;
  const canSave = coffeeName.trim().length > 0;
  const BTN_SZ = 31; // matches CoffeeCard BTN_SIZE

  return (
    <View style={[ec.outerWrap, { width, height }]}>

      {/* ── PLACEHOLDER — Figma 249:3318 ── */}
      <Pressable onPress={handleOpenEdit} style={[ec.placeholder, { width, height }]}>
        <Image source={{ uri: FIGMA_PLUS_CIRCLE }} style={ec.plusIcon} contentFit="contain" />
      </Pressable>

      {/* ── EDIT FORM — slides in from right ── */}
      {mode === "editing" && (
        <Animated.View style={[ec.editCard, { width, height, opacity: saveAnim, transform: [{ translateX: editSlideAnim }, { scale: saveAnim }] }]}>

          {/* Image area */}
          <View
            ref={imgWrapRef as any}
            style={[ec.imageArea, { height: imageH },
              imageUrl && isDragging && { cursor: "grabbing" } as any,
              imageUrl && !isDragging && { cursor: "grab" } as any,
            ]}
            {...(imageUrl && Platform.OS === "web" ? { onMouseDown: handleImgDragStart } : {})}
          >
            {imageUrl ? (
              <>
                <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" contentPosition={{ top: `${cropY}%`, left: "50%" }} />
                {!isDragging && (
                  <View style={ec.imgHint} pointerEvents="none">
                    <Text style={ec.imgHintText}>Drag to reposition</Text>
                  </View>
                )}
                <Pressable onPress={() => setShowImageModal(true)} style={ec.changePhotoBtn}>
                  <Camera size={12} color="#FAF8F0" strokeWidth={1.5} />
                  <Text style={ec.changePhotoBtnText}>Change photo</Text>
                </Pressable>
              </>
            ) : (
              <Pressable onPress={() => setShowImageModal(true)} style={ec.imagePlaceholder}>
                <Camera size={28} color="#684F44" strokeWidth={1.2} />
                <Text style={ec.addPhotoText}>Add Photo</Text>
              </Pressable>
            )}

            {/* Reject — top-left, Figma 267:3661 (brown circle, white X) */}
            <Pressable onPress={handleCancel} style={ec.rejectBtn} hitSlop={8}>
              <Svg width={29.16} height={29.16} viewBox="0 0 29.16 29.16" fill="none">
                <Circle cx={14.58} cy={14.58} r={14.58} fill="#351101" />
                <Path d="M10.58 10.58L18.58 18.58M18.58 10.58L10.58 18.58" stroke="#FAF8F0" strokeWidth={1.5} strokeLinecap="round" />
              </Svg>
            </Pressable>

            {/* Accept — top-right, Figma 267:3624 (pink circle, brown checkmark) */}
            <Pressable onPress={handleSave} style={ec.acceptBtn} disabled={!canSave || saving} hitSlop={8}>
              {saving
                ? <View style={ec.acceptLoading}><ActivityIndicator size="small" color="#351101" /></View>
                : <Image source={{ uri: FIGMA_ACCEPT_BTN }} style={ec.overlayBtnIcon} contentFit="contain" />
              }
            </Pressable>
          </View>

          {/* Info area — Figma 267:3609: padding 15.4 left, 12 top */}
          <View style={[ec.infoArea, { minHeight: infoH, flex: 1 }]}>

            {/* Coffee name — Figma: y=12, h=25 */}
            <TextInput style={ec.nameInput} value={coffeeName} onChangeText={setCoffeeName} placeholder="Add Coffee Name" placeholderTextColor="#351101" multiline />

            {/* By roaster — Figma: y=69 (gap from name = name wraps into space) */}
            <View style={ec.roasterRow}>
              <Text style={ec.byLine}>By {roasterName}</Text>
            </View>

            {/* Divider — Figma: y=88, gap above=6.8, gap below=6.5 */}
            <View style={ec.divider} />

            {/* Bean type — added manually, same row height as process/roast */}
            <View style={ec.fieldRow}>
              <TextInput style={ec.fieldRowInput} value={beanType} onChangeText={setBeanType} placeholder="Add Bean Type" placeholderTextColor="#684F44" />
            </View>
            <View style={ec.divider} />

            {/* Process • Roast — persistent labels + editable inputs */}
            <View style={ec.fieldRow}>
              <Text style={ec.fieldLabel}>Process </Text>
              <TextInput style={ec.fieldRowInput} value={processVal} onChangeText={setProcessVal} placeholder="" placeholderTextColor="#684F44" />
              <Text style={ec.dot}> • </Text>
              <Text style={ec.fieldLabel}>Roast </Text>
              <TextInput style={ec.fieldRowInput} value={roastLevel} onChangeText={setRoastLevel} placeholder="" placeholderTextColor="#684F44" />
            </View>
            <View style={ec.divider} />

            {/* Tasting notes */}
            <View style={ec.fieldRow}>
              <TextInput style={ec.fieldRowInput} value={tastingNotes} onChangeText={setTastingNotes} placeholder="Add Tasting Notes" placeholderTextColor="#684F44" />
            </View>
            <View style={ec.divider} />

            {/* Bottom row — price left, cart right */}
            <View style={ec.bottomRow}>
              {/* Price + weight: baseline-aligned so small text sits on same baseline as large price */}
              <View style={ec.priceWeightRow}>
                <Text style={ec.rupee}>₹ </Text>
                <TextInput style={ec.priceInput} value={priceInr} onChangeText={setPriceInr} placeholder="––––" placeholderTextColor="#351101" keyboardType="numeric" />
                <View style={ec.weightGroup}>
                  <Text style={ec.weightText}>/  </Text>
                  <TextInput style={ec.weightInput} value={weightGrams} onChangeText={setWeightGrams} placeholder="–––" placeholderTextColor="#351101" keyboardType="numeric" />
                  <Text style={ec.weightText}>  g</Text>
                </View>
              </View>
              <Pressable onPress={() => setShowUrlInput(true)}>
                <CartIcon size={BTN_SZ} />
              </Pressable>
            </View>
          </View>

          {/* URL modal — opened by cart icon, like ImageUploadModal */}
          <Modal visible={showUrlInput} transparent animationType="fade" onRequestClose={() => setShowUrlInput(false)}>
            <View style={ec.urlModalOverlay}>
              <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setShowUrlInput(false)} />
              <View style={ec.urlModalCard}>
                <View style={ec.urlModalHeader}>
                  <Text style={ec.urlModalTitle}>Product URL</Text>
                  <Pressable onPress={() => setShowUrlInput(false)} hitSlop={8}><X size={14} color="#A09580" /></Pressable>
                </View>
                <TextInput style={ec.urlModalInput} value={productUrl} onChangeText={setProductUrl} placeholder="https://..." placeholderTextColor="#C7BAA5" autoCapitalize="none" autoFocus />
                <Pressable onPress={() => setShowUrlInput(false)} style={ec.urlModalDone}>
                  <Text style={ec.urlModalDoneText}>Done</Text>
                </Pressable>
              </View>
            </View>
          </Modal>

          <ImageUploadModal
            visible={showImageModal}
            title="Add bean photo"
            purpose="hero"
            currentUrl={imageUrl}
            onConfirm={(url) => { setImageUrl(url); setShowImageModal(false); }}
            onClose={() => setShowImageModal(false)}
          />
        </Animated.View>
      )}
    </View>
  );
}

const ec = StyleSheet.create({
  // Outer wrapper — no shadow, clips edit form slide-in
  outerWrap: {
    borderRadius: 5,
    overflow: "hidden",
    position: "relative",
  },

  // Figma 249:3318 — cream bg, 1.5px #C7BAA5 border, centered + circle
  placeholder: {
    position: "absolute",
    top: 0,
    left: 0,
    backgroundColor: "#FAF8F0",
    borderWidth: 1.5,
    borderColor: "#C7BAA5",
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  plusIcon: { width: 44, height: 44 },

  // Edit form — slides in from right, no shadow
  editCard: {
    position: "absolute",
    top: 0,
    left: 0,
    backgroundColor: "#EFE9DB",
    borderTopLeftRadius: 3.624,
    borderTopRightRadius: 3.624,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
  },

  // Image section
  imageArea: {
    backgroundColor: "#d4c5b8",
    borderTopLeftRadius: 3.624,
    borderTopRightRadius: 3.624,
    overflow: "hidden",
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#e8e0d0",
  },
  // Figma 267:3668 — Inter Regular 10.246px #684F44
  addPhotoText: { fontFamily: fonts.bodyRegular, fontSize: 10.246, color: "#684F44" },
  imgHint: { position: "absolute", bottom: 8, left: 0, right: 0, alignItems: "center" },
  imgHintText: {
    fontFamily: fonts.bodyRegular, fontSize: 10, color: "rgba(255,255,255,0.75)",
    backgroundColor: "rgba(0,0,0,0.25)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4,
  },
  changePhotoBtn: {
    position: "absolute", bottom: 8, right: 8, flexDirection: "row", alignItems: "center",
    gap: 4, backgroundColor: "rgba(0,0,0,0.4)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4,
  },
  changePhotoBtnText: { fontFamily: fonts.bodyMedium, fontSize: 10, color: "#FAF8F0" },

  // Reject — top-left, Figma 267:3661
  rejectBtn: {
    position: "absolute",
    top: 10,
    left: 12,
    zIndex: 10,
  },
  // Accept — top-right, Figma 267:3624
  acceptBtn: {
    position: "absolute",
    top: 10,
    right: 12,
    zIndex: 10,
  },
  overlayBtnIcon: {
    width: 29,
    height: 29,
  },
  acceptLoading: {
    width: 29, height: 29, borderRadius: 14.5,
    backgroundColor: "#D798DA", alignItems: "center", justifyContent: "center",
  },

  // Figma 267:3609 — padding: left=15, top=12
  infoArea: {
    paddingHorizontal: 15,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: "#EFE9DB",
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
  },

  // Figma 267:3611 — Canela Text Regular 21.376px, lineHeight 25, #351101
  nameInput: {
    fontFamily: fonts.displayRegular, fontSize: 21.376, color: "#351101",
    lineHeight: 25, padding: 0, margin: 0, borderWidth: 0,
    ...(Platform.OS === "web" ? { outlineStyle: "none", fontFeatureSettings: "'lnum', 'pnum'" } : {}),
  } as any,

  // Figma 267:3612 — Inter Regular 10.9px #684F44
  roasterRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  byLine: { fontFamily: fonts.bodyRegular, fontSize: 10.9, color: "#684F44" },

  // Figma dividers — 1px #C7BAA5, 6.5px above and below (centers the 12px-tall fields)
  divider: { height: 1, backgroundColor: "#C7BAA5", marginTop: 6.5, marginBottom: 6.5 },

  // All field rows — identical container so divider spacing is uniform
  fieldRow: { flexDirection: "row", alignItems: "center", height: 12 },
  // Persistent label before an input (stays visible while user types)
  fieldLabel: { fontFamily: fonts.bodyRegular, fontSize: 9.563, color: "#684F44" },
  // All field inputs — Inter Regular 9.563px #684F44, identical styling
  fieldRowInput: {
    fontFamily: fonts.bodyRegular, fontSize: 9.563, color: "#684F44",
    padding: 0, margin: 0, borderWidth: 0, flex: 1, height: 12,
    ...(Platform.OS === "web" ? { outlineStyle: "none", fontFeatureSettings: "'lnum', 'pnum'" } : {}),
  } as any,
  dot: {
    fontFamily: fonts.bodyRegular, fontSize: 9.563, color: "#684F44",
    lineHeight: 12,
    ...(Platform.OS === "web" ? { fontFeatureSettings: "'lnum', 'pnum'" } : {}),
  } as any,

  // Bottom row — price left, cart right
  bottomRow: {
    flexDirection: "row", alignItems: "flex-end",
    justifyContent: "space-between", marginTop: "auto" as any,
  },
  priceWeightRow: { flexDirection: "row", alignItems: "baseline" },
  // Figma 267:3616 — Canela 17.077px, element height 26px
  rupee: {
    fontFamily: fonts.displayRegular, fontSize: 17.077, color: "#351101",
    lineHeight: 26, height: 26,
    ...(Platform.OS === "web" ? { fontFeatureSettings: "'lnum', 'pnum'" } : {}),
  } as any,
  priceInput: {
    fontFamily: fonts.displayRegular, fontSize: 17.077, color: "#351101",
    lineHeight: 26, height: 26, width: 44,
    padding: 0, margin: 0, borderWidth: 0,
    ...(Platform.OS === "web" ? { outlineStyle: "none", fontFeatureSettings: "'lnum', 'pnum'" } : {}),
  } as any,
  // Figma 267:3617 — Inter 9.563px, baseline-aligned with price
  weightGroup: {
    flexDirection: "row", alignItems: "baseline",
  },
  weightText: {
    fontFamily: fonts.bodyRegular, fontSize: 9.563, color: "#351101",
    ...(Platform.OS === "web" ? { fontFeatureSettings: "'lnum', 'pnum'" } : {}),
  } as any,
  weightInput: {
    fontFamily: fonts.bodyRegular, fontSize: 9.563, color: "#351101",
    height: 14, width: 22,
    padding: 0, margin: 0, borderWidth: 0,
    ...(Platform.OS === "web" ? { outlineStyle: "none", fontFeatureSettings: "'lnum', 'pnum'" } : {}),
  } as any,

  // URL modal — opened by cart icon
  urlModalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  urlModalCard: {
    width: 320, backgroundColor: "#FAF8F0", borderRadius: 8,
    padding: 20,
  },
  urlModalHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 12,
  },
  urlModalTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: "#351101" },
  urlModalInput: {
    borderWidth: 1, borderColor: "#D7D1C4", borderRadius: 4,
    paddingHorizontal: 10, paddingVertical: 8,
    fontFamily: fonts.bodyRegular, fontSize: 13, color: "#351101",
    backgroundColor: "#FEFDFB",
  } as any,
  urlModalDone: {
    marginTop: 12, alignSelf: "flex-end" as any,
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 4, backgroundColor: "#351101",
  },
  urlModalDoneText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: "#FAF8F0" },
});

const cf = StyleSheet.create({
  wrap: {
    padding: 24,
    backgroundColor: "#FAF8F0",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  heading: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: "#351101",
  },
  typeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 4,
  },
  typeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#D7D1C4",
    backgroundColor: "#FEFDFB",
  },
  typeBtnActive: {
    borderColor: "#351101",
    backgroundColor: "#351101",
  },
  typeBtnText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: "#684F44" },
  typeBtnTextActive: { color: "#FAF8F0" },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: "#684F44",
    marginBottom: 5,
    marginTop: 12,
  },
  labelMeta: {
    fontFamily: fonts.bodyRegular,
    color: "#A09580",
  },
  input: {
    borderWidth: 1,
    borderColor: "#D7D1C4",
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: "#351101",
    backgroundColor: "#FEFDFB",
  } as any,
  textarea: {
    minHeight: 72,
    textAlignVertical: "top" as any,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
    justifyContent: "flex-end" as any,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#D7D1C4",
  },
  cancelText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#684F44" },
  submitBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4,
    backgroundColor: "#351101",
  },
  submitBtnDisabled: { backgroundColor: "#A09580" },
  submitText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: "#FAF8F0" },
  imageRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 } as any,
  removeBtn: { padding: 4 },
  addImageBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    marginTop: 4, marginBottom: 2,
    paddingVertical: 5, alignSelf: "flex-start" as any,
  },
  addImageText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#684F44" },
  twoCol: { flexDirection: "row", gap: 12 } as any,
  colHalf: { flex: 1 } as any,
});

// ── Main page ─────────────────────────────────────────────────────────────────

const NAVBAR_H = 72;

export default function RoasterDetailPage() {
  const { slug, edit } = useLocalSearchParams<{ slug: string; edit?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { products, roasters, appendProducts, removeProduct } = useCoffeeData();
  const { getProfile, refreshProfiles, loading: profileLoading } = useRoasterProfiles();
  const { height: winH } = useWindowDimensions();

  // Primary lookup: roasters derived from the product catalog
  const productRoaster = roasters.find((r: any) => r.slug === slug);
  // Secondary lookup: rich profile data from roasters.json / API
  const profile = getProfile(slug, productRoaster?.website, productRoaster?.name);

  // Synthesise a roaster object from whichever source has data
  const roaster = productRoaster ?? (profile ? {
    slug: profile.roaster_slug ?? slug,
    name: profile.name ?? slug,
    city: profile.city ?? null,
    website: profile.website ?? null,
  } : null);

  const catalogCoffees = useMemo(() => products.filter((p: any) => p.roaster_slug === slug), [products, slug]);
  const [localCoffees, setLocalCoffees] = useState<any[]>([]);
  const [deletedProductIds, setDeletedProductIds] = useState<Set<string>>(new Set());
  const coffees = useMemo(() => {
    const seen = new Set<string>();
    return [...localCoffees, ...catalogCoffees].filter((c) => {
      const id = c.product_id ?? c.id;
      if (deletedProductIds.has(id)) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [localCoffees, catalogCoffees, deletedProductIds]);

  const isOwner = user?.account_type === "roaster" && user?.roaster_slug === slug;

  // Posts state
  const [featuredPosts, setFeaturedPosts] = useState<any[]>([]);
  const [allPosts, setAllPosts] = useState<any[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);

  // Follow state (persistent via API)
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);

  useEffect(() => {
    if (!slug) return;
    // Load followers
    apiFetch(`/roasters/${slug}/followers`).then((d) => {
      setFollowerCount(d.follower_count);
      setFollowers(d.followers || []);
    }).catch(() => {});
    // Load follow status for current user
    apiFetch(`/roasters/${slug}/follow-status`).then((d) => setFollowing(d.following)).catch(() => {});
  }, [slug]);

  const handleFollowToggle = useCallback(async () => {
    try {
      const res = await apiFetch(`/roasters/${slug}/follow`, { method: "POST" });
      setFollowing(res.following);
      setFollowerCount(res.follower_count);
      // Refresh followers list
      apiFetch(`/roasters/${slug}/followers`).then((d) => setFollowers(d.followers || [])).catch(() => {});
    } catch {
      setFollowing((f) => !f);
    }
  }, [slug]);

  // Compose form
  const [showCompose, setShowCompose] = useState(false);
  const [composing, setComposing] = useState(false);

  // Right panel tabs
  const [activeRightTab, setActiveRightTab] = useState<"posts" | "beans" | "followers">("posts");
  const [followers, setFollowers] = useState<any[]>([]);

  // Default to beans tab if roaster has no posts
  useEffect(() => {
    if (postsLoading) return;
    const hasPosts = isOwner ? allPosts.length > 0 : featuredPosts.length > 0;
    if (!hasPosts) setActiveRightTab("beans");
  }, [postsLoading, allPosts, featuredPosts, isOwner]);

  // About expand
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const ABOUT_LIMIT = 260;

  // ── In-place editing (owner only) ───────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(edit === "1");

  // Sync edit state when ?edit=1 param changes (e.g. navigating from dropdown)
  useEffect(() => {
    if (edit === "1" && isOwner) setIsEditing(true);
  }, [edit, isOwner]);
  const [saving, setSaving] = useState(false);

  const heroImageUrl = useMemo(
    () => profile?.hero_image_url || (!profileLoading && coffees.find((c: any) => c.image_url)?.image_url) || null,
    [profile, coffees, profileLoading]
  );
  const logoUrl = profile?.logo_url ?? null;
  const specialtyTags: string[] = (profile?.specialties && profile.specialties.length > 0)
    ? profile.specialties.slice(0, 4)
    : ["Single Origin", "Estate Grown", "Specialty Grade"];
  const city = roaster?.city || profile?.city || null;
  const website = roaster?.website || profile?.website || null;
  const aboutBlurb = profile?.about_blurb || null;

  // Edit form state — initialized from current profile values
  const [editAbout, setEditAbout] = useState(aboutBlurb || "");
  const [editSpecialties, setEditSpecialties] = useState(specialtyTags.join(", "));
  const [editWebsite, setEditWebsite] = useState(website || "");
  const [editCity, setEditCity] = useState(city || "");
  const [editLogo, setEditLogo] = useState(logoUrl || "");
  const [editHero, setEditHero] = useState(heroImageUrl || "");
  const heroCropY = profile?.hero_crop_y ?? 50;
  const [editCropY, setEditCropY] = useState(heroCropY);
  const [isDraggingHero, setIsDraggingHero] = useState(false);
  const dragStartRef = useRef({ y: 0, cropY: 50 });
  const heroWrapRef = useRef<View>(null);
  const [showLogoUpload, setShowLogoUpload] = useState(false);
  const [showHeroUpload, setShowHeroUpload] = useState(false);

  // Sync form state when entering edit mode OR when profile data loads
  useEffect(() => {
    if (isEditing) {
      setEditAbout(aboutBlurb || "");
      setEditSpecialties(specialtyTags.join(", "));
      setEditWebsite(website || "");
      setEditCity(city || "");
      setEditLogo(logoUrl || "");
      setEditHero(heroImageUrl || "");
      setEditCropY(heroCropY);
    }
  }, [isEditing, aboutBlurb, profile]);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const specs = editSpecialties.split(",").map((s) => s.trim()).filter(Boolean);
      await apiFetch(`/roasters/${slug}/profile`, {
        method: "PUT",
        body: JSON.stringify({
          about_blurb: editAbout,
          specialties: specs,
          website: editWebsite,
          city: editCity,
          logo_url: editLogo,
          hero_image_url: editHero,
          hero_crop_y: editCropY,
        }),
      });
      await refreshProfiles();
      setIsEditing(false);
      // Remove ?edit=1 from URL
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("edit");
        window.history.replaceState({}, "", url.toString());
      }
    } catch (e) {
      console.warn("Save roaster profile error:", e);
    } finally {
      setSaving(false);
    }
  };

  // ── Hero drag-to-reposition (web mouse events) ─────────────────────────────
  const handleHeroDragStart = useCallback((e: any) => {
    if (!isEditing) return;
    e.preventDefault();
    dragStartRef.current = { y: e.clientY, cropY: editCropY };
    setIsDraggingHero(true);

    const handleMove = (ev: MouseEvent) => {
      const heroEl = (heroWrapRef.current as unknown as HTMLElement);
      if (!heroEl) return;
      const containerH = heroEl.getBoundingClientRect().height;
      // Moving mouse down → image moves up → cropY decreases (shows lower part)
      // Invert: dragging down should reveal top = increase cropY
      const deltaY = ev.clientY - dragStartRef.current.y;
      const deltaPct = (deltaY / containerH) * 100;
      const newCropY = Math.max(0, Math.min(100, dragStartRef.current.cropY - deltaPct));
      setEditCropY(newCropY);
    };

    const handleUp = () => {
      setIsDraggingHero(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [isEditing, editCropY]);

  const loadPosts = useCallback(async () => {
    try {
      setPostsLoading(true);
      const fp = await apiFetch<any>(`/roasters/${slug}/posts/featured`);
      setFeaturedPosts(fp.featured_posts || []);
      // Owner always loads all posts for management
      if (isOwner) {
        const all = await apiFetch<any>(`/roasters/${slug}/posts`);
        setAllPosts(all.posts || []);
      }
    } catch (e) {
      console.warn("Posts load error:", e);
      setFeaturedPosts([]);
      setAllPosts([]);
    } finally {
      setPostsLoading(false);
    }
  }, [slug, isOwner]);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  const handleFeatureToggle = useCallback(async (postId: number) => {
    try {
      await apiFetch(`/roaster-posts/${postId}/feature`, { method: "PUT" });
      await loadPosts();
    } catch (e: any) {
      console.warn("Feature toggle error:", e.message);
    }
  }, [loadPosts]);

  const handleDeleteProduct = useCallback(async (productId: string) => {
    // Remove immediately from all three sources — no reload needed
    setDeletedProductIds((prev) => new Set([...prev, productId]));       // instant UI filter
    setLocalCoffees((prev) => prev.filter((c) => (c.product_id ?? c.id) !== productId)); // local state
    removeProduct(productId);                                              // global context
    try {
      const isRoasterManaged = productId.startsWith("rp_");
      if (isRoasterManaged) {
        // Roaster-managed product — real DELETE from DB
        const numericId = productId.replace(/^rp_/, "");
        await apiFetch(`/roasters/${slug}/products/${numericId}`, { method: "DELETE" });
      } else {
        // Scraped product — persistently hide via hidden_products table
        await apiFetch(`/roasters/${slug}/products/hide`, {
          method: "POST",
          body: JSON.stringify({ product_id: productId }),
        });
      }
    } catch (e: any) {
      console.warn("Delete product error:", e.message);
    }
  }, [slug, removeProduct]);

  const handleCreatePost = useCallback(async (data: any) => {
    try {
      setComposing(true);
      await apiFetch("/roaster-posts", {
        method: "POST",
        body: JSON.stringify({
          title: data.title,
          teaser: data.teaser,
          external_url: data.external_url || null,
          cover_image_url: data.cover_image_url || null,
          post_type: data.post_type || "article",
          location: data.location || null,
          images: data.images || [],
        }),
      });
      setShowCompose(false);
      await loadPosts();
    } catch (e: any) {
      console.warn("Create post error:", e.message);
    } finally {
      setComposing(false);
    }
  }, [loadPosts]);

  const handleCreateProduct = useCallback(async (data: any) => {
    try {
      const raw = await apiFetch(`/roasters/${slug}/products`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      // Normalise to match the shape GET /products returns for roaster-managed
      // products: product_id is "rp_<db_id>", roaster_name is populated, etc.
      const normalised = {
        ...raw,
        product_id: `rp_${raw.id}`,
        roaster_slug: slug,
        roaster_name: roaster?.name ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
        _source: "roaster_managed",
      };
      // Show immediately on the roaster profile
      setLocalCoffees((prev) => [normalised, ...prev]);
      // Also inject into the global CoffeeDataContext so the marketplace sees it
      appendProducts([normalised]);
      setShowAddBean(false);
    } catch (e: any) {
      console.warn("Create product error:", e.message);
    }
  }, [slug, appendProducts, roaster]);

  if (!roaster) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Navbar />
        <View style={s.notFound}>
          <Text style={s.notFoundText}>Roaster not found</Text>
        </View>
      </>
    );
  }

  // For owner management: non-featured posts shown below
  const nonFeaturedPosts = allPosts.filter((p) => !p.is_featured);
  const featuredInAllPosts = allPosts.filter((p) => p.is_featured);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Navbar />

      {/* ── Edit mode top banner (under navbar, full width) ───── */}
      {isOwner && isEditing && (
        <View style={s.editBanner}>
          <View style={s.editBannerLeft}>
            <PenLine size={12} color="#D798DA" strokeWidth={2} />
            <Text style={s.editBannerLabel}>Editing profile</Text>
          </View>
          <View style={s.editBannerRight}>
            <Pressable onPress={() => setIsEditing(false)} style={s.editBannerDiscard}>
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
      )}

      <View style={[s.pageContainer, { height: isEditing ? winH - NAVBAR_H - 44 : winH - NAVBAR_H }]}>

        {/* ── LEFT PANEL (sticky, dark) ──────────────────────────────── */}
        <View style={[s.leftPanel, { height: isEditing ? winH - NAVBAR_H - 44 : winH - NAVBAR_H }, isEditing && { paddingBottom: 120 }]}>

          {/* Back */}
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <BackArrowIcon />
            <Text style={s.backText}>Back</Text>
          </Pressable>

          {/* Share */}
          <Pressable
            onPress={() => {
              if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
                navigator.clipboard.writeText(window.location.href);
              }
            }}
            style={s.shareRow}
          >
            <Text style={s.shareText}>SHARE</Text>
            <LeftPanelShareIcon color="#C7BAA5" />
          </Pressable>

          {/* Roaster name */}
          <Text style={[s.roasterName, liningNumerals]} numberOfLines={3}>
            {roaster.name}
          </Text>

          {/* ── About blurb (in-place editable) ── */}
          {isEditing ? (
            <View style={s.aboutBlock}>
              <TextInput
                style={[s.aboutText, s.inlineEdit]}
                value={editAbout}
                onChangeText={setEditAbout}
                placeholder="Tell people about your roastery…"
                placeholderTextColor="rgba(199,186,165,0.35)"
                multiline
              />
            </View>
          ) : aboutBlurb ? (
            <View style={s.aboutBlock}>
              <Text style={s.aboutText}>
                {aboutExpanded || aboutBlurb.length <= ABOUT_LIMIT
                  ? aboutBlurb
                  : aboutBlurb.slice(0, ABOUT_LIMIT) + "…"}
                {aboutBlurb.length > ABOUT_LIMIT && (
                  <Text
                    onPress={() => setAboutExpanded((v) => !v)}
                    style={s.aboutMore}
                  >
                    {aboutExpanded ? " less" : " more"}
                  </Text>
                )}
              </Text>
            </View>
          ) : isOwner ? (
            <Pressable onPress={() => setIsEditing(true)} style={s.aboutBlock}>
              <Text style={[s.aboutText, { opacity: 0.4 }]}>Tap the pencil to add your story…</Text>
            </Pressable>
          ) : null}

          {/* ── Logo upload (edit-mode only) ── */}
          {isEditing && (
            <Pressable onPress={() => setShowLogoUpload(true)} style={s.uploadTrigger}>
              {editLogo ? (
                <Image source={{ uri: editLogo }} style={s.uploadThumb} contentFit="cover" />
              ) : (
                <View style={s.uploadThumbEmpty}>
                  <Camera size={24} color="#C7BAA5" strokeWidth={1.5} />
                </View>
              )}
              <Text style={s.uploadTriggerText}>Change logo</Text>
            </Pressable>
          )}

          {/* Push footer to bottom (skip in edit mode so content scrolls naturally) */}
          {!isEditing && <View style={{ flex: 1 }} />}
          {isEditing && <View style={{ height: 24 }} />}

          {/* ── Specialty tags (in-place editable) ── */}
          <View style={s.tagBand}>
            {!isEditing && <View style={s.rule} />}
            {isEditing ? (
              <TextInput
                style={[s.tagText, s.inlineEditTag]}
                value={editSpecialties}
                onChangeText={setEditSpecialties}
                placeholder="Single Origin, Estate Grown"
                placeholderTextColor="rgba(199,186,165,0.35)"
              />
            ) : (
              <Text style={s.tagText}>{specialtyTags.join(" / ")}</Text>
            )}
            {!isEditing && <View style={s.rule} />}
          </View>

          {/* ── Meta row (website + city in-place editable, followers always read-only) ── */}
          <View style={s.metaRow}>
            {isEditing ? (
              <>
                <View style={s.metaItem}>
                  <ExternalLinkIcon />
                  <TextInput
                    style={s.inlineEditMeta}
                    value={editWebsite}
                    onChangeText={setEditWebsite}
                    placeholder="Website URL"
                    placeholderTextColor="rgba(199,186,165,0.35)"
                    autoCapitalize="none"
                  />
                </View>
                <View style={s.metaItem}>
                  <MapPinIcon />
                  <TextInput
                    style={s.inlineEditMeta}
                    value={editCity}
                    onChangeText={setEditCity}
                    placeholder="City"
                    placeholderTextColor="rgba(199,186,165,0.35)"
                  />
                </View>
              </>
            ) : (
              <>
                {website ? (
                  <Pressable onPress={() => Linking.openURL(website)} style={s.metaItem}>
                    <ExternalLinkIcon />
                    <Text style={s.metaText}>Website</Text>
                  </Pressable>
                ) : null}
                <View style={s.metaItem}>
                  <UsersIcon />
                  <Text style={s.metaText}>{followerCount} {followerCount === 1 ? "follower" : "followers"}</Text>
                </View>
                {city ? (
                  <View style={s.metaItem}>
                    <MapPinIcon />
                    <Text style={s.metaText}>{city}</Text>
                  </View>
                ) : null}
              </>
            )}
          </View>

          {!isEditing && <View style={s.rule} />}

          {/* Follow button — hidden for owner */}
          {!isOwner && (
            <View style={s.followRow}>
              <FollowButton following={following} onToggle={handleFollowToggle} />
            </View>
          )}
        </View>

        {/* ── RIGHT PANEL (scroll + floating compose button + modal) ── */}
        <View style={s.rightPanel}>
          <ScrollView
            style={s.rightScroll}
            contentContainerStyle={s.rightContent}
            showsVerticalScrollIndicator={false}
          >
          {/* Hero image — show editHero during edit mode, draggable to reposition */}
          <View
            ref={heroWrapRef}
            style={[s.heroImageWrap, isEditing && isDraggingHero && { cursor: "grabbing" } as any, isEditing && !isDraggingHero && { cursor: "grab" } as any]}
            {...(isEditing && Platform.OS === "web" ? { onMouseDown: handleHeroDragStart } : {})}
          >
            {(isEditing ? editHero : heroImageUrl) ? (
              <Image
                source={{ uri: isEditing ? editHero : heroImageUrl }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                contentPosition={{ top: `${isEditing ? editCropY : heroCropY}%`, left: "50%" }}
              />
            ) : (
              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "#1a0800" }]} />
            )}
            {/* Drag hint — shown in edit mode */}
            {isOwner && isEditing && !isDraggingHero && (
              <View style={s.heroDragHint} pointerEvents="none">
                <Text style={s.heroDragHintText}>Drag to reposition</Text>
              </View>
            )}
            {/* Change cover button — bottom-right */}
            {isOwner && isEditing && (
              <Pressable onPress={() => setShowHeroUpload(true)} style={s.heroEditBtn}>
                <Camera size={14} color="#FAF8F0" strokeWidth={1.5} />
                <Text style={s.heroEditBtnText}>Change cover</Text>
              </Pressable>
            )}
          </View>

          {/* ── Tab bar: POSTS | BEANS (hide POSTS if roaster has none) ── */}
          {(() => {
            const hasPosts = isOwner ? allPosts.length > 0 : featuredPosts.length > 0;
            const showTabs = !postsLoading && hasPosts;
            return (
              <>
                <View style={s.rightTabBar}>
                  {showTabs && (
                    <Pressable onPress={() => setActiveRightTab("posts")} style={[s.rightTab, activeRightTab === "posts" && s.rightTabActive]}>
                      <Text style={[s.rightTabText, activeRightTab === "posts" && s.rightTabTextActive]}>POSTS</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={() => setActiveRightTab("beans")} style={[s.rightTab, activeRightTab === "beans" && s.rightTabActive]}>
                    <Text style={[s.rightTabText, activeRightTab === "beans" && s.rightTabTextActive]}>BEANS</Text>
                  </Pressable>
                  <Pressable onPress={() => setActiveRightTab("followers")} style={[s.rightTab, activeRightTab === "followers" && s.rightTabActive]}>
                    <Text style={[s.rightTabText, activeRightTab === "followers" && s.rightTabTextActive]}>FOLLOWERS</Text>
                  </Pressable>
                </View>
                <View style={s.divider} />
              </>
            );
          })()}

          {/* ── POSTS TAB ─────────────────────────────────────────── */}
          {activeRightTab === "posts" && (
            <>
              {/* Public visitor: featured posts */}
              {!postsLoading && !isOwner && featuredPosts.length > 0 && (
                <>
                  <View style={s.divider} />
                  {featuredPosts.map((post, i) => (
                    <View key={post.id}>
                      <RoasterPostCard
                        post={post}
                        roasterName={roaster.name}
                        avatarUrl={logoUrl}
                        city={city}
                        isOwner={false}
                      />
                      {i < featuredPosts.length - 1 && <View style={s.divider} />}
                    </View>
                  ))}
                </>
              )}

              {/* Owner: featured posts first, then rest */}
              {isOwner && !postsLoading && allPosts.length > 0 && (() => {
                const featured = allPosts.filter((p) => p.is_featured).sort((a, b) => (a.featured_order ?? 9) - (b.featured_order ?? 9));
                const rest = allPosts.filter((p) => !p.is_featured);
                const slotsLeft = 2 - featured.length;
                const hint = featured.length === 0
                  ? "No featured posts yet — star up to 2 to pin them here."
                  : slotsLeft === 1
                  ? "1 featured slot remaining."
                  : null;
                const ordered = [...featured, ...rest];
                return (
                  <>
                    <View style={s.divider} />
                    {hint && (
                      <View style={s.featureHintRow}>
                        <Text style={s.featureHint}>{hint}</Text>
                      </View>
                    )}
                    {ordered.map((post, i) => (
                      <View key={post.id}>
                        <RoasterPostCard
                          post={post}
                          roasterName={roaster.name}
                          avatarUrl={logoUrl}
                          city={city}
                          isOwner
                          onFeatureToggle={handleFeatureToggle}
                        />
                        {i < ordered.length - 1 && (
                          <View style={post.is_featured ? s.divider : s.dividerLight} />
                        )}
                      </View>
                    ))}
                  </>
                );
              })()}

              {/* Owner: no posts yet */}
              {isOwner && !postsLoading && allPosts.length === 0 && (
                <>
                  <View style={s.divider} />
                  <View style={s.emptyPostsWrap}>
                    <Text style={s.emptyPostsTitle}>Share your story</Text>
                    <Text style={s.emptyPostsBody}>
                      Feature up to 2 posts on your profile — link to a journal entry, press coverage, or anything worth reading.
                    </Text>
                    <Pressable onPress={() => setShowCompose(true)} style={s.emptyPostsBtn}>
                      <Text style={s.emptyPostsBtnText}>Write your first post →</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </>
          )}

          {/* ── BEANS TAB ─────────────────────────────────────────── */}
          {activeRightTab === "beans" && (
            <>
              <Text style={[s.gridHeading, liningNumerals]}>
                {`Explore ${coffees.length} ${coffees.length === 1 ? "coffee" : "coffees"} from ${roaster.name}`}
              </Text>
              <CoffeeGrid
                coffees={coffees}
                isOwner={isOwner}
                onDeleteProduct={handleDeleteProduct}
                roasterName={roaster.name}
                onSaveCard={handleCreateProduct}
              />
            </>
          )}

          {/* ── FOLLOWERS TAB ──────────────────────────────────────── */}
          {activeRightTab === "followers" && (
            <View style={s.followersTab}>
              <Text style={s.followersCount}>
                {followerCount} {followerCount === 1 ? "follower" : "followers"}
              </Text>
              {followers.length === 0 ? (
                <View style={s.followersEmpty}>
                  <Text style={s.followersEmptyText}>No followers yet</Text>
                </View>
              ) : (
                followers.map((f: any, idx: number) => (
                  <View key={f.username}>
                    {idx > 0 && <View style={s.followerDivider} />}
                    <Pressable
                      onPress={() => router.push(`/user/${f.username}`)}
                      style={(state: any) => [s.followerRow, state.hovered && s.followerRowHovered]}
                    >
                      {f.avatar_url ? (
                        <Image source={{ uri: f.avatar_url }} style={s.followerAvatar} contentFit="cover" />
                      ) : (
                        <View style={s.followerAvatarFallback}>
                          <Text style={s.followerInitial}>
                            {(f.display_name || f.username || "?")[0].toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={s.followerInfo}>
                        <Text style={s.followerName} numberOfLines={1}>{f.display_name}</Text>
                        {f.location ? (
                          <View style={s.followerLocationRow}>
                            <MapPin size={12} color="#D798DA" strokeWidth={2} />
                            <Text style={s.followerLocation} numberOfLines={1}>{f.location}</Text>
                          </View>
                        ) : null}
                      </View>
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          )}

          <View style={{ height: 100 }} />
          </ScrollView>

          {/* ── Edit-mode dim overlay (covers right panel content) ─── */}
          {isEditing && <View style={s.editDimOverlay} pointerEvents="none" />}

          {/* ── Floating action button (owner, posts tab only) */}
          {isOwner && !isEditing && activeRightTab === "posts" && (
            <Pressable
              onPress={() => setShowCompose(true)}
              style={s.fab}
            >
              <Plus size={22} color="#FAF8F0" strokeWidth={2.5} />
            </Pressable>
          )}

          {/* ── Image upload modals ─────────────────────────────────── */}
          <ImageUploadModal
            visible={showLogoUpload}
            title="Upload Logo"
            purpose="logo"
            currentUrl={editLogo}
            onConfirm={(url) => setEditLogo(url)}
            onClose={() => setShowLogoUpload(false)}
          />
          <ImageUploadModal
            visible={showHeroUpload}
            title="Upload Cover Image"
            purpose="hero"
            currentUrl={editHero}
            onConfirm={(url) => setEditHero(url)}
            onClose={() => setShowHeroUpload(false)}
          />

          {/* ── Compose modal ────────────────────────────────────────── */}
          <Modal
            visible={showCompose}
            transparent
            animationType="fade"
            onRequestClose={() => setShowCompose(false)}
          >
            <View style={s.modalOverlay}>
              {/* Backdrop — tap to dismiss */}
              <Pressable
                style={StyleSheet.absoluteFillObject}
                onPress={() => setShowCompose(false)}
              />
              {/* Card */}
              <View style={s.modalCard}>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  <ComposePostForm
                    onSubmit={handleCreatePost}
                    onCancel={() => setShowCompose(false)}
                    loading={composing}
                  />
                </ScrollView>
              </View>
            </View>
          </Modal>

        </View>
      </View>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  notFound: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FAF8F0",
  },
  notFoundText: { fontFamily: fonts.bodyRegular, fontSize: 16, color: "#351101" },

  // Two-column layout — height set dynamically via winH - NAVBAR_H
  pageContainer: {
    flexDirection: "row",
    overflow: "hidden",
  } as any,

  // Left panel — height set dynamically, scrolls internally if content overflows
  // Figma: 603px wide, Back at y=126, SHARE at y=227 → paddingTop matches y=126
  leftPanel: {
    width: "42%" as any,
    backgroundColor: "#2a0d00",
    paddingHorizontal: "6.25%" as any,
    paddingTop: 126,
    paddingBottom: 32,
    flexDirection: "column",
    overflowY: "auto" as any,
    flexShrink: 0,
  } as any,

  // Back at y=126, SHARE at y=227 → gap between bottom of Back and top of SHARE ≈ 85px
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 85,
  },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: "#C7BAA5" },

  // SHARE text at y=227, roaster name at y=249 → 22px gap (14px text + 8px margin)
  shareRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  shareText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: "#C7BAA5",
    letterSpacing: 0.5,
  },

  roasterName: {
    fontFamily: fonts.displayRegular,
    fontSize: 56.8,
    color: "#FAF8F0",
    lineHeight: 63,
    marginTop: 8,
    marginBottom: 12,
  },

  aboutBlock: { paddingRight: 20 },
  aboutText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: "#C7BAA5",
    lineHeight: 18,
  },
  aboutMore: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: "#FAF8F0" },

  tagBand: { marginBottom: 14 },
  // Figma: rules are 280px wide, left-aligned (x=91 within panel)
  rule: {
    height: 1,
    width: 280,
    alignSelf: "flex-start" as any,
    backgroundColor: "rgba(250,248,240,0.25)",
    marginVertical: 0,
  },
  tagText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: "#FAF8F0",
    lineHeight: 18,
    paddingVertical: 8,
  },

  // Figma: meta row at y=537, specialty band bottom ~y=532 → 5px gap
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap" as any,
    gap: 20,
    marginTop: 5,
    marginBottom: 9,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: "#FAF8F0" },

  followRow: { marginTop: 14 },

  // ── In-place editing styles (owner only) ──────────────────────────────────

  // Inline edit fields — subtle background only, no borders
  inlineEdit: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: "rgba(250,248,240,0.06)",
    minHeight: 80,
    textAlignVertical: "top" as any,
  } as any,
  inlineEditTag: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(250,248,240,0.06)",
    textAlign: "center" as any,
    flex: 1,
  } as any,
  inlineEditSingle: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: "#FAF8F0",
    backgroundColor: "rgba(250,248,240,0.06)",
  } as any,
  inlineEditMeta: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: "#FAF8F0",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: "rgba(250,248,240,0.06)",
    minWidth: 80,
  } as any,

  // Logo upload trigger — small preview + "Change logo" text
  uploadTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    paddingVertical: 8,
  } as any,
  uploadThumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(199,186,165,0.3)",
  },
  uploadThumbEmpty: {
    width: 72,
    height: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(199,186,165,0.3)",
    borderStyle: "dashed" as any,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  uploadTriggerText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: "#C7BAA5",
    textDecorationLine: "underline" as any,
  },

  // Hero drag hint — centered overlay
  heroDragHint: {
    position: "absolute" as any,
    top: "50%" as any,
    left: "50%" as any,
    transform: [{ translateX: -70 }, { translateY: -14 }],
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  } as any,
  heroDragHintText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: "#FAF8F0",
  },

  // Hero edit button — pill, bottom-right of hero image
  heroEditBtn: {
    position: "absolute" as any,
    bottom: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  } as any,
  heroEditBtnText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: "#FAF8F0",
  },

  // Dim overlay on right panel during editing
  editDimOverlay: {
    position: "absolute" as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(250,248,240,0.5)",
    zIndex: 5,
  },

  // Edit banner — top of page, under navbar, full width
  editBanner: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between" as any,
    paddingHorizontal: 24,
    backgroundColor: "#351101",
  } as any,
  editBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  } as any,
  editBannerLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: "#D798DA",
  },
  editBannerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  } as any,
  editBannerDiscard: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(199,186,165,0.3)",
  },
  editBannerDiscardText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: "#C7BAA5" },
  editBannerSave: {
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: "#FAF8F0",
  },
  editBannerSaveText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: "#351101" },

  // Right panel wrapper — needed to anchor the FAB outside the ScrollView
  rightPanel: {
    flex: 1,
    position: "relative" as any,
    backgroundColor: "#FAF8F0",
  },

  // Right scrollable column — fills the panel
  rightScroll: {
    flex: 1,
  },
  rightContent: {
    flexGrow: 1,
  },

  // Floating action button — round circle, bottom-right of right panel
  fab: {
    position: "absolute" as any,
    bottom: 28,
    right: 28,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#351101",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 50,
  } as any,

  // Compose modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center" as any,
    alignItems: "center" as any,
  },
  modalCard: {
    backgroundColor: "#FAF8F0",
    borderRadius: 16,
    width: "90%" as any,
    maxWidth: 560,
    maxHeight: "85%" as any,
    overflow: "hidden" as any,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 16,
  } as any,

  // Right panel tab bar (POSTS | BEANS) — Figma 151:1783 thin divider style
  rightTabBar: {
    flexDirection: "row",
    backgroundColor: "#FAF8F0",
    paddingHorizontal: 28,
    gap: 32,
  } as any,
  rightTab: {
    paddingVertical: 14,
  },
  rightTabActive: {},
  rightTabText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: "#A09580",
  },
  rightTabTextActive: {
    color: "#351101",
  },

  // Hero image
  heroImageWrap: {
    width: "100%" as any,
    height: 334,
    backgroundColor: "#1a0800",
    position: "relative" as any,
    overflow: "hidden",
  } as any,

  // Section headers
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 4,
  },
  sectionLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    color: "#A09580",
    textTransform: "uppercase" as any,
    letterSpacing: 0.8,
  },
  featureHintRow: {
    paddingHorizontal: 28,
    paddingTop: 14,
    paddingBottom: 4,
  },
  featureHint: {
    fontFamily: fonts.bodyRegular,
    fontSize: 11,
    color: "#A09580",
    fontStyle: "italic" as any,
  },
  sectionHint: {
    fontFamily: fonts.bodyRegular,
    fontSize: 10.5,
    color: "#A09580",
  },

  // Empty posts state (owner)
  emptyPostsWrap: {
    marginHorizontal: 28,
    marginVertical: 24,
    padding: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D7D1C4",
    backgroundColor: "#FFFEFB",
  },
  emptyPostsTitle: {
    fontFamily: fonts.displayRegular,
    fontSize: 20,
    color: "#351101",
    marginBottom: 8,
  },
  emptyPostsBody: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: "#684F44",
    lineHeight: 19,
  },
  emptyPostsBtn: {
    marginTop: 14,
    alignSelf: "flex-start" as any,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#351101",
  },
  emptyPostsBtnText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#351101" },

  // Dividers — Figma 151:1783 thin subtle line
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(215,209,196,0.5)", marginHorizontal: 20 },
  dividerLight: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(215,209,196,0.35)", marginHorizontal: 20 },

  // Followers tab — Figma 42:4128 row style
  followersTab: {
    paddingHorizontal: 28,
    paddingTop: 20,
  },
  followersCount: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: "#351101",
    marginBottom: 16,
  },
  followersEmpty: {
    paddingVertical: 40,
    alignItems: "center",
  } as any,
  followersEmptyText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    color: "#A09580",
  },
  followerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 6,
  } as any,
  followerRowHovered: {
    backgroundColor: "#D798DA",
  },
  followerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(215,209,196,0.5)",
  },
  followerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  followerAvatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#351101",
    alignItems: "center",
    justifyContent: "center",
  } as any,
  followerInitial: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 18,
    color: "#FAF8F0",
  },
  followerInfo: {
    flex: 1,
    minWidth: 0,
  },
  followerName: {
    fontFamily: fonts.bodyRegular,
    fontSize: 18,
    color: "#351101",
  },
  followerLocationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  } as any,
  followerLocation: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: "#684F44",
  },

  // Grid heading
  gridHeading: {
    fontFamily: fonts.displayRegular,
    fontSize: 20,
    color: "#351101",
    lineHeight: 28,
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 20,
  },
});
