import { View, Text } from "react-native";

export default function Chip({ children }: { children: string }) {
  return (
    <View className="px-2 py-0.5 rounded-full bg-tag-bg">
      <Text className="text-xs text-tag-text">{children}</Text>
    </View>
  );
}
