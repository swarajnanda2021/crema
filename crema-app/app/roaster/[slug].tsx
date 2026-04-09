/**
 * Roaster Profile Page — Figma: "Crema – Beans" (node 96:7742)
 *
 * Layout:
 *   [Navbar 72px]
 *   [Left sticky panel (dark #2a0d00, ~42%) | Right scrollable (#FAF8F0, ~58%)]
 *
 * Left panel: roaster name, about blurb, specialty tags, website / followers / city,
 *             follow button. Sticky for the full page height.
 *
 * Right scroll: hero image → featured post cards (2 max) → coffee grid (no filters).
 *
 * Roaster login: below featured posts, shows all their posts with feature/unfeature
 *                toggles and a compose CTA if they have no posts at all.
 */

import { useMemo, useState, useCallback, useEffect } from "react";
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  useWindowDimensions, LayoutChangeEvent, Platform, Animated,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import Svg, { Path } from "react-native-svg";
import { MessageCircle } from "lucide-react-native";

import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useRoasterProfiles } from "../../src/hooks/useRoasterProfiles";
import { useAuth } from "../../src/hooks/useAuth";
import { apiFetch } from "../../src/api/client";
import { fonts, colors } from "../../src/theme/colors";
import CoffeeCard from "../../src/components/CoffeeCard";
import Navbar from "../../src/components/Navbar";
import { HeartOutlineIcon, HeartFilledOutlineIcon } from "../../src/components/icons/FigmaIcons";

// ── Platform helpers ──────────────────────────────────────────────────────────
const liningNumerals = Platform.OS === "web"
  ? { fontFeatureSettings: "'lnum', 'pnum'" } as any
  : {};

// ── Icons ─────────────────────────────────────────────────────────────────────

function BackArrowIcon() {
  return (
    <Svg width={9} height={16} viewBox="0 0 9 16" fill="none">
      <Path d="M8 15L1 8L8 1" stroke="#C7BAA5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function MapPinIcon({ color = "#D798DA" }: { color?: string }) {
  return (
    <Svg width={11} height={14} viewBox="0 0 13.9 17.2" fill="none">
      <Path d="M0.75 6.89C0.75 11.2 4.52 14.76 6.18 16.12C6.42 16.32 6.54 16.42 6.72 16.47C6.86 16.51 7.06 16.51 7.2 16.47C7.38 16.42 7.5 16.32 7.74 16.12C9.41 14.76 13.17 11.2 13.17 6.89C13.17 5.26 12.52 3.7 11.35 2.55C10.19 1.4 8.61 0.75 6.96 0.75C5.31 0.75 3.73 1.4 2.57 2.55C1.4 3.7 0.75 5.26 0.75 6.89Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.19 6.07C5.19 7.05 5.98 7.85 6.96 7.85C7.94 7.85 8.74 7.05 8.74 6.07C8.74 5.09 7.94 4.3 6.96 4.3C5.98 4.3 5.19 5.09 5.19 6.07Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ExternalLinkIcon({ color = "#D798DA" }: { color?: string }) {
  return (
    <Svg width={13} height={13} viewBox="0 0 15.5 15.5" fill="none">
      <Path d="M5.42 1.68H3.74C2.69 1.68 2.17 1.68 1.77 1.89C1.42 2.07 1.13 2.35 0.95 2.7C0.75 3.1 0.75 3.62 0.75 4.67V11.76C0.75 12.81 0.75 13.33 0.95 13.73C1.13 14.08 1.42 14.37 1.77 14.55C2.17 14.75 2.69 14.75 3.73 14.75H10.83C11.88 14.75 12.4 14.75 12.8 14.55C13.15 14.37 13.43 14.08 13.61 13.73C13.82 13.33 13.82 12.81 13.82 11.77V10.08M14.75 5.42V0.75M14.75 0.75H10.08M14.75 0.75L8.22 7.28" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function UsersIcon({ color = "#D798DA" }: { color?: string }) {
  return (
    <Svg width={18} height={15} viewBox="0 0 20 17" fill="none">
      <Path d="M14 1C15.66 1 17 2.34 17 4C17 5.66 15.66 7 14 7M16 14C17.78 14 19 13.1 19 12C19 10.9 17.78 10 16 10M1 12C1 10.34 3.24 9 6 9C8.76 9 11 10.34 11 12C11 13.66 8.76 15 6 15C3.24 15 1 13.66 1 12ZM10 4C10 5.66 8.21 7 6 7C3.79 7 2 5.66 2 4C2 2.34 3.79 1 6 1C8.21 1 10 2.34 10 4Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ShareIcon({ color = "#351101" }: { color?: string }) {
  return (
    <Svg width={12} height={14} viewBox="0 0 14 16" fill="none">
      <Path d="M12 5.5C13.1 5.5 14 4.6 14 3.5C14 2.4 13.1 1.5 12 1.5C10.9 1.5 10 2.4 10 3.5C10 4.6 10.9 5.5 12 5.5ZM2 9.5C3.1 9.5 4 8.6 4 7.5C4 6.4 3.1 5.5 2 5.5C0.9 5.5 0 6.4 0 7.5C0 8.6 0.9 9.5 2 9.5ZM12 13.5C13.1 13.5 14 12.6 14 11.5C14 10.4 13.1 9.5 12 9.5C10.9 9.5 10 10.4 10 11.5C10 12.6 10.9 13.5 12 13.5ZM3.7 8.5L10.3 11.5M10.3 3.5L3.7 6.5" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function StarIcon({ filled = false }: { filled?: boolean }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill={filled ? "#E8C07A" : "none"}>
      <Path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" stroke={filled ? "#E8C07A" : "#A09580"} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
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

// ── Roaster Post Card — Figma-faithful ────────────────────────────────────────

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
    // Animate pulse
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
      {/* Header: avatar | name + timestamp | subtitle */}
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
        {/* Feature toggle (owner only) */}
        {isOwner && onFeatureToggle && (
          <Pressable onPress={() => onFeatureToggle(post.id)} style={pc.featureBtn} hitSlop={8}>
            <StarIcon filled={post.is_featured} />
            <Text style={[pc.featureBtnText, post.is_featured && pc.featureBtnActive]}>
              {post.is_featured ? `Featured #${post.featured_order}` : "Feature"}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Title */}
      <Pressable onPress={handleOpen} style={pc.titleWrap}>
        <Text style={pc.title}>{post.title}</Text>
      </Pressable>

      {/* Cover image — full width, 298px tall */}
      {post.cover_image_url ? (
        <Pressable onPress={handleOpen} style={pc.coverWrap}>
          <Image
            source={{ uri: post.cover_image_url }}
            style={pc.coverImage}
            contentFit="cover"
          />
        </Pressable>
      ) : null}

      {/* Teaser text */}
      <Text style={pc.teaser} numberOfLines={3}>{post.teaser}</Text>

      {/* Action bar: likes | comments | share */}
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
          <MessageCircle size={14} color="#A09580" strokeWidth={2} />
        </View>
        <Pressable onPress={handleOpen} style={pc.actionBtn}>
          <ShareIcon color="#A09580" />
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
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: "rgba(232,192,122,0.12)",
  },
  featureBtnText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    color: "#A09580",
  },
  featureBtnActive: {
    color: "#E8C07A",
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

// ── CTA for roasters with no posts ───────────────────────────────────────────

function PostCTA({ onPress }: { onPress?: () => void }) {
  return (
    <View style={cta.wrap}>
      <Text style={cta.title}>Share your story</Text>
      <Text style={cta.body}>
        Feature up to two posts on your profile — link to a journal entry, press feature, or anything worth reading.
        Post from the{" "}
        <Text style={cta.emph}>Home feed</Text>
        {" "}and star your favourites here.
      </Text>
      {onPress && (
        <Pressable onPress={onPress} style={cta.btn}>
          <Text style={cta.btnText}>Go to feed →</Text>
        </Pressable>
      )}
    </View>
  );
}

const cta = StyleSheet.create({
  wrap: {
    marginHorizontal: 28,
    marginVertical: 24,
    padding: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D7D1C4",
    backgroundColor: "#FFFEFB",
  },
  title: {
    fontFamily: fonts.displayRegular,
    fontSize: 20,
    color: "#351101",
    marginBottom: 8,
  },
  body: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: "#684F44",
    lineHeight: 19,
  },
  emph: { fontFamily: fonts.bodySemiBold, color: "#351101" },
  btn: {
    marginTop: 14,
    alignSelf: "flex-start" as any,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#351101",
  },
  btnText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#351101" },
});

// ── Follow button ─────────────────────────────────────────────────────────────

function FollowButton({ following, onToggle }: { following: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={[fb.btn, following && fb.btnFollowing]}>
      {!following && (
        <Text style={fb.plus}>+</Text>
      )}
      <Text style={[fb.text, following && fb.textFollowing]}>
        {following ? "Following" : "Follow"}
      </Text>
    </Pressable>
  );
}

const fb = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 27,
    paddingHorizontal: 12,
    borderRadius: 2,
    borderWidth: 1.5,
    borderColor: "#FAF8F0",
  },
  btnFollowing: {
    backgroundColor: "#FAF8F0",
  },
  plus: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: "#FAF8F0",
    lineHeight: 17,
  },
  text: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: "#FAF8F0",
    lineHeight: 15,
  },
  textFollowing: {
    color: "#351101",
  },
});

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RoasterDetailPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { products, roasters } = useCoffeeData();
  const { getProfile } = useRoasterProfiles();
  const { width } = useWindowDimensions();

  const roaster = roasters.find((r: any) => r.slug === slug);
  const profile = getProfile(slug, roaster?.website, roaster?.name);
  const coffees = useMemo(() => products.filter((p: any) => p.roaster_slug === slug), [products, slug]);

  // Is the logged-in user the owner of this roaster page?
  const isOwner = user?.account_type === "roaster" && user?.roaster_slug === slug;

  // Featured posts (public)
  const [featuredPosts, setFeaturedPosts] = useState<any[]>([]);
  // All posts (shown only to owner for management)
  const [allPosts, setAllPosts] = useState<any[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);

  const [following, setFollowing] = useState(false);

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
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const ABOUT_LIMIT = 260;

  // Load posts
  useEffect(() => {
    (async () => {
      try {
        setPostsLoading(true);
        // Always fetch featured posts for public display
        const fp = await apiFetch(`/roasters/${slug}/posts/featured`);
        setFeaturedPosts(fp.featured_posts || []);
        // If owner, also fetch all posts for management
        if (isOwner) {
          const all = await apiFetch(`/roasters/${slug}/posts`);
          setAllPosts(all.posts || []);
        }
      } catch {
        setFeaturedPosts([]);
        setAllPosts([]);
      } finally {
        setPostsLoading(false);
      }
    })();
  }, [slug, isOwner]);

  const handleFeatureToggle = useCallback(async (postId: number) => {
    try {
      await apiFetch(`/roaster-posts/${postId}/feature`, { method: "PUT" });
      // Refresh
      const [fp, all] = await Promise.all([
        apiFetch(`/roasters/${slug}/posts/featured`),
        apiFetch(`/roasters/${slug}/posts`),
      ]);
      setFeaturedPosts(fp.featured_posts || []);
      setAllPosts(all.posts || []);
    } catch (e: any) {
      console.warn("Feature toggle error:", e.message);
    }
  }, [slug]);

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

  // Non-featured posts (for owner management view)
  const nonFeaturedPosts = allPosts.filter((p) => !p.is_featured);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Navbar />

      <View style={s.pageContainer}>

        {/* ── LEFT STICKY PANEL ─────────────────────────────────────────── */}
        <View style={s.leftPanel}>
          {/* Back */}
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <BackArrowIcon />
            <Text style={s.backText}>Back</Text>
          </Pressable>

          {/* SHARE */}
          <Pressable
            onPress={() => {
              if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
                navigator.clipboard.writeText(window.location.href);
              }
            }}
            style={s.shareRow}
          >
            <Text style={s.shareText}>SHARE</Text>
            <ExternalLinkIcon color="#C7BAA5" />
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

          {/* Spacer pushes footer to bottom */}
          <View style={{ flex: 1 }} />

          {/* Specialty tags with rules */}
          <View style={s.tagBand}>
            <View style={s.rule} />
            <Text style={s.tagText}>{specialtyTags.join(" / ")}</Text>
            <View style={s.rule} />
          </View>

          {/* Metadata row: website | followers | city */}
          <View style={s.metaRow}>
            {website ? (
              <Pressable onPress={() => Linking.openURL(website)} style={s.metaItem}>
                <ExternalLinkIcon color="#FAF8F0" />
                <Text style={s.metaText}>Website</Text>
              </Pressable>
            ) : null}
            <View style={s.metaItem}>
              <UsersIcon color="#FAF8F0" />
              <Text style={s.metaText}>
                {following ? "1 follower" : "0 followers"}
              </Text>
            </View>
            {city ? (
              <View style={s.metaItem}>
                <MapPinIcon color="#FAF8F0" />
                <Text style={s.metaText}>{city}</Text>
              </View>
            ) : null}
          </View>

          <View style={s.rule} />

          {/* Follow button */}
          <View style={s.followRow}>
            <FollowButton following={following} onToggle={() => setFollowing((f) => !f)} />
          </View>
        </View>

        {/* ── RIGHT SCROLLABLE CONTENT ──────────────────────────────────── */}
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

          {/* ── Featured posts ──────────────────────────────────────────── */}
          {!postsLoading && featuredPosts.length > 0 && (
            <>
              <View style={s.divider} />
              {featuredPosts.map((post, i) => (
                <View key={post.id}>
                  <RoasterPostCard
                    post={post}
                    roasterName={roaster.name}
                    avatarUrl={logoUrl}
                    isOwner={isOwner}
                    onFeatureToggle={isOwner ? handleFeatureToggle : undefined}
                  />
                  {i < featuredPosts.length - 1 && <View style={s.divider} />}
                </View>
              ))}
            </>
          )}

          {/* ── Roaster CTA (owner, no featured posts) ──────────────────── */}
          {!postsLoading && isOwner && featuredPosts.length === 0 && (
            <>
              <View style={s.divider} />
              <PostCTA onPress={() => router.push("/")} />
            </>
          )}

          {/* ── Owner: manage all posts ─────────────────────────────────── */}
          {isOwner && allPosts.length > 0 && (
            <>
              <View style={s.divider} />
              <View style={s.allPostsHeader}>
                <Text style={s.allPostsTitle}>Your posts</Text>
                <Text style={s.allPostsHint}>★ Star up to 2 to feature on your profile</Text>
              </View>
              {nonFeaturedPosts.map((post) => (
                <View key={post.id}>
                  <RoasterPostCard
                    post={post}
                    roasterName={roaster.name}
                    avatarUrl={logoUrl}
                    isOwner={isOwner}
                    onFeatureToggle={handleFeatureToggle}
                  />
                  <View style={s.dividerLight} />
                </View>
              ))}
            </>
          )}

          {/* ── Coffee grid ─────────────────────────────────────────────── */}
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

  // Page container — full height flex row
  pageContainer: {
    flex: 1,
    flexDirection: "row",
    overflow: "hidden",
  } as any,

  // ── Left sticky panel ─────────────────────────────────────────────
  leftPanel: {
    width: "42%" as any,
    backgroundColor: "#2a0d00",
    paddingHorizontal: "6.25%" as any,
    paddingTop: 40,
    paddingBottom: 32,
    flexDirection: "column",
    // Web sticky: stays in place while right side scrolls
    position: "sticky" as any,
    top: 0,
    alignSelf: "flex-start" as any,
    height: "100vh" as any,
    overflowY: "auto" as any,
  } as any,

  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 24,
  },
  backText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: "#C7BAA5",
  },

  shareRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
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
  aboutMore: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: "#FAF8F0",
  },

  // Specialty tags with horizontal rules
  tagBand: { marginBottom: 14 },
  rule: {
    height: 1,
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

  // Metadata: website | followers | city
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap" as any,
    gap: 20,
    marginTop: 12,
    marginBottom: 12,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: "#FAF8F0",
  },

  followRow: { marginTop: 14 },

  // ── Right scrollable ──────────────────────────────────────────────
  rightScroll: {
    flex: 1,
    backgroundColor: "#FAF8F0",
  },
  rightContent: {
    // no extra padding — cards handle their own padding
  },

  // Hero image: spans full right column, 334px tall (Figma spec)
  heroImageWrap: {
    width: "100%" as any,
    height: 334,
    backgroundColor: "#1a0800",
    position: "relative" as any,
    overflow: "hidden",
  } as any,

  // Dividers
  divider: {
    height: 1,
    backgroundColor: "#D7D1C4",
    marginVertical: 0,
  },
  dividerLight: {
    height: 1,
    backgroundColor: "#EDE8E1",
  },

  // Grid heading
  gridHeading: {
    fontFamily: fonts.displayRegular,
    fontSize: 22,
    color: "#351101",
    lineHeight: 28,
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 20,
  },

  // Owner post management
  allPostsHeader: {
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 12,
  },
  allPostsTitle: {
    fontFamily: fonts.displayRegular,
    fontSize: 18,
    color: "#351101",
  },
  allPostsHint: {
    fontFamily: fonts.bodyRegular,
    fontSize: 11,
    color: "#A09580",
  },
});
