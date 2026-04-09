/**
 * Roaster Profile Page — unified for all visitors + roaster owner mode.
 *
 * Public visitor:  left panel (about, meta, Follow) + right scroll (hero, featured posts, coffee grid)
 * Owner (isOwner): same page, NO Follow button, + star-toggle management, + compose new post form
 *
 * Navbar user-icon already routes roaster accounts here instead of /profile.
 */

import { useMemo, useState, useCallback, useEffect } from "react";
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  LayoutChangeEvent, Platform, Animated, TextInput, ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import Svg, { Path } from "react-native-svg";
import { Plus, X } from "lucide-react-native";

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
// These are served by the Figma Desktop MCP and match the design exactly.
const FIGMA_BACK_ARROW     = "http://localhost:3845/assets/258b4df2171b8c3fd18f751b3cd93df5e9bc0e3a.svg";
const FIGMA_SHARE_ICON     = "http://localhost:3845/assets/73a3490dfe017b6c6d09ffe81f7fa967b808e05e.svg";
const FIGMA_WEBSITE_ICON   = "http://localhost:3845/assets/c8b1c717f262fb5c8267b41ffb94e03f9f30e3a2.svg";
const FIGMA_FOLLOWERS_ICON = "http://localhost:3845/assets/24115d6a26d4b35414125e4d31aa30ab00a5efc0.svg";
const FIGMA_CITY_ICON      = "http://localhost:3845/assets/34b74a6440e0a03457339dd5236601f37c6a31c8.svg";
const FIGMA_PLUS_ICON      = "http://localhost:3845/assets/f9b31cb40af6488f3e9140aca17c71a98e3f3c64.svg";

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

function RoasterPostCard({
  post,
  roasterName,
  avatarUrl,
  onFeatureToggle,
  isOwner,
}: {
  post: any;
  roasterName: string;
  avatarUrl?: string | null;
  onFeatureToggle?: (id: number) => void;
  isOwner?: boolean;
}) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
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
      {/* Header: avatar | name + time | subtitle + feature toggle */}
      <View style={pc.header}>
        <View style={pc.avatarWrap}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={pc.avatar} contentFit="cover" />
          ) : (
            <View style={[pc.avatar, { backgroundColor: "#351101", alignItems: "center", justifyContent: "center" }]}>
              <Text style={{ color: "#FAF8F0", fontSize: 11, fontFamily: fonts.bodySemiBold }}>
                {(roasterName || "R")[0].toUpperCase()}
              </Text>
            </View>
          )}
        </View>
        <View style={pc.headerMeta}>
          <View style={pc.nameRow}>
            <Text style={pc.authorName}>{roasterName}</Text>
            <Text style={pc.timestamp}>{timeAgo(post.published_at)}</Text>
          </View>
          <Text style={pc.subtitle}>Posted about an article</Text>
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

      {/* Title */}
      <Pressable onPress={handleOpen} style={pc.titleWrap}>
        <Text style={pc.title}>{post.title}</Text>
      </Pressable>

      {/* Cover image */}
      {post.cover_image_url ? (
        <Pressable onPress={handleOpen} style={pc.coverWrap}>
          <Image
            source={{ uri: post.cover_image_url }}
            style={pc.coverImage}
            contentFit="cover"
          />
        </Pressable>
      ) : null}

      {/* Teaser */}
      <Text style={pc.teaser} numberOfLines={3}>{post.teaser}</Text>

      {/* Action bar */}
      <View style={pc.actionBar}>
        <Pressable onPress={handleLike} style={pc.actionBtn}>
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            {liked
              ? <HeartFilledOutlineIcon size={14} />
              : <HeartOutlineIcon size={14} color="#A09580" />}
          </Animated.View>
          {likeCount > 0 && (
            <Text style={[pc.actionCount, liked && { color: "#D798DA" }]}>{likeCount}</Text>
          )}
        </Pressable>
        <View style={pc.actionBtn}>
          <CommentIcon color="#A09580" />
        </View>
        <Pressable onPress={handleOpen} style={pc.actionBtn}>
          <ShareInlineIcon color="#A09580" />
        </Pressable>
        {post.external_url && (
          <Pressable onPress={handleOpen} style={pc.readMore}>
            <Text style={pc.readMoreText}>Read article →</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const pc = StyleSheet.create({
  card: {
    backgroundColor: "#FAF8F0",
    paddingHorizontal: 28,
    paddingVertical: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  avatarWrap: {},
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    overflow: "hidden",
  } as any,
  headerMeta: { flex: 1 },
  nameRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  authorName: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11.8,
    color: "#351101",
  },
  timestamp: {
    fontFamily: fonts.bodyRegular,
    fontSize: 10,
    color: "#A09580",
  },
  subtitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    color: "#684F44",
    marginTop: 2,
  },
  featureBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(160,149,128,0.3)",
  },
  featureBtnActive: {
    borderColor: "rgba(215,152,218,0.4)",
    backgroundColor: "rgba(215,152,218,0.08)",
  },
  featureBtnText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    color: "#A09580",
  },
  featureBtnTextActive: {
    color: "#D798DA",
  },
  titleWrap: { marginBottom: 12 },
  title: {
    fontFamily: fonts.bodyRegular,
    fontSize: 16.8,
    color: "#351101",
    lineHeight: 23.5,
  },
  coverWrap: {
    borderRadius: 5,
    overflow: "hidden",
    marginBottom: 12,
  },
  coverImage: {
    width: "100%" as any,
    height: 298,
    borderRadius: 5,
  },
  teaser: {
    fontFamily: fonts.bodyRegular,
    fontSize: 10.9,
    color: "#684F44",
    lineHeight: 15.1,
    marginBottom: 14,
  },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  actionCount: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11.8,
    color: "#351101",
  },
  readMore: { marginLeft: "auto" as any },
  readMoreText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: "#351101",
    textDecorationLine: "underline",
  },
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
  onSubmit: (data: { title: string; teaser: string; external_url: string; cover_image_url: string }) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [title, setTitle] = useState("");
  const [teaser, setTeaser] = useState("");
  const [url, setUrl] = useState("");
  const [coverUrl, setCoverUrl] = useState("");

  const canSubmit = title.trim().length > 0 && teaser.trim().length > 0 && teaser.trim().length <= 300;

  return (
    <View style={cf.wrap}>
      <View style={cf.header}>
        <Text style={cf.heading}>New article post</Text>
        <Pressable onPress={onCancel} hitSlop={8}>
          <X size={16} color="#A09580" />
        </Pressable>
      </View>

      <Text style={cf.label}>Title *</Text>
      <TextInput
        style={cf.input}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Gangecool Estate"
        placeholderTextColor="#C7BAA5"
      />

      <Text style={cf.label}>
        Teaser * <Text style={cf.labelMeta}>{teaser.length}/300</Text>
      </Text>
      <TextInput
        style={[cf.input, cf.textarea]}
        value={teaser}
        onChangeText={setTeaser}
        placeholder="A short description (up to 300 chars) that appears in the feed…"
        placeholderTextColor="#C7BAA5"
        multiline
        numberOfLines={3}
      />

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

      <Text style={cf.label}>Cover image URL</Text>
      <TextInput
        style={cf.input}
        value={coverUrl}
        onChangeText={setCoverUrl}
        placeholder="https://…"
        placeholderTextColor="#C7BAA5"
        autoCapitalize="none"
        keyboardType="url"
      />

      <View style={cf.actions}>
        <Pressable onPress={onCancel} style={cf.cancelBtn}>
          <Text style={cf.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => canSubmit && onSubmit({ title: title.trim(), teaser: teaser.trim(), external_url: url.trim(), cover_image_url: coverUrl.trim() })}
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
    marginHorizontal: 28,
    marginVertical: 20,
    padding: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D7D1C4",
    backgroundColor: "#FFFEFB",
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
});

// ── Main page ─────────────────────────────────────────────────────────────────

const NAVBAR_H = 72;

export default function RoasterDetailPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { products, roasters } = useCoffeeData();
  const { getProfile } = useRoasterProfiles();
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

      <View style={[s.pageContainer, { height: winH - NAVBAR_H }]}>

        {/* ── LEFT PANEL (sticky, dark) ──────────────────────────────── */}
        <View style={[s.leftPanel, { height: winH - NAVBAR_H }]}>

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

          {/* About blurb */}
          {aboutBlurb ? (
            <View style={s.aboutBlock}>
              <Text style={s.aboutText}>
                {aboutExpanded || aboutBlurb.length <= ABOUT_LIMIT
                  ? aboutBlurb
                  : aboutBlurb.slice(0, ABOUT_LIMIT) + "…"}
                {!aboutExpanded && aboutBlurb.length > ABOUT_LIMIT && (
                  <Text onPress={() => setAboutExpanded(true)} style={s.aboutMore}> more</Text>
                )}
              </Text>
            </View>
          ) : null}

          {/* Push footer to bottom */}
          <View style={{ flex: 1 }} />

          {/* Specialty tags with rules */}
          <View style={s.tagBand}>
            <View style={s.rule} />
            <Text style={s.tagText}>{specialtyTags.join(" / ")}</Text>
            <View style={s.rule} />
          </View>

          {/* Meta row: website | followers | city */}
          <View style={s.metaRow}>
            {website ? (
              <Pressable onPress={() => Linking.openURL(website)} style={s.metaItem}>
                <ExternalLinkIcon />
                <Text style={s.metaText}>Website</Text>
              </Pressable>
            ) : null}
            <View style={s.metaItem}>
              <UsersIcon />
              <Text style={s.metaText}>
                {following ? "1 follower" : "0 followers"}
              </Text>
            </View>
            {city ? (
              <View style={s.metaItem}>
                <MapPinIcon />
                <Text style={s.metaText}>{city}</Text>
              </View>
            ) : null}
          </View>

          <View style={s.rule} />

          {/* Follow button — hidden for owner */}
          {!isOwner ? (
            <View style={s.followRow}>
              <FollowButton following={following} onToggle={() => setFollowing((f) => !f)} />
            </View>
          ) : (
            /* Owner: "New Post" + "Sign out" buttons in the follow slot */
            <View style={[s.followRow, { flexDirection: "row", gap: 10 }]}>
              <Pressable
                onPress={() => setShowCompose(true)}
                style={s.newPostBtn}
              >
                <Plus size={13} color="#2a0d00" strokeWidth={2.5} />
                <Text style={s.newPostBtnText}>New Post</Text>
              </Pressable>
              <Pressable
                onPress={() => { logout(); router.replace("/"); }}
                style={s.signOutBtn}
              >
                <Text style={s.signOutBtnText}>Sign out</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* ── RIGHT SCROLLABLE CONTENT ──────────────────────────────── */}
        <ScrollView
          style={s.rightScroll}
          contentContainerStyle={s.rightContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero image */}
          <View style={s.heroImageWrap}>
            {heroImageUrl ? (
              <Image
                source={{ uri: heroImageUrl }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
              />
            ) : (
              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "#1a0800" }]} />
            )}
          </View>

          {/* ── Compose form (owner only) ────────────────────────────── */}
          {isOwner && showCompose && (
            <>
              <View style={s.divider} />
              <ComposePostForm
                onSubmit={handleCreatePost}
                onCancel={() => setShowCompose(false)}
                loading={composing}
              />
            </>
          )}

          {/* ── Featured posts (public visitors only — owners see everything in "All your posts") */}
          {!postsLoading && !isOwner && featuredPosts.length > 0 && (
            <>
              <View style={s.divider} />
              {featuredPosts.map((post, i) => (
                <View key={post.id}>
                  <RoasterPostCard
                    post={post}
                    roasterName={roaster.name}
                    avatarUrl={logoUrl}
                    isOwner={false}
                  />
                  {i < featuredPosts.length - 1 && <View style={s.divider} />}
                </View>
              ))}
            </>
          )}

          {/* ── Owner: all posts with star-toggle (no separate Featured duplication) */}
          {isOwner && allPosts.length > 0 && (
            <>
              <View style={s.divider} />
              <View style={s.sectionHeader}>
                <Text style={s.sectionHint}>★ Star up to 2 to feature on your profile</Text>
              </View>
              {allPosts.map((post, i) => (
                <View key={post.id}>
                  <RoasterPostCard
                    post={post}
                    roasterName={roaster.name}
                    avatarUrl={logoUrl}
                    isOwner
                    onFeatureToggle={handleFeatureToggle}
                  />
                  {i < allPosts.length - 1 && <View style={s.dividerLight} />}
                </View>
              ))}
            </>
          )}

          {/* ── Owner: no posts yet ──────────────────────────────────── */}
          {isOwner && !postsLoading && allPosts.length === 0 && !showCompose && (
            <>
              <View style={s.divider} />
              <View style={s.emptyPostsWrap}>
                <Text style={s.emptyPostsTitle}>Share your story</Text>
                <Text style={s.emptyPostsBody}>
                  Feature up to two posts on your profile — link to a journal entry, press coverage, or anything worth reading.
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

          <View style={{ height: 80 }} />
        </ScrollView>
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

  // "New Post" button for owner
  newPostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 27,
    paddingHorizontal: 14,
    borderRadius: 2,
    backgroundColor: "#FAF8F0",
    alignSelf: "flex-start" as any,
  },
  newPostBtnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: "#2a0d00",
  },
  // "Sign out" button — outlined, same height as New Post
  signOutBtn: {
    height: 27,
    paddingHorizontal: 12,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: "rgba(199,186,165,0.5)",
    alignSelf: "flex-start" as any,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutBtnText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: "#C7BAA5",
  },

  // Right scrollable column — flex:1 fills remaining width; height from parent
  rightScroll: {
    flex: 1,
    backgroundColor: "#FAF8F0",
  },
  rightContent: {
    flexGrow: 1,
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
