/**
 * CRUD Utopia — QR identity modal. Shows the user's short-lived QR token
 * as a scannable code. Shown from the profile dropdown via "Show QR".
 * Cross-platform: react-native-qrcode-svg works on web (via react-native-svg)
 * and native.
 * See CRUD_UTOPIA.md at repo root.
 */

import { View, Text, Pressable, Modal, StyleSheet, ActivityIndicator } from "react-native";
import { X } from "lucide-react-native";
import QRCode from "react-native-qrcode-svg";
import { t } from "../tokens/useTokens";
import { useAuth } from "../hooks/useAuth";
import { useQRToken } from "../hooks/useQRToken";

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function QRModal({ visible, onClose }: Props) {
  const { user } = useAuth();
  const { token, loading } = useQRToken(visible);

  if (!user) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={s.card}>
          <View style={s.header}>
            <Text style={s.title}>Your QR</Text>
            <Pressable onPress={onClose}><X size={20} color={t.color["text.primary"]} /></Pressable>
          </View>

          <View style={s.body}>
            <View style={s.qrWrap}>
              {loading || !token ? (
                <ActivityIndicator color={t.color.accent} />
              ) : (
                <QRCode
                  value={token}
                  size={220}
                  color={t.color["text.primary"]}
                  backgroundColor={t.color["card.front"]}
                />
              )}
            </View>

            <Text style={s.displayName}>{user.display_name}</Text>
            <Text style={s.username}>@{user.username}</Text>

            <Text style={s.helpText}>
              Show this code to a café barista to collect a stamp. Refreshes every 5 minutes.
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  card: {
    width: "92%", maxWidth: 360, backgroundColor: t.color.bg, borderRadius: 12,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: t.color["border.light"],
  },
  title: { fontFamily: t.font["body.semibold"], fontSize: 16, color: t.color["text.primary"] },
  body: { padding: 24, alignItems: "center", gap: 12 },
  qrWrap: {
    width: 240, height: 240,
    backgroundColor: t.color["card.front"],
    alignItems: "center", justifyContent: "center",
    borderRadius: 8,
    padding: 10,
  },
  displayName: { fontFamily: t.font.display, fontSize: 24, color: t.color["text.primary"], marginTop: 8 },
  username: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.muted"] },
  helpText: {
    fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.secondary"],
    textAlign: "center", marginTop: 12, paddingHorizontal: 16, lineHeight: 16,
  },
});
