import { View, Text, StyleSheet } from "react-native";
import { ReactNode } from "react";
import { colors } from "../theme/colors";

interface MetaRowProps {
  icon: ReactNode;
  label: string;
  value: string;
  muted?: boolean;
}

export default function MetaRow({ icon, label, value, muted = false }: MetaRowProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>{icon}</View>
      <View style={styles.content}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, muted && styles.valueMuted]}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  iconWrap: {
    marginTop: 2,
    opacity: 0.6,
  },
  content: {
    flex: 1,
  },
  label: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    opacity: 0.5,
    fontWeight: "600",
    color: colors.textOnDark,
  },
  value: {
    fontSize: 14,
    color: colors.textOnDark,
  },
  valueMuted: {
    opacity: 0.4,
    fontStyle: "italic",
  },
});
