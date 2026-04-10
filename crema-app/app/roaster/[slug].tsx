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
  LayoutChangeEvent, Platform, Animated, TextInput, ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import Svg, { Path } from "react-native-svg";
import { Plus, X, PenLine, Camera } from "lucide-react-native";
import ImageUploadModal from "../../src/components/ImageUploadModal";

import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useRoasterProfiles } from "../../src/hooks/useRoasterProfiles";
import { useAuth } from "../../src/hooks/useAuth";
import { apiFetch } from "../../src/api/client";
import { fonts, colors } from "../../src/theme/colors";
import CoffeeCard from "../../src/components/CoffeeCard";
import Navbar from "../../src/components/Navbar";
import { HeartOutlineIcon, HeartFilledOutlineIcon } from "../../src/components/icons/FigmaIcons";

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

const GAP = 20;
const TARGET_CARD_W = 220;
const CARD_ASPECT = 400 / 240;
const GRID_PAD = 28;

function CoffeeGrid({ coffees }: { coffees: any[] }) {
  const [containerW, setContainerW] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerW(e.nativeEvent.layout.width);
  }, []);
  const available = containerW > 0 ? containerW - GRID_PAD * 2 : 800;
  const numCols = Math.max(1, Math.min(4, Math.round((available + GAP) / (TARGET_CARD_W + GAP))));
  const cardW = Math.floor((available - GAP * (numCols - 1)) / numCols);
  const cardH = Math.floor(cardW * CARD_ASPECT);

  if (coffees.length === 0) {
    return (
      <View style={cg.empty}>
        <Text style={cg.emptyText}>No coffees listed yet.</Text>
      </View>
    );
  }
  return (
    <View onLayout={onLayout} style={[cg.grid, { gap: GAP, paddingHorizontal: GRID_PAD }]}>
      {coffees.map((c) => (
        <View key={c.product_id} style={{ width: cardW, height: cardH }}>
          <CoffeeCard coffee={c} width={cardW} height={cardH} />
        </View>
      ))}
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
});

// ── Main page ─────────────────────────────────────────────────────────────────

const NAVBAR_H = 72;

export default function RoasterDetailPage() {
  const { slug, edit } = useLocalSearchParams<{ slug: string; edit?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { products, roasters } = useCoffeeData();
  const { getProfile, refreshProfiles } = useRoasterProfiles();
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

  const coffees = useMemo(() => products.filter((p: any) => p.roaster_slug === slug), [products, slug]);

  const isOwner = user?.account_type === "roaster" && user?.roaster_slug === slug;

  // Posts state
  const [featuredPosts, setFeaturedPosts] = useState<any[]>([]);
  const [allPosts, setAllPosts] = useState<any[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);

  // Follow state
  const [following, setFollowing] = useState(false);

  // Compose form
  const [showCompose, setShowCompose] = useState(false);
  const [composing, setComposing] = useState(false);

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
    () => profile?.hero_image_url || coffees.find((c: any) => c.image_url)?.image_url || null,
    [profile, coffees]
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
                  <Text style={s.metaText}>{following ? "1 follower" : "0 followers"}</Text>
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
              <FollowButton following={following} onToggle={() => setFollowing((f) => !f)} />
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

          {/* ── Public visitor: featured posts ───────────────────────── */}
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

          {/* ── Owner: featured posts first, then rest ────────────────── */}
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

          {/* ── Owner: no posts yet ──────────────────────────────────── */}
          {isOwner && !postsLoading && allPosts.length === 0 && (
            <>
              <View style={s.divider} />
              <View style={s.emptyPostsWrap}>
                <Text style={s.emptyPostsTitle}>Share your story</Text>
                <Text style={s.emptyPostsBody}>
                  Feature up to 3 posts on your profile — link to a journal entry, press coverage, or anything worth reading.
                </Text>
                <Pressable onPress={() => setShowCompose(true)} style={s.emptyPostsBtn}>
                  <Text style={s.emptyPostsBtnText}>Write your first post →</Text>
                </Pressable>
              </View>
            </>
          )}

          {/* ── Coffee grid ──────────────────────────────────────────── */}
          <View style={s.divider} />
          <Text style={[s.gridHeading, liningNumerals]}>
            {`Explore ${coffees.length} ${coffees.length === 1 ? "coffee" : "coffees"} from ${roaster.name}`}
          </Text>
          <CoffeeGrid coffees={coffees} />

          <View style={{ height: 100 }} />
          </ScrollView>

          {/* ── Edit-mode dim overlay (covers right panel content) ─── */}
          {isEditing && <View style={s.editDimOverlay} pointerEvents="none" />}

          {/* ── Floating compose button (owner, non-edit mode) ─────── */}
          {isOwner && !isEditing && (
            <Pressable onPress={() => setShowCompose(true)} style={s.fab}>
              <Plus size={18} color="#FAF8F0" strokeWidth={2.5} />
              <Text style={s.fabLabel}>New post</Text>
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

  // Floating compose button — pill, bottom-right of right panel
  fab: {
    position: "absolute" as any,
    bottom: 28,
    right: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#351101",
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 50,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 50,
  } as any,
  fabLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: "#FAF8F0",
  },

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

  // Dividers
  divider: { height: 1, backgroundColor: "#D7D1C4" },
  dividerLight: { height: 1, backgroundColor: "#EDE8E1" },

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
