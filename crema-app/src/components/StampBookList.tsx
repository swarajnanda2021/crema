/**
 * CRUD Utopia — Stamp Book list. Renders a user's stamp history as
 * roaster-list-style rows. Tap opens StampBookModal with QR + progress.
 * See CRUD_UTOPIA.md at repo root.
 */

import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { ArrowRight } from "lucide-react-native";
import { t } from "../tokens/useTokens";
import { resolveUploadUrl } from "../api/client";
import { useStampBook } from "../hooks/useCafes";
import StampBookModal from "./StampBookModal";
import type { StampBookEntry } from "../resources/types";

interface Props {
  username: string;
  isOwnProfile: boolean;
}

export default function StampBookList({ username, isOwnProfile }: Props) {
  const { entries, loading } = useStampBook(username);
  const [selected, setSelected] = useState<StampBookEntry | null>(null);

  if (loading) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyText}>Loading stamp book…</Text>
      </View>
    );
  }

  if (entries.length === 0) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyTitle}>No stamps yet</Text>
        <Text style={s.emptyText}>
          {isOwnProfile
            ? "Visit a café and have them scan your QR to start collecting stamps."
            : "This user hasn't collected any café stamps yet."}
        </Text>
      </View>
    );
  }

  return (
    <>
      <View style={s.list}>
        {entries.map((e) => (
          <Row key={e.cafe_slug} entry={e} onTap={() => setSelected(e)} />
        ))}
      </View>

      <StampBookModal
        visible={!!selected}
        entry={selected}
        isOwnProfile={isOwnProfile}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function Row({ entry, onTap }: { entry: StampBookEntry; onTap: () => void }) {
  const [hovered, setHovered] = useState(false);
  const subParts: string[] = [];
  if (entry.city) subParts.push([entry.city, entry.state].filter(Boolean).join(", "));
  subParts.push(`${entry.progress} / ${entry.stamp_target} stamps`);
  if (entry.rewards_redeemed > 0) subParts.push(`${entry.rewards_redeemed} earned`);

  return (
    <>
      <Pressable
        onPress={onTap}
        style={[s.row, hovered && s.rowHovered] as any}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
      >
        <View style={s.image}>
          {entry.logo_url ? (
            <Image source={{ uri: resolveUploadUrl(entry.logo_url) }} style={{ width: 60, height: 60 }} contentFit="cover" />
          ) : (
            <View style={s.imageFallback}>
              <Text style={s.imageInitial}>{entry.name.charAt(0)}</Text>
            </View>
          )}
        </View>
        <View style={s.info}>
          <Text style={s.name} numberOfLines={1}>{entry.name}</Text>
          <Text style={s.sub} numberOfLines={1}>{subParts.join("  \u00B7  ")}</Text>
        </View>
        <View style={[s.arrow, hovered && s.arrowHovered] as any}>
          <ArrowRight size={18} color={hovered ? t.color["text.primary"] : t.color["text.muted"]} strokeWidth={1.5} />
        </View>
      </Pressable>
      <View style={s.divider} />
    </>
  );
}

const s = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingTop: 12 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 16,
    paddingVertical: 14, paddingHorizontal: 8,
  },
  rowHovered: { backgroundColor: t.color.flash } as any,
  image: { width: 60, height: 60, borderRadius: 6, overflow: "hidden", backgroundColor: t.color["card.info"] },
  imageFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  imageInitial: { fontFamily: t.font.display, fontSize: 28, color: t.color["text.muted"] },
  info: { flex: 1, minWidth: 0 },
  name: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.primary"] },
  sub: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.muted"], marginTop: 2 },
  arrow: { padding: 6 },
  arrowHovered: {} as any,
  divider: { height: 1, backgroundColor: t.color["border.light"], marginHorizontal: 8 },

  empty: { paddingVertical: 60, alignItems: "center", paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontFamily: t.font["body.semibold"], fontSize: 15, color: t.color["text.primary"] },
  emptyText: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.muted"], textAlign: "center", lineHeight: 18 },
});
