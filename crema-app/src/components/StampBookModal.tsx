/**
 * CRUD Utopia — Stamp Book modal. Shows progress at a single café.
 * On own profile: includes the QR for getting more stamps.
 * On other profiles: just shows progress (no QR).
 * See CRUD_UTOPIA.md at repo root.
 */

import { View, Text, Pressable, Modal, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { X } from "lucide-react-native";
import QRCode from "react-native-qrcode-svg";
import { t } from "../tokens/useTokens";
import { resolveUploadUrl } from "../api/client";
import { useQRToken } from "../hooks/useQRToken";
import type { StampBookEntry } from "../resources/types";

interface Props {
  visible: boolean;
  entry: StampBookEntry | null;
  isOwnProfile: boolean;
  onClose: () => void;
}

export default function StampBookModal({ visible, entry, isOwnProfile, onClose }: Props) {
  const router = useRouter();
  const { token, loading } = useQRToken(visible && isOwnProfile);

  if (!entry) return null;

  const dots = Array.from({ length: entry.stamp_target }, (_, i) => i < entry.progress);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={s.card}>
          <View style={s.header}>
            <Pressable
              onPress={() => { onClose(); router.push(`/cafe/${entry.cafe_slug}` as any); }}
              style={s.headerLeft}
            >
              {entry.logo_url ? (
                <Image source={{ uri: resolveUploadUrl(entry.logo_url) }} style={s.headerLogo} contentFit="cover" />
              ) : (
                <View style={[s.headerLogo, s.headerLogoFallback]}>
                  <Text style={s.headerLogoText}>{entry.name.charAt(0)}</Text>
                </View>
              )}
              <View>
                <Text style={s.title}>{entry.name}</Text>
                {entry.city && <Text style={s.subtitle}>{[entry.city, entry.state].filter(Boolean).join(", ")}</Text>}
              </View>
            </Pressable>
            <Pressable onPress={onClose}><X size={20} color={t.color["text.primary"]} /></Pressable>
          </View>

          <View style={s.body}>
            {/* Progress dots */}
            <Text style={s.progressLabel}>{entry.progress} / {entry.stamp_target} stamps</Text>
            <View style={s.dotsRow}>
              {dots.map((filled, i) => (
                <View key={i} style={[s.dot, filled ? s.dotFilled : s.dotEmpty]} />
              ))}
            </View>

            {entry.rewards_redeemed > 0 && (
              <Text style={s.rewardsText}>
                {entry.rewards_redeemed} {entry.rewards_redeemed === 1 ? entry.stamp_reward.toLowerCase() : entry.stamp_reward.toLowerCase() + "s"} earned so far
              </Text>
            )}

            {isOwnProfile && (
              <View style={s.qrSection}>
                <View style={s.qrWrap}>
                  {loading || !token ? (
                    <ActivityIndicator color={t.color.accent} />
                  ) : (
                    <QRCode
                      value={token}
                      size={160}
                      color={t.color["text.primary"]}
                      backgroundColor={t.color["card.front"]}
                    />
                  )}
                </View>
                <Text style={s.qrHelp}>Show this to a barista to collect a stamp.</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  card: {
    width: "92%", maxWidth: 420, backgroundColor: t.color.bg, borderRadius: 12,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: t.color["border.light"],
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  headerLogo: { width: 40, height: 40, borderRadius: 20 },
  headerLogoFallback: { backgroundColor: t.color["card.info"], alignItems: "center", justifyContent: "center" },
  headerLogoText: { fontFamily: t.font.display, fontSize: 16, color: t.color["text.primary"] },
  title: { fontFamily: t.font["body.semibold"], fontSize: 16, color: t.color["text.primary"] },
  subtitle: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.muted"] },

  body: { padding: 24, alignItems: "center", gap: 8 },
  progressLabel: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.primary"] },
  dotsRow: { flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" as any, justifyContent: "center" },
  dot: { width: 18, height: 18, borderRadius: 9 },
  dotFilled: { backgroundColor: t.color.accent },
  dotEmpty: { backgroundColor: t.color["card.info"], borderWidth: 1, borderColor: t.color.border },

  rewardsText: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.secondary"], marginTop: 6 },

  qrSection: { alignItems: "center", marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: t.color["border.light"], width: "100%", gap: 8 },
  qrWrap: {
    width: 180, height: 180,
    backgroundColor: t.color["card.front"],
    alignItems: "center", justifyContent: "center",
    borderRadius: 8,
    padding: 10,
  },
  qrHelp: {
    fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.muted"],
    textAlign: "center", paddingHorizontal: 16,
  },
});
