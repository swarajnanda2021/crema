/**
 * CRUD Utopia — metric info modal. Uses the site's floating-modal pattern
 * (overlayWrap + overlayBg + card) so it feels identical to PostModal and
 * the other overlays. Opened by a small "?" button on each MetricCard /
 * chart / table in the admin traction dashboard.
 * See CRUD_UTOPIA.md at repo root.
 */

import { View, Text, Pressable, Modal, StyleSheet, Platform } from "react-native";
import { HelpCircle, X } from "lucide-react-native";

import { t } from "../../tokens/useTokens";

// ── InfoButton — circular "?" in the top-right corner of a card ──────────

export function InfoButton({
  onPress,
  accessibilityLabel,
}: {
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [s.btn, pressed && s.btnPressed]}
      accessibilityLabel={accessibilityLabel || "What does this mean?"}
    >
      <HelpCircle
        size={14}
        color={t.color["text.muted"]}
        strokeWidth={1.8}
      />
    </Pressable>
  );
}

// ── InfoModal — floating overlay matching site's PostModal shell ─────────

export default function InfoModal({
  visible,
  title,
  body,
  onClose,
}: {
  visible: boolean;
  title: string;
  body: string;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
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
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Circular "?" icon button — top-right corner of info-bearing cards
  btn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  } as any,
  btnPressed: {
    backgroundColor: t.color["card.info"],
  },

  // Floating overlay — same pattern used by PostModal, ImageUploadModal, etc.
  overlayWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    ...(Platform.OS === "web"
      ? ({
          backdropFilter: "blur(35px)",
          WebkitBackdropFilter: "blur(35px)",
        } as any)
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
    maxWidth: 460,
    overflow: "hidden",
    zIndex: 1,
  } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md + 2,
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
  },
  bodyText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.secondary"],
    lineHeight: t.lineHeight.relaxed,
  },
});
