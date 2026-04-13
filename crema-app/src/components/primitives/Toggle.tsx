/**
 * Toggle — generic like/follow toggle button with animated feedback.
 *
 * Wraps useToggle hook. Renders a pressable with icon + count.
 * Used for: post likes, comment likes, follow buttons.
 *
 * On iOS/Swift: SwiftUI Button with .animation(.spring()) modifier.
 */

import { useRef, useCallback } from "react";
import { Pressable, Text, Animated, StyleSheet, View } from "react-native";
import { useToggle } from "../../resources/useToggle";
import { t } from "../../tokens/useTokens";

interface ToggleProps {
  /** Resource name: "post_likes", "comment_likes", "follows" */
  resource: string;
  /** Target ID: post.id, comment.id, or roaster slug */
  targetId: string | number;
  /** Initial state from parent resource */
  initial?: boolean;
  /** Initial count from parent resource */
  count?: number;
  /** Icon when toggled ON */
  iconOn: React.ReactNode;
  /** Icon when toggled OFF */
  iconOff: React.ReactNode;
  /** Show count next to icon (default: true) */
  showCount?: boolean;
  /** Custom style for the pressable */
  style?: any;
  /** Font size for count text */
  countSize?: number;
}

export default function Toggle({
  resource, targetId, initial, count: initialCount,
  iconOn, iconOff, showCount = true, style, countSize = 13,
}: ToggleProps) {
  const { toggled, count, toggle } = useToggle(resource, targetId, {
    initial, count: initialCount,
  });

  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
    Animated.sequence([
      Animated.spring(scaleAnim, { toValue: 1.3, friction: 3, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 5, useNativeDriver: true }),
    ]).start();
    toggle();
  }, [toggle, scaleAnim]);

  return (
    <Pressable onPress={handlePress} style={[s.btn, style]}>
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        {toggled ? iconOn : iconOff}
      </Animated.View>
      {showCount && count > 0 && (
        <Text style={[s.count, countSize !== 13 && { fontSize: countSize }, toggled && { color: t.color.accent }]}>
          {count}
        </Text>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 5 } as any,
  count: { fontFamily: t.font["body.medium"], fontSize: 11.8, color: t.color["text.primary"] },
});
