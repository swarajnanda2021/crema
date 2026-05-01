/**
 * ImageUploadModal — Elegant image picker with three upload methods:
 * 1. Choose from device gallery
 * 2. Take a photo with camera
 * 3. Paste an image URL
 *
 * Matches the Crema design system (cream/brown/white palette, Inter fonts).
 */
import { useState, useEffect } from "react";
import { View, Text, TextInput, Pressable, Modal, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { X, ImageIcon, Camera, Link2 } from "lucide-react-native";
import { t, makeStyles } from "../tokens/useTokens";
import { apiUpload, resolveUploadUrl } from "../api/client";

interface Props {
  visible: boolean;
  title: string;
  purpose?: string;        // "logo" | "hero" — sent to upload endpoint
  currentUrl?: string;
  onConfirm: (url: string) => void;
  onClose: () => void;
}

type Mode = "idle" | "url";

export default function ImageUploadModal({ visible, title, purpose = "general", currentUrl, onConfirm, onClose }: Props) {
  const [previewUrl, setPreviewUrl] = useState(currentUrl || "");
  const [urlInput, setUrlInput] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [uploading, setUploading] = useState(false);
  const s = useStyles();

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setPreviewUrl(currentUrl || "");
      setUrlInput("");
      setMode("idle");
      setUploading(false);
    }
  }, [visible]);

  // Pick from gallery
  const pickFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsEditing: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        if (Platform.OS === "web") {
          await uploadWebAsset(asset);
        } else {
          await uploadNativeAsset(asset);
        }
      }
    } catch (e) {
      console.warn("Gallery pick failed:", e);
    }
  };

  // Take a photo (native only — on web, camera falls back to file picker)
  const takePhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return;
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.8,
        allowsEditing: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        if (Platform.OS === "web") {
          await uploadWebAsset(asset);
        } else {
          await uploadNativeAsset(asset);
        }
      }
    } catch (e) {
      console.warn("Camera failed:", e);
    }
  };

  // Upload on web — handle blob/data URIs properly
  const uploadWebAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    setUploading(true);
    try {
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      // Derive extension from the blob's mime type
      const mime = blob.type || "image/jpeg";
      const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
      const filename = `upload_${Date.now()}.${ext}`;

      const formData = new FormData();
      formData.append("file", blob, filename);

      const raw = await apiUpload<{ url: string }>(`/upload/image?purpose=${purpose}`, formData);
      const res = (raw as any)?.data ?? raw;
      setPreviewUrl(res.url);
    } catch (e) {
      console.warn("Web upload failed:", e);
    } finally {
      setUploading(false);
    }
  };

  // Upload on native — use the file URI directly
  const uploadNativeAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    setUploading(true);
    try {
      const uri = asset.uri;
      const filename = uri.split("/").pop() || "photo.jpg";
      const match = /\.(\w+)$/.exec(filename);
      const ext = match ? match[1] : "jpg";
      const mimeType = asset.mimeType || `image/${ext === "jpg" ? "jpeg" : ext}`;

      const formData = new FormData();
      formData.append("file", { uri, name: filename, type: mimeType } as any);

      const raw = await apiUpload<{ url: string }>(`/upload/image?purpose=${purpose}`, formData);
      const res = (raw as any)?.data ?? raw;
      setPreviewUrl(res.url);
    } catch (e) {
      console.warn("Native upload failed:", e);
    } finally {
      setUploading(false);
    }
  };

  // Use a pasted URL
  const handleUseUrl = () => {
    if (urlInput.trim()) {
      setPreviewUrl(urlInput.trim());
      setMode("idle");
    }
  };

  // Confirm and close
  const handleConfirm = () => {
    if (previewUrl) {
      onConfirm(previewUrl);
    }
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>

          {/* ── Header ─────────────────────────────────── */}
          <View style={s.header}>
            <Text style={s.title}>{title}</Text>
            <Pressable onPress={onClose} style={s.closeBtn}>
              <X size={18} color={t.color["text.primary"]} />
            </Pressable>
          </View>

          {/* ── Preview ────────────────────────────────── */}
          <View style={s.previewWrap}>
            {uploading ? (
              <ActivityIndicator size="large" color={t.color["text.muted"]} />
            ) : previewUrl ? (
              // Upload endpoint returns a relative path (e.g. `/uploads/…`);
              // `resolveUploadUrl` prepends the API base so `expo-image`
              // can fetch it. Without this the preview thumbnail stays
              // blank after a successful upload. (§postmodal-redo)
              <Image source={{ uri: resolveUploadUrl(previewUrl) }} style={s.previewImg} contentFit="cover" transition={200} />
            ) : (
              <View style={s.previewEmpty}>
                <ImageIcon size={32} color={t.color.divider} strokeWidth={1.2} />
                <Text style={s.previewHint}>No image selected</Text>
              </View>
            )}
          </View>

          {/* ── Action buttons ─────────────────────────── */}
          <View style={s.actions}>
            <ActionButton
              icon={<ImageIcon size={20} color={t.color["text.secondary"]} strokeWidth={1.5} />}
              label="Choose from device"
              onPress={pickFromGallery}
              disabled={uploading}
            />
            {Platform.OS !== "web" && (
              <ActionButton
                icon={<Camera size={20} color={t.color["text.secondary"]} strokeWidth={1.5} />}
                label="Take a photo"
                onPress={takePhoto}
                disabled={uploading}
              />
            )}
            <ActionButton
              icon={<Link2 size={20} color={t.color["text.secondary"]} strokeWidth={1.5} />}
              label={mode === "url" ? "Hide URL input" : "Paste image URL"}
              onPress={() => setMode(mode === "url" ? "idle" : "url")}
              disabled={uploading}
              active={mode === "url"}
            />
          </View>

          {/* ── URL input (toggled) ────────────────────── */}
          {mode === "url" && (
            <View style={s.urlRow}>
              <TextInput
                style={s.urlInput}
                value={urlInput}
                onChangeText={setUrlInput}
                placeholder="https://example.com/image.jpg"
                placeholderTextColor={t.color["text.muted"]}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={handleUseUrl}
              />
              <Pressable onPress={handleUseUrl} style={s.urlGoBtn}>
                <Text style={s.urlGoText}>Use</Text>
              </Pressable>
            </View>
          )}

          {/* ── Footer ─────────────────────────────────── */}
          <View style={s.footer}>
            <Pressable onPress={onClose} style={s.cancelBtn}>
              <Text style={s.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              style={[s.confirmBtn, !previewUrl && s.confirmBtnDisabled]}
              disabled={!previewUrl || uploading}
            >
              <Text style={s.confirmText}>
                {previewUrl !== currentUrl ? "Use this image" : "Keep current"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Action button sub-component ──────────────────────────────────────────────

function ActionButton({ icon, label, onPress, disabled, active }: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  const s = useStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.actionBtn,
        active && s.actionBtnActive,
        pressed && s.actionBtnPressed,
        disabled && { opacity: 0.5 },
      ]}
    >
      {icon}
      <Text style={[s.actionLabel, active && s.actionLabelActive]}>{label}</Text>
    </Pressable>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles((t) => ({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: t.color["card.front"],
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: {
    fontFamily: t.font["body.semibold"],
    fontSize: 18,
    color: t.color["text.primary"],
  },
  closeBtn: { padding: 4 },

  // Preview area
  previewWrap: {
    marginHorizontal: 24,
    height: 180,
    borderRadius: 12,
    backgroundColor: t.color["tag.bg"],
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImg: {
    width: "100%",
    height: "100%",
  } as any,
  previewEmpty: {
    alignItems: "center",
    gap: 8,
  },
  previewHint: {
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: t.color["text.muted"],
  },

  // Action buttons
  actions: {
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 8,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: t.color.bg,
    borderWidth: 1,
    borderColor: t.color["border.light"],
  },
  actionBtnActive: {
    borderColor: t.color["text.primary"],
    backgroundColor: t.color["card.info"],
  },
  actionBtnPressed: {
    backgroundColor: t.color["border.light"],
  },
  actionLabel: {
    fontFamily: t.font["body.medium"],
    fontSize: 14,
    color: t.color["text.primary"],
  },
  actionLabelActive: {
    fontFamily: t.font["body.semibold"],
  },

  // URL input row
  urlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 24,
    marginTop: 8,
  },
  urlInput: {
    flex: 1,
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: t.color["text.primary"],
    backgroundColor: t.color.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    paddingHorizontal: 12,
    paddingVertical: 10,
  } as any,
  urlGoBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: t.color["text.primary"],
  },
  urlGoText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 13,
    color: t.color["text.on-cta"],
  },

  // Footer
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    padding: 24,
    paddingTop: 20,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cancelText: {
    fontFamily: t.font["body.medium"],
    fontSize: 14,
    color: t.color["text.secondary"],
  },
  confirmBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: t.color["text.primary"],
  },
  confirmBtnDisabled: {
    backgroundColor: t.color["text.muted"],
  },
  confirmText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 14,
    color: t.color["text.on-cta"],
  },
}));
