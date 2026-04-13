/**
 * CroppedAvatar — renders an avatar with manual crop/zoom positioning.
 *
 * Preserved from PostFeedCard.tsx — the crop math is the same for all platforms.
 * On iOS/Swift, this becomes a ZStack with GeometryReader and .offset().
 */

import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { resolveUploadUrl } from "../../api/client";

interface AvatarProps {
  url: string;
  cropX?: number;
  cropY?: number;
  zoom?: number;
  size: number;
  style?: any;
}

export default function CroppedAvatar({ url, cropX, cropY, zoom, size, style }: AvatarProps) {
  const [aspect, setAspect] = useState(1.5);
  const z = zoom ?? 1;
  const cx = cropX ?? 50;
  const cy = cropY ?? 50;
  const MIN = 1.2;

  let iW: number, iH: number;
  if (aspect >= 1) { iH = size * MIN * z; iW = iH * aspect; }
  else { iW = size * MIN * z; iH = iW / aspect; }
  const tx = -(iW - size) * (cx / 100);
  const ty = -(iH - size) * (cy / 100);

  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }, style]}>
      <Image
        source={{ uri: resolveUploadUrl(url) }}
        style={{ position: "absolute", width: iW, height: iH, left: tx, top: ty } as any}
        contentFit="fill"
        onLoad={(e: any) => { const s = e?.source; if (s?.width && s?.height) setAspect(s.width / s.height); }}
      />
    </View>
  );
}
