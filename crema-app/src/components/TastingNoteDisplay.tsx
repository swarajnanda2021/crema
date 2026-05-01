import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react-native";
import { t, makeStyles } from "../tokens/useTokens";
import Chip from "./Chip";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const suffix = day === 1 || day === 21 || day === 31 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th";
  return `${day}${suffix} ${months[d.getMonth()]}, ${d.getFullYear()}`;
}

interface Props {
  note: any;
  isOwner?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

export default function TastingNoteDisplay({ note, isOwner, onEdit, onDelete }: Props) {
  const [showBrew, setShowBrew] = useState(false);
  const styles = useStyles();
  const hasBrew = note.dose_grams || note.yield_grams || note.water_volume_ml || note.grind_size || note.brew_ratio;
  const hasAttributes = note.acidity || note.body || note.sweetness || note.aftertaste;

  return (
    <View style={styles.card}>
      {/* Comment */}
      {note.comment && (
        <Text style={styles.comment}>{note.comment}</Text>
      )}

      {/* Drink line */}
      {(note.drink_style || note.brew_method) && (
        <Text style={styles.drinkLine}>
          {note.drink_style && <Text style={styles.capitalize}>{note.drink_style.replace(/-/g, " ")}</Text>}
          {note.drink_style && note.brew_method && " via "}
          {note.brew_method && <Text style={styles.capitalize}>{note.brew_method.replace(/-/g, " ")}</Text>}
          {note.milk_type && note.milk_type !== "none" && ` with ${note.milk_type} milk`}
        </Text>
      )}

      {/* Flavor tags */}
      {note.flavor_tags && note.flavor_tags.length > 0 && (
        <View style={styles.tagRow}>
          {(typeof note.flavor_tags === "string" ? JSON.parse(note.flavor_tags) : note.flavor_tags).map((tag: string) => (
            <Chip key={tag}>{tag.replace(/-/g, " ")}</Chip>
          ))}
        </View>
      )}

      {/* Brew details toggle */}
      {(hasBrew || hasAttributes) && (
        <Pressable onPress={() => setShowBrew(!showBrew)} style={styles.toggleBtn}>
          <Text style={styles.toggleText}>
            {showBrew ? "Hide brew details" : "Show brew details"}
          </Text>
          {showBrew ? <ChevronUp size={14} color={t.color["accent.cta"]} /> : <ChevronDown size={14} color={t.color["accent.cta"]} />}
        </Pressable>
      )}

      {showBrew && (
        <View style={styles.brewSection}>
          {/* Recipe grid */}
          <View style={styles.recipeGrid}>
            {note.dose_grams && <MiniStat label="Dose" value={`${note.dose_grams}g`} />}
            {note.yield_grams && <MiniStat label="Yield" value={`${note.yield_grams}g`} />}
            {note.water_volume_ml && <MiniStat label="Water" value={`${note.water_volume_ml}ml`} />}
            {note.water_temp_celsius && <MiniStat label="Temp" value={`${note.water_temp_celsius}\u00B0C`} />}
            {note.extraction_time_seconds && <MiniStat label="Time" value={`${note.extraction_time_seconds}s`} />}
            {note.grind_size && <MiniStat label="Grind" value={note.grind_size.replace(/-/g, " ")} />}
            {note.brew_ratio && <MiniStat label="Ratio" value={note.brew_ratio} />}
          </View>

          {/* Attribute bars */}
          {hasAttributes && (
            <View style={styles.attrSection}>
              {note.acidity && <AttributeBar label="Acidity" value={note.acidity} />}
              {note.body && <AttributeBar label="Body" value={note.body} />}
              {note.sweetness && <AttributeBar label="Sweetness" value={note.sweetness} />}
              {note.aftertaste && <AttributeBar label="Aftertaste" value={note.aftertaste} />}
            </View>
          )}
        </View>
      )}

      {/* Date + actions */}
      <View style={styles.footer}>
        <Text style={styles.dateText}>
          {note.created_at ? formatDate(note.created_at) : ""}
        </Text>
        {isOwner && (
          <View style={styles.footerActions}>
            {onEdit && (
              <Pressable onPress={onEdit}><Pencil size={14} color={t.color["text.secondary"]} /></Pressable>
            )}
            {onDelete && (
              <Pressable onPress={onDelete}><Trash2 size={14} color={t.color.accent} /></Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  const miniStyles = useMiniStyles();
  return (
    <View>
      <Text style={miniStyles.label}>{label}</Text>
      <Text style={miniStyles.value}>{value}</Text>
    </View>
  );
}

function AttributeBar({ label, value }: { label: string; value: number }) {
  const attrStyles = useAttrStyles();
  return (
    <View style={attrStyles.row}>
      <Text style={attrStyles.label}>{label}</Text>
      <View style={attrStyles.barContainer}>
        {[1, 2, 3, 4, 5].map((i) => (
          <View key={i} style={[attrStyles.segment, { backgroundColor: i <= value ? t.color["accent.cta"] : t.color.border }]} />
        ))}
      </View>
      <Text style={attrStyles.valueText}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
  },
  comment: {
    fontFamily: t.font["body.regular"],
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 8,
    color: t.color["text.primary"],
  },
  drinkLine: {
    fontSize: 12,
    marginBottom: 8,
    color: t.color["text.secondary"],
  },
  capitalize: {
    textTransform: "capitalize",
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginBottom: 8,
  },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: "500",
    color: t.color["accent.cta"],
  },
  brewSection: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: t.color.border,
  },
  recipeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 16,
    rowGap: 4,
  },
  attrSection: {
    marginTop: 8,
    gap: 4,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: t.color.border,
  },
  dateText: {
    fontSize: 12,
    color: t.color["text.secondary"],
  },
  footerActions: {
    flexDirection: "row",
    gap: 12,
  },
}));

const useMiniStyles = makeStyles((t) => ({
  label: {
    fontSize: 10,
    textTransform: "uppercase",
    opacity: 0.5,
    color: t.color["text.secondary"],
  },
  value: {
    fontSize: 12,
    fontWeight: "500",
    color: t.color["text.primary"],
  },
}));

const useAttrStyles = makeStyles((t) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  label: {
    fontSize: 10,
    width: 64,
    color: t.color["text.secondary"],
  },
  barContainer: {
    flex: 1,
    flexDirection: "row",
    gap: 2,
  },
  segment: {
    flex: 1,
    height: 6,
    borderRadius: 9999,
  },
  valueText: {
    fontSize: 10,
    width: 12,
    textAlign: "right",
    color: t.color["text.secondary"],
  },
}));
