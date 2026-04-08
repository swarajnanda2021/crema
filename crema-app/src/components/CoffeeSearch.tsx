import { useState, useMemo } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { Search, Plus, X } from "lucide-react-native";
import { Image } from "expo-image";
import { colors, fonts } from "../theme/colors";
import { SHELF_LABELS, ShelfKey } from "../theme/colors";

const SHELF_KEYS: ShelfKey[] = ["currently_drinking", "drank", "want_to_try"];

interface Props {
  products: any[];
  onAddToShelf: (productId: string, shelf: string) => void;
}

export default function CoffeeSearch({ products, onAddToShelf }: Props) {
  const [query, setQuery] = useState("");
  const [shelfPicker, setShelfPicker] = useState<string | null>(null);

  const results = useMemo(() => {
    if (!query.trim() || query.length < 2) return [];
    const q = query.toLowerCase();
    return products
      .filter((p: any) =>
        p.coffee_name?.toLowerCase().includes(q) ||
        p.roaster_name?.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [query, products]);

  const handleAdd = (productId: string, shelf: ShelfKey) => {
    onAddToShelf(productId, shelf);
    setShelfPicker(null);
    setQuery("");
  };

  return (
    <View style={s.container}>
      <View style={s.searchBar}>
        <Search size={14} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search coffees to add..."
          placeholderTextColor={colors.textMuted}
          style={s.input}
        />
        {query ? (
          <Pressable onPress={() => { setQuery(""); setShelfPicker(null); }}>
            <X size={14} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {results.length > 0 && (
        <View style={s.results}>
          {results.map((p: any) => (
            <View key={p.product_id} style={s.resultRow}>
              {p.image_url ? (
                <Image source={{ uri: p.image_url }} style={s.thumb} contentFit="cover" />
              ) : (
                <View style={[s.thumb, { backgroundColor: colors.tagBg }]} />
              )}
              <View style={s.resultInfo}>
                <Text style={s.resultName} numberOfLines={1}>{p.coffee_name}</Text>
                <Text style={s.resultRoaster} numberOfLines={1}>{p.roaster_name}</Text>
              </View>

              {shelfPicker === p.product_id ? (
                <View style={s.shelfOptions}>
                  {SHELF_KEYS.map(key => (
                    <Pressable key={key} onPress={() => handleAdd(p.product_id, key)} style={s.shelfOption}>
                      <View style={[s.shelfDot, { backgroundColor: SHELF_LABELS[key].color }]} />
                      <Text style={s.shelfLabel}>{SHELF_LABELS[key].label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Pressable onPress={() => setShelfPicker(p.product_id)} style={s.addBtn}>
                  <Plus size={14} color={colors.textPrimary} />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { marginBottom: 16 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.cardFront,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  input: { flex: 1, fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.textPrimary },
  results: {
    marginTop: 4,
    backgroundColor: colors.cardFront,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: "hidden",
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
  },
  thumb: { width: 36, height: 36, borderRadius: 4 },
  resultInfo: { flex: 1, minWidth: 0 },
  resultName: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.textPrimary },
  resultRoaster: { fontFamily: fonts.bodyRegular, fontSize: 11, color: colors.textMuted },
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.tagBg,
    alignItems: "center",
    justifyContent: "center",
  },
  shelfOptions: { flexDirection: "row", gap: 6 },
  shelfOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.tagBg,
  },
  shelfDot: { width: 6, height: 6, borderRadius: 3 },
  shelfLabel: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.textPrimary },
});
