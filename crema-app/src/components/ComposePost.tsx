/**
 * ComposePost — unified in-place compose with dry-run preview.
 *
 * Auto-detects mode from user input:
 *   - Paste a URL → article mode (link preview, no images)
 *   - Add images/tasting note → note mode (no link preview)
 *   - Repost (repostTarget) → repost mode (compact preview of original)
 *
 * Renders like a real post card: user avatar, name, "Just now", editable body,
 * link preview or image grid below, location field, submit bar.
 */

import { useState, useEffect, useRef } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView, Modal,
  StyleSheet, ActivityIndicator, Platform,
} from "react-native";
import { Image } from "expo-image";
import { Camera, Plus, X } from "lucide-react-native";

import { apiFetchRaw, resolveUploadUrl } from "../api/client";
import { t } from "../tokens/useTokens";
import { HapticPressable } from "./primitives";
import { PostCafeIcon, PostDrinkIcon, PostLocationPinIcon } from "./icons/FigmaIcons";
import ImageUploadModal from "./ImageUploadModal";
import TastingNoteCard from "./TastingNoteCard";
import PostGallery, { GALLERY_ASPECT, PG_RADIUS } from "./PostGallery";
import { useCafes } from "../hooks/useCafes";

interface ComposePostProps {
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
  repostTarget?: any;
  products?: any[];
  user?: { username: string; display_name?: string; avatar_url?: string } | null;
  initialData?: { body?: string; images?: string[]; location?: string; drink?: string | null };
  // When set, the composer mounts with the Add-Card → Tasting Note
  // sub-flow already open and this coffee pre-selected. Used by the
  // PopularityModal "Write a tasting note" shortcut so the user lands
  // on the sliders without searching.
  prefillTastingNote?: {
    product_id?: string | number;
    coffee_name: string;
    roaster_name?: string;
    roast_level?: string;
    process?: string;
    product_url?: string;
  };
}

const URL_REGEX = /https?:\/\/[^\s]+/;

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

export default function ComposePost({
  onSubmit,
  onCancel,
  loading = false,
  repostTarget,
  products,
  user,
  initialData,
  prefillTastingNote,
}: ComposePostProps) {
  const isRepost = !!repostTarget;
  const isEditing = !!initialData;

  // Core state
  const [teaser, setTeaser] = useState(initialData?.body || "");
  const [location, setLocation] = useState(initialData?.location || "");
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationDraft, setLocationDraft] = useState(initialData?.location || "");
  // §2.14 / §2.23 — long-form mode is now a Short / Long tab row at
  // the top of the composer (not a toggle). The same teaser textarea
  // carries the body; Long just extends the visible char limit
  // (300 → 5000) and grows the modal. Backend still stores the long
  // body under `body_full` for posts flagged `sourcing_story` — the
  // composer truncates the first ~280 chars of the body into the
  // feed `teaser`, then hands the full text over as `body_full` on
  // submit.
  const canStoryMode = !isRepost;
  const [storyMode, setStoryMode] = useState(
    (initialData as any)?.post_type === "sourcing_story",
  );
  const SHORT_MAX = 300;
  const STORY_MAX = 5000;
  const STORY_MIN = 200;
  const [cafeSlug, setCafeSlug] = useState<string | null>(null);
  const [cafePickerOpen, setCafePickerOpen] = useState(false);
  const { cafes } = useCafes();
  const selectedCafe = cafeSlug ? cafes.find((c) => c.cafe_slug === cafeSlug) : null;

  // Tag a drink — free-text chip (users pick common drinks from a modal
  // or type their own). Stored into the post teaser as context; kept
  // separate from location and café tags.
  const [drink, setDrink] = useState<string | null>(initialData?.drink || null);
  const [drinkPickerOpen, setDrinkPickerOpen] = useState(false);
  const COMMON_DRINKS = [
    "Espresso", "Cortado", "Latte", "Cappuccino", "Flat White",
    "Americano", "Pour Over", "V60", "AeroPress", "Cold Brew",
    "Mocha", "Macchiato", "Filter Coffee", "Affogato",
  ];

  // Auto-detected article link. Once a URL is detected in the
  // teaser we yank it out of the textarea and hold it as an
  // "attached" link — the preview card renders below, the URL no
  // longer takes up visual space in the composed body, and the
  // user can cancel the attachment via an X on the preview (same
  // language as image removal).
  const [attachedUrl, setAttachedUrl] = useState("");
  const [linkPreview, setLinkPreview] = useState<{ title: string; description: string; image_url: string; domain: string } | null>(null);
  const [linkTitle, setLinkTitle] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const debounceRef = useRef<any>(null);

  // Images / tasting notes
  const [imageUrls, setImageUrls] = useState<string[]>(initialData?.images || []);
  const [showImgUpload, setShowImgUpload] = useState(false);
  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [addCardTab, setAddCardTab] = useState<"image" | "tasting_note">("image");
  const [editGridW, setEditGridW] = useState(0);

  // Tasting note selector
  const [tnSearch, setTnSearch] = useState("");
  const [tnSelectedCoffee, setTnSelectedCoffee] = useState<any>(null);
  const [tnScores, setTnScores] = useState({ acidity: 3, body: 3, sweetness: 3, aftertaste: 3 });

  const isTN = (s: string) => s.startsWith('{"type":') && s.includes('"tasting_note"');
  const hasImages = imageUrls.length > 0;
  const hasUrl = !!attachedUrl;
  const isArticleMode = hasUrl && !hasImages;
  const canAddImage = !isArticleMode && imageUrls.length < 6;

  // Edit grid sizing
  const EDIT_COLS = 3;
  const EDIT_GAP = 8;
  const editThumbW = editGridW > 0 ? Math.floor((editGridW - EDIT_GAP * (EDIT_COLS - 1)) / EDIT_COLS) : 100;
  const editThumbH = Math.floor(editThumbW * GALLERY_ASPECT);

  // §2.23b — URLs don't count toward the visible character budget.
  // A pasted 50-char link shouldn't eat half a short post or half a
  // long one. We strip every URL before measuring length, for both
  // the displayed counter and the enforcement path.
  const stripUrls = (s: string) => s.replace(/https?:\/\/\S+/g, "");
  const visibleLen = stripUrls(teaser).length;
  const visibleMax = storyMode ? STORY_MAX : SHORT_MAX;

  const onChangeTeaser = (next: string) => {
    if (stripUrls(next).length > visibleMax) return;
    setTeaser(next);
  };

  // Prefill the Add-Card → Tasting Note sub-flow when a caller
  // handed us a coffee (PopularityModal "Write a tasting note"
  // shortcut). We land the user on the sliders instead of the
  // search box. Only runs on mount — changing the prop mid-session
  // wouldn't make sense here.
  useEffect(() => {
    if (!prefillTastingNote) return;
    setAddCardTab("tasting_note");
    setShowAddCardModal(true);
    setTnSelectedCoffee({
      product_id: prefillTastingNote.product_id,
      coffee_name: prefillTastingNote.coffee_name,
      roaster_name: prefillTastingNote.roaster_name || "",
      roast_level: prefillTastingNote.roast_level || "",
      process: prefillTastingNote.process || "",
      product_url: prefillTastingNote.product_url || "",
    });
    setTnSearch(prefillTastingNote.coffee_name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-detect URL in teaser text. Once a URL shows up AND we
  // don't already have one attached, yank it out of the teaser
  // and hold it as `attachedUrl`. The composer body visually loses
  // the URL — the preview card below is the anchor instead, with
  // its own X to detach.
  useEffect(() => {
    if (isRepost || hasImages) return;
    if (attachedUrl) return;
    const match = teaser.match(URL_REGEX);
    if (!match) return;
    const url = match[0];
    setAttachedUrl(url);
    setTeaser((prev) => prev.replace(url, "").replace(/\s{2,}/g, " ").trim());
  }, [teaser, hasImages, isRepost, attachedUrl]);

  // Fetch link preview when a URL gets attached.
  useEffect(() => {
    if (!attachedUrl) { setLinkPreview(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLinkLoading(true);
      try {
        const raw = await apiFetchRaw(`/link-preview?url=${encodeURIComponent(attachedUrl)}`);
        const data = raw?.data ?? raw;
        setLinkPreview(data);
        if (data.title && !linkTitle) setLinkTitle(data.title);
      } catch { setLinkPreview(null); }
      finally { setLinkLoading(false); }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [attachedUrl]);

  // Detach the attached link entirely — user dismissed the preview
  // card via the X. Everything link-related clears so article mode
  // switches off.
  const clearAttachedLink = () => {
    setAttachedUrl("");
    setLinkPreview(null);
    setLinkTitle("");
  };

  // Adding an image also detaches any attached link (article +
  // images are mutually exclusive).
  const handleAddImage = (url: string) => {
    setImageUrls((p) => [...p, url]);
    clearAttachedLink();
  };

  // Validation — visible length (URLs stripped) is what counts.
  const canSubmit = (() => {
    if (loading) return false;
    if (isRepost) return true;
    if (visibleLen === 0) return false;
    if (storyMode) return visibleLen >= STORY_MIN && visibleLen <= STORY_MAX;
    return visibleLen <= SHORT_MAX;
  })();

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (isRepost) {
      await onSubmit({
        title: "Repost",
        teaser: teaser.trim() || "Reposted",
        post_type: "repost",
        repost_of_id: repostTarget.id,
        repost_comment: teaser.trim() || null,
      });
      return;
    }
    if (storyMode) {
      // §2.23a — the one field carries both. Derive a feed excerpt
      // (~280 chars, word-boundary) from the body; store the full
      // text under body_full so PostCard's "Read the full post →"
      // still works.
      const full = teaser.trim();
      const excerpt = full.length > 280
        ? full.slice(0, 280).replace(/\s+\S*$/, "") + "\u2026"
        : full;
      const imgs = imageUrls.filter(Boolean);
      await onSubmit({
        title: excerpt.slice(0, 80) || "Long-form post",
        teaser: excerpt,
        body_full: full,
        post_type: "sourcing_story",
        images: imgs,
        cover_image_url: imgs[0] || null,
      });
      return;
    }
    if (isArticleMode) {
      await onSubmit({
        title: linkTitle.trim() || attachedUrl.slice(0, 60),
        teaser: teaser.trim(),
        external_url: attachedUrl,
        cover_image_url: linkPreview?.image_url || null,
        post_type: "article",
      });
    } else {
      const imgs = imageUrls.filter(Boolean);
      await onSubmit({
        title: teaser.trim().slice(0, 60) || "Note",
        teaser: teaser.trim(),
        post_type: "note",
        location: location.trim() || null,
        cafe_slug: cafeSlug,
        drink: drink || null,
        images: imgs,
        cover_image_url: imgs[0] || null,
      });
    }
  };

  const displayName = user?.display_name || user?.username || "You";
  const avatarUrl = user?.avatar_url;

  return (
    <View style={s.card}>
      {/* §2.23a — body is scrollable; the submit row is pinned at
         the bottom so Long-mode content (tall textarea + chips +
         Add Card) can't clip Cancel / Post. */}
      <ScrollView
        style={s.scrollBody}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
      {/* ── Post preview header (dry run) ── */}
      <View style={s.header}>
        <View>
          {avatarUrl ? (
            <Image source={{ uri: resolveUploadUrl(avatarUrl) }} style={s.avatar} contentFit="cover" />
          ) : (
            <View style={[s.avatar, s.avatarFallback]}>
              <Text style={s.avatarLetter}>{displayName[0].toUpperCase()}</Text>
            </View>
          )}
        </View>
        <View style={s.headerMeta}>
          <View style={s.nameRow}>
            <Text style={s.authorName}>{displayName}</Text>
            <Text style={s.timestamp}>Just now</Text>
          </View>
          <Text style={s.subtitle}>
            {isRepost
              ? "Reposting"
              : isArticleMode
                ? "Sharing a link"
                : storyMode
                  ? "Writing a long post"
                  : "Writing a note"}
          </Text>
        </View>
        <Pressable onPress={onCancel} hitSlop={8}>
          <X size={18} color="#A09580" />
        </Pressable>
      </View>

      {/* §2.23a — Short / Long tab row. Sits above the teaser
         textarea. Tapping Long extends the visible char limit
         (300 → 5000) on the same field and grows the modal
         vertically; no second textarea. Hidden for reposts. */}
      {canStoryMode && (
        <View style={s.modeTabs}>
          <Pressable
            onPress={() => setStoryMode(false)}
            style={[s.modeTab, !storyMode && s.modeTabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: !storyMode }}
          >
            <Text style={[s.modeTabText, !storyMode && s.modeTabTextActive]}>Short</Text>
          </Pressable>
          <Pressable
            onPress={() => setStoryMode(true)}
            style={[s.modeTab, storyMode && s.modeTabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: storyMode }}
          >
            <Text style={[s.modeTabText, storyMode && s.modeTabTextActive]}>Long</Text>
          </Pressable>
        </View>
      )}

      {/* ── Editable teaser (same font as final post body) ── */}
      <TextInput
        style={[s.teaserInput, storyMode && s.teaserInputLong]}
        value={teaser}
        onChangeText={onChangeTeaser}
        placeholder={
          isRepost
            ? "Add your thoughts..."
            : storyMode
              ? "Write the long version — a sourcing story, a brew walkthrough, a detailed review."
              : "What's on your mind? Paste a link to share an article."
        }
        placeholderTextColor="#A09580"
        multiline
      />
      <Text style={s.charCount}>
        {visibleLen}/{visibleMax}
        {storyMode && visibleLen < STORY_MIN ? ` (min ${STORY_MIN} to publish)` : ""}
      </Text>

      {/* ── ARTICLE MODE: link preview with title overlay ── */}
      {isArticleMode && (
        <View style={s.linkSection}>
          {linkLoading && <ActivityIndicator size="small" color="#D798DA" style={{ marginVertical: 12 }} />}
          {linkPreview && (
            <View style={s.previewCard}>
              {linkPreview.image_url ? (
                <View style={s.previewThumbWrap}>
                  <Image source={{ uri: linkPreview.image_url }} style={s.previewThumbImg} contentFit="cover" />
                  <View style={s.previewOverlay}>
                    <TextInput
                      style={s.previewTitle}
                      value={linkTitle}
                      onChangeText={setLinkTitle}
                      placeholder="Title"
                      placeholderTextColor="rgba(250,248,240,0.5)"
                    />
                    <Text style={s.previewDomain}>{linkPreview.domain}</Text>
                  </View>
                </View>
              ) : (
                <View style={s.previewNoImg}>
                  <TextInput
                    style={[s.previewTitle, { color: "#351101" }]}
                    value={linkTitle}
                    onChangeText={setLinkTitle}
                    placeholder="Title"
                    placeholderTextColor="#A09580"
                  />
                  <Text style={[s.previewDomain, { color: "#A09580" }]}>{linkPreview.domain}</Text>
                </View>
              )}
              {/* Detach the article — same language as image-thumb X. */}
              <Pressable onPress={clearAttachedLink} style={s.previewRemove} hitSlop={6} accessibilityLabel="Remove link">
                <X size={14} color="#FAF8F0" strokeWidth={2.5} />
              </Pressable>
            </View>
          )}
        </View>
      )}

      {/* ── NOTE MODE: image/tasting-note grid + location ── */}
      {!isRepost && !isArticleMode && (
        <View style={s.noteSection}>
          {/* Image grid */}
          <View style={s.imageGrid} onLayout={(e) => setEditGridW(e.nativeEvent.layout.width)}>
            {imageUrls.map((entry, idx) => (
              <View key={idx} style={[s.imageThumb, { width: editThumbW, height: editThumbH }]}>
                {isTN(entry) ? (
                  <TastingNoteCard {...JSON.parse(entry)} width={editThumbW} height={editThumbH} />
                ) : (
                  <Image source={{ uri: resolveUploadUrl(entry) }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                )}
                <Pressable onPress={() => setImageUrls((p) => p.filter((_, i) => i !== idx))} style={s.imageRemove}>
                  <X size={12} color="#FAF8F0" strokeWidth={2.5} />
                </Pressable>
              </View>
            ))}
            {canAddImage && (
              <Pressable onPress={() => { setAddCardTab("image"); setShowAddCardModal(true); }} style={[s.imageAdd, { width: editThumbW, height: editThumbH }]}>
                <Plus size={20} color="#A09580" strokeWidth={1.5} />
                <Text style={s.imageAddLabel}>Add Card</Text>
              </Pressable>
            )}
          </View>

          {/* §2.23c — three optional fields collapsed onto one chip
             row: Location, Tag a café, Tag a drink. Each chip opens
             its own picker (or a small text prompt for Location).
             Filled chips show the value + an X to clear. */}
          <View style={s.chipsRow}>
            <Pressable
              style={[s.fieldChip, !!location && s.fieldChipActive]}
              onPress={() => { setLocationDraft(location); setLocationOpen(true); }}
            >
              <PostLocationPinIcon size={12} color={location ? t.color["accent.cta"] : t.color.accent} />
              <Text style={[s.fieldChipLabel, !!location && s.fieldChipLabelActive]} numberOfLines={1}>
                {location || "Location"}
              </Text>
              {!!location && (
                <Pressable onPress={() => setLocation("")} hitSlop={6}>
                  <X size={11} color={t.color["text.muted"]} />
                </Pressable>
              )}
            </Pressable>

            <Pressable
              style={[s.fieldChip, !!selectedCafe && s.fieldChipActive]}
              onPress={() => setCafePickerOpen(true)}
            >
              <PostCafeIcon size={12} color={selectedCafe ? t.color["accent.cta"] : t.color.accent} />
              <Text style={[s.fieldChipLabel, !!selectedCafe && s.fieldChipLabelActive]} numberOfLines={1}>
                {selectedCafe?.name || "Tag a café"}
              </Text>
              {!!selectedCafe && (
                <Pressable onPress={() => setCafeSlug(null)} hitSlop={6}>
                  <X size={11} color={t.color["text.muted"]} />
                </Pressable>
              )}
            </Pressable>

            <Pressable
              style={[s.fieldChip, !!drink && s.fieldChipActive]}
              onPress={() => setDrinkPickerOpen(true)}
            >
              <PostDrinkIcon size={12} color={drink ? t.color["accent.cta"] : t.color.accent} />
              <Text style={[s.fieldChipLabel, !!drink && s.fieldChipLabelActive]} numberOfLines={1}>
                {drink || "Tag a drink"}
              </Text>
              {!!drink && (
                <Pressable onPress={() => setDrink(null)} hitSlop={6}>
                  <X size={11} color={t.color["text.muted"]} />
                </Pressable>
              )}
            </Pressable>
          </View>

          {/* Location text prompt — same modal shell as the drink /
             café pickers so the three chips feel symmetrical. */}
          {locationOpen && (
            <Modal visible transparent animationType="fade" onRequestClose={() => setLocationOpen(false)}>
              <View style={s.pickerOverlay}>
                <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setLocationOpen(false)} />
                <View style={s.pickerCard}>
                  <View style={s.pickerHeader}>
                    <Text style={s.pickerTitle}>Add location</Text>
                    <Pressable onPress={() => setLocationOpen(false)}><X size={18} color={t.color["text.primary"]} /></Pressable>
                  </View>
                  <View style={{ padding: 16 }}>
                    <TextInput
                      style={s.locationModalInput}
                      value={locationDraft}
                      onChangeText={setLocationDraft}
                      placeholder="Where are you?"
                      placeholderTextColor={t.color["text.muted"]}
                      autoFocus
                      onSubmitEditing={() => { setLocation(locationDraft.trim()); setLocationOpen(false); }}
                    />
                    <View style={s.locationModalActions}>
                      <Pressable onPress={() => setLocationOpen(false)} style={s.cancelBtn}>
                        <Text style={s.cancelText}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => { setLocation(locationDraft.trim()); setLocationOpen(false); }}
                        style={s.submitBtn}
                      >
                        <Text style={s.submitText}>Save</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              </View>
            </Modal>
          )}

          {/* Drink picker modal — quick list of common drinks + custom input */}
          {drinkPickerOpen && (
            <Modal visible transparent animationType="fade" onRequestClose={() => setDrinkPickerOpen(false)}>
              <View style={s.pickerOverlay}>
                <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setDrinkPickerOpen(false)} />
                <View style={s.pickerCard}>
                  <View style={s.pickerHeader}>
                    <Text style={s.pickerTitle}>Tag a drink</Text>
                    <Pressable onPress={() => setDrinkPickerOpen(false)}><X size={18} color={t.color["text.primary"]} /></Pressable>
                  </View>
                  <ScrollView style={{ maxHeight: 340 }}>
                    {COMMON_DRINKS.map((d) => (
                      <Pressable
                        key={d}
                        onPress={() => { setDrink(d); setDrinkPickerOpen(false); }}
                        style={s.pickerRow}
                      >
                        <Text style={s.pickerRowName}>{d}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              </View>
            </Modal>
          )}

          {/* Café picker modal */}
          {cafePickerOpen && (
            <Modal visible transparent animationType="fade" onRequestClose={() => setCafePickerOpen(false)}>
              <View style={s.pickerOverlay}>
                <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setCafePickerOpen(false)} />
                <View style={s.pickerCard}>
                  <View style={s.pickerHeader}>
                    <Text style={s.pickerTitle}>Tag a café</Text>
                    <Pressable onPress={() => setCafePickerOpen(false)}><X size={18} color={t.color["text.primary"]} /></Pressable>
                  </View>
                  <ScrollView style={{ maxHeight: 400 }}>
                    {cafes.length === 0 ? (
                      <Text style={s.pickerEmpty}>No cafés available</Text>
                    ) : (
                      cafes.map((c) => (
                        <Pressable
                          key={c.cafe_slug}
                          onPress={() => { setCafeSlug(c.cafe_slug); setCafePickerOpen(false); }}
                          style={s.pickerRow}
                        >
                          <Text style={s.pickerRowName}>{c.name}</Text>
                          {c.city && <Text style={s.pickerRowSub}>{c.city}, {c.state}</Text>}
                        </Pressable>
                      ))
                    )}
                  </ScrollView>
                </View>
              </View>
            </Modal>
          )}

          {/* Image upload modal */}
          <ImageUploadModal
            visible={showImgUpload}
            title="Add image"
            purpose="post"
            currentUrl=""
            onConfirm={(u) => { handleAddImage(u); setShowImgUpload(false); }}
            onClose={() => setShowImgUpload(false)}
          />

          {/* Add Card tabs modal */}
          <Modal visible={showAddCardModal} transparent animationType="fade" onRequestClose={() => setShowAddCardModal(false)}>
            <Pressable style={s.addCardOverlay} onPress={() => setShowAddCardModal(false)}>
              <Pressable style={s.addCardModal} onPress={(e) => e.stopPropagation()}>
                <View style={s.addCardHeader}>
                  <Text style={s.addCardTitle}>Add Card</Text>
                  <Pressable onPress={() => setShowAddCardModal(false)} hitSlop={8}><X size={18} color="#351101" /></Pressable>
                </View>
                <View style={s.addCardTabs}>
                  <Pressable onPress={() => setAddCardTab("image")} style={[s.addCardTab, addCardTab === "image" && s.addCardTabActive]}>
                    <Text style={[s.addCardTabText, addCardTab === "image" && s.addCardTabTextActive]}>Image</Text>
                  </Pressable>
                  <Pressable onPress={() => setAddCardTab("tasting_note")} style={[s.addCardTab, addCardTab === "tasting_note" && s.addCardTabActive]}>
                    <Text style={[s.addCardTabText, addCardTab === "tasting_note" && s.addCardTabTextActive]}>Tasting Note</Text>
                  </Pressable>
                </View>
                {addCardTab === "image" ? (
                  <Pressable onPress={() => { setShowAddCardModal(false); setShowImgUpload(true); }} style={s.addCardImageBtn}>
                    <Camera size={24} color="#684F44" strokeWidth={1.2} />
                    <Text style={s.addCardImageBtnText}>Upload or paste an image</Text>
                  </Pressable>
                ) : (
                  <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                    <TextInput style={s.tnSearch} value={tnSearch} onChangeText={setTnSearch} placeholder="Search by coffee or roaster..." placeholderTextColor="#A09580" />
                    {!tnSelectedCoffee && tnSearch.length > 1 && (products || [])
                      .filter((p: any) => {
                        const q = tnSearch.toLowerCase();
                        return (
                          p.coffee_name?.toLowerCase().includes(q) ||
                          p.roaster_name?.toLowerCase().includes(q)
                        );
                      })
                      .slice(0, 6)
                      .map((p: any) => (
                        <Pressable key={p.product_id} onPress={() => { setTnSelectedCoffee(p); setTnSearch(p.coffee_name); }} style={s.tnResultRow}>
                          <Text style={s.tnResultName} numberOfLines={1}>{p.coffee_name}</Text>
                          <Text style={s.tnResultRoaster} numberOfLines={1}>{p.roaster_name}</Text>
                        </Pressable>
                      ))}
                    {tnSelectedCoffee && (
                      <View style={{ marginTop: 12 }}>
                        <Text style={s.tnSelectedName} numberOfLines={1}>{tnSelectedCoffee.coffee_name}</Text>
                        <Text style={s.tnSelectedRoaster}>By {tnSelectedCoffee.roaster_name}</Text>
                        {(["acidity", "body", "sweetness", "aftertaste"] as const).map((field) => (
                          <View key={field} style={s.tnScoreRow}>
                            <Text style={s.tnScoreLabel}>{field.charAt(0).toUpperCase() + field.slice(1)}</Text>
                            <View style={s.tnScoreDots}>
                              {[1, 2, 3, 4, 5].map((v) => (
                                <Pressable key={v} onPress={() => setTnScores((p) => ({ ...p, [field]: v }))} style={[s.tnDot, tnScores[field] === v && s.tnDotActive]}>
                                  <Text style={[s.tnDotText, tnScores[field] === v && s.tnDotTextActive]}>{v}</Text>
                                </Pressable>
                              ))}
                            </View>
                          </View>
                        ))}
                        <Pressable
                          onPress={() => {
                            const noteData = JSON.stringify({ type: "tasting_note", coffee_name: tnSelectedCoffee.coffee_name, roaster_name: tnSelectedCoffee.roaster_name, roast_level: tnSelectedCoffee.roast_level, process: tnSelectedCoffee.process, product_url: tnSelectedCoffee.product_url, ...tnScores });
                            setImageUrls((p) => { const f = p.filter((e) => !isTN(e)); return [noteData, ...f]; });
                            setShowAddCardModal(false); setTnSelectedCoffee(null); setTnSearch("");
                          }}
                          style={s.tnConfirmBtn}
                        >
                          <Text style={s.tnConfirmText}>Add Tasting Note</Text>
                        </Pressable>
                      </View>
                    )}
                  </ScrollView>
                )}
              </Pressable>
            </Pressable>
          </Modal>
        </View>
      )}

      {/* ── REPOST PREVIEW ── */}
      {isRepost && repostTarget && (
        <View style={s.repostPreview}>
          <View style={s.repostPreviewHeader}>
            {repostTarget.author_avatar_url ? (
              <Image source={{ uri: resolveUploadUrl(repostTarget.author_avatar_url) }} style={s.repostAvatar} contentFit="cover" />
            ) : (
              <View style={[s.repostAvatar, s.repostAvatarFallback]}>
                <Text style={s.repostAvatarLetter}>{(repostTarget.author_display_name || "?")[0].toUpperCase()}</Text>
              </View>
            )}
            <Text style={s.repostAuthor} numberOfLines={1}>{repostTarget.author_display_name}</Text>
            <Text style={s.repostTime}>{timeAgo(repostTarget.published_at)}</Text>
          </View>
          <Text style={s.repostTeaser} numberOfLines={3}>{repostTarget.teaser}</Text>
          {repostTarget.images?.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <PostGallery images={repostTarget.images} />
            </View>
          )}
        </View>
      )}

      </ScrollView>

      {/* ── Submit bar (pinned outside the scroll) ── */}
      <View style={s.submitRow}>
        <HapticPressable haptic="tap" onPress={onCancel} style={s.cancelBtn}><Text style={s.cancelText}>Cancel</Text></HapticPressable>
        <HapticPressable haptic="commit" onPress={handleSubmit} style={[s.submitBtn, !canSubmit && s.submitBtnDisabled]} disabled={!canSubmit}>
          {loading ? <ActivityIndicator size="small" color="#FAF8F0" /> : <Text style={s.submitText}>{isEditing ? "Save" : isRepost ? "Repost" : "Post"}</Text>}
        </HapticPressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // Outer shell — flex column so the scroll body expands and the
  // submit row sits pinned at the bottom. Padding lives on the
  // scroll contents + submit row individually.
  card: { backgroundColor: "#FAF8F0", flexShrink: 1 } as any,
  scrollBody: { flexGrow: 0, flexShrink: 1 } as any,
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 } as any,
  // Dry-run post header
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 14 } as any,
  avatar: { width: 30, height: 30, borderRadius: 15, overflow: "hidden" } as any,
  avatarFallback: { backgroundColor: "#351101", alignItems: "center", justifyContent: "center" } as any,
  avatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 11, color: "#FAF8F0" },
  headerMeta: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "baseline", gap: 5 } as any,
  authorName: { fontFamily: t.font["body.medium"], fontSize: 11.8, color: "#351101" },
  timestamp: { fontFamily: t.font["body.medium"], fontSize: 10, color: "#A09580" },
  subtitle: { fontFamily: t.font["body.medium"], fontSize: 10, color: "#684F44", marginTop: 2 },
  // §2.23a — Short / Long mode tabs above the teaser.
  modeTabs: {
    flexDirection: "row", gap: 6, marginBottom: 10,
  } as any,
  modeTab: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 14, borderWidth: 1, borderColor: "#D1C7B3",
    backgroundColor: "transparent",
  } as any,
  modeTabActive: {
    backgroundColor: "#351101", borderColor: "#351101",
  } as any,
  modeTabText: {
    fontFamily: t.font["body.medium"], fontSize: 11,
    color: "#684F44", letterSpacing: 0.3,
  } as any,
  modeTabTextActive: {
    color: "#FAF8F0", fontFamily: t.font["body.semibold"],
  } as any,
  // Teaser
  teaserInput: { fontFamily: t.font["body.regular"], fontSize: 16.8, color: "#351101", lineHeight: 23.5, minHeight: 48, textAlignVertical: "top" } as any,
  // Long-form grows the textarea (modal expands with it).
  teaserInputLong: { minHeight: 220 } as any,
  charCount: { fontFamily: t.font["body.regular"], fontSize: 10, color: "#A09580", textAlign: "right", marginTop: 2, marginBottom: 8 } as any,
  // Link preview (article mode)
  linkSection: { marginBottom: 8 },
  previewCard: { borderRadius: 8, overflow: "hidden", backgroundColor: "#EFE9DB", position: "relative" } as any,
  // Detach-article X — same visual language as the image-thumb X
  // (semi-opaque dark disc, cream glyph). Top-right so it doesn't
  // clash with the title overlay anchored bottom-left.
  previewRemove: {
    position: "absolute", top: 8, right: 8,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
    zIndex: 2,
  } as any,
  previewThumbWrap: { position: "relative", height: 200 } as any,
  previewThumbImg: { width: "100%" as any, height: "100%" as any },
  previewOverlay: { position: "absolute", bottom: 10, left: 10, backgroundColor: "#FFF", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, maxWidth: "80%" } as any,
  previewTitle: { fontFamily: t.font["body.semibold"], fontSize: 14, color: "#351101", lineHeight: 19, marginBottom: 2 },
  previewDomain: { fontFamily: t.font["body.regular"], fontSize: 11, color: "#A09580" },
  previewNoImg: { padding: 14 },
  // Note mode
  noteSection: { marginBottom: 8 },

  // §2.23c — one horizontal row of three optional-field chips.
  chipsRow: {
    flexDirection: "row", flexWrap: "wrap", gap: 8,
    marginTop: 12, marginBottom: 4,
  } as any,
  fieldChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 14, borderWidth: 1, borderColor: "#D1C7B3",
    backgroundColor: "transparent", maxWidth: "100%",
  } as any,
  fieldChipActive: {
    backgroundColor: t.color["accent.soft"],
    borderColor: t.color["accent.soft"],
  } as any,
  fieldChipLabel: {
    fontFamily: t.font["body.medium"], fontSize: 12,
    color: t.color["text.muted"], letterSpacing: 0.2,
  } as any,
  fieldChipLabelActive: {
    color: t.color["accent.cta"],
  } as any,

  // Location prompt modal
  locationModalInput: {
    fontFamily: t.font["body.regular"], fontSize: 14,
    color: t.color["text.primary"],
    borderRadius: 6, borderWidth: 1, borderColor: "#D7D1C4",
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: "#fff",
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}),
  } as any,
  locationModalActions: {
    flexDirection: "row", justifyContent: "flex-end",
    alignItems: "center", gap: 12, marginTop: 14,
  } as any,
  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" } as any,
  pickerCard: { backgroundColor: t.color.bg, borderRadius: 12, width: "90%", maxWidth: 420 } as any,
  pickerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: t.color["border.light"] } as any,
  pickerTitle: { fontFamily: t.font["body.semibold"], fontSize: 16, color: t.color["text.primary"] },
  pickerEmpty: { padding: 20, textAlign: "center" as any, fontFamily: t.font["body.regular"], color: t.color["text.muted"] },
  pickerRow: { padding: 14, borderBottomWidth: 1, borderBottomColor: t.color["border.light"] } as any,
  pickerRowName: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.primary"] },
  pickerRowSub: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.muted"], marginTop: 2 },

  imageGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 } as any,
  imageThumb: { borderRadius: PG_RADIUS, overflow: "hidden", position: "relative" } as any,
  imageRemove: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" } as any,
  imageAdd: { borderRadius: PG_RADIUS, borderWidth: 1.5, borderColor: "#C7BAA5", borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 6 } as any,
  imageAddLabel: { fontFamily: t.font["body.medium"], fontSize: 10, color: "#A09580" },
  // Add Card modal
  addCardOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" } as any,
  addCardModal: { backgroundColor: "#FAF8F0", borderRadius: 12, width: "90%", maxWidth: 420, maxHeight: "80%", padding: 20 } as any,
  addCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } as any,
  addCardTitle: { fontFamily: t.font["body.semibold"], fontSize: 16, color: "#351101" },
  addCardTabs: { flexDirection: "row", gap: 8, marginBottom: 16 } as any,
  addCardTab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 4, borderWidth: 1, borderColor: "#D7D1C4", backgroundColor: "#FEFDFB" },
  addCardTabActive: { borderColor: "#351101", backgroundColor: "#351101" },
  addCardTabText: { fontFamily: t.font["body.medium"], fontSize: 12, color: "#684F44" },
  addCardTabTextActive: { color: "#FAF8F0" },
  addCardImageBtn: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 40, borderRadius: 8, borderWidth: 1.5, borderColor: "#C7BAA5", borderStyle: "dashed" } as any,
  addCardImageBtnText: { fontFamily: t.font["body.medium"], fontSize: 13, color: "#684F44" },
  // Tasting note selector
  tnSearch: { fontFamily: t.font["body.regular"], fontSize: 14, color: "#351101", borderRadius: 6, borderWidth: 1, borderColor: "#D7D1C4", paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff" },
  tnResultRow: { paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(215,209,196,0.4)" },
  tnResultName: { fontFamily: t.font["body.medium"], fontSize: 13, color: "#351101" },
  tnResultRoaster: { fontFamily: t.font["body.regular"], fontSize: 11, color: "#684F44", marginTop: 2 },
  tnSelectedName: { fontFamily: t.font["body.semibold"], fontSize: 14, color: "#351101" },
  tnSelectedRoaster: { fontFamily: t.font["body.regular"], fontSize: 12, color: "#684F44", marginBottom: 12 },
  tnScoreRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 } as any,
  tnScoreLabel: { fontFamily: t.font["body.medium"], fontSize: 13, color: "#351101", width: 80 },
  tnScoreDots: { flexDirection: "row", gap: 8 } as any,
  tnDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(215,209,196,0.4)", alignItems: "center", justifyContent: "center" } as any,
  tnDotActive: { backgroundColor: "#D798DA" },
  tnDotText: { fontFamily: t.font["body.medium"], fontSize: 11, color: "#684F44" },
  tnDotTextActive: { color: "#351101" },
  tnConfirmBtn: { marginTop: 16, paddingVertical: 12, borderRadius: 6, backgroundColor: "#351101", alignItems: "center" } as any,
  tnConfirmText: { fontFamily: t.font["body.semibold"], fontSize: 13, color: "#FAF8F0" },
  // Repost preview
  repostPreview: { borderWidth: 1, borderColor: "#D7D1C4", borderRadius: 8, padding: 12, marginBottom: 12 },
  repostPreviewHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 } as any,
  repostAvatar: { width: 20, height: 20, borderRadius: 10, overflow: "hidden" } as any,
  repostAvatarFallback: { backgroundColor: "#351101", alignItems: "center", justifyContent: "center" } as any,
  repostAvatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 8, color: "#FAF8F0" },
  repostAuthor: { fontFamily: t.font["body.medium"], fontSize: 11, color: "#351101", flex: 1 },
  repostTime: { fontFamily: t.font["body.regular"], fontSize: 10, color: "#A09580" },
  repostTeaser: { fontFamily: t.font["body.regular"], fontSize: 13, color: "#684F44", lineHeight: 18, marginBottom: 6 },
  repostThumb: { width: 60, height: 60, borderRadius: 4, marginTop: 4 },
  // Submit bar — pinned outside the ScrollView so it never clips
  // when Long-mode content grows. Own padding + top border visually
  // separates it from the scrolling body.
  submitRow: {
    flexDirection: "row", justifyContent: "flex-end", alignItems: "center",
    gap: 12, paddingHorizontal: 20, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: "rgba(53,17,1,0.08)",
    backgroundColor: "#FAF8F0",
  } as any,
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 8 },
  cancelText: { fontFamily: t.font["body.medium"], fontSize: 12, color: "#A09580" },
  submitBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 4, backgroundColor: "#351101" },
  submitBtnDisabled: { opacity: 0.4 },
  submitText: { fontFamily: t.font["body.semibold"], fontSize: 12, color: "#FAF8F0" },
});
