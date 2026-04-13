import { View, Text, StyleSheet } from "react-native";
import { t } from "../tokens/useTokens";

interface ChipProps {
  children: string;
  variant?: "default" | "accent" | "dark";
}

export default function Chip({ children, variant = "default" }: ChipProps) {
  const bg = variant === "accent" ? t.color["accent.soft"] : variant === "dark" ? "rgba(255,255,255,0.12)" : t.color["tag.bg"];
  const fg = variant === "accent" ? t.color["accent.cta"] : variant === "dark" ? t.color["text.on-dark"] : t.color["tag.text"];

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
    fontFamily: t.font["body.medium"],
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
