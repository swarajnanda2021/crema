import { useState } from "react";
import { View, Text, TextInput, Pressable, Modal, StyleSheet, ScrollView } from "react-native";
import { X } from "lucide-react-native";
import { colors, fonts } from "../theme/colors";

interface Props {
  visible: boolean;
  user: any;
  onSave: (data: any) => Promise<void>;
  onClose: () => void;
}

const PREFS = [
  { value: "light", label: "Light Roast" },
  { value: "medium", label: "Medium Roast" },
  { value: "dark", label: "Dark Roast" },
];
const STYLES = [
  { value: "espresso", label: "Espresso" },
  { value: "filter", label: "Filter" },
  { value: "both", label: "Both" },
];

export default function ProfileEditModal({ visible, user, onSave, onClose }: Props) {
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [location, setLocation] = useState(user?.location || "");
  const [favDrink, setFavDrink] = useState(user?.favorite_drink || "");
  const [favCafe, setFavCafe] = useState(user?.favorite_cafe || "");
  const [pref, setPref] = useState(user?.coffee_preference || "");
  const [style, setStyle] = useState(user?.brewing_style || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        display_name: displayName || undefined,
        bio: bio || undefined,
        location: location || undefined,
        favorite_drink: favDrink || undefined,
        favorite_cafe: favCafe || undefined,
        coffee_preference: pref || undefined,
        brewing_style: style || undefined,
      });
      onClose();
    } catch {} finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.modal}>
          <View style={s.header}>
            <Text style={s.title}>Edit Profile</Text>
            <Pressable onPress={onClose} style={s.closeBtn}>
              <X size={18} color={colors.textPrimary} />
            </Pressable>
          </View>

          <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
            <Text style={s.label}>Display Name</Text>
            <TextInput style={s.input} value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={colors.textMuted} />

            <Text style={s.label}>Bio</Text>
            <TextInput style={[s.input, s.textArea]} value={bio} onChangeText={setBio} placeholder="Tell us about yourself..." placeholderTextColor={colors.textMuted} multiline numberOfLines={3} />

            <Text style={s.label}>Location</Text>
            <TextInput style={s.input} value={location} onChangeText={setLocation} placeholder="City, Country" placeholderTextColor={colors.textMuted} />

            <Text style={s.label}>Favorite Drink</Text>
            <TextInput style={s.input} value={favDrink} onChangeText={setFavDrink} placeholder="e.g., Cortado" placeholderTextColor={colors.textMuted} />

            <Text style={s.label}>Favorite Cafe</Text>
            <TextInput style={s.input} value={favCafe} onChangeText={setFavCafe} placeholder="e.g., Blue Tokai, Bangalore" placeholderTextColor={colors.textMuted} />

            <Text style={s.label}>Coffee Preference</Text>
            <View style={s.chipRow}>
              {PREFS.map(p => (
                <Pressable key={p.value} onPress={() => setPref(pref === p.value ? "" : p.value)} style={[s.chip, pref === p.value && s.chipActive]}>
                  <Text style={[s.chipText, pref === p.value && s.chipTextActive]}>{p.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.label}>Brewing Style</Text>
            <View style={s.chipRow}>
              {STYLES.map(st => (
                <Pressable key={st.value} onPress={() => setStyle(style === st.value ? "" : st.value)} style={[s.chip, style === st.value && s.chipActive]}>
                  <Text style={[s.chipText, style === st.value && s.chipTextActive]}>{st.label}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          <Pressable onPress={handleSave} disabled={saving} style={[s.saveBtn, saving && { opacity: 0.5 }]}>
            <Text style={s.saveBtnText}>{saving ? "Saving..." : "Save Changes"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modal: {
    width: "100%",
    maxWidth: 480,
    maxHeight: "80%",
    backgroundColor: colors.cardFront,
    borderRadius: 16,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    borderBottomWidth: 1,
    borderColor: colors.divider,
  },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 18, color: colors.textPrimary },
  closeBtn: { padding: 4 },
  body: { padding: 20 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.textPrimary, marginBottom: 6, marginTop: 16 },
  input: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.tagBg,
  },
  chipActive: { backgroundColor: colors.textPrimary },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.textSecondary },
  chipTextActive: { color: colors.textOnDark },
  saveBtn: {
    margin: 20,
    marginTop: 8,
    backgroundColor: colors.textPrimary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.textOnDark },
});
