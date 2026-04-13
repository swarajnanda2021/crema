import { useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from "react-native";
import { ChevronDown, ChevronUp, Send } from "lucide-react-native";
import { t } from "../tokens/useTokens";

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
    <View style={styles.card}>
      {/* Comment */}
      <TextInput
        placeholder="How was this coffee?"
        placeholderTextColor={t.color.unavailable}
        value={comment}
        onChangeText={setComment}
        multiline
        style={styles.commentInput}
      />

      {/* Quick selectors row */}
      <View style={styles.selectorsRow}>
        <DropdownChips label="Style" options={DRINK_STYLES} selected={drinkStyle} onSelect={setDrinkStyle} />
        <DropdownChips label="Brew" options={BREW_METHODS} selected={brewMethod} onSelect={setBrewMethod} />
        <DropdownChips label="Milk" options={MILK_TYPES} selected={milkType} onSelect={setMilkType} />
      </View>

      {/* Advanced toggle */}
      <Pressable onPress={() => setShowAdvanced(!showAdvanced)} style={styles.advancedToggle}>
        <Text style={styles.advancedText}>
          {showAdvanced ? "Hide advanced" : "Show advanced"}
        </Text>
        {showAdvanced ? <ChevronUp size={14} color={t.color["accent.cta"]} /> : <ChevronDown size={14} color={t.color["accent.cta"]} />}
      </Pressable>

      {showAdvanced && (
        <View style={styles.advancedSection}>
          <View style={styles.inputRow}>
            <NumberInput label="Dose (g)" value={doseGrams} onChange={setDoseGrams} />
            <NumberInput label="Yield (g)" value={yieldGrams} onChange={setYieldGrams} />
          </View>
          <View style={styles.inputRow}>
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
        style={[styles.submitBtn, { backgroundColor: submitting ? t.color.unavailable : t.color["accent.cta"] }]}
      >
        <Send size={16} color="white" />
        <Text style={styles.submitText}>
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
      <Pressable
        onPress={() => setOpen(!open)}
        style={[dropStyles.chip, { backgroundColor: selected ? t.color["accent.cta"] : t.color["tag.bg"] }]}
      >
        <Text style={[dropStyles.chipText, { color: selected ? "white" : t.color["tag.text"] }]}>
          {selected ? selected.replace(/-/g, " ") : label}
        </Text>
        <ChevronDown size={12} color={selected ? "white" : t.color["tag.text"]} />
      </Pressable>
      {open && (
        <ScrollView style={dropStyles.dropdown}>
          <Pressable onPress={() => { onSelect(""); setOpen(false); }} style={dropStyles.option}>
            <Text style={dropStyles.optionTextClear}>Clear</Text>
          </Pressable>
          {options.map((o) => (
            <Pressable key={o} onPress={() => { onSelect(o); setOpen(false); }} style={dropStyles.option}>
              <Text style={[dropStyles.optionText, { color: o === selected ? t.color["accent.cta"] : t.color["text.primary"] }]}>
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
    <View style={{ flex: 1 }}>
      <Text style={numStyles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        style={numStyles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 16,
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color.border,
  },
  commentInput: {
    fontFamily: t.font["body.regular"],
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 12,
    minHeight: 60,
    color: t.color["text.primary"],
  },
  selectorsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 8,
  },
  advancedText: {
    fontSize: 12,
    fontWeight: "500",
    color: t.color["accent.cta"],
  },
  advancedSection: {
    gap: 8,
    marginBottom: 12,
  },
  inputRow: {
    flexDirection: "row",
    gap: 8,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    borderRadius: 8,
  },
  submitText: {
    fontSize: 14,
    fontWeight: "600",
    color: "white",
  },
});

const dropStyles = StyleSheet.create({
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9999,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "500",
  },
  dropdown: {
    position: "absolute",
    top: 32,
    left: 0,
    borderRadius: 8,
    zIndex: 50,
    maxHeight: 160,
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color.border,
    width: 160,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  optionTextClear: {
    fontSize: 12,
    color: t.color["text.secondary"],
  },
  optionText: {
    fontSize: 12,
    textTransform: "capitalize",
  },
});

const numStyles = StyleSheet.create({
  label: {
    fontSize: 10,
    textTransform: "uppercase",
    marginBottom: 4,
    color: t.color["text.secondary"],
  },
  input: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: t.color.bg,
    color: t.color["text.primary"],
    borderWidth: 1,
    borderColor: t.color.border,
  },
});
