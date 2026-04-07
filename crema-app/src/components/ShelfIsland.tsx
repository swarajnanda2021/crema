import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { ShoppingCart, Share2, Coffee, X } from "lucide-react-native";
import { colors } from "../theme/colors";
import { pricePer250g } from "../utils/formatPrice";
import { useCoffeeData } from "../hooks/useCoffeeData";
import { useTastingNotes } from "../hooks/useTastingNotes";
import { useShare } from "../hooks/useShare";
import { trackClick } from "../api/client";
import TastingNoteDisplay from "./TastingNoteDisplay";
import TastingNoteForm from "./TastingNoteForm";
import Chip from "./Chip";

interface Props {
  entry: any;
  isOwner?: boolean;
  onRemove?: () => void;
}

export default function ShelfIsland({ entry, isOwner, onRemove }: Props) {
  const router = useRouter();
  const { productMap } = useCoffeeData();
  const { notes, fetchNotes, createNote, deleteNote } = useTastingNotes();
  const { share } = useShare();
  const coffee = productMap?.get(entry.product_id);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchNotes(entry.product_id);
  }, [entry.product_id]);

  if (!coffee) return null;

  const price250 = pricePer250g(coffee.price_per_gram);

  return (
    <View style={styles.card}>
      {/* Coffee info row */}
      <View style={styles.infoRow}>
        {/* Image */}
        <Pressable onPress={() => router.push(`/coffee/${coffee.product_id}`)} style={{ width: 110 }}>
          {coffee.image_url ? (
            <Image source={{ uri: coffee.image_url }} style={{ width: 110, height: 130 }} contentFit="cover" />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Coffee size={32} color={colors.border} />
            </View>
          )}
        </Pressable>

        {/* Details */}
        <View style={styles.details}>
          <View>
            <Text style={styles.coffeeName} numberOfLines={2}>{coffee.coffee_name}</Text>
            <Pressable onPress={() => router.push(`/roaster/${coffee.roaster_slug}`)}>
              <Text style={styles.roasterName}>{coffee.roaster_name}</Text>
            </Pressable>
            <View style={styles.chipRow}>
              {coffee.roast_level && coffee.roast_level !== "Unknown" && <Chip>{coffee.roast_level}</Chip>}
              {coffee.process && <Chip>{coffee.process}</Chip>}
            </View>
          </View>

          <View style={styles.priceRow}>
            <Text style={styles.price}>
              {price250 != null ? `\u20B9${price250.toLocaleString("en-IN")}` : "\u2014"}
              <Text style={styles.priceUnit}> / 250g</Text>
            </Text>
            <View style={styles.actionBtns}>
              <Pressable onPress={() => share(coffee)} style={[styles.iconBtn, { backgroundColor: colors.tagBg }]}>
                <Share2 size={14} color={colors.tagText} />
              </Pressable>
              <Pressable
                onPress={() => { trackClick(coffee.product_id, coffee.roaster_slug, "shelf"); Linking.openURL(coffee.product_url); }}
                style={[styles.iconBtn, { backgroundColor: colors.accent }]}
              >
                <ShoppingCart size={14} color="white" />
              </Pressable>
              {isOwner && onRemove && (
                <Pressable onPress={onRemove} style={[styles.iconBtn, { backgroundColor: colors.tagBg }]}>
                  <X size={14} color={colors.like} />
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Tasting notes section */}
      <View style={styles.notesSection}>
        {notes.filter((n: any) => n.product_id === entry.product_id).length > 0 && (
          <View style={{ marginBottom: 8 }}>
            {notes.filter((n: any) => n.product_id === entry.product_id).map((note: any) => (
              <TastingNoteDisplay
                key={note.id}
                note={note}
                isOwner={isOwner}
                onDelete={() => { deleteNote(note.id).then(() => fetchNotes(entry.product_id)); }}
              />
            ))}
          </View>
        )}

        {isOwner && (
          showForm ? (
            <TastingNoteForm
              productId={entry.product_id}
              onSubmit={async (note) => { await createNote(note); fetchNotes(entry.product_id); setShowForm(false); }}
            />
          ) : (
            <Pressable onPress={() => setShowForm(true)} style={styles.addNoteBtn}>
              <Text style={styles.addNoteText}>+ Add tasting note</Text>
            </Pressable>
          )
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 16,
    backgroundColor: colors.cardFront,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoRow: {
    flexDirection: "row",
  },
  imagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    width: 110,
    height: 130,
    backgroundColor: colors.tagBg,
  },
  details: {
    flex: 1,
    padding: 12,
    justifyContent: "space-between",
  },
  coffeeName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  roasterName: {
    fontSize: 12,
    marginTop: 2,
    color: colors.accent,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 6,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  price: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  priceUnit: {
    fontSize: 12,
    fontWeight: "400",
    opacity: 0.6,
  },
  actionBtns: {
    flexDirection: "row",
    gap: 8,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 9999,
    alignItems: "center",
    justifyContent: "center",
  },
  notesSection: {
    padding: 12,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  addNoteBtn: {
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: colors.tagBg,
  },
  addNoteText: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.tagText,
  },
});
