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
  View, ScrollView, Pressable, StyleSheet, Text,
  useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent,
} from "react-native";
import { Image } from "expo-image";
import { ChevronRight } from "lucide-react-native";

import { resolveUploadUrl } from "../api/client";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { t } from "../tokens/useTokens";
import TastingNoteCard from "./TastingNoteCard";

export const GALLERY_ASPECT = 371 / 281; // Portrait — Figma TastingNoteCard base (281×371)
export const GALLERY_ASPECT_LS = 251 / 370; // Landscape — CoffeeCard mobile (370×251)
export const PG_GAP = 10;
export const PG_RADIUS = 5;
export const PG_RADIUS_LS = 10;

export function isTastingNoteEntry(img: string) {
  return img.startsWith('{"type":"tasting_note"') || img.startsWith('{"type": "tasting_note"');
}

function ImageSlot({
  entry, width, height, onPress,
}: { entry: string; width: number; height: number; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width, height }}>
      <Image
        source={{ uri: resolveUploadUrl(entry) }}
        style={{ width, height, borderRadius: PG_RADIUS }}
        contentFit="cover"
      />
    </Pressable>
  );
}

function NoteSlot({
  entry, width, height, landscape, onPress,
}: { entry: string; width: number; height: number; landscape: boolean; onPress?: () => void }) {
  const data = JSON.parse(entry);
  return (
    <Pressable onPress={onPress} style={{ width, height }}>
      <TastingNoteCard {...data} width={width} height={height} landscape={landscape} />
    </Pressable>
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
          <NoteCarouselMobile notes={notes} containerW={effectiveW} onPress={onPress} />
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
              <NoteSlot entry={entry} width={itemW} height={itemH} landscape={false} onPress={onPress} />
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
  notes, containerW, onPress,
}: { notes: string[]; containerW: number; onPress?: () => void }) {
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
            <NoteSlot entry={entry} width={slideW} height={slideH} landscape onPress={onPress} />
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
