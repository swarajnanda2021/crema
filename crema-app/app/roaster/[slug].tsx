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
import { Plus, X, PenLine, Camera, MapPin, Check } from "lucide-react-native";
import ImageUploadModal from "../../src/components/ImageUploadModal";
import TastingNoteCard from "../../src/components/TastingNoteCard";
import ComposePost from "../../src/components/ComposePost";

import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useRoasterProfiles } from "../../src/hooks/useRoasterProfiles";
import { useAuth } from "../../src/hooks/useAuth";
import { apiFetch, resolveUploadUrl } from "../../src/api/client";
import { fonts, colors } from "../../src/theme/colors";
import CoffeeCard from "../../src/components/CoffeeCard";
import Navbar from "../../src/components/Navbar";
import { HeartOutlineIcon, HeartFilledOutlineIcon, CartIcon, CommentBubbleIcon, ShareNodesIcon, PostLocationPinIcon } from "../../src/components/icons/FigmaIcons";
import { openPostModal } from "../../src/components/PostFeedCard";

const liningNumerals = Platform.OS === "web"
  ? { fontFeatureSettings: "'lnum', 'pnum'" } as any
  : {};

// ── Icons (exact Figma SVG paths, inline — no external asset server) ─────────

// Figma 109:8684 — back chevron 7×14, #C7BAA5
function BackArrowIcon() {
  return (
    <Svg width={7} height={14} viewBox="0 0 7 14" fill="none">
      <Path d="M6 1L1 7L6 13" stroke="#C7BAA5" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Figma 249:3438 — location pin with inner circle
function MapPinIcon({ color = "#D798DA" }: { color?: string }) {
  return (
    <Svg width={12} height={16} viewBox="0 0 13.9649 17.3005" fill="none">
      <Path d="M0.75 6.9138C0.75 11.2337 4.52909 14.806 6.20182 16.1756C6.44121 16.3716 6.56234 16.4708 6.74095 16.5211C6.88002 16.5602 7.0847 16.5602 7.22378 16.5211C7.40271 16.4707 7.523 16.3725 7.76329 16.1757C9.43602 14.8061 13.2149 11.234 13.2149 6.9142C13.2149 5.2794 12.5583 3.71137 11.3895 2.55539C10.2207 1.39942 8.63552 0.75 6.98257 0.75C5.32961 0.75 3.74427 1.39952 2.57545 2.55549C1.40664 3.71147 0.75 5.27901 0.75 6.9138Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.20178 6.09214C5.20178 7.0756 5.99903 7.87285 6.98249 7.87285C7.96595 7.87285 8.76321 7.0756 8.76321 6.09214C8.76321 5.10868 7.96595 4.31142 6.98249 4.31142C5.99903 4.31142 5.20178 5.10868 5.20178 6.09214Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Figma 249:3432 — external link with arrow
function ExternalLinkIcon({ color = "#D798DA" }: { color?: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 15.5 15.5" fill="none">
      <Path d="M5.41685 1.68333H3.73685C2.69142 1.68333 2.16831 1.68333 1.76901 1.88679C1.41778 2.06575 1.13242 2.35111 0.953455 2.70234C0.750001 3.10165 0.750001 3.62475 0.750001 4.67018V11.7635C0.750001 12.8089 0.750001 13.3314 0.953455 13.7307C1.13242 14.0819 1.41778 14.3678 1.76901 14.5467C2.16792 14.75 2.69039 14.75 3.73378 14.75H10.8329C11.8763 14.75 12.398 14.75 12.7969 14.5467C13.1481 14.3678 13.4344 14.0817 13.6134 13.7304C13.8167 13.3315 13.8167 12.8096 13.8167 11.7662V10.0833M14.75 5.41667V0.75M14.75 0.75H10.0833M14.75 0.75L8.21667 7.28333" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Figma 249:3436 — two-person followers icon
function UsersIcon({ color = "#D798DA" }: { color?: string }) {
  return (
    <Svg width={18} height={15} viewBox="0 0 19.562 16.5517" fill="none">
      <Path d="M18.812 15.8016C18.812 14.054 17.1366 12.5672 14.7982 12.0162M12.7913 15.8017C12.7913 13.5849 10.0958 11.7879 6.77067 11.7879C3.44554 11.7879 0.75 13.5849 0.75 15.8017M12.7913 8.77755C15.0081 8.77755 16.8051 6.98052 16.8051 4.76378C16.8051 2.54703 15.0081 0.75 12.7913 0.75M6.77067 8.77755C4.55392 8.77755 2.75689 6.98052 2.75689 4.76378C2.75689 2.54703 4.55392 0.75 6.77067 0.75C8.98741 0.75 10.7844 2.54703 10.7844 4.76378C10.7844 6.98052 8.98741 8.77755 6.77067 8.77755Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ShareInlineIcon({ color = "#A09580" }: { color?: string }) {
  return (
    <Svg width={12} height={14} viewBox="0 0 14 16" fill="none">
      <Path d="M12 5.5C13.1 5.5 14 4.6 14 3.5C14 2.4 13.1 1.5 12 1.5C10.9 1.5 10 2.4 10 3.5C10 4.6 10.9 5.5 12 5.5ZM2 9.5C3.1 9.5 4 8.6 4 7.5C4 6.4 3.1 5.5 2 5.5C0.9 5.5 0 6.4 0 7.5C0 8.6 0.9 9.5 2 9.5ZM12 13.5C13.1 13.5 14 12.6 14 11.5C14 10.4 13.1 9.5 12 9.5C10.9 9.5 10 10.4 10 11.5C10 12.6 10.9 13.5 12 13.5ZM3.7 8.5L10.3 11.5M10.3 3.5L3.7 6.5" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Figma 249:3443 — upload/share box with arrow
function LeftPanelShareIcon({ color = "#D798DA" }: { color?: string }) {
  return (
    <Svg width={14} height={16} viewBox="0 0 14.8014 17.4264" fill="none">
      <Path d="M11.3382 7.40073H13.3069C13.481 7.40073 13.6479 7.46987 13.771 7.59294C13.894 7.71601 13.9632 7.88293 13.9632 8.05698V15.9319C13.9632 16.106 13.894 16.2729 13.771 16.396C13.6479 16.519 13.481 16.5882 13.3069 16.5882H1.49443C1.32039 16.5882 1.15347 16.519 1.0304 16.396C0.907324 16.2729 0.838184 16.106 0.838184 15.9319V8.05698C0.838184 7.88293 0.907324 7.71601 1.0304 7.59294C1.15347 7.46987 1.32039 7.40073 1.49443 7.40073H3.46318" stroke={color} strokeWidth={1.67637} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M4.11968 4.11942L7.40093 0.838184L10.6822 4.11942" stroke={color} strokeWidth={1.67637} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M7.40091 0.838184V10.0256" stroke={color} strokeWidth={1.67637} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
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

// StarIcon removed — replaced by three-dot pin menu

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

const GALLERY_ASPECT = 371 / 281; // Universal H/W ratio — matches TastingNoteCard Figma (281×371)
const PG_GAP = 10;
const PG_RADIUS = 5;

function isTastingNoteEntry(img: string) {
  return img.startsWith('{"type":') && img.includes('"tasting_note"');
}

function GallerySlot({ entry, width, height, onPress }: { entry: string; width: number; height: number; onPress?: () => void }) {
  if (isTastingNoteEntry(entry)) {
    const data = JSON.parse(entry);
    return <TastingNoteCard {...data} width={width} height={height} />;
  }
  return (
    <Pressable onPress={onPress}>
      <Image
        source={{ uri: resolveUploadUrl(entry) }}
        style={{ width, height, borderRadius: PG_RADIUS }}
        contentFit="cover"
      />
    </Pressable>
  );
}

function PhotoGallery({ images, onPress }: { images: string[]; onPress?: () => void }) {
  const [cw, setCw] = useState(0);

  if (!images || images.length === 0) return null;

  // Every item is always the 3-column size — one standard presentation size sitewide.
  // 1–3 items sit in a row at that fixed size; 4+ scroll horizontally.
  const itemW = cw > 0 ? Math.floor((cw - PG_GAP * 2) / 3) : 220;
  const itemH = Math.floor(itemW * GALLERY_ASPECT);

  return (
    <View onLayout={(e) => setCw(e.nativeEvent.layout.width)} style={pg.rowWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: PG_GAP }}
      >
        {images.map((entry, i) => (
          <View key={i} style={{ borderRadius: PG_RADIUS, overflow: "hidden" }}>
            <GallerySlot entry={entry} width={itemW} height={itemH} onPress={onPress} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const pg = StyleSheet.create({
  rowWrap: { marginBottom: 16 },
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
  isOwner,
  onPin,
  onDelete,
  onEdit,
  onRepost,
  products,
}: {
  post: any;
  roasterName: string;
  avatarUrl?: string | null;
  city?: string | null;
  isOwner?: boolean;
  onPin?: (id: number) => void;
  onDelete?: (id: number) => void;
  onEdit?: (id: number, data: any) => Promise<void>;
  onRepost?: (post: any) => void;
  products?: any[];
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  // ── Edit mode state ──
  const [isEditingPost, setIsEditingPost] = useState(false);
  const [editTeaser, setEditTeaser] = useState(post.teaser);
  const [editTitle, setEditTitle] = useState(post.title);
  const [editUrl, setEditUrl] = useState(post.external_url || "");
  const [editLocation, setEditLocation] = useState(post.location || "");
  const [editImages, setEditImages] = useState<string[]>(post.images || []);
  const [editSaving, setEditSaving] = useState(false);
  const [showImgUpload, setShowImgUpload] = useState(false);
  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [addCardTab, setAddCardTab] = useState<"image" | "tasting_note">("image");
  const [editGridW, setEditGridW] = useState(0);

  // Tasting note selector state
  const [tnSearch, setTnSearch] = useState("");
  const [tnSelectedCoffee, setTnSelectedCoffee] = useState<any>(null);
  const [tnScores, setTnScores] = useState({ acidity: 3, body: 3, sweetness: 3, aftertaste: 3 });

  const isArticle = post.post_type === "article";
  const hasTastingNote = editImages.some((img) => img.startsWith('{"type":') && img.includes('"tasting_note"'));
  const canAddImage = !isArticle && editImages.length < 6;

  // Edit thumbnails: 3-column layout, same aspect ratio as gallery's 3-column height
  const EDIT_COLS = 3;
  const EDIT_GAP = 8;
  const editThumbW = editGridW > 0 ? Math.floor((editGridW - EDIT_GAP * (EDIT_COLS - 1)) / EDIT_COLS) : 100;
  const editThumbH = Math.floor(editThumbW * GALLERY_ASPECT);

  const handleStartEdit = () => {
    setEditTeaser(post.teaser);
    setEditTitle(post.title);
    setEditUrl(post.external_url || "");
    setEditLocation(post.location || "");
    setEditImages(post.images || []);
    setIsEditingPost(true);
  };

  const handleCancelEdit = () => setIsEditingPost(false);

  const handleSaveEdit = async () => {
    setEditSaving(true);
    try {
      await onEdit?.(post.id, {
        title: editTitle,
        teaser: editTeaser,
        external_url: editUrl || null,
        location: editLocation || null,
        images: editImages,
      });
      setIsEditingPost(false);
    } catch {} finally {
      setEditSaving(false);
    }
  };
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const menuBtnRef = useRef<any>(null);
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

  const isPinned = !!post.is_featured;

  return (
    <View style={pc.card}>

      {/* ── Header: avatar + name + timestamp + subtitle + three-dot menu ── */}
      <View style={pc.header}>
        <View>
          {avatarUrl ? (
            <Image source={{ uri: resolveUploadUrl(avatarUrl) }} style={pc.avatar} contentFit="cover" />
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
          <Text style={pc.subtitle}>
            {isPinned ? "Pinned" : post.post_type === "tasting_note" ? "Posted a tasting note" : post.post_type === "note" ? "Shared a moment" : post.post_type === "repost" ? "Reposted" : "Shared an article"}
          </Text>
        </View>
        {/* Three-dot menu — owner only (Figma 249:3494, horizontal dots) */}
        {isOwner && (
          <View style={pc.menuWrap}>
            <Pressable
              ref={menuBtnRef}
              onPress={() => {
                if (menuBtnRef.current?.measureInWindow) {
                  menuBtnRef.current.measureInWindow((x: number, y: number, w: number, h: number) => {
                    setMenuPos({ top: y + h, right: Math.max(16, (typeof window !== "undefined" ? window.innerWidth : 1440) - x - w) });
                    setMenuOpen(true);
                  });
                } else {
                  setMenuOpen((v) => !v);
                }
              }}
              hitSlop={8}
              style={pc.menuDotsBtn}
            >
              <View style={{ transform: [{ rotate: "-90deg" }] }}>
                <Svg width={4} height={14} viewBox="0 0 4 14" fill="none">
                  <Circle cx={2} cy={2} r={1.5} fill="#A09580" />
                  <Circle cx={2} cy={7} r={1.5} fill="#A09580" />
                  <Circle cx={2} cy={12} r={1.5} fill="#A09580" />
                </Svg>
              </View>
            </Pressable>
            <Modal visible={menuOpen} transparent animationType="none" onRequestClose={() => setMenuOpen(false)}>
              <Pressable style={pc.dropdownOverlay} onPress={() => setMenuOpen(false)}>
                <View style={[pc.dropdown, { position: "absolute", top: menuPos.top, right: menuPos.right } as any]}>
                  {/* Edit post — Figma 264:3592 pencil icon */}
                  <Pressable onPress={() => { setMenuOpen(false); handleStartEdit(); }} style={pc.dropdownItem}>
                    <Svg width={15} height={15} viewBox="0 0 16.5 16.5" fill="none">
                      <Path d="M0.75 15.75H15.75M0.75 15.75V11.9004L10.9393 1.44043L10.941 1.43879C11.3112 1.05875 11.4966 0.8684 11.7103 0.797103C11.8986 0.734299 12.1015 0.734299 12.2898 0.797103C12.5034 0.868349 12.6886 1.05849 13.0583 1.43798L14.6893 3.11236C15.0606 3.49349 15.2463 3.68414 15.3159 3.90388C15.377 4.09717 15.377 4.30538 15.3158 4.49867C15.2463 4.71826 15.0609 4.90862 14.6902 5.2892L14.6893 5.29002L4.5 15.75L0.75 15.75Z" stroke="#684F44" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                    <Text style={pc.dropdownText}>Edit post</Text>
                  </Pressable>
                  <View style={pc.dropdownDivider} />
                  {/* Pin/Unpin — Figma 292:3907 (pin) / 264:3600 (unpin) */}
                  <Pressable onPress={() => { setMenuOpen(false); onPin?.(post.id); }} style={pc.dropdownItem}>
                    {isPinned ? (
                      <Svg width={15} height={15} viewBox="0 0 16.5 16.5" fill="none">
                        <Path d="M6.16456 10.4306L0.75 15.75M11.4875 12.461L10.0739 13.8497L2.41602 6.32641L3.82964 4.93763M11.75 8.75L15.75 5.5375L10.8769 0.750002L7.75 4.75" stroke="#684F44" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                    ) : (
                      <Svg width={15} height={15} viewBox="0 0 16.5 16.5" fill="none">
                        <Path d="M6.16456 10.4306L0.75 15.75M2.41602 6.32641L10.0739 13.8497L11.4875 12.461L11.1601 9.36176L15.75 5.5375L10.8769 0.750001L6.98341 5.25925L3.82964 4.93763L2.41602 6.32641Z" stroke="#684F44" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                    )}
                    <Text style={pc.dropdownText}>{isPinned ? "Unpin post" : "Pin post"}</Text>
                  </Pressable>
                  <View style={pc.dropdownDivider} />
                  {/* Delete — Figma 264:3593 trash icon */}
                  <Pressable onPress={() => { setMenuOpen(false); onDelete?.(post.id); }} style={pc.dropdownItem}>
                    <Svg width={13} height={15} viewBox="0 0 14.5 16.5" fill="none">
                      <Path d="M2.375 3.25V13.0833C2.375 14.0168 2.375 14.4831 2.55211 14.8397C2.70791 15.1533 2.95632 15.4087 3.26208 15.5685C3.60935 15.75 4.06418 15.75 4.97249 15.75H9.52751C10.4358 15.75 10.89 15.75 11.2373 15.5685C11.543 15.4087 11.7923 15.1533 11.9481 14.8397C12.125 14.4835 12.125 14.0175 12.125 13.0859V3.25M2.375 3.25H4M2.375 3.25H0.75M4 3.25H10.5M4 3.25C4 2.47343 4 2.08534 4.1237 1.77905C4.28862 1.37067 4.60476 1.04602 5.00293 0.876868C5.30156 0.750001 5.68034 0.750001 6.4375 0.750001H8.0625C8.81965 0.750001 9.19823 0.750001 9.49686 0.876868C9.89503 1.04602 10.2113 1.37067 10.3762 1.77905C10.4999 2.08534 10.5 2.47343 10.5 3.25M10.5 3.25H12.125M12.125 3.25H13.75" stroke="#684F44" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                    <Text style={pc.dropdownText}>Delete</Text>
                  </Pressable>
                </View>
              </Pressable>
            </Modal>
          </View>
        )}
      </View>

      {/* ── Body text / Title ── */}
      {isEditingPost ? (
        <>
          {isArticle && (
            <TextInput
              style={[pc.body, pc.editInput]}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Title"
              placeholderTextColor="#A09580"
            />
          )}
          <TextInput
            style={[pc.body, pc.editInput, { minHeight: 60 }]}
            value={editTeaser}
            onChangeText={setEditTeaser}
            placeholder="What's on your mind?"
            placeholderTextColor="#A09580"
            multiline
          />
          {isArticle && (
            <TextInput
              style={[pc.locationText, pc.editInput, { marginTop: 8 }]}
              value={editUrl}
              onChangeText={setEditUrl}
              placeholder="Article URL"
              placeholderTextColor="#A09580"
              autoCapitalize="none"
            />
          )}
          {!isArticle && (
            <View style={[pc.locationRow, { marginTop: 4 }]}>
              <PostLocationPinIcon size={12} color="#D798DA" />
              <TextInput
                style={[pc.locationText, pc.editInput, { flex: 1 }]}
                value={editLocation}
                onChangeText={setEditLocation}
                placeholder="Location (optional)"
                placeholderTextColor="#A09580"
              />
            </View>
          )}
        </>
      ) : (
        <>
          <Pressable onPress={handleOpen}>
            <Text style={pc.body}>{post.teaser}</Text>
          </Pressable>
          {(post.location || city) ? (
            <View style={pc.locationRow}>
              <PostLocationPinIcon size={12} color="#D798DA" />
              <Text style={pc.locationText}>{post.location || city}</Text>
            </View>
          ) : null}
        </>
      )}

      {/* ── Repost: nested original post card ── */}
      {post.post_type === "repost" && post.original_post && (
        <Pressable onPress={() => openPostModal({ postId: post.original_post.id, mode: "comment" })} style={pc.repostCard}>
          <View style={pc.repostCardHeader}>
            <Pressable
              onPress={() => {
                const op = post.original_post;
                if (op.roaster_slug && !op.roaster_slug.startsWith("user_")) router.push(`/roaster/${op.roaster_slug}`);
                else if (op.author_username) router.push(`/user/${op.author_username}`);
              }}
              style={pc.repostCardAuthorRow}
            >
              {post.original_post.author_avatar_url ? (
                <Image source={{ uri: resolveUploadUrl(post.original_post.author_avatar_url) }} style={pc.repostCardAvatar} contentFit="cover" />
              ) : (
                <View style={[pc.repostCardAvatar, pc.repostCardAvatarFb]}>
                  <Text style={pc.repostCardAvatarLetter}>{(post.original_post.author_display_name || "?")[0].toUpperCase()}</Text>
                </View>
              )}
              <Text style={pc.repostCardAuthor} numberOfLines={1}>{post.original_post.author_display_name}</Text>
            </Pressable>
            <Text style={pc.repostCardTime}>{timeAgo(post.original_post.published_at)}</Text>
          </View>
          <Text style={pc.repostCardTeaser} numberOfLines={3}>{post.original_post.teaser}</Text>
          {(post.original_post.images?.length > 0 || post.original_post.cover_image_url) && (
            <View style={pc.repostCardGallery}>
              <PhotoGallery
                images={post.original_post.images?.length > 0 ? post.original_post.images : [post.original_post.cover_image_url]}
                onPress={() => { if (post.original_post.external_url) Linking.openURL(post.original_post.external_url); }}
              />
            </View>
          )}
        </Pressable>
      )}

      {/* ── Photo gallery / Editable image grid ── */}
      {isEditingPost ? (
        <View style={pc.editImageGrid} onLayout={(e) => setEditGridW(e.nativeEvent.layout.width)}>
          {editImages.map((entry, idx) => {
            const isTN = entry.startsWith('{"type":') && entry.includes('"tasting_note"');
            return (
              <View key={idx} style={[pc.editImageThumb, { width: editThumbW, height: editThumbH }]}>
                {isTN ? (
                  <TastingNoteCard {...JSON.parse(entry)} width={editThumbW} height={editThumbH} />
                ) : (
                  <Image source={{ uri: resolveUploadUrl(entry) }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                )}
                <Pressable onPress={() => setEditImages((prev) => prev.filter((_, i) => i !== idx))} style={pc.editImageRemove}>
                  <X size={12} color="#FAF8F0" strokeWidth={2.5} />
                </Pressable>
              </View>
            );
          })}
          {canAddImage && (
            <Pressable onPress={() => { setAddCardTab("image"); setShowAddCardModal(true); }} style={[pc.editImageAdd, { width: editThumbW, height: editThumbH }]}>
              <Plus size={20} color="#A09580" strokeWidth={1.5} />
              <Text style={pc.editImageAddLabel}>Add Card</Text>
            </Pressable>
          )}

          {/* Image upload modal (opened from Add Card → Image tab) */}
          <ImageUploadModal
            visible={showImgUpload}
            title="Add image"
            purpose="post"
            currentUrl=""
            onConfirm={(url) => { setEditImages((prev) => [...prev, url]); setShowImgUpload(false); }}
            onClose={() => setShowImgUpload(false)}
          />

          {/* Add Card two-tab modal */}
          <Modal visible={showAddCardModal} transparent animationType="fade" onRequestClose={() => setShowAddCardModal(false)}>
            <Pressable style={pc.addCardOverlay} onPress={() => setShowAddCardModal(false)}>
              <Pressable style={pc.addCardModal} onPress={(e) => e.stopPropagation()}>
                {/* Header */}
                <View style={pc.addCardHeader}>
                  <Text style={pc.addCardTitle}>Add Card</Text>
                  <Pressable onPress={() => setShowAddCardModal(false)} hitSlop={8}>
                    <X size={18} color="#351101" />
                  </Pressable>
                </View>

                {/* Tabs */}
                <View style={pc.addCardTabs}>
                  <Pressable onPress={() => setAddCardTab("image")} style={[pc.addCardTab, addCardTab === "image" && pc.addCardTabActive]}>
                    <Text style={[pc.addCardTabText, addCardTab === "image" && pc.addCardTabTextActive]}>Image</Text>
                  </Pressable>
                  <Pressable onPress={() => setAddCardTab("tasting_note")} style={[pc.addCardTab, addCardTab === "tasting_note" && pc.addCardTabActive]}>
                    <Text style={[pc.addCardTabText, addCardTab === "tasting_note" && pc.addCardTabTextActive]}>Tasting Note</Text>
                  </Pressable>
                </View>

                {/* Tab content */}
                {addCardTab === "image" ? (
                  <Pressable
                    onPress={() => { setShowAddCardModal(false); setShowImgUpload(true); }}
                    style={pc.addCardImageBtn}
                  >
                    <Camera size={24} color="#684F44" strokeWidth={1.2} />
                    <Text style={pc.addCardImageBtnText}>Upload or paste an image</Text>
                  </Pressable>
                ) : (
                  <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                    {/* Coffee search */}
                    <TextInput
                      style={pc.addCardSearch}
                      value={tnSearch}
                      onChangeText={setTnSearch}
                      placeholder="Search for a coffee..."
                      placeholderTextColor="#A09580"
                    />

                    {/* Coffee results (when searching, before selection) */}
                    {!tnSelectedCoffee && tnSearch.length > 1 && (
                      <View style={pc.addCardResults}>
                        {(products || [])
                          .filter((p: any) => p.coffee_name?.toLowerCase().includes(tnSearch.toLowerCase()))
                          .slice(0, 6)
                          .map((p: any) => (
                            <Pressable
                              key={p.product_id}
                              onPress={() => { setTnSelectedCoffee(p); setTnSearch(p.coffee_name); }}
                              style={pc.addCardResultRow}
                            >
                              <Text style={pc.addCardResultName} numberOfLines={1}>{p.coffee_name}</Text>
                              <Text style={pc.addCardResultRoaster} numberOfLines={1}>{p.roaster_name}</Text>
                            </Pressable>
                          ))}
                      </View>
                    )}

                    {/* Score selectors (after coffee selected) */}
                    {tnSelectedCoffee && (
                      <View style={{ marginTop: 12 }}>
                        <Text style={pc.addCardSelectedName} numberOfLines={1}>{tnSelectedCoffee.coffee_name}</Text>
                        <Text style={pc.addCardSelectedRoaster}>By {tnSelectedCoffee.roaster_name}</Text>

                        {(["acidity", "body", "sweetness", "aftertaste"] as const).map((field) => (
                          <View key={field} style={pc.addCardScoreRow}>
                            <Text style={pc.addCardScoreLabel}>{field.charAt(0).toUpperCase() + field.slice(1)}</Text>
                            <View style={pc.addCardScoreDots}>
                              {[1, 2, 3, 4, 5].map((v) => (
                                <Pressable
                                  key={v}
                                  onPress={() => setTnScores((prev) => ({ ...prev, [field]: v }))}
                                  style={[pc.addCardDot, tnScores[field] === v && pc.addCardDotActive]}
                                >
                                  <Text style={[pc.addCardDotText, tnScores[field] === v && pc.addCardDotTextActive]}>{v}</Text>
                                </Pressable>
                              ))}
                            </View>
                          </View>
                        ))}

                        <Pressable
                          onPress={() => {
                            const noteData = JSON.stringify({
                              type: "tasting_note",
                              coffee_name: tnSelectedCoffee.coffee_name,
                              roaster_name: tnSelectedCoffee.roaster_name,
                              roast_level: tnSelectedCoffee.roast_level,
                              process: tnSelectedCoffee.process,
                              product_url: tnSelectedCoffee.product_url,
                              ...tnScores,
                            });
                            // Tasting note always goes first
                            setEditImages((prev) => {
                              const filtered = prev.filter((e) => !(e.startsWith('{"type":') && e.includes('"tasting_note"')));
                              return [noteData, ...filtered];
                            });
                            setShowAddCardModal(false);
                            setTnSelectedCoffee(null);
                            setTnSearch("");
                          }}
                          style={pc.addCardConfirmBtn}
                        >
                          <Text style={pc.addCardConfirmText}>Add Tasting Note</Text>
                        </Pressable>
                      </View>
                    )}
                  </ScrollView>
                )}
              </Pressable>
            </Pressable>
          </Modal>
        </View>
      ) : (
        isArticle && post.cover_image_url ? (
          <Pressable onPress={handleOpen} style={pc.articleThumbWrap}>
            <Image source={{ uri: resolveUploadUrl(post.cover_image_url) }} style={pc.articleThumbImg} contentFit="cover" />
            <View style={pc.articleOverlay}>
              {post.title ? <Text style={pc.articleTitle} numberOfLines={2}>{post.title}</Text> : null}
              {post.external_url ? <Text style={pc.articleDomain}>{post.external_url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</Text> : null}
            </View>
          </Pressable>
        ) : (
          <PhotoGallery images={post.images || (post.cover_image_url ? [post.cover_image_url] : [])} onPress={handleOpen} />
        )
      )}

      {/* ── Edit save/cancel bar ── */}
      {isEditingPost && (
        <View style={pc.editBar}>
          <Pressable onPress={handleCancelEdit} style={pc.editBarDiscard}>
            <Text style={pc.editBarDiscardText}>Discard</Text>
          </Pressable>
          <Pressable onPress={handleSaveEdit} style={pc.editBarSave} disabled={editSaving}>
            {editSaving ? (
              <ActivityIndicator size="small" color="#351101" />
            ) : (
              <Text style={pc.editBarSaveText}>Save</Text>
            )}
          </Pressable>
        </View>
      )}

      {/* ── Action bar (heart | comment | repost | share) ── */}
      {!isEditingPost && (
        <View style={pc.actionBar}>
          <Pressable onPress={handleLike} style={pc.actionBtn}>
            <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
              {liked
                ? <HeartFilledOutlineIcon size={16} color="#D798DA" />
                : <HeartOutlineIcon size={16} color="#D798DA" />}
            </Animated.View>
            <Text style={[pc.actionCount, liked && { color: "#D798DA" }]}>{likeCount}</Text>
          </Pressable>
          <Pressable onPress={() => openPostModal({ post, mode: "comment" })} style={pc.actionBtn}>
            <CommentBubbleIcon size={14} color="#D798DA" />
            <Text style={pc.actionCount}>{commentCount}</Text>
          </Pressable>
          {post.post_type !== "repost" && (
            <Pressable onPress={() => openPostModal({ post, mode: "repost" })} style={pc.actionBtn}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path d="M17 1L21 5L17 9M3 11V9C3 7.93 3.42 6.93 4.17 6.17C4.93 5.42 5.93 5 7 5H21M7 23L3 19L7 15M21 13V15C21 16.06 20.58 17.07 19.83 17.83C19.07 18.58 18.07 19 17 19H3" stroke="#D798DA" strokeWidth={2.095} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
              {(post.repost_count || 0) > 0 && <Text style={pc.actionCount}>{post.repost_count}</Text>}
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
                navigator.clipboard.writeText(post.external_url || window.location.href);
              }
            }}
            style={pc.actionBtn}
          >
            <ShareNodesIcon size={12} color="#D798DA" />
          </Pressable>
          {post.external_url && (
            <Pressable onPress={handleOpen} style={pc.readMore}>
              <Text style={pc.readMoreText}>Read →</Text>
            </Pressable>
          )}
        </View>
      )}
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
  // Three-dot menu (Figma 249:3494) + dropdown via Modal (Figma 264:3590 / 292:3898)
  menuWrap: {} as any,
  menuDotsBtn: { padding: 4 },
  dropdownOverlay: {
    flex: 1,
  } as any,
  dropdown: {
    backgroundColor: "#fff",
    borderRadius: 6.228,
    paddingVertical: 8,
    width: 173,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.15,
    shadowRadius: 6.228,
    elevation: 8,
  } as any,
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 18,
    paddingVertical: 12,
  } as any,
  dropdownText: { fontFamily: fonts.bodyRegular, fontSize: 13.573, color: "#684F44" },
  dropdownDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(215,209,196,0.4)", marginHorizontal: 10 },
  // Edit mode styles
  // Nested repost card
  repostCard: {
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#D7D1C4",
    borderRadius: 8,
    backgroundColor: "#FEFDFB",
    padding: 12,
  },
  repostCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 } as any,
  repostCardAvatar: { width: 20, height: 20, borderRadius: 10, overflow: "hidden" } as any,
  repostCardAvatarFb: { backgroundColor: "#351101", alignItems: "center", justifyContent: "center" } as any,
  repostCardAvatarLetter: { fontFamily: fonts.bodySemiBold, fontSize: 8, color: "#FAF8F0" },
  repostCardAuthorRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 } as any,
  repostCardAuthor: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#351101" },
  repostCardTime: { fontFamily: fonts.bodyRegular, fontSize: 10, color: "#A09580" },
  repostCardTeaser: { fontFamily: fonts.bodyRegular, fontSize: 13, color: "#684F44", lineHeight: 18 },
  repostCardGallery: { marginTop: 8 },
  // Article thumbnail — full column width with white rounded title box
  articleThumbWrap: {
    marginBottom: 14,
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
    height: 200,
  } as any,
  articleThumbImg: { width: "100%" as any, height: "100%" as any },
  articleOverlay: {
    position: "absolute",
    bottom: 10,
    left: 10,
    backgroundColor: "#FFF",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "80%",
  } as any,
  articleTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: "#351101",
    lineHeight: 19,
    marginBottom: 2,
  },
  articleDomain: {
    fontFamily: fonts.bodyRegular,
    fontSize: 11,
    color: "#A09580",
  },
  editInput: {
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#EDE8E1",
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  editImageGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  } as any,
  editImageThumb: {
    borderRadius: 5,
    overflow: "hidden",
    position: "relative",
  } as any,
  editImageRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  } as any,
  editImageAdd: {
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#C7BAA5",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  } as any,
  editImageAddLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    color: "#A09580",
  },
  // Add Card modal
  addCardOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  } as any,
  addCardModal: {
    backgroundColor: "#FAF8F0",
    borderRadius: 12,
    width: "90%",
    maxWidth: 420,
    maxHeight: "80%",
    padding: 20,
  } as any,
  addCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  } as any,
  addCardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: "#351101" },
  addCardTabs: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  } as any,
  addCardTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#D7D1C4",
    backgroundColor: "#FEFDFB",
  },
  addCardTabActive: {
    borderColor: "#351101",
    backgroundColor: "#351101",
  },
  addCardTabText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: "#684F44" },
  addCardTabTextActive: { color: "#FAF8F0" },
  addCardImageBtn: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 40,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#C7BAA5",
    borderStyle: "dashed",
  } as any,
  addCardImageBtnText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#684F44" },
  addCardSearch: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    color: "#351101",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#D7D1C4",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  addCardResults: { marginTop: 4 },
  addCardResultRow: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(215,209,196,0.4)",
  },
  addCardResultName: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#351101" },
  addCardResultRoaster: { fontFamily: fonts.bodyRegular, fontSize: 11, color: "#684F44", marginTop: 2 },
  addCardSelectedName: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: "#351101" },
  addCardSelectedRoaster: { fontFamily: fonts.bodyRegular, fontSize: 12, color: "#684F44", marginBottom: 12 },
  addCardScoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  } as any,
  addCardScoreLabel: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#351101", width: 80 },
  addCardScoreDots: { flexDirection: "row", gap: 8 } as any,
  addCardDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(215,209,196,0.4)",
    alignItems: "center",
    justifyContent: "center",
  } as any,
  addCardDotActive: { backgroundColor: "#D798DA" },
  addCardDotText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#684F44" },
  addCardDotTextActive: { color: "#351101" },
  addCardConfirmBtn: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 6,
    backgroundColor: "#351101",
    alignItems: "center",
  } as any,
  addCardConfirmText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: "#FAF8F0" },
  editBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(215,209,196,0.4)",
  } as any,
  editBarDiscard: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 4,
  },
  editBarDiscardText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: "#A09580" },
  editBarSave: {
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: "#351101",
  },
  editBarSaveText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: "#FAF8F0" },
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
    <View style={{ transform: [{ rotate: "45deg" }] }}>
      <Plus size={8} color="#fff" strokeWidth={3} />
    </View>
  );
}

function FollowButton({ following, onToggle }: { following: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={[fb.btn, following && fb.btnFollowing]}>
      {!following && <Plus size={10} color="#FAF8F0" strokeWidth={2.5} />}
      {following && <Check size={10} color="#351101" strokeWidth={2.5} />}
      <Text style={[fb.text, following && fb.textFollowing]}>
        {following ? "Following" : "Follow"}
      </Text>
    </Pressable>
  );
}

const fb = StyleSheet.create({
  // Figma 163:2373 — Follow 71×27, Following 88×27 (expands right)
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
  btnFollowing: {
    width: 88,
    backgroundColor: "#D798DA",
    borderColor: "#D798DA",
  },
  text: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: "#FAF8F0" },
  textFollowing: { color: "#351101" },
});

// ── Inline editable coffee card (owner: add bean flow) ────────────────────────
// Placeholder: Figma 249:3318 — cream card, 1.5px #C7BAA5 border, centered + circle
// Edit form:   Figma 249:3486 — slides in from right, fonts match CoffeeLabel exactly

// Inline SVG replacements for former Figma MCP localhost assets
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
        <Svg width={44} height={44} viewBox="0 0 44 44" fill="none">
          <Circle cx={22} cy={22} r={22} fill="#EFE9DB" />
          <Path d="M22 12V32M12 22H32" stroke="#351101" strokeWidth={2} strokeLinecap="round" />
        </Svg>
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
                <Image source={{ uri: resolveUploadUrl(imageUrl) }} style={StyleSheet.absoluteFillObject} contentFit="cover" contentPosition={{ top: `${cropY}%`, left: "50%" }} />
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
                : <Svg width={29} height={29} viewBox="0 0 29.16 29.16" fill="none">
                    <Circle cx={14.58} cy={14.58} r={14.58} fill="#D798DA" />
                    <Path d="M9 15L13 19L21 11" stroke="#351101" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
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
  const ROASTER_POSTS_PER_PAGE = 5;
  const [visibleRoasterPosts, setVisibleRoasterPosts] = useState(5);
  const [activeRightTab, setActiveRightTab] = useState<"posts" | "beans">("posts");
  const [followers, setFollowers] = useState<any[]>([]);
  const [showFollowersModal, setShowFollowersModal] = useState(false);
  const [myFollows, setMyFollows] = useState<string[]>([]);

  // Fetch which roasters I follow when modal opens
  useEffect(() => {
    if (!showFollowersModal || !user) return;
    apiFetch<{ following: string[] }>("/me/following")
      .then((d) => setMyFollows(d.following || []))
      .catch(() => {});
  }, [showFollowersModal, user]);

  const handleToggleFollowInModal = useCallback(async (roasterSlug: string) => {
    try {
      const res = await apiFetch<{ following: boolean }>(`/roasters/${roasterSlug}/follow`, { method: "POST" });
      setMyFollows((prev) => res.following ? [...prev, roasterSlug] : prev.filter((s) => s !== roasterSlug));
    } catch {}
  }, []);

  // Default to beans tab if roaster has no posts
  useEffect(() => {
    if (postsLoading) return;
    if (allPosts.length === 0) setActiveRightTab("beans");
  }, [postsLoading, allPosts]);

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
  const heroCropX = profile?.hero_crop_x ?? 50;
  const heroCropY = profile?.hero_crop_y ?? 50;
  const heroZoom = profile?.hero_zoom ?? 1;
  const [editCropX, setEditCropX] = useState(heroCropX);
  const [editCropY, setEditCropY] = useState(heroCropY);
  const [editHeroZoom, setEditHeroZoom] = useState(heroZoom);
  const [isDraggingHero, setIsDraggingHero] = useState(false);
  const [heroImgAspect, setHeroImgAspect] = useState(1.8);
  const [heroContW, setHeroContW] = useState(0);
  const [heroContH, setHeroContH] = useState(0);
  const dragStartRef = useRef({ x: 0, y: 0, cropX: 50, cropY: 50 });
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
      setEditCropX(heroCropX);
      setEditCropY(heroCropY);
      setEditHeroZoom(heroZoom);
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
          hero_crop_x: editCropX,
          hero_crop_y: editCropY,
          hero_zoom: editHeroZoom,
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

  // ── Hero drag-to-reposition (web mouse events, X + Y axes) ─────────────────
  const handleHeroDragStart = useCallback((e: any) => {
    if (!isEditing) return;
    e.preventDefault();
    dragStartRef.current = { x: e.clientX, y: e.clientY, cropX: editCropX, cropY: editCropY };
    setIsDraggingHero(true);

    const handleMove = (ev: MouseEvent) => {
      const heroEl = (heroWrapRef.current as unknown as HTMLElement);
      if (!heroEl) return;
      const rect = heroEl.getBoundingClientRect();
      const deltaX = ev.clientX - dragStartRef.current.x;
      const deltaY = ev.clientY - dragStartRef.current.y;
      const deltaPctX = (deltaX / rect.width) * 100;
      const deltaPctY = (deltaY / rect.height) * 100;
      setEditCropX(Math.max(0, Math.min(100, dragStartRef.current.cropX - deltaPctX)));
      setEditCropY(Math.max(0, Math.min(100, dragStartRef.current.cropY - deltaPctY)));
    };

    const handleUp = () => {
      setIsDraggingHero(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [isEditing, editCropX, editCropY]);

  // Pinch-to-zoom for hero image (trackpad pinch = wheel + ctrlKey on web)
  const handleHeroWheel = useCallback((e: any) => {
    if (!isEditing) return;
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.01;
    setEditHeroZoom((z) => Math.round(Math.max(1, Math.min(5, z + delta)) * 100) / 100);
  }, [isEditing]);

  const loadPosts = useCallback(async () => {
    try {
      setPostsLoading(true);
      const all = await apiFetch<any>(`/roasters/${slug}/posts`);
      setAllPosts(all.posts || []);
    } catch (e) {
      console.warn("Posts load error:", e);
      setAllPosts([]);
    } finally {
      setPostsLoading(false);
    }
  }, [slug]);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  const handlePinToggle = useCallback(async (postId: number) => {
    try {
      await apiFetch(`/roaster-posts/${postId}/pin`, { method: "PUT" });
      await loadPosts();
    } catch (e: any) {
      console.warn("Pin toggle error:", e.message);
    }
  }, [loadPosts]);

  const handleDeletePost = useCallback(async (postId: number) => {
    try {
      await apiFetch(`/roaster-posts/${postId}`, { method: "DELETE" });
      setAllPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (e: any) {
      console.warn("Delete post error:", e.message);
    }
  }, []);

  const handleEditPost = useCallback(async (postId: number, data: any) => {
    await apiFetch(`/roaster-posts/${postId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    await loadPosts();
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

  // For owner management: non-featured posts shown below
  // Sort posts: pinned first, then rest by date descending
  const sortedPosts = useMemo(() => {
    const pinned = allPosts.filter((p) => p.is_featured);
    const rest = allPosts.filter((p) => !p.is_featured);
    return [...pinned, ...rest];
  }, [allPosts]);

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
            <LeftPanelShareIcon />
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
                <Image source={{ uri: resolveUploadUrl(editLogo) }} style={s.uploadThumb} contentFit="cover" />
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
                <Pressable onPress={() => setShowFollowersModal(true)} style={s.metaItem}>
                  <UsersIcon />
                  <Text style={s.metaText}>{followerCount} {followerCount === 1 ? "follower" : "followers"}</Text>
                </Pressable>
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
            onScroll={(e) => {
              const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
              if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 300) {
                if (activeRightTab === "posts" && visibleRoasterPosts < sortedPosts.length) {
                  setVisibleRoasterPosts((c) => Math.min(c + ROASTER_POSTS_PER_PAGE, sortedPosts.length));
                }
              }
            }}
            scrollEventThrottle={400}
          >
          {/* Hero image — show editHero during edit mode, draggable to reposition */}
          <View
            ref={heroWrapRef}
            style={[s.heroImageWrap, isEditing && isDraggingHero && { cursor: "grabbing" } as any, isEditing && !isDraggingHero && { cursor: "grab" } as any]}
            onLayout={(e) => { setHeroContW(e.nativeEvent.layout.width); setHeroContH(e.nativeEvent.layout.height); }}
            {...(isEditing && Platform.OS === "web" ? { onMouseDown: handleHeroDragStart, onWheel: handleHeroWheel } : {})}
          >
            {(isEditing ? editHero : heroImageUrl) ? (() => {
              const cW = heroContW || 800;
              const cH = heroContH || 334;
              const zoom = isEditing ? editHeroZoom : heroZoom;
              const cx = isEditing ? editCropX : heroCropX;
              const cy = isEditing ? editCropY : heroCropY;
              const contAspect = cW / cH;
              const MIN_OVER = 1.15;
              let iW: number, iH: number;
              if (heroImgAspect > contAspect) {
                iH = cH * MIN_OVER * zoom;
                iW = iH * heroImgAspect;
              } else {
                iW = cW * MIN_OVER * zoom;
                iH = iW / heroImgAspect;
              }
              const tx = -(iW - cW) * (cx / 100);
              const ty = -(iH - cH) * (cy / 100);
              return (
                <Image
                  source={{ uri: resolveUploadUrl(isEditing ? editHero : heroImageUrl) }}
                  style={{ position: "absolute", width: iW, height: iH, left: tx, top: ty } as any}
                  contentFit="fill"
                  onLoad={(e: any) => { const src = e?.source; if (src?.width && src?.height) setHeroImgAspect(src.width / src.height); }}
                />
              );
            })() : (
              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "#1a0800" }]} />
            )}
            {/* Drag hint — shown in edit mode */}
            {isOwner && isEditing && !isDraggingHero && (
              <View style={s.heroDragHint} pointerEvents="none">
                <Text style={s.heroDragHintText}>Drag to reposition · Pinch to zoom</Text>
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
            const hasPosts = allPosts.length > 0;
            const showTabs = !postsLoading && hasPosts;
            return (
              <>
                <View style={s.rightTabBar}>
                  {showTabs && (
                    <Pressable onPress={() => setActiveRightTab("posts")} style={s.rightTab}>
                      <Text style={[s.rightTabText, activeRightTab === "posts" && s.rightTabTextActive]}>POSTS</Text>
                      {activeRightTab === "posts" && <View style={s.rightTabUnderline} />}
                    </Pressable>
                  )}
                  <Pressable onPress={() => setActiveRightTab("beans")} style={s.rightTab}>
                    <Text style={[s.rightTabText, activeRightTab === "beans" && s.rightTabTextActive]}>BEANS</Text>
                    {activeRightTab === "beans" && <View style={s.rightTabUnderline} />}
                  </Pressable>
                </View>
              </>
            );
          })()}

          {/* ── POSTS TAB — pinned on top, then reverse-chrono ── */}
          {activeRightTab === "posts" && (
            <>
              {/* In-place compose */}
              {showCompose && !repostTarget && (
                <>
                  <ComposePost
                    onSubmit={async (data) => { await handleCreatePost(data); }}
                    onCancel={() => setShowCompose(false)}
                    loading={composing}
                    products={products}
                    user={user}
                  />
                  {sortedPosts.length > 0 && <View style={s.dividerLight} />}
                </>
              )}
              {!postsLoading && sortedPosts.length > 0 && (
                sortedPosts.slice(0, visibleRoasterPosts).map((post, i) => (
                  <View key={post.id}>
                    <RoasterPostCard
                      post={post}
                      roasterName={roaster.name}
                      avatarUrl={logoUrl}
                      city={city}
                      isOwner={isOwner}
                      onPin={handlePinToggle}
                      onDelete={handleDeletePost}
                      onEdit={handleEditPost}
                      onRepost={(post) => setRepostTarget(post)}
                      products={products}
                    />
                    {i < Math.min(sortedPosts.length, visibleRoasterPosts) - 1 && <View style={s.dividerLight} />}
                  </View>
                ))
              )}

              {/* No posts yet (owner) */}
              {isOwner && !postsLoading && allPosts.length === 0 && (
                <View style={s.emptyPostsWrap}>
                  <Text style={s.emptyPostsTitle}>Share your story</Text>
                  <Text style={s.emptyPostsBody}>
                    Post about your coffee, link to press coverage, or share anything worth reading.
                  </Text>
                  <Pressable onPress={() => setShowCompose(true)} style={s.emptyPostsBtn}>
                    <Text style={s.emptyPostsBtnText}>Write your first post →</Text>
                  </Pressable>
                </View>
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

          {/* ── FOLLOWERS MODAL (triggered from left panel followers count) ── */}
          <Modal visible={showFollowersModal} transparent animationType="fade" onRequestClose={() => setShowFollowersModal(false)}>
            <Pressable style={s.followersOverlay} onPress={() => setShowFollowersModal(false)}>
              <Pressable style={s.followersModal} onPress={(e) => e.stopPropagation()}>
                <View style={s.followersModalHeader}>
                  <Text style={s.followersCount}>
                    {followerCount} {followerCount === 1 ? "follower" : "followers"}
                  </Text>
                  <Pressable onPress={() => setShowFollowersModal(false)} hitSlop={8}>
                    <X size={18} color="#351101" />
                  </Pressable>
                </View>
                <ScrollView style={s.followersScrollArea} showsVerticalScrollIndicator={false}>
                  {followers.length === 0 ? (
                    <View style={s.followersEmpty}>
                      <Text style={s.followersEmptyText}>No followers yet</Text>
                    </View>
                  ) : (
                    followers.map((f: any, idx: number) => {
                      const isMe = user && f.username === user.username;
                      const followSlug = f.roaster_slug || f.username;
                      const amFollowing = myFollows.includes(followSlug);
                      const isRoaster = f.account_type === "roaster" && f.roaster_slug;
                      return (
                        <View key={f.username}>
                          {idx > 0 && <View style={s.followerDivider} />}
                          <View style={s.followerRow}>
                            <Pressable
                              onPress={() => { setShowFollowersModal(false); router.push(isRoaster ? `/roaster/${f.roaster_slug}` : `/user/${f.username}`); }}
                              style={s.followerPressable}
                            >
                              {f.avatar_url ? (
                                <Image source={{ uri: resolveUploadUrl(f.avatar_url) }} style={s.followerAvatar} contentFit="cover" />
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
                            {!isMe && (
                              <Pressable
                                onPress={() => handleToggleFollowInModal(followSlug)}
                                style={[s.followerFollowBtn, amFollowing && s.followerFollowBtnActive]}
                              >
                                {!amFollowing && <Plus size={10} color="#684F44" strokeWidth={2.5} />}
                                {amFollowing && <Check size={10} color="#351101" strokeWidth={2.5} />}
                                <Text style={[s.followerFollowBtnText, amFollowing && s.followerFollowBtnTextActive]}>
                                  {amFollowing ? "Following" : "Follow"}
                                </Text>
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
    gap: 14,
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

  // Inline edit fields — rounded light boxes
  inlineEdit: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(250,248,240,0.1)",
    minHeight: 80,
    textAlignVertical: "top" as any,
  } as any,
  inlineEditTag: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "rgba(250,248,240,0.1)",
    textAlign: "center" as any,
    flex: 1,
  } as any,
  inlineEditSingle: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: "#FAF8F0",
    backgroundColor: "rgba(250,248,240,0.1)",
  } as any,
  inlineEditMeta: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: "#FAF8F0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(250,248,240,0.1)",
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

  // Right panel tab bar — Figma 249:3411–3417
  // Tab bar: height 80, labels 32px from top, 4px underline flush at bottom
  // POSTS→BEANS gap 100px, left padding 56px (Figma measurements at 1440px)
  rightTabBar: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: "#FAF8F0",
    height: 80,
    paddingLeft: 56,
    gap: 100,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(215,209,196,0.5)",
  } as any,
  rightTab: {
    justifyContent: "center",
    position: "relative",
  } as any,
  rightTabActive: {},
  rightTabUnderline: {
    position: "absolute",
    bottom: -1,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: "#351101",
  } as any,
  rightTabText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: "#A09580",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  } as any,
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

  // Followers modal — triggered from left panel followers count
  followersOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  } as any,
  followersModal: {
    backgroundColor: "#FAF8F0",
    borderRadius: 12,
    width: "90%",
    maxWidth: 400,
    maxHeight: "70%",
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 8,
  } as any,
  followersModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  } as any,
  followersScrollArea: {
    flexGrow: 0,
  },
  followersCount: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: "#351101",
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
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 6,
  } as any,
  followerPressable: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minWidth: 0,
  } as any,
  // Figma 306:4077 — Follow #684F44 71×27, Following #D798DA 88×27 (opens left)
  followerFollowBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    width: 71,
    height: 27,
    borderRadius: 2,
    borderWidth: 1.5,
    borderColor: "#684F44",
    flexShrink: 0,
  } as any,
  followerFollowBtnActive: {
    width: 88,
    backgroundColor: "#D798DA",
    borderColor: "#D798DA",
  },
  followerFollowBtnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: "#684F44",
  },
  followerFollowBtnTextActive: {
    color: "#351101",
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
