import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
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
    <View className="rounded-2xl overflow-hidden mb-4" style={{ backgroundColor: colors.cardFront, borderWidth: 1, borderColor: colors.border }}>
      {/* Coffee info row */}
      <View className="flex-row">
        {/* Image */}
        <Pressable onPress={() => router.push(`/coffee/${coffee.product_id}`)} style={{ width: 110 }}>
          {coffee.image_url ? (
            <Image source={{ uri: coffee.image_url }} style={{ width: 110, height: 130 }} contentFit="cover" />
          ) : (
            <View className="items-center justify-center" style={{ width: 110, height: 130, backgroundColor: colors.tagBg }}>
              <Coffee size={32} color={colors.border} />
            </View>
          )}
        </Pressable>

        {/* Details */}
        <View className="flex-1 p-3 justify-between">
          <View>
            <Text className="text-base font-semibold" numberOfLines={2} style={{ color: colors.textPrimary }}>
              {coffee.coffee_name}
            </Text>
            <Pressable onPress={() => router.push(`/roaster/${coffee.roaster_slug}`)}>
              <Text className="text-xs mt-0.5" style={{ color: colors.accent }}>{coffee.roaster_name}</Text>
            </Pressable>
            <View className="flex-row flex-wrap gap-1 mt-1.5">
              {coffee.roast_level && coffee.roast_level !== "Unknown" && <Chip>{coffee.roast_level}</Chip>}
              {coffee.process && <Chip>{coffee.process}</Chip>}
            </View>
          </View>

          <View className="flex-row items-center justify-between mt-2">
            <Text className="text-lg font-bold" style={{ color: colors.textPrimary }}>
              {price250 != null ? `\u20B9${price250.toLocaleString("en-IN")}` : "\u2014"}
              <Text className="text-xs font-normal opacity-60"> / 250g</Text>
            </Text>
            <View className="flex-row gap-2">
              <Pressable onPress={() => share(coffee)} className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: colors.tagBg }}>
                <Share2 size={14} color={colors.tagText} />
              </Pressable>
              <Pressable
                onPress={() => { trackClick(coffee.product_id, coffee.roaster_slug, "shelf"); Linking.openURL(coffee.product_url); }}
                className="w-8 h-8 rounded-full items-center justify-center"
                style={{ backgroundColor: colors.accent }}
              >
                <ShoppingCart size={14} color="white" />
              </Pressable>
              {isOwner && onRemove && (
                <Pressable onPress={onRemove} className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: colors.tagBg }}>
                  <X size={14} color={colors.like} />
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Tasting notes section */}
      <View className="p-3 border-t" style={{ borderColor: colors.border }}>
        {notes.filter((n: any) => n.product_id === entry.product_id).length > 0 && (
          <View className="mb-2">
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
            <Pressable onPress={() => setShowForm(true)} className="py-2 rounded-lg items-center" style={{ backgroundColor: colors.tagBg }}>
              <Text className="text-sm font-medium" style={{ color: colors.tagText }}>+ Add tasting note</Text>
            </Pressable>
          )
        )}
      </View>
    </View>
  );
}
