import { View, Text, StyleSheet } from "react-native";
import { colors, fonts } from "../theme/colors";

interface ChipProps {
  children: string;
  variant?: "default" | "accent" | "dark";
}

export default function Chip({ children, variant = "default" }: ChipProps) {
  const bg = variant === "accent" ? colors.accentSoft : variant === "dark" ? "rgba(255,255,255,0.12)" : colors.tagBg;
  const fg = variant === "accent" ? colors.accent : variant === "dark" ? colors.textOnDark : colors.tagText;

  return (
    <View style={[s.chip, { backgroundColor: bg }]}>
      <Text style={[s.text, { color: fg }]}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  text: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
