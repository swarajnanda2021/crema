/**
 * CropGestureWrap — drag-to-reposition + pinch-to-zoom gesture wrapper
 * for crop frames (avatars, hero covers, card images). (§2.36)
 *
 * Pre-migration the sites used DOM `onMouseDown` + `onWheel` handlers
 * that only worked on web. On native the avatar / hero was effectively
 * undraggable. This wrapper adds a `react-native-gesture-handler`
 * `Gesture.Pan()` + `Gesture.Pinch()` composition that runs on native
 * touch; on web it's a no-op passthrough so the existing DOM handlers
 * keep working unchanged — mixing gesture-handler with
 * onMouseDown/onWheel on the same view produces double-fires.
 *
 * Contract:
 *   - Caller owns the current crop/zoom state + setters.
 *   - Wrapper converts finger pan translationX/Y (px) into percent
 *     deltas against `containerW` / `containerH`.
 *   - Wrapper delegates to `onCrop(nextX, nextY)` / `onZoom(next)`
 *     with clamped 0–100 / min–max values.
 *   - `enabled` gates the gesture — pass `isEditing` from the site.
 *
 * Usage:
 *   <CropGestureWrap
 *     enabled={isEditing}
 *     containerW={containerW} containerH={containerH}
 *     cropX={editCropX} cropY={editCropY} zoom={editZoom}
 *     onCrop={(x, y) => { setEditCropX(x); setEditCropY(y); }}
 *     onZoom={(z) => setEditZoom(z)}
 *   >
 *     <Image ... />
 *   </CropGestureWrap>
 */
import { Platform, View } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, { useSharedValue, runOnJS } from "react-native-reanimated";

interface Props {
  enabled: boolean;
  containerW: number;
  containerH: number;
  cropX: number;
  cropY: number;
  zoom: number;
  onCrop: (x: number, y: number) => void;
  onZoom: (z: number) => void;
  /** Zoom clamp. Defaults match the existing sites: 1 – 5. */
  minZoom?: number;
  maxZoom?: number;
  /** Invert drag direction. Default: pan moves the image the same way
   *  the finger moves, which reads as "grab the image, move it". The
   *  cover/hero sites pre-migration felt like "move the viewport",
   *  which is the opposite — the old code negated the delta. Match
   *  that behaviour by default so nothing flips out from under users. */
  invertDrag?: boolean;
  children: React.ReactNode;
  style?: any;
}

export default function CropGestureWrap({
  enabled,
  containerW,
  containerH,
  cropX,
  cropY,
  zoom,
  onCrop,
  onZoom,
  minZoom = 1,
  maxZoom = 5,
  invertDrag = true,
  children,
  style,
}: Props) {
  // Web keeps its DOM `onMouseDown` / `onWheel` handlers — gesture-
  // handler on web would claim the same pointer events and double-
  // fire. Only wrap on native.
  if (Platform.OS === "web") {
    return <View style={style}>{children}</View>;
  }

  return (
    <NativeWrap
      enabled={enabled}
      containerW={containerW}
      containerH={containerH}
      cropX={cropX}
      cropY={cropY}
      zoom={zoom}
      onCrop={onCrop}
      onZoom={onZoom}
      minZoom={minZoom}
      maxZoom={maxZoom}
      invertDrag={invertDrag}
      style={style}
    >
      {children}
    </NativeWrap>
  );
}

function NativeWrap({
  enabled, containerW, containerH, cropX, cropY, zoom,
  onCrop, onZoom, minZoom, maxZoom, invertDrag, children, style,
}: Required<Omit<Props, "children" | "style">> & { children: React.ReactNode; style?: any }) {
  // Starting values snapped on gesture begin so the callbacks operate
  // against a stable anchor — matches the DOM path's
  // dragStartRef.current pattern.
  const startCropX = useSharedValue(cropX);
  const startCropY = useSharedValue(cropY);
  const startZoom = useSharedValue(zoom);

  const applyCrop = (x: number, y: number) => onCrop(x, y);
  const applyZoom = (z: number) => onZoom(Math.round(z * 100) / 100);

  const pan = Gesture.Pan()
    .enabled(enabled)
    // A few pixels of play so a stray fingertap doesn't register as a
    // drag and yank the crop. Matches the feed swipes' CLAIM_X.
    .minDistance(4)
    .onBegin(() => {
      "worklet";
      startCropX.value = cropX;
      startCropY.value = cropY;
    })
    .onUpdate((e) => {
      "worklet";
      if (containerW <= 0 || containerH <= 0) return;
      const dx = (e.translationX / containerW) * 100;
      const dy = (e.translationY / containerH) * 100;
      const sign = invertDrag ? -1 : 1;
      const nextX = Math.max(0, Math.min(100, startCropX.value + sign * dx));
      const nextY = Math.max(0, Math.min(100, startCropY.value + sign * dy));
      runOnJS(applyCrop)(nextX, nextY);
    });

  const pinch = Gesture.Pinch()
    .enabled(enabled)
    .onBegin(() => {
      "worklet";
      startZoom.value = zoom;
    })
    .onUpdate((e) => {
      "worklet";
      const next = Math.max(minZoom, Math.min(maxZoom, startZoom.value * e.scale));
      runOnJS(applyZoom)(next);
    });

  const composed = Gesture.Simultaneous(pan, pinch);

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={style}>{children}</Animated.View>
    </GestureDetector>
  );
}
