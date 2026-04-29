/**
 * PostGallery — universal image / tasting-note gallery for posts.
 *
 * §postmodal-redo (mobile): split the two content types instead of
 * packing them into one 3-column strip.
 *   - Tasting-note cards get a dedicated full-width landscape
 *     carousel (one card per viewport, snap-paging, pagination dots
 *     + right-edge chevron hint). Matches the CoffeeCard landscape
 *     variant's design language (370×251 frame).
 *   - Images stay in the original 3-column thumbnail strip at the
 *     same small size, with carousel affordances when >3. Per the
 *     user: "keep the image size, just add carousel".
 *
 * Wide web: original 3-up thumbnail strip with everything in-line
 * (tasting notes + images), unchanged from pre-redo behaviour.
 *
 * Mobile native: the initial container width is seeded from
 * `useWindowDimensions()` so the first paint isn't zero-width (the
 * pure-onLayout path was hiding images on Expo Go — "don't see jack
 * shit"). The real `onLayout` width swaps in on the next tick.
 */

import { useState } from "react";
import {
  View, ScrollView, Pressable, StyleSheet, Text, Platform,
  useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent,
} from "react-native";
import { Image } from "expo-image";
import { ChevronRight } from "lucide-react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

import { resolveUploadUrl } from "../api/client";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { t } from "../tokens/useTokens";
import TastingNoteCard from "./TastingNoteCard";

export const GALLERY_ASPECT = 371 / 281; // Portrait — Figma TastingNoteCard base (281×371)
export const GALLERY_ASPECT_LS = 251 / 370; // Landscape — CoffeeCard mobile (370×251)
export const PG_GAP = 10;
export const PG_RADIUS = 5;
export const PG_RADIUS_LS = 10;

export function isTastingNoteEntry(img: any) {
  return typeof img === "string" && (
    img.startsWith('{"type":"tasting_note"') || img.startsWith('{"type": "tasting_note"')
  );
}

function ImageSlot({
  entry, width, height, onPress,
}: { entry: string; width: number; height: number; onPress?: () => void }) {
  const img = (
    <Image
      source={{ uri: resolveUploadUrl(entry) }}
      style={{ width, height, borderRadius: PG_RADIUS }}
      contentFit="cover"
    />
  );

  // Web: plain Pressable. RN Web's onClick bubbles cleanly and
  // SwipeToCommit is a passthrough, so there's no gesture arbiter
  // to race.
  if (Platform.OS === "web") {
    return (
      <Pressable onPress={onPress} style={{ width, height }}>
        {img}
      </Pressable>
    );
  }

  // Native: when this slot sits inside SwipeToCommit's `Gesture.Pan`
  // AND a horizontal `<ScrollView>` parent, three touch handlers
  // arbitrate for the same finger — and iOS sometimes strands an RN
  // Pressable behind the gesture-handler Pan's POSSIBLE phase, so a
  // zero-travel tap never fires (M7). Move the tap into gesture-
  // handler's pipeline via `Gesture.Tap()` so the child gesture
  // competes with the parent Pan at the same level: Tap wins on
  // release without meeting Pan's 10-px activation offset, Pan wins
  // on horizontal travel. Deterministic arbitration, no responder
  // race.
  const tap = Gesture.Tap()
    .maxDuration(260)
    .onEnd((_e, success) => {
      "worklet";
      if (success && onPress) runOnJS(onPress)();
    });
  return (
    <GestureDetector gesture={tap}>
      <View style={{ width, height }}>{img}</View>
    </GestureDetector>
  );
}

// M6 fix: no outer Pressable wrap. The inner cart inside
// `TastingNoteCard` is the only actionable element on the card; the
// pre-postmodal-redo behaviour was to render the card bare and let
// the cart own its own touches. Wrapping in Pressable on web caused
// the outer onClick to bubble from the inner cart (double-fire
// opening both the product URL and the post modal). Tap on empty
// card area now falls through to whatever parent container wants to
// claim it (on mobile feed, that's PostCard's outer `CardContainer`
// Pressable via `mobileTapToOpen`).
function NoteSlot({
  entry, width, height, landscape,
}: { entry: string; width: number; height: number; landscape: boolean }) {
  let data: any;
  try {
    data = JSON.parse(entry);
  } catch {
    // Malformed tasting-note JSON — render nothing rather than
    // throwing a render-time exception (the feed used to crash on
    // a single bad row).
    return null;
  }
  return (
    <View style={{ width, height }}>
      <TastingNoteCard {...data} width={width} height={height} landscape={landscape} />
    </View>
  );
}

export default function PostGallery({
  images,
  onPress,
}: {
  images: string[];
  onPress?: () => void;
}) {
  const { isMobile } = useBreakpoint();
  const { width: winW } = useWindowDimensions();
  const [cw, setCw] = useState(0);

  if (!images || images.length === 0) return null;

  const seededW = isMobile ? Math.max(200, winW - 44) : Math.max(200, winW - 60);
  const effectiveW = cw > 0 ? cw : seededW;

  if (isMobile) {
    // Split the entries by type so tasting-note cards can render
    // at full-width landscape while images stay as a 3-col strip.
    const notes = images.filter(isTastingNoteEntry);
    const imgs = images.filter((x) => !isTastingNoteEntry(x));
    return (
      <View
        onLayout={(e) => setCw(e.nativeEvent.layout.width)}
        style={s.wrap}
      >
        {notes.length > 0 && (
          <NoteCarouselMobile notes={notes} containerW={effectiveW} />
        )}
        {imgs.length > 0 && (
          <ImageStripMobile images={imgs} containerW={effectiveW} onPress={onPress} />
        )}
      </View>
    );
  }

  // Wide web: original 3-up thumbnail strip, mixed types in order.
  const itemW = Math.floor((effectiveW - PG_GAP * 2) / 3);
  const itemH = Math.floor(itemW * GALLERY_ASPECT);
  return (
    <View onLayout={(e) => setCw(e.nativeEvent.layout.width)} style={s.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: PG_GAP }}
      >
        {images.map((entry, i) => (
          <View key={i} style={{ width: itemW, height: itemH, borderRadius: PG_RADIUS, overflow: "hidden" as any }}>
            {isTastingNoteEntry(entry) ? (
              <NoteSlot entry={entry} width={itemW} height={itemH} landscape={false} />
            ) : (
              <ImageSlot entry={entry} width={itemW} height={itemH} onPress={onPress} />
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** Mobile tasting-note carousel — one full-width landscape card per
 *  viewport, snap-paged, with dot indicators + edge chevron when
 *  there are multiple notes. */
function NoteCarouselMobile({
  notes, containerW,
}: { notes: string[]; containerW: number }) {
  const [idx, setIdx] = useState(0);
  const slideW = containerW;
  const slideH = Math.round(slideW * GALLERY_ASPECT_LS);
  const multi = notes.length > 1;

  return (
    <View style={s.carousel}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        pagingEnabled
        snapToInterval={slideW}
        decelerationRate="fast"
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, slideW));
          if (i !== idx) setIdx(i);
        }}
        scrollEventThrottle={16}
      >
        {notes.map((entry, i) => (
          <View key={i} style={{ width: slideW, height: slideH, borderRadius: PG_RADIUS_LS, overflow: "hidden" }}>
            <NoteSlot entry={entry} width={slideW} height={slideH} landscape />
          </View>
        ))}
      </ScrollView>
      {multi && idx < notes.length - 1 && (
        <View pointerEvents="none" style={[s.chevronHint, { top: slideH / 2 - 14 }]}>
          <ChevronRight size={20} color={t.color["text.on-dark"]} strokeWidth={2.5} />
        </View>
      )}
      {multi && (
        <View style={s.dots} pointerEvents="none">
          {notes.map((_, i) => (
            <View key={i} style={[s.dot, i === idx && s.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

/** Mobile image strip — 3 thumbnails per viewport at the original
 *  small size (per user: "keep the image size"), with carousel
 *  affordances when there's a 4th+ item to reveal. */
function ImageStripMobile({
  images, containerW, onPress,
}: { images: string[]; containerW: number; onPress?: () => void }) {
  const [idx, setIdx] = useState(0);
  const itemW = Math.floor((containerW - PG_GAP * 2) / 3);
  const itemH = Math.floor(itemW * GALLERY_ASPECT);
  const slideUnit = itemW + PG_GAP;
  const multi = images.length > 3;

  return (
    <View style={s.carousel}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: PG_GAP }}
        snapToInterval={multi ? slideUnit : undefined}
        decelerationRate={multi ? "fast" : "normal"}
        onScroll={multi ? (e: NativeSyntheticEvent<NativeScrollEvent>) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, slideUnit));
          if (i !== idx) setIdx(i);
        } : undefined}
        scrollEventThrottle={16}
      >
        {images.map((entry, i) => (
          <View key={i} style={{ width: itemW, height: itemH, borderRadius: PG_RADIUS, overflow: "hidden" as any }}>
            <ImageSlot entry={entry} width={itemW} height={itemH} onPress={onPress} />
          </View>
        ))}
      </ScrollView>
      {multi && idx < images.length - 3 && (
        <View pointerEvents="none" style={[s.chevronHint, { top: itemH / 2 - 14 }]}>
          <ChevronRight size={20} color={t.color["text.on-dark"]} strokeWidth={2.5} />
        </View>
      )}
      {multi && (
        <View style={s.dots} pointerEvents="none">
          {Array.from({ length: Math.max(1, images.length - 2) }).map((_, i) => (
            <View key={i} style={[s.dot, i === idx && s.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 16, position: "relative" as any },
  carousel: { position: "relative" as any, marginBottom: 10 },
  chevronHint: {
    position: "absolute" as any,
    right: 6,
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  } as any,
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: 8,
  } as any,
  dot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: t.color["text.muted"],
    opacity: 0.4,
  } as any,
  dotActive: {
    backgroundColor: t.color["text.primary"],
    opacity: 1,
  } as any,
});
