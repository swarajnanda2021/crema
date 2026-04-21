/**
 * EditableCoffeeCard — inline bean-creation form for roaster owner.
 *
 * Slides in from right over a placeholder "+ Add" card.
 * Image area with drag-to-reposition, all product fields, URL modal.
 * Uses design tokens — no hardcoded colors.
 */

import { useState, useCallback, useRef } from "react";
import {
  View, Text, Pressable, TextInput, Modal, StyleSheet,
  Platform, Animated, Easing, ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import Svg, { Circle, Path } from "react-native-svg";
import { Camera, X } from "lucide-react-native";

import { resolveUploadUrl } from "../../api/client";
import { t } from "../../tokens/useTokens";
import ImageUploadModal from "../ImageUploadModal";
import { CartIcon } from "../icons/FigmaIcons";

const IMAGE_RATIO = 160 / 372;

const liningNumerals = Platform.OS === "web"
  ? ({ fontFeatureSettings: "'lnum', 'pnum'" } as any)
  : ({ fontVariant: ["lining-nums", "proportional-nums"] } as any);

interface EditableCoffeeCardProps {
  roasterName: string;
  width: number;
  height: number;
  onSave: (data: any) => Promise<void>;
  /** §2.9 — when set, the component starts directly in "editing"
   *  mode pre-filled with these fields, and onCancel is expected
   *  to close the surrounding modal rather than revert to the
   *  placeholder. The parent decides whether `onSave` POSTs (new
   *  product) or PUTs (existing product). */
  initialData?: any;
  /** §2.9 — cancel callback for edit mode. Only used when
   *  `initialData` is present; the placeholder-creation flow still
   *  uses its own internal slide-out. */
  onCancel?: () => void;
}

export default function EditableCoffeeCard({
  roasterName, width, height, onSave, initialData, onCancel,
}: EditableCoffeeCardProps) {
  // When `initialData` is provided we're in edit-an-existing-bean
  // mode and the placeholder step is skipped entirely. Otherwise the
  // original placeholder → editing flow runs.
  const startMode: "placeholder" | "editing" = initialData ? "editing" : "placeholder";
  const [mode, setMode] = useState<"placeholder" | "editing">(startMode);

  // Field states — pre-filled from initialData when editing.
  const [coffeeName, setCoffeeName] = useState(initialData?.coffee_name || "");
  const [beanType, setBeanType] = useState(initialData?.bean_type || "");
  const [processVal, setProcessVal] = useState(initialData?.process || "");
  const [roastLevel, setRoastLevel] = useState(initialData?.roast_level || "");
  const [tastingNotes, setTastingNotes] = useState(initialData?.tasting_notes || "");
  const [flavorNotes, setFlavorNotes] = useState(initialData?.flavor_notes || "");
  const [origin, setOrigin] = useState(initialData?.origin || "");
  const [varietal, setVarietal] = useState(initialData?.varietal || "");
  const [altitudeMasl, setAltitudeMasl] = useState(
    initialData?.altitude_masl != null ? String(initialData.altitude_masl) : "",
  );
  const [priceInr, setPriceInr] = useState(
    initialData?.price_inr != null ? String(initialData.price_inr) : "",
  );
  const [weightGrams, setWeightGrams] = useState(
    initialData?.weight_grams != null ? String(initialData.weight_grams) : "",
  );
  const [productUrl, setProductUrl] = useState(initialData?.product_url || "");
  const [showUrlInput, setShowUrlInput] = useState(false);
  // Wholesale availability (§2.2) — a single checkbox. Minimum-kg +
  // note fields were dropped: roasters only need to declare "yes,
  // wholesale is on the table for this bean" — the rest (quantity,
  // price, terms) gets negotiated inline on the inquiry thread where
  // the café can ask and the roaster can answer with context. This
  // kept the form from feeling like a procurement SKU editor.
  const [wholesaleAvailable, setWholesaleAvailable] = useState(
    initialData?.wholesale_available === 1,
  );
  const [imageUrl, setImageUrl] = useState(initialData?.image_url || "");
  const [cropY, setCropY] = useState(
    initialData?.image_crop_y != null ? initialData.image_crop_y : 50,
  );
  const [isDragging, setIsDragging] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const imgDragRef = useRef({ y: 0, cropY: cropY });
  const imgWrapRef = useRef<View>(null);
  // In edit-existing mode the card is already visible (no slide-in
  // animation), so start the slide at 0 instead of `width`.
  const editSlideAnim = useRef(new Animated.Value(initialData ? 0 : width)).current;
  const saveAnim = useRef(new Animated.Value(1)).current;

  const resetFields = useCallback(() => {
    setCoffeeName(""); setBeanType(""); setProcessVal(""); setRoastLevel("");
    setTastingNotes(""); setOrigin(""); setVarietal(""); setAltitudeMasl("");
    setFlavorNotes(""); setPriceInr(""); setWeightGrams(""); setProductUrl("");
    setShowUrlInput(false); setImageUrl(""); setCropY(50);
    setShowImageModal(false); setSaving(false);
    setWholesaleAvailable(false);
  }, []);

  const handleOpenEdit = useCallback(() => {
    setMode("editing");
    editSlideAnim.setValue(width);
    saveAnim.setValue(1);
    Animated.timing(editSlideAnim, {
      toValue: 0, duration: 260, useNativeDriver: true,
      easing: Easing.out(Easing.cubic),
    }).start();
  }, [editSlideAnim, width]);

  const handleCancel = useCallback(() => {
    // Edit-an-existing-bean flow: let the parent close the modal.
    // Create-new-bean flow: slide back to the placeholder.
    if (initialData && onCancel) { onCancel(); return; }
    Animated.timing(editSlideAnim, {
      toValue: width, duration: 200, useNativeDriver: true,
      easing: Easing.in(Easing.cubic),
    }).start(() => { setMode("placeholder"); resetFields(); });
  }, [editSlideAnim, width, resetFields, initialData, onCancel]);

  const handleImgDragStart = useCallback((e: any) => {
    e.preventDefault();
    imgDragRef.current = { y: e.clientY, cropY };
    setIsDragging(true);
    const handleMove = (ev: MouseEvent) => {
      const el = imgWrapRef.current as unknown as HTMLElement;
      if (!el) return;
      const h = el.getBoundingClientRect().height;
      const delta = ((ev.clientY - imgDragRef.current.y) / h) * 100;
      setCropY(Math.max(0, Math.min(100, imgDragRef.current.cropY - delta)));
    };
    const handleUp = () => {
      setIsDragging(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [cropY]);

  const handleSave = useCallback(async () => {
    if (!coffeeName.trim() || saving) return;
    const data = {
      coffee_name: coffeeName.trim(),
      bean_type: beanType.trim() || null,
      process: processVal.trim() || null,
      roast_level: roastLevel.trim() || null,
      tasting_notes: tastingNotes.trim() || null,
      origin: origin.trim() || null,
      varietal: varietal.trim() || null,
      altitude_masl: altitudeMasl ? parseInt(altitudeMasl) : null,
      flavor_notes: flavorNotes.trim() || null,
      price_inr: priceInr ? parseFloat(priceInr) : null,
      weight_grams: weightGrams ? parseInt(weightGrams) : null,
      product_url: productUrl.trim() || null,
      image_url: imageUrl || null,
      description_raw: null,
      // Wholesale availability — just the flag. The backend still
      // accepts wholesale_minimum_kg + wholesale_note (they're in the
      // schema for legacy rows), but the roaster-facing form stops
      // capturing them; null-through both.
      wholesale_available: wholesaleAvailable ? 1 : 0,
      wholesale_minimum_kg: null,
      wholesale_note: null,
    };
    // Edit-an-existing flow: skip the slide-out-to-placeholder
    // animation entirely — the parent closes the hosting modal on
    // save, and animating the card's opacity to 0 here leaves a
    // visible "blank card" frame if the parent hasn't unmounted yet
    // (that was the blank-on-tick bug). Just save and hand back.
    if (initialData) {
      setSaving(true);
      try { await onSave(data); } finally { setSaving(false); }
      return;
    }
    Animated.sequence([
      Animated.timing(saveAnim, { toValue: 1.03, duration: 120, useNativeDriver: true }),
      Animated.timing(saveAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(async () => {
      setSaving(true);
      await onSave(data);
      setSaving(false);
      setMode("placeholder");
      resetFields();
      editSlideAnim.setValue(width);
      saveAnim.setValue(1);
    });
  }, [coffeeName, beanType, processVal, roastLevel, tastingNotes, origin, varietal,
    altitudeMasl, flavorNotes, priceInr, weightGrams, productUrl, imageUrl,
    wholesaleAvailable, initialData,
    saving, onSave, width, resetFields]);

  const imageH = Math.round(height * IMAGE_RATIO);
  const infoH = height - imageH;
  const canSave = coffeeName.trim().length > 0;
  const BTN_SZ = 31;

  return (
    <View style={[s.outerWrap, { width, height }]}>
      {/* Placeholder (new-product creation flow only; hidden when
          editing an existing bean since the card is already in-form). */}
      {!initialData && (
        <Pressable onPress={handleOpenEdit} style={[s.placeholder, { width, height }]}>
          <Svg width={44} height={44} viewBox="0 0 44 44" fill="none">
            <Circle cx={22} cy={22} r={22} fill={t.color["card.info"]} />
            <Path d="M22 12V32M12 22H32" stroke={t.color["text.primary"]} strokeWidth={2} strokeLinecap="round" />
          </Svg>
        </Pressable>
      )}

      {/* Edit form — slides in from right */}
      {mode === "editing" && (
        <Animated.View style={[s.editCard, { width, height, opacity: saveAnim, transform: [{ translateX: editSlideAnim }, { scale: saveAnim }] }]}>
          {/* Image area */}
          <View
            ref={imgWrapRef as any}
            style={[s.imageArea, { height: imageH },
              imageUrl && isDragging && { cursor: "grabbing" } as any,
              imageUrl && !isDragging && { cursor: "grab" } as any,
            ]}
            {...(imageUrl && Platform.OS === "web" ? { onMouseDown: handleImgDragStart } : {})}
          >
            {imageUrl ? (
              <>
                <Image source={{ uri: resolveUploadUrl(imageUrl) }} style={StyleSheet.absoluteFillObject} contentFit="cover" contentPosition={{ top: `${cropY}%`, left: "50%" }} />
                {!isDragging && (
                  <View style={s.imgHint} pointerEvents="none">
                    <Text style={s.imgHintText}>Drag to reposition</Text>
                  </View>
                )}
                <Pressable onPress={() => setShowImageModal(true)} style={s.changePhotoBtn}>
                  <Camera size={12} color={t.color["text.on-dark"]} strokeWidth={1.5} />
                  <Text style={s.changePhotoBtnText}>Change photo</Text>
                </Pressable>
              </>
            ) : (
              <Pressable onPress={() => setShowImageModal(true)} style={s.imagePlaceholder}>
                <Camera size={28} color={t.color["text.secondary"]} strokeWidth={1.2} />
                <Text style={s.addPhotoText}>Add Photo</Text>
              </Pressable>
            )}

            {/* Reject — top-left */}
            <Pressable onPress={handleCancel} style={s.rejectBtn} hitSlop={8}>
              <Svg width={29.16} height={29.16} viewBox="0 0 29.16 29.16" fill="none">
                <Circle cx={14.58} cy={14.58} r={14.58} fill={t.color["text.primary"]} />
                <Path d="M10.58 10.58L18.58 18.58M18.58 10.58L10.58 18.58" stroke={t.color["text.on-dark"]} strokeWidth={1.5} strokeLinecap="round" />
              </Svg>
            </Pressable>

            {/* Accept — top-right */}
            <Pressable onPress={handleSave} style={s.acceptBtn} disabled={!canSave || saving} hitSlop={8}>
              {saving
                ? <View style={s.acceptLoading}><ActivityIndicator size="small" color={t.color["text.primary"]} /></View>
                : <Svg width={29} height={29} viewBox="0 0 29.16 29.16" fill="none">
                    <Circle cx={14.58} cy={14.58} r={14.58} fill={t.color.accent} />
                    <Path d="M9 15L13 19L21 11" stroke={t.color["text.primary"]} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
              }
            </Pressable>
          </View>

          {/* Info area */}
          <View style={[s.infoArea, { minHeight: infoH, flex: 1 }]}>
            <TextInput style={s.nameInput} value={coffeeName} onChangeText={setCoffeeName} placeholder="Add Coffee Name" placeholderTextColor={t.color["text.primary"]} multiline />
            <View style={s.roasterRow}>
              <Text style={s.byLine}>By {roasterName}</Text>
            </View>
            <View style={s.divider} />
            <View style={s.fieldRow}>
              <TextInput style={s.fieldRowInput} value={beanType} onChangeText={setBeanType} placeholder="Add Bean Type" placeholderTextColor={t.color["text.secondary"]} />
            </View>
            <View style={s.divider} />
            {/* Process / Roast row. The dot separator here mirrors
               CoffeeLabel's "{process} Process • {roast} Roast" format
               so the editable version aligns with how the card reads
               once saved. Rendering label + input pairs in one row
               rather than three separate text nodes kept the dot from
               floating mid-row. */}
            <View style={s.fieldRow}>
              <View style={s.processRoastPair}>
                <Text style={s.fieldLabel}>Process </Text>
                <TextInput style={s.fieldRowInput} value={processVal} onChangeText={setProcessVal} placeholder="" placeholderTextColor={t.color["text.secondary"]} />
              </View>
              <Text style={s.dotSep}>•</Text>
              <View style={s.processRoastPair}>
                <Text style={s.fieldLabel}>Roast </Text>
                <TextInput style={s.fieldRowInput} value={roastLevel} onChangeText={setRoastLevel} placeholder="" placeholderTextColor={t.color["text.secondary"]} />
              </View>
            </View>
            <View style={s.divider} />
            <View style={s.fieldRow}>
              <TextInput style={s.fieldRowInput} value={tastingNotes} onChangeText={setTastingNotes} placeholder="Add Tasting Notes" placeholderTextColor={t.color["text.secondary"]} />
            </View>
            <View style={s.divider} />
            {/* Price / weight row. Placeholders use literal Unicode
               (— and ₹) because Expo Web's TextInput occasionally
               renders escape-sequence strings ("\u2013\u2013") as
               the raw escape instead of the glyph, which surfaced as
               "\u201" showing in the field. */}
            <View style={s.bottomRow}>
              <View style={s.priceWeightRow}>
                <Text style={s.rupee}>₹ </Text>
                <TextInput style={s.priceInput} value={priceInr} onChangeText={setPriceInr} placeholder="————" placeholderTextColor={t.color["text.primary"]} keyboardType="numeric" />
                <View style={s.weightGroup}>
                  <Text style={s.weightText}>/  </Text>
                  <TextInput style={s.weightInput} value={weightGrams} onChangeText={setWeightGrams} placeholder="———" placeholderTextColor={t.color["text.primary"]} keyboardType="numeric" />
                  <Text style={s.weightText}>  g</Text>
                </View>
              </View>
              <Pressable onPress={() => setShowUrlInput(true)}>
                <CartIcon size={BTN_SZ} />
              </Pressable>
            </View>

            {/* Wholesale flag (§2.2). One row, one checkbox. Tapping
               toggles wholesale_available; there are no further fields
               to expand. Café viewers see a Package chip on the card
               for flagged beans, and negotiate min-kg / price inline
               in the inquiry thread. */}
            <View style={s.divider} />
            <Pressable onPress={() => setWholesaleAvailable((v) => !v)} style={s.wholesaleToggleRow}>
              <View style={[s.wholesaleCheckbox, wholesaleAvailable && s.wholesaleCheckboxOn]}>
                {wholesaleAvailable && <Text style={s.wholesaleCheck}>✓</Text>}
              </View>
              <Text style={s.wholesaleLabel}>Available wholesale</Text>
            </Pressable>
          </View>

          {/* URL modal */}
          <Modal visible={showUrlInput} transparent animationType="fade" onRequestClose={() => setShowUrlInput(false)}>
            <View style={s.urlModalOverlay}>
              <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setShowUrlInput(false)} />
              <View style={s.urlModalCard}>
                <View style={s.urlModalHeader}>
                  <Text style={s.urlModalTitle}>Product URL</Text>
                  <Pressable onPress={() => setShowUrlInput(false)} hitSlop={8}><X size={14} color={t.color["text.muted"]} /></Pressable>
                </View>
                <TextInput style={s.urlModalInput} value={productUrl} onChangeText={setProductUrl} placeholder="https://..." placeholderTextColor={t.color.divider} autoCapitalize="none" autoFocus />
                <Pressable onPress={() => setShowUrlInput(false)} style={s.urlModalDone}>
                  <Text style={s.urlModalDoneText}>Done</Text>
                </Pressable>
              </View>
            </View>
          </Modal>

          <ImageUploadModal
            visible={showImageModal}
            title="Add bean photo"
            purpose="hero"
            currentUrl={imageUrl}
            onConfirm={(url) => { setImageUrl(url); setShowImageModal(false); }}
            onClose={() => setShowImageModal(false)}
          />
        </Animated.View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  outerWrap: { borderRadius: 5, overflow: "hidden", position: "relative" },
  placeholder: {
    position: "absolute", top: 0, left: 0,
    backgroundColor: t.color.bg, borderWidth: 1.5, borderColor: t.color.divider,
    borderRadius: 5, alignItems: "center", justifyContent: "center",
  },
  editCard: {
    position: "absolute", top: 0, left: 0,
    backgroundColor: t.color["card.info"],
    borderTopLeftRadius: 3.624, borderTopRightRadius: 3.624,
    borderBottomLeftRadius: 5, borderBottomRightRadius: 5,
  },
  imageArea: {
    backgroundColor: "#d4c5b8",
    borderTopLeftRadius: 3.624, borderTopRightRadius: 3.624, overflow: "hidden",
  },
  imagePlaceholder: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#e8e0d0",
  },
  addPhotoText: { fontFamily: t.font["body.regular"], fontSize: 10.246, color: t.color["text.secondary"] },
  imgHint: { position: "absolute", bottom: 8, left: 0, right: 0, alignItems: "center" },
  imgHintText: {
    fontFamily: t.font["body.regular"], fontSize: 10, color: "rgba(255,255,255,0.75)",
    backgroundColor: "rgba(0,0,0,0.25)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4,
  },
  changePhotoBtn: {
    position: "absolute", bottom: 8, right: 8, flexDirection: "row", alignItems: "center",
    gap: 4, backgroundColor: "rgba(0,0,0,0.4)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4,
  },
  changePhotoBtnText: { fontFamily: t.font["body.medium"], fontSize: 10, color: t.color["text.on-dark"] },
  rejectBtn: { position: "absolute", top: 10, left: 12, zIndex: 10 },
  acceptBtn: { position: "absolute", top: 10, right: 12, zIndex: 10 },
  acceptLoading: {
    width: 29, height: 29, borderRadius: 14.5,
    backgroundColor: t.color.accent, alignItems: "center", justifyContent: "center",
  },
  infoArea: {
    paddingHorizontal: 15, paddingTop: 12, paddingBottom: 12,
    backgroundColor: t.color["card.info"],
    borderBottomLeftRadius: 5, borderBottomRightRadius: 5,
  },
  nameInput: {
    fontFamily: t.font.display, fontSize: 21.376, color: t.color["text.primary"],
    lineHeight: 25, padding: 0, margin: 0, borderWidth: 0,
    ...(Platform.OS === "web" ? { outlineStyle: "none", ...liningNumerals } : {}),
  } as any,
  roasterRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  byLine: { fontFamily: t.font["body.regular"], fontSize: 10.9, color: t.color["text.secondary"] },
  divider: { height: 1, backgroundColor: t.color.divider, marginTop: 6.5, marginBottom: 6.5 },
  fieldRow: { flexDirection: "row", alignItems: "center", height: 12 },
  fieldLabel: { fontFamily: t.font["body.regular"], fontSize: 9.563, color: t.color["text.secondary"] },
  fieldRowInput: {
    fontFamily: t.font["body.regular"], fontSize: 9.563, color: t.color["text.secondary"],
    padding: 0, margin: 0, borderWidth: 0, flex: 1, height: 12,
    ...(Platform.OS === "web" ? { outlineStyle: "none", ...liningNumerals } : {}),
  } as any,
  dot: {
    fontFamily: t.font["body.regular"], fontSize: 9.563, color: t.color["text.secondary"],
    lineHeight: 12, ...liningNumerals,
  } as any,
  // Each Process/Roast label+input is its own flex unit so the dot
  // separator sits cleanly between them instead of floating in the
  // middle of the row because of flex: 1 fights.
  processRoastPair: { flexDirection: "row", alignItems: "center", flex: 1 } as any,
  dotSep: {
    fontFamily: t.font["body.regular"], fontSize: 9.563,
    color: t.color["text.secondary"], lineHeight: 12,
    paddingHorizontal: 4,
  } as any,

  // Wholesale availability section (§2.2). Row shows a small
  // checkbox + label; tapping reveals the flag/min/note panel.
  wholesaleToggleRow: {
    flexDirection: "row", alignItems: "center", gap: 7,
    paddingVertical: 2,
  } as any,
  wholesaleCheckbox: {
    width: 12, height: 12, borderRadius: 2, borderWidth: 1,
    borderColor: t.color["text.secondary"],
    alignItems: "center", justifyContent: "center",
  } as any,
  wholesaleCheckboxOn: {
    backgroundColor: t.color["text.primary"],
    borderColor: t.color["text.primary"],
  } as any,
  wholesaleCheck: {
    fontFamily: t.font["body.semibold"], fontSize: 8,
    color: t.color["text.on-dark"], lineHeight: 10,
  } as any,
  wholesaleLabel: {
    fontFamily: t.font["body.regular"], fontSize: 9.563,
    color: t.color["text.secondary"],
  } as any,
  bottomRow: {
    flexDirection: "row", alignItems: "flex-end",
    justifyContent: "space-between", marginTop: "auto" as any,
  },
  priceWeightRow: { flexDirection: "row", alignItems: "baseline" },
  rupee: {
    fontFamily: t.font.display, fontSize: 17.077, color: t.color["text.primary"],
    lineHeight: 26, height: 26, ...liningNumerals,
  } as any,
  priceInput: {
    fontFamily: t.font.display, fontSize: 17.077, color: t.color["text.primary"],
    lineHeight: 26, height: 26, width: 44,
    padding: 0, margin: 0, borderWidth: 0,
    ...(Platform.OS === "web" ? { outlineStyle: "none", ...liningNumerals } : {}),
  } as any,
  weightGroup: { flexDirection: "row", alignItems: "baseline" },
  weightText: {
    fontFamily: t.font["body.regular"], fontSize: 9.563, color: t.color["text.primary"],
    ...liningNumerals,
  } as any,
  weightInput: {
    fontFamily: t.font["body.regular"], fontSize: 9.563, color: t.color["text.primary"],
    height: 14, width: 22, padding: 0, margin: 0, borderWidth: 0,
    ...(Platform.OS === "web" ? { outlineStyle: "none", ...liningNumerals } : {}),
  } as any,
  urlModalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  urlModalCard: {
    width: 320, backgroundColor: t.color.bg, borderRadius: 8, padding: 20,
  },
  urlModalHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 12,
  },
  urlModalTitle: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.primary"] },
  urlModalInput: {
    borderWidth: 1, borderColor: t.color.border, borderRadius: 4,
    paddingHorizontal: 10, paddingVertical: 8,
    fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.primary"],
    backgroundColor: "#FEFDFB",
  } as any,
  urlModalDone: {
    marginTop: 12, alignSelf: "flex-end" as any,
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 4, backgroundColor: t.color["text.primary"],
  },
  urlModalDoneText: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.on-dark"] },
});
