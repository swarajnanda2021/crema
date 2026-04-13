import { View, Text, StyleSheet } from "react-native";
import { ReactNode } from "react";
import { colors, fonts } from "../tokens/useTokens";

interface MetaRowProps {
  icon: ReactNode;
  label: string;
  value: string;
  muted?: boolean;
}

export default function MetaRow({ icon, label, value, muted = false }: MetaRowProps) {
  return (
    <View style={s.container}>
      <View style={s.iconWrap}>{icon}</View>
      <View style={s.content}>
        <Text style={s.label}>{label}</Text>
        <Text style={[s.value, muted && s.valueMuted]}>{value}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  iconWrap: { marginTop: 2, opacity: 0.6 },
  content: { flex: 1 },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    opacity: 0.5,
    color: colors.textOnDark,
  },
  value: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    lineHeight: 17,
    color: colors.textOnDark,
    marginTop: 1,
  },
  valueMuted: { opacity: 0.35, fontStyle: "italic" },
});
