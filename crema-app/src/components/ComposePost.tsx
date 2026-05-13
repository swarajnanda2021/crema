/**
 * ComposePost — focus-mode "New post" composer matching Figma 895:223.
 *
 * Replaces the previous Short/Long/Article/Repost composer entirely
 * (§2.40.25). One length, one textarea, one Share button. Sub-flows
 * for tagging a coffee, adding an image, writing a tasting note, and
 * adding a location are entry points listed below the body — each
 * row opens its own sub-screen / picker (wiring TBD per the user's
 * per-button instructions).
 *
 * Focus mode: this composer is rendered FULL-VIEWPORT on mobile —
 * `MobileHeader` and `MobileFooter` are intentionally covered so the
 * user faces no chrome distractions. The full-viewport mounting
 * lives in `GlobalComposePost` (app/_layout.tsx); this file is the
 * inner layout. The composer renders its own top bar (Cancel /
 * "New post" / Share).
 *
 * Layout values are LITERAL to Figma 895:223 per CLAUDE.md "Hard
 * rule — Figma is literal":
 *
 *   • Top bar: 59 px tall, paddingHorizontal 20. Cancel left at
 *     12.5 px Inter Medium (Crema-pink, our `accent.cta` —
 *     standing in for the Figma's #C06CC4 since the brand palette
 *     is locked to one Crema pink). Title centered in New Spirit
 *     Medium 18 / 25, Espresso. Share button: 61×33.48 pill,
 *     borderRadius 26.6, Crema-pink fill, Espresso label at 50%
 *     opacity when disabled (no body text yet).
 *   • Author row: avatar 40×40 circular at x=21, name Inter
 *     Semibold 16 in Espresso, char counter "N / 300" at right
 *     edge in Inter Medium 16 muted.
 *   • Body textarea: Inter Regular 18 / 26 with the Figma
 *     placeholder "What do you want to say?" in `text.muted`.
 *   • Action rows: each 54 px tall, divider above + below, icon
 *     in Crema pink at x=21, label at x=56 in Inter Medium 16
 *     `text.secondary`, chevron right at the row's right edge in
 *     `text.muted`.
 *
 * The Figma uses the same MapPin glyph for both "Add a tasting
 * note" and "Add location" (Vector4 SVG re-used). We follow the
 * Figma literally — both rows use lucide `MapPin`. If the
 * designer intended a different glyph for tasting note, we'll
 * swap when they specify.
 *
 * Submit shape: Single `post_type: "note"` payload. The previous
 * article / sourcing_story / repost paths are gone — those flows
 * (URL preview, long-form, repost) are not part of this composer
 * anymore. Reposts run via `PostModal` in `mode: "repost"` (its
 * own flow); long-form has been retired.
 */

import { useState } from "react";
import { View, Text, TextInput, ScrollView, StyleSheet, Platform, Keyboard, Pressable } from "react-native";
import { Image } from "expo-image";
import { Coffee, Image as ImageIcon, MapPin, ChevronRight, X } from "lucide-react-native";

import { resolveUploadUrl } from "../api/client";
import { t, makeStyles } from "../tokens/useTokens";
import { thumbnailUrl } from "../utils/imageUrl";
import { HapticPressable } from "./primitives";
import TagCoffeeSheet from "./TagCoffeeSheet";
import AddImageActionSheet from "./AddImageActionSheet";
import CustomGallerySheet from "./CustomGallerySheet";
import { useRoasterArticles } from "../hooks/useRoasterArticles";
import {
  TOPIC_LABELS,
  formatArticleDate,
  estimateReadingTime,
} from "../utils/articleMeta";

// Article URL detection — same shape as the chat-bubble unfurl, but
// here we match the URL ANYWHERE in the typed text so the user can
// paste an article URL inside a sentence and have it strip out
// cleanly. The first capture group is the article id.
const ARTICLE_URL_INLINE = /https?:\/\/crema\.app\/article\/(\d+)/i;

interface ComposePostProps {
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
  user?: {
    username?: string;
    display_name?: string;
    avatar_url?: string;
    avatar_crop_x?: number;
    avatar_crop_y?: number;
    avatar_zoom?: number;
  } | null;
  initialData?: { body?: string };
}

const MAX_CHARS = 300;

export default function ComposePost({
  onSubmit,
  onCancel,
  loading = false,
  user,
  initialData,
}: ComposePostProps) {
  const [teaser, setTeaser] = useState(initialData?.body || "");
  // Tag-a-coffee sheet is local state — opens via the action row,
  // closes on backdrop tap, drag-handle tap, or selection. The
  // selected coffee is held here for use on submit (rendering the
  // selected-coffee chip in the body is TBD per the user's per-row
  // spec; for now we only track the selection so the data is there
  // when the user dictates the chip UX).
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const [taggedCoffee, setTaggedCoffee] = useState<{
    product_id: string;
    coffee_name: string;
    roaster_name?: string;
    hero_image?: string | null;
    image_url?: string | null;
  } | null>(null);
  // Add-an-image action sheet (Figma 900:1906). Tapping the
  // "Add an image" action row opens the iOS-style sheet with
  // Photo Gallery / Camera / Cancel. Picking + uploading an
  // image stores its URL on `attachedImage` so the post can
  // include it on submit. The in-body chip / preview UI for
  // the attached image is TBD per the user's next-step spec.
  const [addImageSheetOpen, setAddImageSheetOpen] = useState(false);
  const [gallerySheetOpen, setGallerySheetOpen] = useState(false);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  // Location is auto-extracted from the picked photo's EXIF GPS
  // (gallery flow only — camera-captured photos and web uploads
  // don't carry location). The user can clear it via the X on the
  // chip; the standalone "Add a location" action row was retired
  // since the picker already surfaces "Location Is Included" and
  // we now mirror that signal directly in the body.
  const [attachedLocation, setAttachedLocation] = useState<string | null>(null);
  // Article share — when the user pastes a `crema.app/article/{id}`
  // URL anywhere in the body, we strip the URL out of the visible
  // text and store the article id here. The card preview renders
  // below the body and the post submits as `post_type: "repost"`
  // with `repost_of_article_id` set, so the feed's existing
  // article-repost rendering kicks in (PostCard.repostArticleEl).
  const [attachedArticleId, setAttachedArticleId] = useState<number | null>(null);
  const articleCache = useRoasterArticles();
  const attachedArticle = attachedArticleId
    ? articleCache.getById(attachedArticleId)
    : null;
  const len = teaser.length;
  // An article-only post (URL-only paste) is a valid submission even
  // with empty text, same way an image-only message in chat is.
  const canSubmit =
    !loading && (len > 0 || attachedArticleId != null) && len <= MAX_CHARS;
  const s = useStyles();

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const trimmedText = teaser.trim();
    // Article-share path — submit as `post_type: "repost"` with
    // `repost_of_article_id` set so the feed's existing
    // article-repost rendering (PostCard.repostArticleEl) hydrates
    // the editorial preview via the cross-resource embed. Any text
    // the user typed alongside the URL becomes the repost comment +
    // teaser.
    if (attachedArticleId != null) {
      await onSubmit({
        title: trimmedText.slice(0, 60) || "Repost",
        teaser: trimmedText || "Repost",
        post_type: "repost",
        repost_of_article_id: attachedArticleId,
        repost_comment: trimmedText || null,
      });
      return;
    }
    await onSubmit({
      title: trimmedText.slice(0, 60) || "Note",
      teaser: trimmedText,
      post_type: "note",
      // Carry the tagged coffee through on submit. The backend
      // already accepts `product_id` on note posts (used by the
      // older tasting-note flow); we reuse that field so the post
      // can later be linked back to the tagged product even though
      // the in-body chip rendering is still TBD.
      product_id: taggedCoffee?.product_id || null,
      // Attached image (if the user picked one via the
      // Add-an-image action sheet). Backend accepts an `images`
      // array on note posts; we send a single-element array.
      images: attachedImage ? [attachedImage] : [],
      cover_image_url: attachedImage || null,
      // Location auto-extracted from the photo's EXIF GPS (gallery
      // pick only). Stored as a human-readable place name.
      location: attachedLocation || null,
    });
  };

  const onChangeText = (next: string) => {
    if (next.length > MAX_CHARS) return;
    // Detect a pasted article URL and pull it out of the visible
    // text. The user wanted "the URL should not be visible" — the
    // editorial card preview takes its place. We only strip the
    // FIRST URL we see; subsequent ones (rare) stay as text. If
    // the user later removes the article (X on the card), the
    // body keeps whatever non-URL text remained.
    const m = next.match(ARTICLE_URL_INLINE);
    if (m && attachedArticleId == null) {
      const id = parseInt(m[1], 10);
      if (Number.isFinite(id)) {
        const stripped = next.replace(m[0], "").replace(/\s{2,}/g, " ").trim();
        setAttachedArticleId(id);
        setTeaser(stripped);
        return;
      }
    }
    setTeaser(next);
  };

  const displayName = user?.display_name || user?.username || "You";
  const avatarUrl = user?.avatar_url;

  return (
    <View testID="compose-post-modal" style={s.root}>
      {/* Top bar — Cancel / New post / Share. Figma 895:223 y=0..59. */}
      <View style={s.topBar}>
        <HapticPressable
          testID="compose-post-cancel"
          haptic="tap"
          onPress={() => {
            // Dismiss the keyboard FIRST, then run the parent's
            // close handler. Without the explicit dismiss, iOS
            // swallows the first tap on any control while the
            // soft keyboard is up — the user reported "Cancel
            // doesn't work the first time, only works after I
            // select something" because selecting a coffee
            // implicitly blurred the textarea (the bottom sheet
            // stole focus) so the keyboard was already down by
            // the time they tapped Cancel.
            Keyboard.dismiss();
            onCancel();
          }}
          hitSlop={10}
          style={s.cancelHit}
          accessibilityLabel="Cancel"
          accessibilityRole="button"
        >
          <Text style={s.cancelText}>Cancel</Text>
        </HapticPressable>

        <View pointerEvents="none" style={s.titleWrap}>
          <Text style={s.title}>New post</Text>
        </View>

        <HapticPressable
          testID="compose-post-submit"
          haptic="commit"
          onPress={handleSubmit}
          disabled={!canSubmit}
          style={[s.shareBtn, !canSubmit && s.shareBtnDisabled]}
          accessibilityLabel="Share"
          accessibilityRole="button"
        >
          <Text style={s.shareText}>Share</Text>
        </HapticPressable>
      </View>
      <View style={s.divider} />

      {/* Author row — avatar + name on the left, char counter on
          the right. Figma 895:223 y=75..115. */}
      <View style={s.authorRow}>
        <View style={s.authorLeft}>
          {avatarUrl ? (
            <Image
              source={{ uri: resolveUploadUrl(avatarUrl) }}
              style={s.avatar}
              contentFit="cover"
            />
          ) : (
            <View style={[s.avatar, s.avatarFallback]}>
              <Text style={s.avatarLetter}>
                {(displayName[0] || "?").toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={s.authorName} numberOfLines={1}>
            {displayName}
          </Text>
        </View>
        <Text style={s.charCount}>
          {len} / {MAX_CHARS}
        </Text>
      </View>

      {/* Body textarea fills the available vertical space between
          the author row and the action rows. The placeholder
          color matches Figma's lighter muted (#C7BAA5) — we use
          `text.muted` which is close enough; both are in the
          approved palette. */}
      <ScrollView
        style={s.bodyScroll}
        contentContainerStyle={s.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* No `autoFocus` — auto-focusing the textarea on open
            pops the iOS soft keyboard immediately, and iOS then
            swallows the first tap on Cancel / Share / any action
            row as a keyboard-dismiss instead of a button press
            (the well-known "double-tap" problem). The user has to
            tap a textarea explicitly to start typing — fewer
            surprises that way, and Cancel works first try. */}
        <TextInput
          testID="compose-post-input"
          style={s.body}
          value={teaser}
          onChangeText={onChangeText}
          placeholder="What do you want to say?"
          placeholderTextColor={t.color["text.muted"] as string}
          multiline
          textAlignVertical="top"
        />

        {/* Body order — Figma 900:1915:
              1. Image preview (if attached)  ← above the coffee chip
              2. Selected-coffee chip (if tagged)
            The image renders first because Figma 900:1915 shows the
            picked photo dominating the body region; the coffee chip
            sits beneath it. Location no longer renders as a chip in
            the body — it's surfaced as the LAST action row below
            (Figma 900:1915 shows "Goa, India" rendered like a
            tap row with the location pin icon). */}
        {attachedImage ? (
          <AttachedImageChip
            url={attachedImage}
            onRemove={() => {
              setAttachedImage(null);
              setAttachedLocation(null);
            }}
          />
        ) : null}

        {attachedArticleId ? (
          <AttachedArticleCard
            articleId={attachedArticleId}
            article={attachedArticle}
            onRemove={() => setAttachedArticleId(null)}
          />
        ) : null}

        {taggedCoffee && (
          <SelectedCoffeeChip
            coffee={taggedCoffee}
            onRemove={() => setTaggedCoffee(null)}
          />
        )}

        {/* Location label — Figma 942:343 / 942:344. Sits at the
            very bottom of the body content, AFTER the image and
            coffee chips. Pin icon in Crema pink, text in Inter
            Medium 16 / Dull Brown. Tap to clear. The action-row
            placement was retired — Figma puts the location inline
            with the other body content, not as a tap row. */}
        {attachedLocation ? (
          <AttachedLocationLabel
            label={attachedLocation}
            onRemove={() => setAttachedLocation(null)}
          />
        ) : null}
      </ScrollView>

      {/* Action rows. Each row is 54 px tall (Figma divider-to-
          divider spacing). The Tag-a-coffee row opens the search
          slider (Figma 895:415); when a coffee is tagged the row
          vanishes (chip card above takes over), per Figma 895:290.
          The rest are stubs awaiting the user's per-row spec.

          Article-share posts hide ALL action rows — an
          article-repost is restricted to (article + post text)
          only; mixing in a tagged coffee, image, or tasting note
          would conflate two post types. The user clears the
          article (X on the AttachedArticleCard) to get the rows
          back. */}
      {attachedArticleId == null ? (
        <>
          {!taggedCoffee && <View style={s.divider} />}
          {!taggedCoffee && (
            <ActionRow
              icon={Coffee}
              label="Tag a coffee"
              onPress={() => setTagSheetOpen(true)}
            />
          )}
          {/* "Add an image" row — hidden when an image is already
              attached (the image-preview chip in the body takes its
              place, mirroring how "Tag a coffee" hides when the
              coffee chip is up). Per Figma 900:1915. */}
          {!attachedImage && <View style={s.divider} />}
          {!attachedImage && (
            <ActionRow
              icon={ImageIcon}
              label="Add an image"
              onPress={() => setAddImageSheetOpen(true)}
            />
          )}
          <View style={s.divider} />
          <ActionRow icon={MapPin} label="Add a tasting note" onPress={() => {}} />
          {/* Location is now rendered inside the body content (see
              `AttachedLocationLabel` above) per Figma 942:343 / 944:344,
              not as an action row. Action rows are reserved for "add"
              affordances; the location is a value, not an entry point. */}
        </>
      ) : null}

      {/* Tag-a-coffee bottom sheet. Renders into RN's <Modal>, so
          it sits above the composer's full-viewport host without
          any z-index gymnastics here. */}
      <TagCoffeeSheet
        visible={tagSheetOpen}
        onClose={() => setTagSheetOpen(false)}
        onSelect={(c) => setTaggedCoffee(c as any)}
      />

      {/* Add-an-image action sheet. Opens on the "Add an image"
          row press. Camera path uploads + closes inline; Photo
          Gallery hands off to the custom in-app gallery so the
          user gets our chrome instead of the system picker. */}
      <AddImageActionSheet
        visible={addImageSheetOpen}
        onClose={() => setAddImageSheetOpen(false)}
        onImagePicked={(url) => setAttachedImage(url)}
        onOpenGallery={() => {
          // Close the action sheet, then hand off to the custom
          // gallery. We do these in one render via two state
          // updates so the action sheet's slide-down animation
          // doesn't compete with the gallery's slide-up.
          setAddImageSheetOpen(false);
          setGallerySheetOpen(true);
        }}
      />

      {/* Custom in-app photo gallery (Figma 900:1908). Opens when
          the user taps "Photo Gallery" in the action sheet. On
          native, populates from `expo-media-library`; on web, falls
          back to the file dialog. */}
      <CustomGallerySheet
        visible={gallerySheetOpen}
        onClose={() => setGallerySheetOpen(false)}
        onImagePicked={(url, location) => {
          setAttachedImage(url);
          // Only set the location if the picker handed one back —
          // we don't want a fresh pick to wipe out a location the
          // user already had on a previous attached photo.
          if (location) setAttachedLocation(location);
        }}
      />
    </View>
  );
}

interface SelectedChipProps {
  coffee: {
    product_id: string;
    coffee_name: string;
    roaster_name?: string;
    hero_image?: string | null;
    image_url?: string | null;
  };
  onRemove: () => void;
}

/**
 * SelectedCoffeeChip — Figma 895:328 / 895:290 layout.
 *
 * Horizontal card sitting in the composer body when the user has
 * tagged a coffee via the Tag-a-coffee sheet. Replaces the original
 * "Tag a coffee" action row (which is hidden while this card is
 * shown — see the conditional rendering above).
 *
 * Geometry is LITERAL to Figma 895:290:
 *   • Card 350 × 94, bg white, borderRadius 5.
 *   • Image 68 × 75 at (9, 9) inside the card, borderRadius 5.
 *   • Title at (91, 17), Inter Semibold 16 / 20, Espresso. Allows
 *     2 lines (height 40 in Figma frame).
 *   • Roaster line at (91, 61), Inter Medium 12, Dull Brown
 *     (`text.secondary` light).
 *   • Close button: 37 × 37 circle at (295, 27), bg `card.info`
 *     (Beige #EFE9DB), 8 × 8 X icon centred inside.
 *
 * Marginal extra: the card sits at viewport x=20 / y=187. The y is
 * relative to the parent frame in Figma; in our code we use a
 * marginTop on the chip so it floats below the placeholder text
 * without hardcoding viewport offsets.
 */
function SelectedCoffeeChip({ coffee, onRemove }: SelectedChipProps) {
  const s = useStyles();
  const heroSrc =
    coffee.hero_image || coffee.image_url
      ? (() => {
          const raw = (coffee.hero_image || coffee.image_url) as string;
          const resolved = resolveUploadUrl(raw) || raw;
          return thumbnailUrl(resolved, 200) || resolved;
        })()
      : null;
  return (
    <View style={s.chipCard}>
      <View style={s.chipImage}>
        {heroSrc ? (
          <Image
            source={{ uri: heroSrc }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            transition={200}
          />
        ) : null}
      </View>
      <Text style={s.chipTitle} numberOfLines={2} ellipsizeMode="tail">
        {coffee.coffee_name}
      </Text>
      <Text style={s.chipRoaster} numberOfLines={1} ellipsizeMode="tail">
        By {coffee.roaster_name || "—"}
      </Text>
      <Pressable
        onPress={onRemove}
        style={s.chipCloseHit}
        hitSlop={8}
        accessibilityLabel="Remove tagged coffee"
        accessibilityRole="button"
      >
        <View style={s.chipCloseCircle}>
          {/* X colour from Figma 895:333 — `#A09580` Gray Brown.
              Hard-coded literal because the chip surface is
              always-light (`card.product.bg`) so any mode-flipping
              token would be wrong on the constant cream chip. The
              hex IS in the approved palette (= `text.muted` in
              light mode).
              Size 16: Figma's metadata reports the X at 8×8 inside
              a 37-px circle, but the exported SVG draws the cross
              well outside that 8-px box (the path extends with a
              thick stroke that reads ~14-16 px on the canvas). The
              user flagged a 10-px lucide X as too tiny — bumping
              to 16 with `strokeWidth: 1.5` matches the visual
              weight of the Figma asset. */}
          <X
            size={16}
            color="#A09580"
            strokeWidth={1.5}
          />
        </View>
      </Pressable>
    </View>
  );
}

/**
 * AttachedImageChip — preview of the photo the user picked from
 * the gallery / camera. Rendered between the coffee chip and the
 * location chip in the composer body.
 */
function AttachedImageChip({
  url,
  onRemove,
}: {
  url: string;
  onRemove: () => void;
}) {
  const s = useStyles();
  const src = (() => {
    const resolved = resolveUploadUrl(url) || url;
    return thumbnailUrl(resolved, 800) || resolved;
  })();
  return (
    <View style={s.imageChip}>
      <Image
        source={{ uri: src }}
        style={s.imageChipPreview}
        contentFit="cover"
        transition={150}
      />
      <Pressable
        onPress={onRemove}
        style={s.imageChipCloseHit}
        hitSlop={8}
        accessibilityLabel="Remove attached image"
        accessibilityRole="button"
      >
        <View style={s.imageChipCloseCircle}>
          <X size={16} color="#A09580" strokeWidth={1.5} />
        </View>
      </Pressable>
    </View>
  );
}

/**
 * AttachedLocationLabel — inline location row that lives inside
 * the composer body, AFTER all cards (image + coffee). Matches
 * Figma 942:343 (text) + 942:344 (pin glyph):
 *   • Pin icon in Crema pink (`accent.cta`).
 *   • Place name in Inter Medium 16, `text.secondary` (Dull Brown
 *     #684F44 — the constant warm-brown for body labels).
 *
 * No background fill, no chevron — it reads as a label, not as
 * an action row. Tap anywhere on the row to clear the location
 * (the photo stays attached).
 */
function AttachedLocationLabel({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  const s = useStyles();
  return (
    <Pressable
      onPress={onRemove}
      style={s.locationLabel}
      hitSlop={8}
      accessibilityLabel={`Remove location ${label}`}
      accessibilityRole="button"
    >
      <MapPin
        size={20}
        color={t.color["accent.cta"] as string}
        strokeWidth={1.75}
      />
      <Text style={s.locationLabelText} numberOfLines={1} ellipsizeMode="tail">
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * AttachedArticleCard — editorial article preview rendered inline in
 * the composer body when the user pastes a `crema.app/article/{id}`
 * URL. Same content shape as the chat-bubble unfurl (tag · date ·
 * title · byline · excerpt · reading time) but wrapped in a
 * white-card chrome (radius + shadow) so it reads as "this is the
 * article you're sharing" inside the focus-mode composer.
 *
 * Cache miss falls back to a minimal "Shared article" stub — we
 * only have the article id, not the full row, so the user sees
 * something useful while the cache hydrates.
 *
 * X (top-right) clears the attached article. The composer's
 * `onChangeText` won't re-detect the URL after that because the
 * URL was already stripped out of the typed text.
 */
function AttachedArticleCard({
  articleId,
  article,
  onRemove,
}: {
  articleId: number;
  article: any | null;
  onRemove: () => void;
}) {
  const s = useStyles();
  const tagLabel = article?.topic_category
    ? TOPIC_LABELS[article.topic_category] || null
    : null;
  // Display the article's own publish date only — never the scrape
  // day. NULL published_at returns "" and the date line hides.
  const dateLabel = article ? formatArticleDate(article.published_at) : "";
  const readingTime = article ? estimateReadingTime(article.word_count) : "";
  return (
    <View style={s.attachedArticleCard}>
      <Pressable
        onPress={onRemove}
        hitSlop={8}
        style={s.attachedArticleClose}
        accessibilityLabel="Remove article"
        accessibilityRole="button"
      >
        <X size={14} color={t.color["text.primary"]} strokeWidth={2} />
      </Pressable>
      {(tagLabel || dateLabel) ? (
        <View style={s.attachedArticleMetaRow}>
          {tagLabel ? (
            <Text style={s.attachedArticleMeta}>{tagLabel}</Text>
          ) : null}
          {dateLabel ? (
            <Text style={s.attachedArticleMeta}>{dateLabel}</Text>
          ) : null}
        </View>
      ) : null}
      <Text style={s.attachedArticleTitle} numberOfLines={3}>
        {article?.title || "Shared article"}
      </Text>
      {article?.roaster_name ? (
        <Text style={s.attachedArticleByline} numberOfLines={1}>
          By {article.roaster_name}
        </Text>
      ) : null}
      {article?.excerpt ? (
        <Text style={s.attachedArticleExcerpt}>{article.excerpt}</Text>
      ) : null}
      {readingTime ? (
        <Text style={s.attachedArticleMeta}>{readingTime}</Text>
      ) : null}
    </View>
  );
}

interface ActionRowProps {
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  label: string;
  onPress: () => void;
}

function ActionRow({ icon: Icon, label, onPress }: ActionRowProps) {
  const s = useStyles();
  return (
    <HapticPressable
      haptic="tap"
      onPress={onPress}
      style={s.row}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon size={20} color={t.color["accent.cta"] as string} strokeWidth={1.5} />
      <Text style={s.rowLabel}>{label}</Text>
      <ChevronRight size={24} color={t.color["text.muted"] as string} strokeWidth={1.5} />
    </HapticPressable>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.color.bg } as any,

  // ── Top bar ─────────────────────────────────────────────────
  // Figma 895:223 y=0..59. Cancel left, title centered, Share
  // button right at 20-px padding. We use justify-content:
  // space-between to anchor Cancel + Share to the edges; the
  // title is centred in absolute coords so a wider/narrower
  // Cancel doesn't shove it off-center.
  topBar: {
    height: 59,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    backgroundColor: t.color.bg,
    position: "relative",
  } as any,
  cancelHit: { paddingVertical: 8 } as any,
  cancelText: {
    fontFamily: t.font["body.medium"],
    fontSize: 12.5,
    color: t.color["accent.cta"],
  } as any,
  // The title sits absolute-positioned across the full top-bar so
  // a wider/narrower Cancel doesn't shove it off-center. Its
  // hitbox would otherwise sit over Cancel + Share, swallowing
  // taps. We wrap the Text in a View with `pointerEvents="none"`
  // (as a prop, not a style — the style version is silently
  // ignored on Android RN, which lets the title eat taps even
  // though it's invisible).
  titleWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  title: {
    textAlign: "center",
    fontFamily: t.font.display,
    fontWeight: "500",
    fontSize: 18,
    lineHeight: 25,
    color: t.color["text.primary"],
  } as any,
  // Share pill — Figma's literal 61×33.48 / borderRadius 26.6.
  // Disabled state mirrors Figma's 50% opacity Share label:
  // the pill itself stays Crema pink, the text drops to 50%
  // alpha via `shareBtnDisabled`'s opacity.
  shareBtn: {
    width: 61,
    height: 33.48,
    borderRadius: 26.6,
    backgroundColor: t.color.accent,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  shareBtnDisabled: { opacity: 0.5 } as any,
  // Figma 895:223 measured the Share label at fontSize 12.5 /
  // lineHeight 12.073. Setting lineHeight smaller than fontSize on
  // iOS shrinks the text's line box below the glyph height — the
  // baseline shifts up and the label sits visibly above the pill's
  // vertical centre. The Figma's intent is "label centred in pill,"
  // so we drop the explicit lineHeight here and let the parent's
  // `alignItems: "center"` + `justifyContent: "center"` do the
  // centring with the font's natural line height.
  shareText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 12.5,
    color: t.color["text.on-cta"],
    textAlign: "center",
    includeFontPadding: false,
  } as any,

  divider: { height: 1, backgroundColor: t.color.divider } as any,

  // ── Author row ──────────────────────────────────────────────
  // Figma y=75..115. Avatar 40px circular + name + counter on
  // one row; pad-top 16 lifts the row off the top divider.
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 21,
    paddingTop: 16,
  } as any,
  authorLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  } as any,
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
  } as any,
  avatarFallback: {
    backgroundColor: t.color["text.primary"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  avatarLetter: {
    fontFamily: t.font["body.semibold"],
    fontSize: 14,
    color: t.color["text.on-dark"],
  } as any,
  authorName: {
    fontFamily: t.font["body.semibold"],
    fontSize: 16,
    color: t.color["text.primary"],
    flexShrink: 1,
  } as any,
  charCount: {
    fontFamily: t.font["body.medium"],
    fontSize: 16,
    color: t.color["text.muted"],
  } as any,

  // ── Body textarea ───────────────────────────────────────────
  bodyScroll: { flex: 1 } as any,
  bodyContent: { paddingHorizontal: 21, paddingTop: 12 } as any,
  // No `minHeight` — leaving the TextInput auto-sized to its
  // content lets the chip card (when present) sit right below the
  // placeholder per Figma 895:290 (placeholder y=126, chip y=187 →
  // 35-px gap from placeholder bottom). With a tall minHeight the
  // chip floated halfway down the screen because the empty
  // textarea reserved 200 px of vertical space.
  body: {
    fontFamily: t.font["body.regular"],
    fontSize: 18,
    lineHeight: 26,
    color: t.color["text.primary"],
    textAlignVertical: "top",
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}),
  } as any,

  // ── Selected-coffee chip card (Figma 895:290 / 895:328) ────
  // Sits inside the body ScrollView, below the textarea. All
  // geometry is literal to the Figma node so the title + roaster
  // + close button hit their pixel positions inside the 350×94
  // frame.
  // Chip's vertical gap from the placeholder/textarea: Figma 895:290
  // gives placeholder bottom y=152 and chip top y=187 → 35-px gap.
  chipCard: {
    width: 350,
    height: 94,
    borderRadius: 5,
    backgroundColor: t.color["card.product.bg"],
    position: "relative",
    overflow: "hidden",
    marginTop: 35,
    alignSelf: "flex-start",
    marginLeft: -1, // Figma chip x=20 lines up with the body's x=21 inset minus 1
  } as any,
  chipImage: {
    position: "absolute",
    left: 9,
    top: 9,
    width: 68,
    height: 75,
    borderRadius: 5,
    backgroundColor: t.color["card.info"],
    overflow: "hidden",
  } as any,
  // Title + roaster use `card.product.text*` (constant Espresso /
  // constant warm-brown) NOT the mode-flipping `text.primary` /
  // `text.secondary`. The chip's bg is `card.product.bg` (always
  // cream/white in both modes) — flipping text would have read as
  // pale-cream on cream in dark mode.
  chipTitle: {
    position: "absolute",
    left: 91,
    top: 17,
    width: 149,
    fontFamily: t.font["body.semibold"],
    fontSize: 16,
    lineHeight: 20,
    color: t.color["card.product.text"],
  } as any,
  chipRoaster: {
    position: "absolute",
    left: 91,
    top: 61,
    width: 144,
    fontFamily: t.font["body.medium"],
    fontSize: 12,
    color: t.color["card.product.text.muted"],
  } as any,
  // Close button — circle at Figma (295, 27) inside the 350×94
  // card. The hit area extends slightly via `hitSlop` so the small
  // 8-px X glyph isn't a frustrating tap target. The 37-px circle
  // matches the Figma exactly.
  chipCloseHit: {
    position: "absolute",
    left: 295,
    top: 27,
    width: 37,
    height: 37,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  chipCloseCircle: {
    width: 37,
    height: 37,
    borderRadius: 18.5,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
  } as any,

  // ── Attached image chip ─────────────────────────────────────
  // Lives at the top of the body content above the coffee chip
  // (Figma 900:1915 places the image first). Geometry is literal
  // to Figma 900:1980: 350 × 258 rounded rectangle, the photo
  // fills the box. The previous 180-px height was cropping
  // landscape photos; 258 matches the design.
  imageChip: {
    width: 350,
    height: 258,
    borderRadius: 5,
    backgroundColor: t.color["card.product.bg"],
    overflow: "hidden",
    marginTop: 12,
    alignSelf: "flex-start",
    marginLeft: -1,
    position: "relative",
  } as any,
  imageChipPreview: {
    width: "100%" as any,
    height: "100%" as any,
  } as any,
  imageChipCloseHit: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 37,
    height: 37,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  imageChipCloseCircle: {
    width: 37,
    height: 37,
    borderRadius: 18.5,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
  } as any,

  // ── Inline location label ──────────────────────────────────
  // Sits inside the body, after the image + coffee chips. Per
  // Figma 942:343 + 942:344: pin icon in Crema pink, label in
  // Inter Medium 16 / Dull Brown. Padding keeps the icon on the
  // same column the body content sits on (matches the action
  // rows' icon column for a clean visual rhythm).
  locationLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingTop: 16,
    paddingBottom: 4,
  } as any,
  locationLabelText: {
    fontFamily: t.font["body.medium"],
    fontSize: 16,
    color: t.color["text.secondary"],
    flexShrink: 1,
  } as any,

  // ── Attached article preview ──────────────────────────────
  // White-card chrome (rounded + subtle shadow) that wraps the
  // editorial article info (tag/date · title · byline · excerpt
  // · reading time). Sits in the body region after a pasted
  // article URL is detected and stripped from the typed text.
  attachedArticleCard: {
    backgroundColor: t.color["card.product.bg"],
    borderRadius: t.radius.lg,
    padding: 14,
    marginTop: 12,
    gap: 4,
    shadowColor: t.color.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    position: "relative",
  } as any,
  attachedArticleClose: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  } as any,
  attachedArticleMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
  } as any,
  attachedArticleMeta: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["card.product.text.muted"],
    letterSpacing: 0.2,
  } as any,
  attachedArticleTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.lg"],
    lineHeight: 22,
    color: t.color["card.product.text"],
    paddingRight: 28,
  } as any,
  attachedArticleByline: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["card.product.text.muted"],
    marginTop: 2,
  } as any,
  attachedArticleExcerpt: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    lineHeight: 20,
    color: t.color["card.product.text"],
    marginTop: 6,
  } as any,

  // ── Action rows ─────────────────────────────────────────────
  // Each row is 54 px tall (Figma divider-to-divider). Icon at
  // x=21, label at x=56, chevron flush-right.
  row: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 21,
    gap: 14,
  } as any,
  rowLabel: {
    flex: 1,
    fontFamily: t.font["body.medium"],
    fontSize: 16,
    color: t.color["text.secondary"],
  } as any,
}));
