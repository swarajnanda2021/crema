/**
 * FlavorBodyStrip — horizontal mouthfeel-chip filter that AND-stacks
 * with the flavor wheel selection.
 *
 * Five single-select chips: Smooth · Bold · Crisp · Creamy · Mellow.
 * Each chip displays its own count for the in-stock catalog so the
 * user sees the bucket size *before* tapping (kills the "0 coffees"
 * surprise the multi-tier wheel caused). Tap a chip to filter; tap
 * the same chip again to clear; tap a different chip to switch.
 *
 * Body terms are intentionally *not* configurable through the schema
 * manager — they live in code as a stable five-word vocabulary that
 * matches what consumers say in plain language. If the body axis ever
 * becomes a Phase-2 surface, it gets its own admin schema then.
 */
import { StyleSheet, View, Text, ScrollView } from "react-native";
import HapticPressable from "./primitives/HapticPressable";
import { t, makeStyles } from "../tokens/useTokens";

export type BodySelection = string | null;

export type BodyChip = {
  name: string;
  absorbs: string[]; // lowercase tag tokens this chip captures
};

/** The five canonical body chips. Order is also display order
 *  (left → right). `absorbs` lists are tight; Haiku doesn't enrich
 *  them — these are exact-match tag-strings, lower-cased. */
export const BODY_CHIPS: readonly BodyChip[] = [
  { name: "Smooth", absorbs: ["smooth", "silky", "velvety", "smooth body"] },
  { name: "Bold",   absorbs: ["bold", "rich", "intense", "full-bodied", "full body", "full bodied", "robust", "strong body", "deep"] },
  { name: "Crisp",  absorbs: ["crisp", "bright", "clean", "brisk"] },
  { name: "Creamy", absorbs: ["creamy", "buttery", "syrupy"] },
  { name: "Mellow", absorbs: ["mellow", "balanced", "mild"] },
];

interface Props {
  selected: BodySelection;
  onSelectedChange: (next: BodySelection) => void;
  /** Map from chip name → count of in-stock coffees that absorb. Pass
   *  an empty object to render chips with no count badges. */
  counts: Record<string, number>;
}

export default function FlavorBodyStrip({ selected, onSelectedChange, counts }: Props) {
  const s = useStyles();
  return (
    <View style={s.wrap}>
      <Text style={s.label}>How does it feel?</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.row}
      >
        {BODY_CHIPS.map((chip) => {
          const isPicked = chip.name === selected;
          const count = counts[chip.name] ?? 0;
          return (
            <HapticPressable
              key={chip.name}
              haptic="select"
              onPress={() => onSelectedChange(isPicked ? null : chip.name)}
              hitSlop={6}
              style={[s.chip, isPicked ? s.chipPicked : s.chipIdle]}
              accessibilityRole="button"
              accessibilityLabel={`${chip.name}, ${count} coffees`}
            >
              <Text style={[s.chipName, isPicked && s.chipNameOnDark]}>
                {chip.name}
              </Text>
              <Text style={[s.chipCount, isPicked && s.chipCountOnDark]}>
                {count}
              </Text>
            </HapticPressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  label: {
    fontFamily: t.font["body.semibold"],
    fontSize: 11,
    color: t.color["text.muted"],
    letterSpacing: 0.6,
    textTransform: "uppercase" as any,
    marginBottom: 6,
  },
  row: {
    gap: 8,
    paddingVertical: 4,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.25,
    borderColor: t.color["text.primary"],
  },
  chipIdle: {
    backgroundColor: t.color.bg,
  },
  chipPicked: {
    backgroundColor: t.color.accent,
  },
  chipName: {
    fontFamily: t.font["body.semibold"],
    fontSize: 13,
    color: t.color["text.primary"],
  },
  chipNameOnDark: {
    color: t.color["text.on-cta"],
  },
  chipCount: {
    fontFamily: t.font["body.regular"],
    fontSize: 11,
    color: t.color["text.muted"],
    fontVariant: ["tabular-nums"],
  },
  chipCountOnDark: {
    color: t.color["text.on-cta"],
    opacity: 0.85,
  },
}));
