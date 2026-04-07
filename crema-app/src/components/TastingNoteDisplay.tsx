import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react-native";
import { colors } from "../theme/colors";
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
  const hasBrew = note.dose_grams || note.yield_grams || note.water_volume_ml || note.grind_size || note.brew_ratio;
  const hasAttributes = note.acidity || note.body || note.sweetness || note.aftertaste;

  return (
    <View className="rounded-xl p-4 mb-3" style={{ backgroundColor: colors.cardFront, borderWidth: 1, borderColor: colors.border }}>
      {/* Comment */}
      {note.comment && (
        <Text className="text-sm leading-relaxed mb-2" style={{ color: colors.textPrimary }}>
          {note.comment}
        </Text>
      )}

      {/* Drink line */}
      {(note.drink_style || note.brew_method) && (
        <Text className="text-xs mb-2" style={{ color: colors.textSecondary }}>
          {note.drink_style && <Text className="capitalize">{note.drink_style.replace(/-/g, " ")}</Text>}
          {note.drink_style && note.brew_method && " via "}
          {note.brew_method && <Text className="capitalize">{note.brew_method.replace(/-/g, " ")}</Text>}
          {note.milk_type && note.milk_type !== "none" && ` with ${note.milk_type} milk`}
        </Text>
      )}

      {/* Flavor tags */}
      {note.flavor_tags && note.flavor_tags.length > 0 && (
        <View className="flex-row flex-wrap gap-1 mb-2">
          {(typeof note.flavor_tags === "string" ? JSON.parse(note.flavor_tags) : note.flavor_tags).map((tag: string) => (
            <Chip key={tag}>{tag.replace(/-/g, " ")}</Chip>
          ))}
        </View>
      )}

      {/* Brew details toggle */}
      {(hasBrew || hasAttributes) && (
        <Pressable onPress={() => setShowBrew(!showBrew)} className="flex-row items-center gap-1 mt-1">
          <Text className="text-xs font-medium" style={{ color: colors.accent }}>
            {showBrew ? "Hide brew details" : "Show brew details"}
          </Text>
          {showBrew ? <ChevronUp size={14} color={colors.accent} /> : <ChevronDown size={14} color={colors.accent} />}
        </Pressable>
      )}

      {showBrew && (
        <View className="mt-2 pt-2 border-t" style={{ borderColor: colors.border }}>
          {/* Recipe grid */}
          <View className="flex-row flex-wrap gap-x-4 gap-y-1">
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
            <View className="mt-2 gap-1">
              {note.acidity && <AttributeBar label="Acidity" value={note.acidity} />}
              {note.body && <AttributeBar label="Body" value={note.body} />}
              {note.sweetness && <AttributeBar label="Sweetness" value={note.sweetness} />}
              {note.aftertaste && <AttributeBar label="Aftertaste" value={note.aftertaste} />}
            </View>
          )}
        </View>
      )}

      {/* Date + actions */}
      <View className="flex-row items-center justify-between mt-2 pt-2 border-t" style={{ borderColor: colors.border }}>
        <Text className="text-xs" style={{ color: colors.textSecondary }}>
          {note.created_at ? formatDate(note.created_at) : ""}
        </Text>
        {isOwner && (
          <View className="flex-row gap-3">
            {onEdit && (
              <Pressable onPress={onEdit}><Pencil size={14} color={colors.textSecondary} /></Pressable>
            )}
            {onDelete && (
              <Pressable onPress={onDelete}><Trash2 size={14} color={colors.like} /></Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-[10px] uppercase opacity-50" style={{ color: colors.textSecondary }}>{label}</Text>
      <Text className="text-xs font-medium" style={{ color: colors.textPrimary }}>{value}</Text>
    </View>
  );
}

function AttributeBar({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-row items-center gap-2">
      <Text className="text-[10px] w-16" style={{ color: colors.textSecondary }}>{label}</Text>
      <View className="flex-1 flex-row gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <View key={i} className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: i <= value ? colors.accent : colors.border }} />
        ))}
      </View>
      <Text className="text-[10px] w-3 text-right" style={{ color: colors.textSecondary }}>{value}</Text>
    </View>
  );
}
