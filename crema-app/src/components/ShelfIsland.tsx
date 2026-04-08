import { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { Coffee, ExternalLink, ArrowRight, Trash2, PenLine } from "lucide-react-native";
import { colors } from "../theme/colors";
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
  const price250 = pricePer250g(coffee.price_per_gram);

  useEffect(() => { fetchNotes(coffee.product_id); }, [coffee.product_id]);

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
      {/* Two-column layout: image+details left | tasting journal right */}
      <View style={s.twoCol}>
        {/* ── Left: Coffee image + details ── */}
        <View style={s.leftCol}>
          {/* Large image */}
          {coffee.image_url ? (
            <Image source={{ uri: coffee.image_url }} style={s.coffeeImage} contentFit="cover" />
          ) : (
            <View style={[s.coffeeImage, { backgroundColor: colors.tagBg, alignItems: "center", justifyContent: "center" }]}>
              <Coffee size={32} color={colors.border} />
            </View>
          )}

          {/* Details */}
          <Text style={s.coffeeName}>{coffee.coffee_name}</Text>
          <Pressable onPress={() => router.push(`/roaster/${coffee.roaster_slug}`)}>
            <Text style={s.roasterName}>{coffee.roaster_name}</Text>
          </Pressable>

          {/* Chips */}
          <View style={s.chipRow}>
            {coffee.roast_level && coffee.roast_level !== "Unknown" && <Chip>{coffee.roast_level}</Chip>}
            {coffee.process && <Chip>{coffee.process}</Chip>}
            {price250 != null && <Chip>{`\u20B9${price250}/250g`}</Chip>}
          </View>

          {/* Quick actions */}
          {isOwner && (
            <View style={s.actions}>
              {onMove && (
                <Pressable onPress={() => onMove(coffee.product_id, nextShelf)} style={s.actionBtn}>
                  <ArrowRight size={9} color={colors.textSecondary} />
                  <Text style={s.actionText}>Move to {SHELF_META[nextShelf]?.label}</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => { trackClick(coffee.product_id, coffee.roaster_slug, "shelf"); Linking.openURL(coffee.product_url); }}
                style={s.actionBtn}
              >
                <ExternalLink size={9} color={colors.textSecondary} />
                <Text style={s.actionText}>Buy from roaster</Text>
              </Pressable>
              {onRemove && (
                <Pressable onPress={onRemove} style={s.actionBtn}>
                  <Trash2 size={9} color="#E63946" />
                  <Text style={[s.actionText, { color: "#E63946" }]}>Remove</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

        {/* ── Right: Tasting notes journal ── */}
        <View style={s.rightCol}>
          <Text style={s.journalHeader}>
            Tasting Journal
            {notes.length > 0 && (
              <Text style={s.journalCount}> ({notes.length} {notes.length === 1 ? "entry" : "entries"})</Text>
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
                <PenLine size={12} color={colors.accent} />
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
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  twoCol: { flexDirection: "row" },
  leftCol: {
    width: 200,
    padding: 12,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  coffeeImage: {
    width: "100%" as any,
    aspectRatio: 1,
    borderRadius: 8,
    marginBottom: 12,
  },
  coffeeName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  roasterName: { fontSize: 11, marginTop: 2, color: colors.textSecondary },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 8 },
  actions: { marginTop: 12, gap: 4 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionText: { fontSize: 11, color: colors.textSecondary },
  rightCol: { flex: 1, minWidth: 0, padding: 12 },
  journalHeader: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
    color: colors.textSecondary,
  },
  journalCount: { fontWeight: "400" },
  emptyText: { fontSize: 14, fontStyle: "italic", paddingVertical: 16, color: colors.textSecondary },
  addNoteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addNoteText: { fontSize: 12, fontWeight: "500", color: colors.accent },
});
