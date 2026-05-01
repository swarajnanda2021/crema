/**
 * HiddenPostRow — collapsed stand-in for a post the viewer just hid.
 *
 * Mirrors the PostCard mobile rhythm (`backgroundColor: t.color.bg`,
 * paddingHorizontal: 16, paddingVertical: 14) so the swapped-in row
 * sits between the feed's dividers like any other card. Copy reads
 * as a quiet "post hidden" status with a prominent Undo affordance.
 *
 * Undo uses the same Canela-pink accent + body.semibold rhythm that
 * sourcing-story's "Read the full post →" toggle uses in PostCard,
 * so the feed has one consistent inline-link language.
 */
import { View, Text, Pressable, StyleSheet } from "react-native";
import { EyeOff } from "lucide-react-native";
import { t, makeStyles } from "../../tokens/useTokens";
import { tap as hapticTap } from "../../utils/haptics";

interface Props {
  onUndo: () => void;
}

export default function HiddenPostRow({ onUndo }: Props) {
  const s = useStyles();
  return (
    <View style={s.row}>
      <View style={s.leftCluster}>
        <EyeOff size={16} color={t.color["text.muted"]} strokeWidth={1.7} />
        <Text style={s.label}>Post hidden — we won&apos;t show this again.</Text>
      </View>
      <Pressable
        onPress={() => { hapticTap(); onUndo(); }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Undo hide"
      >
        <Text style={s.undo}>Undo</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    backgroundColor: t.color.bg,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  } as any,
  leftCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
  } as any,
  label: {
    flex: 1,
    fontFamily: t.font["body.regular"],
    fontSize: 14,
    color: t.color["text.secondary"],
    minWidth: 0,
  },
  undo: {
    fontFamily: t.font["body.semibold"],
    fontSize: 13,
    color: t.color.accent,
    letterSpacing: 0.3,
  } as any,
}));
