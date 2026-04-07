import { View, Text, StyleSheet } from "react-native";
import { colors } from "../theme/colors";

export default function Chip({ children }: { children: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
    backgroundColor: colors.tagBg,
  },
  text: {
    fontSize: 12,
    color: colors.tagText,
  },
});
