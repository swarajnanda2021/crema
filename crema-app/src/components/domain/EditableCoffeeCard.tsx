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
  ? { fontFeatureSettings: "'lnum', 'pnum'" } as any
  : {};

interface EditableCoffeeCardProps {
  roasterName: string;
  width: number;
  height: number;
  onSave: (data: any) => Promise<void>;
}

export default function EditableCoffeeCard({
  roasterName, width, height, onSave,
}: EditableCoffeeCardProps) {
  const [mode, setMode] = useState<"placeholder" | "editing">("placeholder");

  // Field states
  const [coffeeName, setCoffeeName] = useState("");
  const [beanType, setBeanType] = useState("");
  const [processVal, setProcessVal] = useState("");
  const [roastLevel, setRoastLevel] = useState("");
  const [tastingNotes, setTastingNotes] = useState("");
  const [flavorNotes, setFlavorNotes] = useState("");
  const [origin, setOrigin] = useState("");
  const [varietal, setVarietal] = useState("");
  const [altitudeMasl, setAltitudeMasl] = useState("");
  const [priceInr, setPriceInr] = useState("");
  const [weightGrams, setWeightGrams] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [cropY, setCropY] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const imgDragRef = useRef({ y: 0, cropY: 50 });
  const imgWrapRef = useRef<View>(null);
  const editSlideAnim = useRef(new Animated.Value(width)).current;
  const saveAnim = useRef(new Animated.Value(1)).current;

  const resetFields = useCallback(() => {
    setCoffeeName(""); setBeanType(""); setProcessVal(""); setRoastLevel("");
    setTastingNotes(""); setOrigin(""); setVarietal(""); setAltitudeMasl("");
    setFlavorNotes(""); setPriceInr(""); setWeightGrams(""); setProductUrl("");
    setShowUrlInput(false); setImageUrl(""); setCropY(50);
    setShowImageModal(false); setSaving(false);
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
    Animated.timing(editSlideAnim, {
      toValue: width, duration: 200, useNativeDriver: true,
      easing: Easing.in(Easing.cubic),
    }).start(() => { setMode("placeholder"); resetFields(); });
  }, [editSlideAnim, width, resetFields]);

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
    };
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
    altitudeMasl, flavorNotes, priceInr, weightGrams, productUrl, imageUrl, saving, onSave, width, resetFields]);

  const imageH = Math.round(height * IMAGE_RATIO);
  const infoH = height - imageH;
  const canSave = coffeeName.trim().length > 0;
  const BTN_SZ = 31;

  return (
    <View style={[s.outerWrap, { width, height }]}>
      {/* Placeholder */}
      <Pressable onPress={handleOpenEdit} style={[s.placeholder, { width, height }]}>
        <Svg width={44} height={44} viewBox="0 0 44 44" fill="none">
          <Circle cx={22} cy={22} r={22} fill={t.color["card.info"]} />
          <Path d="M22 12V32M12 22H32" stroke={t.color["text.primary"]} strokeWidth={2} strokeLinecap="round" />
        </Svg>
      </Pressable>

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
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Process </Text>
              <TextInput style={s.fieldRowInput} value={processVal} onChangeText={setProcessVal} placeholder="" placeholderTextColor={t.color["text.secondary"]} />
              <Text style={s.dot}> {"\u2022"} </Text>
              <Text style={s.fieldLabel}>Roast </Text>
              <TextInput style={s.fieldRowInput} value={roastLevel} onChangeText={setRoastLevel} placeholder="" placeholderTextColor={t.color["text.secondary"]} />
            </View>
            <View style={s.divider} />
            <View style={s.fieldRow}>
              <TextInput style={s.fieldRowInput} value={tastingNotes} onChangeText={setTastingNotes} placeholder="Add Tasting Notes" placeholderTextColor={t.color["text.secondary"]} />
            </View>
            <View style={s.divider} />
            <View style={s.bottomRow}>
              <View style={s.priceWeightRow}>
                <Text style={s.rupee}>{"\u20B9"} </Text>
                <TextInput style={s.priceInput} value={priceInr} onChangeText={setPriceInr} placeholder="\u2013\u2013\u2013\u2013" placeholderTextColor={t.color["text.primary"]} keyboardType="numeric" />
                <View style={s.weightGroup}>
                  <Text style={s.weightText}>/  </Text>
                  <TextInput style={s.weightInput} value={weightGrams} onChangeText={setWeightGrams} placeholder="\u2013\u2013\u2013" placeholderTextColor={t.color["text.primary"]} keyboardType="numeric" />
                  <Text style={s.weightText}>  g</Text>
                </View>
              </View>
              <Pressable onPress={() => setShowUrlInput(true)}>
                <CartIcon size={BTN_SZ} />
              </Pressable>
            </View>
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
