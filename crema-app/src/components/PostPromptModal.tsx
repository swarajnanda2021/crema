/**
 * CRUD Utopia — PostPromptModal. Lightweight floating modal that asks
 * a roaster / café owner if they want to post about a catalog change
 * they just made. On confirm it calls onCompose with a pre-filled
 * suggested teaser; on dismiss it just closes.
 *
 * Uses the site's floating-modal pattern (overlayWrap + backdrop blur +
 * card + primary / secondary button row).
 */

import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { X } from "lucide-react-native";

import { t } from "../tokens/useTokens";

interface Props {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export default function PostPromptModal({
  visible,
  title,
  body,
  confirmLabel = "Compose post",
  onConfirm,
  onClose,
}: Props) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlayWrap}>
        <Pressable style={s.overlayBg} onPress={onClose} />
        <View style={s.card}>
          <View style={s.header}>
            <Text style={s.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={20} color={t.color["text.primary"]} />
            </Pressable>
          </View>
          <View style={s.body}>
            <Text style={s.bodyText}>{body}</Text>
            <Text style={s.question}>Do you want to post about this?</Text>
          </View>
          <View style={s.actions}>
            <Pressable onPress={onClose} style={s.cancelBtn}>
              <Text style={s.cancelText}>Not now</Text>
            </Pressable>
            <Pressable onPress={onConfirm} style={s.confirmBtn}>
              <Text style={s.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlayWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    ...(Platform.OS === "web"
      ? ({ backdropFilter: "blur(35px)", WebkitBackdropFilter: "blur(35px)" } as any)
      : {}),
  } as any,
  overlayBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.color.overlay,
  } as any,
  card: {
    backgroundColor: t.color.bg,
    borderRadius: t.radius.lg,
    width: "92%",
    maxWidth: 440,
    overflow: "hidden",
    zIndex: 1,
  } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  },
  title: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.lg"],
    color: t.color["text.primary"],
    flex: 1,
    paddingRight: t.spacing.md,
  },
  body: {
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.xl,
    gap: t.spacing.md,
  },
  bodyText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.secondary"],
    lineHeight: t.lineHeight.relaxed,
  },
  question: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.color["border.light"],
  },
  cancelBtn: {
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  cancelText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  },
  confirmBtn: {
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.sm,
    backgroundColor: t.color.accent,
  },
  confirmText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  },
});
