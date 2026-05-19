import { View, Text, StyleSheet } from "react-native";
import { t, makeStyles } from "../tokens/useTokens";

interface ChipProps {
  children: string;
  variant?: "default" | "accent";
}

export default function Chip({ children, variant = "default" }: ChipProps) {
  const bg = variant === "accent" ? t.color["accent.soft"] : t.color["tag.bg"];
  const fg = variant === "accent" ? t.color["accent.cta"] : t.color["tag.text"];
  const s = useStyles();

  return (
    <View style={[s.chip, { backgroundColor: bg }]}>
      <Text style={[s.text, { color: fg }]}>{children}</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
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
}));
