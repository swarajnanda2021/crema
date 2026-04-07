import { useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView } from "react-native";
import { ChevronDown, ChevronUp, Send } from "lucide-react-native";
import { colors } from "../theme/colors";

const DRINK_STYLES = ["black","espresso","americano","lungo","cortado","macchiato","cappuccino","flat-white","latte","mocha","cold-brew","iced-latte","filter-coffee","pour-over"];
const BREW_METHODS = ["pour-over","french-press","aeropress","espresso-machine","moka-pot","cold-brew","siphon","turkish","drip-machine","chemex","south-indian-filter","instant"];
const MILK_TYPES = ["none","whole","skim","oat","almond","soy","cashew","coconut"];
const GRIND_SIZES = ["extra-fine","fine","medium-fine","medium","medium-coarse","coarse"];

interface Props {
  productId: string;
  onSubmit: (note: any) => Promise<void>;
}

export default function TastingNoteForm({ productId, onSubmit }: Props) {
  const [comment, setComment] = useState("");
  const [drinkStyle, setDrinkStyle] = useState("");
  const [brewMethod, setBrewMethod] = useState("");
  const [milkType, setMilkType] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [doseGrams, setDoseGrams] = useState("");
  const [yieldGrams, setYieldGrams] = useState("");
  const [waterTemp, setWaterTemp] = useState("");
  const [extractionTime, setExtractionTime] = useState("");
  const [grindSize, setGrindSize] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!comment.trim() && !drinkStyle) return;
    setSubmitting(true);
    try {
      await onSubmit({
        product_id: productId,
        comment: comment.trim() || undefined,
        drink_style: drinkStyle || undefined,
        brew_method: brewMethod || undefined,
        milk_type: milkType || undefined,
        dose_grams: doseGrams ? parseFloat(doseGrams) : undefined,
        yield_grams: yieldGrams ? parseFloat(yieldGrams) : undefined,
        water_temp_celsius: waterTemp ? parseFloat(waterTemp) : undefined,
        extraction_time_seconds: extractionTime ? parseInt(extractionTime) : undefined,
        grind_size: grindSize || undefined,
      });
      setComment("");
      setDrinkStyle("");
      setBrewMethod("");
      setMilkType("");
      setDoseGrams("");
      setYieldGrams("");
      setWaterTemp("");
      setExtractionTime("");
      setGrindSize("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="rounded-xl p-4" style={{ backgroundColor: colors.cardFront, borderWidth: 1, borderColor: colors.border }}>
      {/* Comment */}
      <TextInput
        placeholder="How was this coffee?"
        placeholderTextColor={colors.unavailable}
        value={comment}
        onChangeText={setComment}
        multiline
        className="text-sm mb-3 min-h-[60px]"
        style={{ color: colors.textPrimary }}
      />

      {/* Quick selectors row */}
      <View className="flex-row flex-wrap gap-2 mb-3">
        <DropdownChips label="Style" options={DRINK_STYLES} selected={drinkStyle} onSelect={setDrinkStyle} />
        <DropdownChips label="Brew" options={BREW_METHODS} selected={brewMethod} onSelect={setBrewMethod} />
        <DropdownChips label="Milk" options={MILK_TYPES} selected={milkType} onSelect={setMilkType} />
      </View>

      {/* Advanced toggle */}
      <Pressable onPress={() => setShowAdvanced(!showAdvanced)} className="flex-row items-center gap-1 mb-2">
        <Text className="text-xs font-medium" style={{ color: colors.accent }}>
          {showAdvanced ? "Hide advanced" : "Show advanced"}
        </Text>
        {showAdvanced ? <ChevronUp size={14} color={colors.accent} /> : <ChevronDown size={14} color={colors.accent} />}
      </Pressable>

      {showAdvanced && (
        <View className="gap-2 mb-3">
          <View className="flex-row gap-2">
            <NumberInput label="Dose (g)" value={doseGrams} onChange={setDoseGrams} />
            <NumberInput label="Yield (g)" value={yieldGrams} onChange={setYieldGrams} />
          </View>
          <View className="flex-row gap-2">
            <NumberInput label="Temp (\u00B0C)" value={waterTemp} onChange={setWaterTemp} />
            <NumberInput label="Time (s)" value={extractionTime} onChange={setExtractionTime} />
          </View>
          <DropdownChips label="Grind" options={GRIND_SIZES} selected={grindSize} onSelect={setGrindSize} />
        </View>
      )}

      {/* Submit */}
      <Pressable
        onPress={handleSubmit}
        disabled={submitting}
        className="flex-row items-center justify-center gap-2 py-2.5 rounded-lg"
        style={{ backgroundColor: submitting ? colors.unavailable : colors.accent }}
      >
        <Send size={16} color="white" />
        <Text className="text-sm font-semibold" style={{ color: "white" }}>
          {submitting ? "Saving..." : "Add Note"}
        </Text>
      </Pressable>
    </View>
  );
}

function DropdownChips({ label, options, selected, onSelect }: { label: string; options: string[]; selected: string; onSelect: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable onPress={() => setOpen(!open)} className="px-3 py-1.5 rounded-full flex-row items-center gap-1" style={{ backgroundColor: selected ? colors.accent : colors.tagBg }}>
        <Text className="text-xs font-medium" style={{ color: selected ? "white" : colors.tagText }}>
          {selected ? selected.replace(/-/g, " ") : label}
        </Text>
        <ChevronDown size={12} color={selected ? "white" : colors.tagText} />
      </Pressable>
      {open && (
        <ScrollView className="absolute top-8 left-0 rounded-lg shadow-lg z-50 max-h-40" style={{ backgroundColor: colors.cardFront, borderWidth: 1, borderColor: colors.border, width: 160 }}>
          <Pressable onPress={() => { onSelect(""); setOpen(false); }} className="px-3 py-2">
            <Text className="text-xs" style={{ color: colors.textSecondary }}>Clear</Text>
          </Pressable>
          {options.map((o) => (
            <Pressable key={o} onPress={() => { onSelect(o); setOpen(false); }} className="px-3 py-2">
              <Text className="text-xs capitalize" style={{ color: o === selected ? colors.accent : colors.textPrimary }}>
                {o.replace(/-/g, " ")}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View className="flex-1">
      <Text className="text-[10px] uppercase mb-1" style={{ color: colors.textSecondary }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        className="rounded-lg px-3 py-2 text-sm"
        style={{ backgroundColor: colors.bg, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border }}
      />
    </View>
  );
}
