/**
 * AddImageActionSheet — iOS-style action sheet matching Figma 900:1906.
 *
 * Triggered when the composer's "Add an image" action row is pressed.
 * Two cards anchored to the bottom of the viewport over a warm-dark
 * scrim:
 *
 *   • Top card (Figma 900:1898): 370 × 115, white, borderRadius 5.
 *     Two rows split by a 1-px hairline:
 *       - "Photo Gallery" (Inter Regular 18 / 26, Crema pink)
 *       - "Camera"        (Inter Regular 18 / 26, Crema pink)
 *   • Bottom card (Figma 900:1902): 370 × 53, white, borderRadius 5.
 *     Single row:
 *       - "Cancel" (Inter Semibold 18 / 26, Crema pink)
 *   • 6-px gap between cards.
 *   • Both cards x=10 from each viewport edge → 370 wide on 390 frame.
 *
 * Backdrop scrim (Figma 900:1906): `#24150E` at 40 % opacity — a
 * darker, warmer scrim than the Tag-a-coffee sheet's #684F44/60. Tap
 * outside the cards to dismiss.
 *
 * Colors: the Figma uses `#C06CC4` for the action-link text — a
 * slightly darker pink than the brand's Crema (#D798DA). Per the
 * three-color palette discipline (DESIGN_LANGUAGE.md §1) we stick to
 * `accent.cta` (= constant Crema pink) so the action sheet's links
 * read in the same family as the composer's Cancel link / Share
 * button. If the designer specifically wants the darker variant we
 * surface that as a palette discussion.
 *
 * Image upload: Photo Gallery / Camera reuse the same
 * `launchImageLibraryAsync` / `launchCameraAsync` + multipart
 * upload flow as `ImageUploadModal`. On success we call
 * `onImagePicked(url)` so the parent (ComposePost) can attach the
 * uploaded image to the post.
 */

import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";

import { apiUpload } from "../api/client";
import { t, makeStyles } from "../tokens/useTokens";
import { tap as hapticTap, commit as hapticCommit } from "../utils/haptics";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with the uploaded image URL once a pick + upload finishes
   *  (currently used by the Camera path, which still uses the system
   *  camera capture). */
  onImagePicked: (url: string) => void;
  /** Called when the user taps "Photo Gallery". The parent should
   *  close this sheet AND open the custom in-app gallery — we do
   *  NOT hand off to `launchImageLibraryAsync` here because the user
   *  asked for a custom variant of the iOS picker. */
  onOpenGallery: () => void;
}

export default function AddImageActionSheet({
  visible,
  onClose,
  onImagePicked,
  onOpenGallery,
}: Props) {
  const insets = useSafeAreaInsets();
  const [uploading, setUploading] = useState(false);
  const s = useStyles();

  if (!visible) return null;

  const upload = async (asset: ImagePicker.ImagePickerAsset) => {
    setUploading(true);
    try {
      const formData = new FormData();
      if (Platform.OS === "web") {
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        const mime = blob.type || "image/jpeg";
        const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
        formData.append("file", blob, `upload_${Date.now()}.${ext}`);
      } else {
        const filename = asset.uri.split("/").pop() || "photo.jpg";
        const match = /\.(\w+)$/.exec(filename);
        const ext = match ? match[1] : "jpg";
        const mimeType =
          asset.mimeType || `image/${ext === "jpg" ? "jpeg" : ext}`;
        formData.append("file", {
          uri: asset.uri,
          name: filename,
          type: mimeType,
        } as any);
      }
      const raw = await apiUpload<{ url: string }>(
        "/upload/image?purpose=post",
        formData,
      );
      const res = (raw as any)?.data ?? raw;
      if (res?.url) {
        hapticCommit();
        onImagePicked(res.url);
        onClose();
      }
    } catch (e) {
      console.warn("Add-image upload failed:", e);
    } finally {
      setUploading(false);
    }
  };

  const pickFromGallery = () => {
    hapticTap();
    // Hand off to the parent — it closes this sheet AND opens the
    // custom in-app gallery (CustomGallerySheet). We don't fall
    // through to `launchImageLibraryAsync` because the user asked
    // for the gallery UX to live inside Crema, not the system picker.
    onOpenGallery();
  };

  const takePhoto = async () => {
    hapticTap();
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return;
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.85,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets[0]) {
        await upload(result.assets[0]);
      }
    } catch (e) {
      console.warn("Camera failed:", e);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Scrim — `#24150E` warm-dark at 40 % per Figma 900:1906.
          Tap-to-dismiss covers the whole viewport; the cards
          below sit on top of it. */}
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close" />

      {/* Bottom-anchored stack — top card + 6-px gap + cancel card,
          floating with a comfortable margin above the iPhone home
          indicator (insets.bottom + 12). */}
      <View
        style={[s.dock, { bottom: insets.bottom + 12 }]}
        pointerEvents="box-none"
      >
        <View style={s.topCard}>
          <Pressable
            style={({ pressed }) => [s.row, pressed && s.rowPressed]}
            onPress={pickFromGallery}
            disabled={uploading}
            accessibilityLabel="Photo Gallery"
            accessibilityRole="button"
          >
            <Text style={s.actionText}>Photo Gallery</Text>
          </Pressable>
          <View style={s.innerDivider} />
          <Pressable
            style={({ pressed }) => [s.row, pressed && s.rowPressed]}
            onPress={takePhoto}
            disabled={uploading}
            accessibilityLabel="Camera"
            accessibilityRole="button"
          >
            <Text style={s.actionText}>Camera</Text>
          </Pressable>
        </View>

        <View style={s.cancelCard}>
          <Pressable
            style={({ pressed }) => [s.cancelRow, pressed && s.rowPressed]}
            onPress={onClose}
            accessibilityLabel="Cancel"
            accessibilityRole="button"
          >
            <Text style={s.cancelText}>Cancel</Text>
          </Pressable>
        </View>

        {/* Lightweight upload spinner — overlays the dock while a
            picked image is being POSTed so the user knows
            something is in flight. The cards stay tappable;
            tapping during upload is a no-op via `disabled`. */}
        {uploading ? (
          <View style={s.uploadOverlay} pointerEvents="none">
            <ActivityIndicator size="small" color={t.color.accent} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(36,21,14,0.4)",
  } as any,
  // Cards anchored to the bottom of the viewport. `left/right: 10`
  // gives them the 370-wide footprint on a 390-wide frame.
  dock: {
    position: "absolute",
    left: 10,
    right: 10,
  } as any,

  // ── Top card (Photo Gallery + Camera) ───────────────────────
  topCard: {
    height: 115,
    borderRadius: 5,
    backgroundColor: t.color["card.product.bg"],
    overflow: "hidden",
  } as any,
  // Each row: 57.5 px tall (115 / 2). Centered text via flex.
  row: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  rowPressed: { backgroundColor: t.color["card.product.surface"] } as any,
  // Hairline between Photo Gallery and Camera (Figma 900:1901, full
  // 370-wide line in `divider` color).
  innerDivider: {
    height: 1,
    backgroundColor: t.color.divider,
  } as any,

  // ── Action text ─────────────────────────────────────────────
  // Color stays on the brand's Crema pink (`accent.cta`) per the
  // three-color palette rule — Figma's #C06CC4 darker pink isn't
  // in our approved set.
  actionText: {
    fontFamily: t.font["body.regular"],
    fontSize: 18,
    lineHeight: 26,
    color: t.color["accent.cta"],
    textAlign: "center",
  } as any,

  // ── Cancel card ─────────────────────────────────────────────
  cancelCard: {
    height: 53,
    marginTop: 6,
    borderRadius: 5,
    backgroundColor: t.color["card.product.bg"],
    overflow: "hidden",
  } as any,
  cancelRow: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  cancelText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 18,
    lineHeight: 26,
    color: t.color["accent.cta"],
    textAlign: "center",
  } as any,

  uploadOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  } as any,
}));
