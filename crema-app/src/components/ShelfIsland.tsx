import { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { Coffee, ExternalLink, ArrowRight, Trash2, PenLine } from "lucide-react-native";
import { colors, fonts } from "../theme/colors";
import { pricePer250g } from "../utils/formatPrice";
import { useTastingNotes } from "../hooks/useTastingNotes";
import { trackClick } from "../api/client";
import TastingNoteDisplay from "./TastingNoteDisplay";
import TastingNoteForm from "./TastingNoteForm";
import Chip from "./Chip";

const SHELF_META: Record<string, { label: string }> = {
  currently_drinking: { label: "Currently Drinking" },
  drank: { label: "Drank" },
  want_to_try: { label: "Want to Try" },
};
const SHELF_ORDER = ["currently_drinking", "drank", "want_to_try"];

interface Props {
  entry: any;
  coffee: any;
  isOwner?: boolean;
  currentShelf?: string;
  onRemove?: () => void;
  onMove?: (productId: string, shelf: string) => void;
}

export default function ShelfIsland({ entry, coffee, isOwner, currentShelf, onRemove, onMove }: Props) {
  const router = useRouter();
  const { notes, fetchNotes, createNote, deleteNote } = useTastingNotes();
  const [showForm, setShowForm] = useState(false);
  const price250 = pricePer250g(coffee?.price_per_gram);

  useEffect(() => { if (coffee?.product_id) fetchNotes(coffee.product_id); }, [coffee?.product_id]);

  if (!coffee) return null;

  const handleSaveNote = useCallback(async (noteData: any) => {
    await createNote(noteData);
    setShowForm(false);
    fetchNotes(coffee.product_id);
  }, [createNote, fetchNotes, coffee.product_id]);

  const nextShelf = currentShelf
    ? SHELF_ORDER[(SHELF_ORDER.indexOf(currentShelf) + 1) % SHELF_ORDER.length]
    : "drank";

  return (
    <View style={s.card}>
      <View style={s.twoCol}>
        {/* Left: Coffee image + details */}
        <View style={s.leftCol}>
          <View style={s.imageWrap}>
            {coffee.image_url ? (
              <Image source={{ uri: coffee.image_url }} style={s.coffeeImage} contentFit="cover" />
            ) : (
              <View style={[s.coffeeImage, { backgroundColor: "#e8e0d0", alignItems: "center", justifyContent: "center" }]}>
                <Coffee size={32} color={colors.divider} />
              </View>
            )}
          </View>

          <Text style={s.coffeeName}>{coffee.coffee_name}</Text>
          <Pressable onPress={() => router.push(`/roaster/${coffee.roaster_slug}`)}>
            <Text style={s.roasterName}>By {coffee.roaster_name}</Text>
          </Pressable>

          <View style={s.divider} />

          <View style={s.chipRow}>
            {coffee.roast_level && coffee.roast_level !== "Unknown" && <Chip>{coffee.roast_level}</Chip>}
            {coffee.process && <Chip>{coffee.process}</Chip>}
            {price250 != null && <Chip>{`\u20B9${price250}/250g`}</Chip>}
          </View>

          {isOwner && (
            <>
              <View style={s.divider} />
              <View style={s.actions}>
                {onMove && (
                  <Pressable onPress={() => onMove(coffee.product_id, nextShelf)} style={s.actionBtn}>
                    <ArrowRight size={10} color={colors.textSecondary} />
                    <Text style={s.actionText}>Move to {SHELF_META[nextShelf]?.label}</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => { trackClick(coffee.product_id, coffee.roaster_slug, "shelf"); Linking.openURL(coffee.product_url); }}
                  style={s.actionBtn}
                >
                  <ExternalLink size={10} color={colors.textSecondary} />
                  <Text style={s.actionText}>Buy from roaster</Text>
                </Pressable>
                {onRemove && (
                  <Pressable onPress={onRemove} style={s.actionBtn}>
                    <Trash2 size={10} color="#C8553D" />
                    <Text style={[s.actionText, { color: "#C8553D" }]}>Remove</Text>
                  </Pressable>
                )}
              </View>
            </>
          )}
        </View>

        {/* Right: Tasting notes journal */}
        <View style={s.rightCol}>
          <Text style={s.journalHeader}>
            Tasting Journal
            {notes.length > 0 && (
              <Text style={s.journalCount}> ({notes.length})</Text>
            )}
          </Text>

          {notes.length > 0 ? (
            <View style={{ marginBottom: 12 }}>
              {notes.map((note: any) => (
                <TastingNoteDisplay
                  key={note.id}
                  note={note}
                  isOwner={isOwner}
                  onDelete={() => { deleteNote(note.id).then(() => fetchNotes(coffee.product_id)); }}
                />
              ))}
            </View>
          ) : (
            <Text style={s.emptyText}>No notes yet. How does this coffee taste to you?</Text>
          )}

          {isOwner && (
            showForm ? (
              <TastingNoteForm
                productId={coffee.product_id}
                onSubmit={handleSaveNote}
              />
            ) : (
              <Pressable onPress={() => setShowForm(true)} style={s.addNoteBtn}>
                <PenLine size={12} color={colors.textPrimary} />
                <Text style={s.addNoteText}>
                  {notes.length > 0 ? "Add another entry" : "Write a tasting note"}
                </Text>
              </Pressable>
            )
          )}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderTopLeftRadius: 3.6,
    borderTopRightRadius: 3.6,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    overflow: "hidden",
    marginBottom: 16,
    backgroundColor: colors.cardInfo,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  twoCol: { flexDirection: "row" },
  leftCol: {
    width: 220,
    padding: 16,
    borderRightWidth: 1,
    borderColor: colors.divider,
  },
  imageWrap: {
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 12,
  },
  coffeeImage: {
    width: "100%" as any,
    aspectRatio: 1,
  },
  coffeeName: {
    fontFamily: fonts.displayRegular,
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 21,
  },
  roasterName: {
    fontFamily: fonts.bodyRegular,
    fontSize: 11,
    marginTop: 2,
    color: colors.textSecondary,
  },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  actions: { gap: 6 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionText: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.textSecondary },

  rightCol: { flex: 1, minWidth: 0, padding: 16 },
  journalHeader: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    marginBottom: 12,
    color: colors.textPrimary,
  },
  journalCount: { fontFamily: fonts.bodyRegular, color: colors.textMuted },
  emptyText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    paddingVertical: 24,
    color: colors.textMuted,
    textAlign: "center",
  },
  addNoteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  addNoteText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textPrimary,
  },
});
