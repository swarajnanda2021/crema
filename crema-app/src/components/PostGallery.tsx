/**
 * PostGallery — universal image/card gallery for posts.
 *
 * Every item is always the 3-column size (one standard presentation).
 * 1–3 items sit in a row; 4+ scroll horizontally.
 * Images and TastingNoteCard entries are rendered at the same size.
 */

import { useState } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { resolveUploadUrl } from "../api/client";
import TastingNoteCard from "./TastingNoteCard";

export const GALLERY_ASPECT = 371 / 281; // Universal H/W — Figma TastingNoteCard (281×371)
export const PG_GAP = 10;
export const PG_RADIUS = 5;

export function isTastingNoteEntry(img: string) {
  return img.startsWith('{"type":"tasting_note"');
}

function GallerySlot({
  entry,
  width,
  height,
  onPress,
}: {
  entry: string;
  width: number;
  height: number;
  onPress?: () => void;
}) {
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

export default function PostGallery({
  images,
  onPress,
}: {
  images: string[];
  onPress?: () => void;
}) {
  const [cw, setCw] = useState(0);

  if (!images || images.length === 0) return null;

  const itemW = cw > 0 ? Math.floor((cw - PG_GAP * 2) / 3) : 220;
  const itemH = Math.floor(itemW * GALLERY_ASPECT);

  return (
    <View onLayout={(e) => setCw(e.nativeEvent.layout.width)} style={s.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: PG_GAP }}
      >
        {images.map((entry, i) => (
          <View key={i} style={{ borderRadius: PG_RADIUS, overflow: "hidden" as any }}>
            <GallerySlot entry={entry} width={itemW} height={itemH} onPress={onPress} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 16 },
});
