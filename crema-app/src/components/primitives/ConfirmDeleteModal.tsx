/**
 * ConfirmDeleteModal — shared confirm-before-delete sheet. Matches
 * the roaster page's §2.9 inline confirm visually but lives as a
 * single primitive so every destructive action across the site can
 * reuse it with identical copy tone + layout (the §2.19 sweep).
 *
 * Copy convention: the default body mentions the recycle bin so the
 * user knows the action is recoverable, unless the caller overrides
 * `body` or sets `permanent` (for bin's own "delete forever").
 */

import { View, Text, Pressable, Modal, StyleSheet, Platform } from "react-native";
import { t, makeStyles } from "../../tokens/useTokens";

interface Props {
  visible: boolean;
  title?: string;
  body?: string;
  confirmLabel?: string;
  permanent?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ConfirmDeleteModal({
  visible,
  title = "Delete this?",
  body,
  confirmLabel = "Delete",
  permanent = false,
  onConfirm,
  onClose,
}: Props) {
  const s = useStyles();
  const bodyText = body
    || (permanent
        ? "This will delete it permanently — you won't be able to recover it."
        : "You can always recover it from the recycle bin in your profile.");

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={s.overlayBg} onPress={onClose} />
        <View style={s.card}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.body}>{bodyText}</Text>
          <View style={s.actions}>
            <Pressable onPress={onClose} style={s.cancel}>
              <Text style={s.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => { onClose(); onConfirm(); }}
              style={s.confirm}
            >
              <Text style={s.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  overlay: {
    flex: 1, justifyContent: "center", alignItems: "center",
    ...(Platform.OS === "web" ? ({ backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" } as any) : {}),
  } as any,
  overlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: t.color.overlay } as any,
  card: {
    backgroundColor: t.color.bg,
    borderRadius: t.radius.lg,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 18,
    width: "90%", maxWidth: 420,
    zIndex: 1,
  } as any,
  title: {
    fontFamily: t.font.display,
    fontSize: 20,
    color: t.color["text.primary"],
    lineHeight: 26,
    marginBottom: 8,
  } as any,
  body: {
    fontFamily: t.font["body.regular"],
    fontSize: 13.5,
    color: t.color["text.secondary"],
    lineHeight: 19,
    marginBottom: 20,
  } as any,
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 } as any,
  cancel: { paddingHorizontal: 14, paddingVertical: 8 },
  cancelText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.muted"] },
  confirm: {
    paddingHorizontal: 18, paddingVertical: 8,
    borderRadius: 6, backgroundColor: t.color.accent,
  } as any,
  confirmText: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.primary"] },
}));
