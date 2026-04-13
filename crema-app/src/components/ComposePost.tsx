/**
 * ComposePost — unified in-place compose with dry-run preview.
 *
 * Auto-detects mode from user input:
 *   - Paste a URL → article mode (link preview, no images)
 *   - Add images/tasting note → note mode (no link preview)
 *   - Repost (repostTarget) → repost mode (compact preview of original)
 *
 * Renders like a real post card: user avatar, name, "Just now", editable body,
 * link preview or image grid below, location field, submit bar.
 */

import { useState, useEffect, useRef } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView, Modal,
  StyleSheet, ActivityIndicator, Platform,
} from "react-native";
import { Image } from "expo-image";
import { Camera, Plus, X } from "lucide-react-native";

import { apiFetch, apiFetchRaw, resolveUploadUrl } from "../api/client";
import { fonts } from "../tokens/useTokens";
import { PostLocationPinIcon } from "./icons/FigmaIcons";
import ImageUploadModal from "./ImageUploadModal";
import TastingNoteCard from "./TastingNoteCard";
import PostGallery, { GALLERY_ASPECT, PG_RADIUS } from "./PostGallery";

interface ComposePostProps {
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
  repostTarget?: any;
  products?: any[];
  user?: { username: string; display_name?: string; avatar_url?: string } | null;
  initialData?: { body?: string; images?: string[]; location?: string };
}

const URL_REGEX = /https?:\/\/[^\s]+/;

function timeAgo(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return "just now";
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d`;
    return new Date(dateStr).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  } catch { return ""; }
}

export default function ComposePost({
  onSubmit,
  onCancel,
  loading = false,
  repostTarget,
  products,
  user,
  initialData,
}: ComposePostProps) {
  const isRepost = !!repostTarget;
  const isEditing = !!initialData;

  // Core state
  const [teaser, setTeaser] = useState(initialData?.body || "");
  const [location, setLocation] = useState(initialData?.location || "");

  // Auto-detected mode
  const [detectedUrl, setDetectedUrl] = useState("");
  const [linkPreview, setLinkPreview] = useState<{ title: string; description: string; image_url: string; domain: string } | null>(null);
  const [linkTitle, setLinkTitle] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const debounceRef = useRef<any>(null);

  // Images / tasting notes
  const [imageUrls, setImageUrls] = useState<string[]>(initialData?.images || []);
  const [showImgUpload, setShowImgUpload] = useState(false);
  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [addCardTab, setAddCardTab] = useState<"image" | "tasting_note">("image");
  const [editGridW, setEditGridW] = useState(0);

  // Tasting note selector
  const [tnSearch, setTnSearch] = useState("");
  const [tnSelectedCoffee, setTnSelectedCoffee] = useState<any>(null);
  const [tnScores, setTnScores] = useState({ acidity: 3, body: 3, sweetness: 3, aftertaste: 3 });

  const isTN = (s: string) => s.startsWith('{"type":') && s.includes('"tasting_note"');
  const hasImages = imageUrls.length > 0;
  const hasUrl = !!detectedUrl;
  const isArticleMode = hasUrl && !hasImages;
  const canAddImage = !isArticleMode && imageUrls.length < 6;

  // Edit grid sizing
  const EDIT_COLS = 3;
  const EDIT_GAP = 8;
  const editThumbW = editGridW > 0 ? Math.floor((editGridW - EDIT_GAP * (EDIT_COLS - 1)) / EDIT_COLS) : 100;
  const editThumbH = Math.floor(editThumbW * GALLERY_ASPECT);

  // Auto-detect URL in teaser text
  useEffect(() => {
    if (isRepost || hasImages) { setDetectedUrl(""); return; }
    const match = teaser.match(URL_REGEX);
    setDetectedUrl(match ? match[0] : "");
  }, [teaser, hasImages, isRepost]);

  // Fetch link preview when URL detected
  useEffect(() => {
    if (!detectedUrl) { setLinkPreview(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLinkLoading(true);
      try {
        const data = await apiFetchRaw(`/link-preview?url=${encodeURIComponent(detectedUrl)}`);
        setLinkPreview(data);
        if (data.title && !linkTitle) setLinkTitle(data.title);
      } catch { setLinkPreview(null); }
      finally { setLinkLoading(false); }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [detectedUrl]);

  // Adding an image clears link detection
  const handleAddImage = (url: string) => {
    setImageUrls((p) => [...p, url]);
    setDetectedUrl("");
    setLinkPreview(null);
    setLinkTitle("");
  };

  // Validation
  const canSubmit = (() => {
    if (loading) return false;
    if (isRepost) return true;
    if (!teaser.trim() || teaser.trim().length > 300) return false;
    return true;
  })();

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (isRepost) {
      await onSubmit({
        title: "Repost",
        teaser: teaser.trim() || "Reposted",
        post_type: "repost",
        repost_of_id: repostTarget.id,
        repost_comment: teaser.trim() || null,
      });
      return;
    }
    if (isArticleMode) {
      await onSubmit({
        title: linkTitle.trim() || detectedUrl.slice(0, 60),
        teaser: teaser.trim(),
        external_url: detectedUrl,
        cover_image_url: linkPreview?.image_url || null,
        post_type: "article",
      });
    } else {
      const imgs = imageUrls.filter(Boolean);
      await onSubmit({
        title: teaser.trim().slice(0, 60) || "Note",
        teaser: teaser.trim(),
        post_type: "note",
        location: location.trim() || null,
        images: imgs,
        cover_image_url: imgs[0] || null,
      });
    }
  };

  const displayName = user?.display_name || user?.username || "You";
  const avatarUrl = user?.avatar_url;

  return (
    <View style={s.card}>
      {/* ── Post preview header (dry run) ── */}
      <View style={s.header}>
        <View>
          {avatarUrl ? (
            <Image source={{ uri: resolveUploadUrl(avatarUrl) }} style={s.avatar} contentFit="cover" />
          ) : (
            <View style={[s.avatar, s.avatarFallback]}>
              <Text style={s.avatarLetter}>{displayName[0].toUpperCase()}</Text>
            </View>
          )}
        </View>
        <View style={s.headerMeta}>
          <View style={s.nameRow}>
            <Text style={s.authorName}>{displayName}</Text>
            <Text style={s.timestamp}>Just now</Text>
          </View>
          <Text style={s.subtitle}>
            {isRepost ? "Reposting" : isArticleMode ? "Sharing a link" : "Writing a note"}
          </Text>
        </View>
        <Pressable onPress={onCancel} hitSlop={8}>
          <X size={18} color="#A09580" />
        </Pressable>
      </View>

      {/* ── Editable teaser (same font as final post body) ── */}
      <TextInput
        style={s.teaserInput}
        value={teaser}
        onChangeText={setTeaser}
        placeholder={isRepost ? "Add your thoughts..." : "What's on your mind? Paste a link to share an article."}
        placeholderTextColor="#A09580"
        multiline
        maxLength={300}
      />
      <Text style={s.charCount}>{teaser.length}/300</Text>

      {/* ── ARTICLE MODE: link preview with title overlay ── */}
      {isArticleMode && (
        <View style={s.linkSection}>
          {linkLoading && <ActivityIndicator size="small" color="#D798DA" style={{ marginVertical: 12 }} />}
          {linkPreview && (
            <View style={s.previewCard}>
              {linkPreview.image_url ? (
                <View style={s.previewThumbWrap}>
                  <Image source={{ uri: linkPreview.image_url }} style={s.previewThumbImg} contentFit="cover" />
                  <View style={s.previewOverlay}>
                    <TextInput
                      style={s.previewTitle}
                      value={linkTitle}
                      onChangeText={setLinkTitle}
                      placeholder="Title"
                      placeholderTextColor="rgba(250,248,240,0.5)"
                    />
                    <Text style={s.previewDomain}>{linkPreview.domain}</Text>
                  </View>
                </View>
              ) : (
                <View style={s.previewNoImg}>
                  <TextInput
                    style={[s.previewTitle, { color: "#351101" }]}
                    value={linkTitle}
                    onChangeText={setLinkTitle}
                    placeholder="Title"
                    placeholderTextColor="#A09580"
                  />
                  <Text style={[s.previewDomain, { color: "#A09580" }]}>{linkPreview.domain}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}

      {/* ── NOTE MODE: image/tasting-note grid + location ── */}
      {!isRepost && !isArticleMode && (
        <View style={s.noteSection}>
          {/* Image grid */}
          <View style={s.imageGrid} onLayout={(e) => setEditGridW(e.nativeEvent.layout.width)}>
            {imageUrls.map((entry, idx) => (
              <View key={idx} style={[s.imageThumb, { width: editThumbW, height: editThumbH }]}>
                {isTN(entry) ? (
                  <TastingNoteCard {...JSON.parse(entry)} width={editThumbW} height={editThumbH} />
                ) : (
                  <Image source={{ uri: resolveUploadUrl(entry) }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                )}
                <Pressable onPress={() => setImageUrls((p) => p.filter((_, i) => i !== idx))} style={s.imageRemove}>
                  <X size={12} color="#FAF8F0" strokeWidth={2.5} />
                </Pressable>
              </View>
            ))}
            {canAddImage && (
              <Pressable onPress={() => { setAddCardTab("image"); setShowAddCardModal(true); }} style={[s.imageAdd, { width: editThumbW, height: editThumbH }]}>
                <Plus size={20} color="#A09580" strokeWidth={1.5} />
                <Text style={s.imageAddLabel}>Add Card</Text>
              </Pressable>
            )}
          </View>

          {/* Location */}
          <View style={s.locationRow}>
            <PostLocationPinIcon size={12} color="#D798DA" />
            <TextInput
              style={s.locationInput}
              value={location}
              onChangeText={setLocation}
              placeholder="Location (optional)"
              placeholderTextColor="#A09580"
            />
          </View>

          {/* Image upload modal */}
          <ImageUploadModal
            visible={showImgUpload}
            title="Add image"
            purpose="post"
            currentUrl=""
            onConfirm={(u) => { handleAddImage(u); setShowImgUpload(false); }}
            onClose={() => setShowImgUpload(false)}
          />

          {/* Add Card tabs modal */}
          <Modal visible={showAddCardModal} transparent animationType="fade" onRequestClose={() => setShowAddCardModal(false)}>
            <Pressable style={s.addCardOverlay} onPress={() => setShowAddCardModal(false)}>
              <Pressable style={s.addCardModal} onPress={(e) => e.stopPropagation()}>
                <View style={s.addCardHeader}>
                  <Text style={s.addCardTitle}>Add Card</Text>
                  <Pressable onPress={() => setShowAddCardModal(false)} hitSlop={8}><X size={18} color="#351101" /></Pressable>
                </View>
                <View style={s.addCardTabs}>
                  <Pressable onPress={() => setAddCardTab("image")} style={[s.addCardTab, addCardTab === "image" && s.addCardTabActive]}>
                    <Text style={[s.addCardTabText, addCardTab === "image" && s.addCardTabTextActive]}>Image</Text>
                  </Pressable>
                  <Pressable onPress={() => setAddCardTab("tasting_note")} style={[s.addCardTab, addCardTab === "tasting_note" && s.addCardTabActive]}>
                    <Text style={[s.addCardTabText, addCardTab === "tasting_note" && s.addCardTabTextActive]}>Tasting Note</Text>
                  </Pressable>
                </View>
                {addCardTab === "image" ? (
                  <Pressable onPress={() => { setShowAddCardModal(false); setShowImgUpload(true); }} style={s.addCardImageBtn}>
                    <Camera size={24} color="#684F44" strokeWidth={1.2} />
                    <Text style={s.addCardImageBtnText}>Upload or paste an image</Text>
                  </Pressable>
                ) : (
                  <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                    <TextInput style={s.tnSearch} value={tnSearch} onChangeText={setTnSearch} placeholder="Search for a coffee..." placeholderTextColor="#A09580" />
                    {!tnSelectedCoffee && tnSearch.length > 1 && (products || [])
                      .filter((p: any) => p.coffee_name?.toLowerCase().includes(tnSearch.toLowerCase()))
                      .slice(0, 6)
                      .map((p: any) => (
                        <Pressable key={p.product_id} onPress={() => { setTnSelectedCoffee(p); setTnSearch(p.coffee_name); }} style={s.tnResultRow}>
                          <Text style={s.tnResultName} numberOfLines={1}>{p.coffee_name}</Text>
                          <Text style={s.tnResultRoaster} numberOfLines={1}>{p.roaster_name}</Text>
                        </Pressable>
                      ))}
                    {tnSelectedCoffee && (
                      <View style={{ marginTop: 12 }}>
                        <Text style={s.tnSelectedName} numberOfLines={1}>{tnSelectedCoffee.coffee_name}</Text>
                        <Text style={s.tnSelectedRoaster}>By {tnSelectedCoffee.roaster_name}</Text>
                        {(["acidity", "body", "sweetness", "aftertaste"] as const).map((field) => (
                          <View key={field} style={s.tnScoreRow}>
                            <Text style={s.tnScoreLabel}>{field.charAt(0).toUpperCase() + field.slice(1)}</Text>
                            <View style={s.tnScoreDots}>
                              {[1, 2, 3, 4, 5].map((v) => (
                                <Pressable key={v} onPress={() => setTnScores((p) => ({ ...p, [field]: v }))} style={[s.tnDot, tnScores[field] === v && s.tnDotActive]}>
                                  <Text style={[s.tnDotText, tnScores[field] === v && s.tnDotTextActive]}>{v}</Text>
                                </Pressable>
                              ))}
                            </View>
                          </View>
                        ))}
                        <Pressable
                          onPress={() => {
                            const noteData = JSON.stringify({ type: "tasting_note", coffee_name: tnSelectedCoffee.coffee_name, roaster_name: tnSelectedCoffee.roaster_name, roast_level: tnSelectedCoffee.roast_level, process: tnSelectedCoffee.process, product_url: tnSelectedCoffee.product_url, ...tnScores });
                            setImageUrls((p) => { const f = p.filter((e) => !isTN(e)); return [noteData, ...f]; });
                            setShowAddCardModal(false); setTnSelectedCoffee(null); setTnSearch("");
                          }}
                          style={s.tnConfirmBtn}
                        >
                          <Text style={s.tnConfirmText}>Add Tasting Note</Text>
                        </Pressable>
                      </View>
                    )}
                  </ScrollView>
                )}
              </Pressable>
            </Pressable>
          </Modal>
        </View>
      )}

      {/* ── REPOST PREVIEW ── */}
      {isRepost && repostTarget && (
        <View style={s.repostPreview}>
          <View style={s.repostPreviewHeader}>
            {repostTarget.author_avatar_url ? (
              <Image source={{ uri: resolveUploadUrl(repostTarget.author_avatar_url) }} style={s.repostAvatar} contentFit="cover" />
            ) : (
              <View style={[s.repostAvatar, s.repostAvatarFallback]}>
                <Text style={s.repostAvatarLetter}>{(repostTarget.author_display_name || "?")[0].toUpperCase()}</Text>
              </View>
            )}
            <Text style={s.repostAuthor} numberOfLines={1}>{repostTarget.author_display_name}</Text>
            <Text style={s.repostTime}>{timeAgo(repostTarget.published_at)}</Text>
          </View>
          <Text style={s.repostTeaser} numberOfLines={3}>{repostTarget.teaser}</Text>
          {repostTarget.images?.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <PostGallery images={repostTarget.images} />
            </View>
          )}
        </View>
      )}

      {/* ── Submit bar ── */}
      <View style={s.submitRow}>
        <Pressable onPress={onCancel} style={s.cancelBtn}><Text style={s.cancelText}>Cancel</Text></Pressable>
        <Pressable onPress={handleSubmit} style={[s.submitBtn, !canSubmit && s.submitBtnDisabled]} disabled={!canSubmit}>
          {loading ? <ActivityIndicator size="small" color="#FAF8F0" /> : <Text style={s.submitText}>{isEditing ? "Save" : isRepost ? "Repost" : "Post"}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: "#FAF8F0", paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
  // Dry-run post header
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 14 } as any,
  avatar: { width: 30, height: 30, borderRadius: 15, overflow: "hidden" } as any,
  avatarFallback: { backgroundColor: "#351101", alignItems: "center", justifyContent: "center" } as any,
  avatarLetter: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: "#FAF8F0" },
  headerMeta: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "baseline", gap: 5 } as any,
  authorName: { fontFamily: fonts.bodyMedium, fontSize: 11.8, color: "#351101" },
  timestamp: { fontFamily: fonts.bodyMedium, fontSize: 10, color: "#A09580" },
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 10, color: "#684F44", marginTop: 2 },
  // Teaser
  teaserInput: { fontFamily: fonts.bodyRegular, fontSize: 16.8, color: "#351101", lineHeight: 23.5, minHeight: 48, textAlignVertical: "top" } as any,
  charCount: { fontFamily: fonts.bodyRegular, fontSize: 10, color: "#A09580", textAlign: "right", marginTop: 2, marginBottom: 8 } as any,
  // Link preview (article mode)
  linkSection: { marginBottom: 8 },
  previewCard: { borderRadius: 8, overflow: "hidden", backgroundColor: "#EFE9DB" } as any,
  previewThumbWrap: { position: "relative", height: 200 } as any,
  previewThumbImg: { width: "100%" as any, height: "100%" as any },
  previewOverlay: { position: "absolute", bottom: 10, left: 10, backgroundColor: "#FFF", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, maxWidth: "80%" } as any,
  previewTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: "#351101", lineHeight: 19, marginBottom: 2 },
  previewDomain: { fontFamily: fonts.bodyRegular, fontSize: 11, color: "#A09580" },
  previewNoImg: { padding: 14 },
  // Note mode
  noteSection: { marginBottom: 8 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, marginBottom: 4 } as any,
  locationInput: { fontFamily: fonts.bodyRegular, fontSize: 13, color: "#351101", flex: 1 },
  imageGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 } as any,
  imageThumb: { borderRadius: PG_RADIUS, overflow: "hidden", position: "relative" } as any,
  imageRemove: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" } as any,
  imageAdd: { borderRadius: PG_RADIUS, borderWidth: 1.5, borderColor: "#C7BAA5", borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 6 } as any,
  imageAddLabel: { fontFamily: fonts.bodyMedium, fontSize: 10, color: "#A09580" },
  // Add Card modal
  addCardOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" } as any,
  addCardModal: { backgroundColor: "#FAF8F0", borderRadius: 12, width: "90%", maxWidth: 420, maxHeight: "80%", padding: 20 } as any,
  addCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } as any,
  addCardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: "#351101" },
  addCardTabs: { flexDirection: "row", gap: 8, marginBottom: 16 } as any,
  addCardTab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 4, borderWidth: 1, borderColor: "#D7D1C4", backgroundColor: "#FEFDFB" },
  addCardTabActive: { borderColor: "#351101", backgroundColor: "#351101" },
  addCardTabText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: "#684F44" },
  addCardTabTextActive: { color: "#FAF8F0" },
  addCardImageBtn: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 40, borderRadius: 8, borderWidth: 1.5, borderColor: "#C7BAA5", borderStyle: "dashed" } as any,
  addCardImageBtnText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#684F44" },
  // Tasting note selector
  tnSearch: { fontFamily: fonts.bodyRegular, fontSize: 14, color: "#351101", borderRadius: 6, borderWidth: 1, borderColor: "#D7D1C4", paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff" },
  tnResultRow: { paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(215,209,196,0.4)" },
  tnResultName: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#351101" },
  tnResultRoaster: { fontFamily: fonts.bodyRegular, fontSize: 11, color: "#684F44", marginTop: 2 },
  tnSelectedName: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: "#351101" },
  tnSelectedRoaster: { fontFamily: fonts.bodyRegular, fontSize: 12, color: "#684F44", marginBottom: 12 },
  tnScoreRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 } as any,
  tnScoreLabel: { fontFamily: fonts.bodyMedium, fontSize: 13, color: "#351101", width: 80 },
  tnScoreDots: { flexDirection: "row", gap: 8 } as any,
  tnDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(215,209,196,0.4)", alignItems: "center", justifyContent: "center" } as any,
  tnDotActive: { backgroundColor: "#D798DA" },
  tnDotText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#684F44" },
  tnDotTextActive: { color: "#351101" },
  tnConfirmBtn: { marginTop: 16, paddingVertical: 12, borderRadius: 6, backgroundColor: "#351101", alignItems: "center" } as any,
  tnConfirmText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: "#FAF8F0" },
  // Repost preview
  repostPreview: { borderWidth: 1, borderColor: "#D7D1C4", borderRadius: 8, padding: 12, marginBottom: 12 },
  repostPreviewHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 } as any,
  repostAvatar: { width: 20, height: 20, borderRadius: 10, overflow: "hidden" } as any,
  repostAvatarFallback: { backgroundColor: "#351101", alignItems: "center", justifyContent: "center" } as any,
  repostAvatarLetter: { fontFamily: fonts.bodySemiBold, fontSize: 8, color: "#FAF8F0" },
  repostAuthor: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#351101", flex: 1 },
  repostTime: { fontFamily: fonts.bodyRegular, fontSize: 10, color: "#A09580" },
  repostTeaser: { fontFamily: fonts.bodyRegular, fontSize: 13, color: "#684F44", lineHeight: 18, marginBottom: 6 },
  repostThumb: { width: 60, height: 60, borderRadius: 4, marginTop: 4 },
  // Submit bar
  submitRow: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 4 } as any,
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 8 },
  cancelText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: "#A09580" },
  submitBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 4, backgroundColor: "#351101" },
  submitBtnDisabled: { opacity: 0.4 },
  submitText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: "#FAF8F0" },
});
