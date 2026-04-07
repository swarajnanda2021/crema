import { View, Text } from "react-native";
import { ReactNode } from "react";

interface MetaRowProps {
  icon: ReactNode;
  label: string;
  value: string;
  muted?: boolean;
}

export default function MetaRow({ icon, label, value, muted = false }: MetaRowProps) {
  return (
    <View className="flex-row items-start gap-2">
      <View className="mt-0.5 opacity-60">{icon}</View>
      <View className="flex-1">
        <Text className="text-[11px] uppercase tracking-wider opacity-50 font-semibold text-text-on-dark">
          {label}
        </Text>
        <Text className={`text-sm text-text-on-dark ${muted ? "opacity-40 italic" : ""}`}>
          {value}
        </Text>
      </View>
    </View>
  );
}
