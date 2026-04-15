/**
 * CRUD Utopia — café profile page. Mirrors roaster/[slug].tsx structure:
 * split panel layout, three tabs (Bio / Coffee Menu / Posts), owner edit mode.
 * See CRUD_UTOPIA.md at repo root.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  View, Text, ScrollView, Pressable, StyleSheet, TextInput,
  ActivityIndicator, useWindowDimensions, Linking, Image as RNImage,
} from "react-native";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, MapPin, AtSign, Globe, Coffee, Camera, PenLine, Plus, Trash2 } from "lucide-react-native";
import { t } from "../../src/tokens/useTokens";
import { apiFetchRaw, resolveUploadUrl } from "../../src/api/client";
import { useAuth } from "../../src/hooks/useAuth";
import Navbar from "../../src/components/Navbar";
import ScannerModal from "../../src/components/ScannerModal";
import type { Cafe, CafeMenuItem, CafeBarista } from "../../src/resources/types";

const NAVBAR_H = 72;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_OF_WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

type TabKey = "bio" | "menu" | "posts";

export default function CafeDetailPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { width: winW } = useWindowDimensions();

  const [cafe, setCafe] = useState<Cafe | null>(null);
  const [menu, setMenu] = useState<CafeMenuItem[]>([]);
  const [baristas, setBaristas] = useState<CafeBarista[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("bio");

  // Owner state
  const isOwner = user?.account_type === "cafe" && user?.cafe_slug === slug;
  const [isEditing, setIsEditing] = useState(false);
  const [editAbout, setEditAbout] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editInstagram, setEditInstagram] = useState("");
  const [editWebsite, setEditWebsite] = useState("");
  const [showScanner, setShowScanner] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cafeRes, menuRes, baristaRes, postsRes] = await Promise.all([
        apiFetchRaw<any>(`/cafe_profiles/${slug}`),
        apiFetchRaw<any>(`/cafe_profiles/${slug}/cafe_menu_items?limit=50`).catch(() => ({ data: [] })),
        apiFetchRaw<any>(`/cafe_profiles/${slug}/cafe_baristas?limit=30`).catch(() => ({ data: [] })),
        apiFetchRaw<any>(`/posts?limit=50`).catch(() => ({ data: [] })),
      ]);
      const cafeData = cafeRes?.data ?? cafeRes;
      const menuData = menuRes?.data ?? menuRes;
      const baristaData = baristaRes?.data ?? baristaRes;
      const postsData = postsRes?.data ?? postsRes;

      setCafe(cafeData);
      setMenu(Array.isArray(menuData) ? menuData : []);
      setBaristas(Array.isArray(baristaData) ? baristaData : []);
      // Filter posts: own (post.cafe_slug == slug) or mentioning
      const ownPosts = (Array.isArray(postsData) ? postsData : []).filter((p: any) => p.cafe_slug === slug);
      setPosts(ownPosts);

      if (cafeData) {
        setEditAbout(cafeData.about_blurb || "");
        setEditAddress(cafeData.address || "");
        setEditInstagram(cafeData.instagram_handle || "");
        setEditWebsite(cafeData.website || "");
      }
    } catch (e) {
      console.warn("Café fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSave = useCallback(async () => {
    try {
      await apiFetchRaw(`/cafe_profiles/${slug}`, {
        method: "PUT",
        body: JSON.stringify({
          about_blurb: editAbout,
          address: editAddress,
          instagram_handle: editInstagram || null,
          website: editWebsite || null,
        }),
      });
      setIsEditing(false);
      await fetchAll();
    } catch (e) {
      console.warn("Café save failed:", e);
    }
  }, [slug, editAbout, editAddress, editInstagram, editWebsite, fetchAll]);

  // Seasonal status text
  const seasonalText = useMemo(() => {
    if (!cafe) return null;
    const open = cafe.seasonal_open_month;
    const close = cafe.seasonal_close_month;
    if (open == null || close == null) return "Open year-round";
    return `Open ${MONTHS[open - 1]}–${MONTHS[close - 1]} (closed ${MONTHS[close % 12]}–${MONTHS[open - 2 < 0 ? 11 : open - 2]})`;
  }, [cafe]);

  // Layout: split panel on web (>800px), stacked on mobile
  const isWide = winW >= 800;

  if (loading || !cafe) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Navbar />
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={t.color["text.primary"]} />
        </View>
      </>
    );
  }

  const heroImage = cafe.cover_image_url ? resolveUploadUrl(cafe.cover_image_url) : null;
  const heroFallback = `https://www.google.com/s2/favicons?domain=${cafe.instagram_handle || cafe.website || ""}&sz=128`;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Navbar />

      {isOwner && isEditing && (
        <View style={s.editBanner}>
          <View style={s.editBannerLeft}>
            <PenLine size={12} color={t.color.accent} />
            <Text style={s.editBannerLabel}>Editing café</Text>
          </View>
          <View style={s.editBannerRight}>
            <Pressable onPress={() => setIsEditing(false)} style={s.discardBtn}>
              <Text style={s.discardText}>Discard</Text>
            </Pressable>
            <Pressable onPress={handleSave} style={s.saveBtn}>
              <Text style={s.saveText}>Save changes</Text>
            </Pressable>
          </View>
        </View>
      )}

      <ScrollView style={s.scroll} contentContainerStyle={[s.scrollContent, isWide && s.scrollContentWide]}>
        <View style={[s.layout, isWide && s.layoutWide]}>
          {/* LEFT PANEL */}
          <View style={[s.leftPanel, isWide && s.leftPanelWide]}>
            <View style={s.heroWrap}>
              {heroImage ? (
                <Image source={{ uri: heroImage }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
              ) : (
                <View style={s.heroFallback}>
                  <Coffee size={64} color={t.color["text.muted"]} />
                </View>
              )}
            </View>

            <Pressable onPress={() => router.back()} style={s.backBtn}>
              <ArrowLeft size={16} color={t.color["text.primary"]} />
              <Text style={s.backText}>Back</Text>
            </Pressable>

            <Text style={s.cafeName}>{cafe.name}</Text>

            {isEditing ? (
              <TextInput
                style={[s.aboutText, s.inlineEdit, { minHeight: 60 }]}
                value={editAbout}
                onChangeText={setEditAbout}
                multiline
                placeholder="Tell people about your café…"
                placeholderTextColor={t.color["text.muted"]}
              />
            ) : cafe.about_blurb ? (
              <Text style={s.aboutBlurb}>{cafe.about_blurb}</Text>
            ) : null}

            {/* Seasonal badge */}
            {seasonalText && (
              <View style={s.seasonalBadge}>
                <Text style={s.seasonalText}>{seasonalText}</Text>
              </View>
            )}

            {/* Meta rows */}
            <View style={s.metaRows}>
              {(cafe.address || isEditing) && (
                <View style={s.metaRow}>
                  <MapPin size={14} color={t.color.accent} />
                  {isEditing ? (
                    <TextInput
                      style={[s.metaText, s.inlineEdit, { flex: 1 }]}
                      value={editAddress}
                      onChangeText={setEditAddress}
                      placeholder="Address"
                      placeholderTextColor={t.color["text.muted"]}
                    />
                  ) : (
                    <Pressable onPress={() => cafe.address && Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(cafe.address)}`)}>
                      <Text style={s.metaTextLink}>{cafe.address}</Text>
                    </Pressable>
                  )}
                </View>
              )}
              {(cafe.instagram_handle || isEditing) && (
                <View style={s.metaRow}>
                  <AtSign size={14} color={t.color.accent} />
                  {isEditing ? (
                    <TextInput
                      style={[s.metaText, s.inlineEdit, { flex: 1 }]}
                      value={editInstagram}
                      onChangeText={setEditInstagram}
                      placeholder="Instagram handle (no @)"
                      placeholderTextColor={t.color["text.muted"]}
                    />
                  ) : (
                    <Pressable onPress={() => Linking.openURL(`https://instagram.com/${cafe.instagram_handle}`)}>
                      <Text style={s.metaTextLink}>@{cafe.instagram_handle}</Text>
                    </Pressable>
                  )}
                </View>
              )}
              {(cafe.website || isEditing) && (
                <View style={s.metaRow}>
                  <Globe size={14} color={t.color.accent} />
                  {isEditing ? (
                    <TextInput
                      style={[s.metaText, s.inlineEdit, { flex: 1 }]}
                      value={editWebsite}
                      onChangeText={setEditWebsite}
                      placeholder="Website URL"
                      placeholderTextColor={t.color["text.muted"]}
                    />
                  ) : (
                    <Pressable onPress={() => cafe.website && Linking.openURL(cafe.website)}>
                      <Text style={s.metaTextLink}>{cafe.website?.replace(/^https?:\/\//, "")}</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>

            {/* Owner actions */}
            {isOwner && !isEditing && (
              <View style={s.ownerActions}>
                <Pressable onPress={() => setIsEditing(true)} style={s.editBtn}>
                  <PenLine size={12} color={t.color["text.primary"]} />
                  <Text style={s.editBtnText}>Edit café</Text>
                </Pressable>
                {cafe.stamps_enabled === 1 && (
                  <Pressable onPress={() => setShowScanner(true)} style={s.scanBtn}>
                    <Camera size={14} color={t.color["text.on-dark"]} />
                    <Text style={s.scanBtnText}>Scan QR</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>

          {/* RIGHT PANEL */}
          <View style={[s.rightPanel, isWide && s.rightPanelWide]}>
            {/* Tabs */}
            <View style={s.tabs}>
              {(["bio", "menu", "posts"] as TabKey[]).map((tab) => (
                <Pressable key={tab} onPress={() => setActiveTab(tab)} style={s.tabBtn}>
                  <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
                    {tab === "bio" ? "BIO" : tab === "menu" ? "COFFEE MENU" : "POSTS"}
                  </Text>
                  {activeTab === tab && <View style={s.tabUnderline} />}
                </Pressable>
              ))}
            </View>

            {/* Tab content */}
            {activeTab === "bio" && (
              <BioTab cafe={cafe} baristas={baristas} />
            )}

            {activeTab === "menu" && (
              <MenuTab cafe_slug={slug} menu={menu} isOwner={isOwner} onChange={fetchAll} />
            )}

            {activeTab === "posts" && (
              <PostsTab posts={posts} />
            )}
          </View>
        </View>
      </ScrollView>

      {showScanner && (
        <ScannerModal
          cafeSlug={slug}
          onClose={() => setShowScanner(false)}
        />
      )}
    </>
  );
}

// ── Bio Tab ────────────────────────────────────────────────────────────────

function BioTab({ cafe, baristas }: { cafe: Cafe; baristas: CafeBarista[] }) {
  const hours = cafe.hours_json;
  return (
    <View style={s.tabContent}>
      {/* Stats (only if stamps enabled) */}
      {cafe.stamps_enabled === 1 && (
        <View style={s.statsBlock}>
          <Text style={s.sectionTitle}>Stats</Text>
          <View style={s.statsRow}>
            <View style={s.statCell}>
              <Text style={s.statValue}>{cafe.stamps_given ?? 0}</Text>
              <Text style={s.statLabel}>stamps given</Text>
            </View>
            <View style={s.statCell}>
              <Text style={s.statValue}>{cafe.rewards_redeemed ?? 0}</Text>
              <Text style={s.statLabel}>{cafe.stamp_reward?.toLowerCase() || "rewards"} redeemed</Text>
            </View>
            <View style={s.statCell}>
              <Text style={s.statValue}>{cafe.stamp_target}</Text>
              <Text style={s.statLabel}>stamps for {cafe.stamp_reward?.toLowerCase() || "reward"}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Baristas */}
      {baristas.length > 0 && (
        <View style={s.baristasBlock}>
          <Text style={s.sectionTitle}>Baristas</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingVertical: 8 }}>
            {baristas.map((b) => (
              <View key={b.id} style={s.baristaCard}>
                {b.photo_url ? (
                  <Image source={{ uri: resolveUploadUrl(b.photo_url) }} style={s.baristaPhoto} contentFit="cover" />
                ) : (
                  <View style={[s.baristaPhoto, s.baristaPhotoFallback]}>
                    <Text style={s.baristaInitial}>{b.name.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <Text style={s.baristaName}>{b.name}</Text>
                {b.specialty && <Text style={s.baristaSpecialty}>{b.specialty}</Text>}
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Hours */}
      {hours && Object.keys(hours).length > 0 && (
        <View style={s.hoursBlock}>
          <Text style={s.sectionTitle}>Hours</Text>
          {DAYS_OF_WEEK.map((d) => (
            <View key={d} style={s.hoursRow}>
              <Text style={s.hoursDay}>{DAY_LABELS[d]}</Text>
              <Text style={s.hoursTime}>{hours[d] || "Closed"}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Menu Tab ───────────────────────────────────────────────────────────────

function MenuTab({ cafe_slug, menu, isOwner, onChange }: {
  cafe_slug: string; menu: CafeMenuItem[]; isOwner: boolean; onChange: () => void;
}) {
  const router = useRouter();

  // Group by drink_name so multi-bean drinks stack as carousel slides
  const grouped = useMemo(() => {
    const map = new Map<string, CafeMenuItem[]>();
    for (const item of menu) {
      const key = item.drink_name;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [menu]);

  const handleDelete = async (id: number) => {
    try {
      await apiFetchRaw(`/cafe_menu_items/${id}`, { method: "DELETE" });
      onChange();
    } catch (e) { console.warn("Menu delete failed:", e); }
  };

  if (menu.length === 0) {
    return (
      <View style={s.tabContent}>
        <View style={s.emptyState}>
          <Coffee size={32} color={t.color["text.muted"]} />
          <Text style={s.emptyText}>{isOwner ? "Add your first drink to the menu" : "No menu yet"}</Text>
        </View>
        {isOwner && (
          <AddMenuItemForm cafe_slug={cafe_slug} onAdded={onChange} />
        )}
      </View>
    );
  }

  return (
    <View style={s.tabContent}>
      {grouped.map(([drinkName, items]) => (
        <DrinkCard
          key={drinkName}
          drinkName={drinkName}
          items={items}
          isOwner={isOwner}
          onDelete={handleDelete}
          onTapRoaster={(roaster_slug) => router.push(`/roaster/${roaster_slug}` as any)}
          onTapProduct={(product_id) => router.push(`/coffee/${product_id}` as any)}
        />
      ))}
      {isOwner && (
        <AddMenuItemForm cafe_slug={cafe_slug} onAdded={onChange} />
      )}
    </View>
  );
}

function DrinkCard({ drinkName, items, isOwner, onDelete, onTapRoaster, onTapProduct }: {
  drinkName: string;
  items: CafeMenuItem[];
  isOwner: boolean;
  onDelete: (id: number) => void;
  onTapRoaster: (slug: string) => void;
  onTapProduct: (productId: string) => void;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const item = items[activeIdx];
  const hasMultiple = items.length > 1;
  const roasterName = item.manual_roaster_name || (item.roaster_slug ? item.roaster_slug.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()) : null);
  const beanName = item.manual_bean_name || (item.product_id ? null : null);

  return (
    <View style={s.drinkCard}>
      <View style={s.drinkCardHeader}>
        <Text style={s.drinkName}>{drinkName}</Text>
        {hasMultiple && (
          <View style={s.drinkCarouselDots}>
            {items.map((_, i) => (
              <Pressable key={i} onPress={() => setActiveIdx(i)}>
                <View style={[s.drinkDot, i === activeIdx && s.drinkDotActive]} />
              </Pressable>
            ))}
          </View>
        )}
        {isOwner && (
          <Pressable onPress={() => onDelete(item.id)} style={s.drinkDelete}>
            <Trash2 size={14} color={t.color["text.muted"]} />
          </Pressable>
        )}
      </View>

      <View style={s.drinkBeanLine}>
        {roasterName && (
          <Pressable
            onPress={() => {
              if (item.roaster_slug) onTapRoaster(item.roaster_slug);
              else if (item.manual_roaster_url) Linking.openURL(item.manual_roaster_url);
            }}
          >
            <Text style={s.drinkRoasterText}>By {roasterName}</Text>
          </Pressable>
        )}
        {(item.roast_level || item.process) && (
          <Text style={s.drinkProcess}>
            {[item.roast_level, item.process].filter(Boolean).join(" · ")}
          </Text>
        )}
      </View>

      {(item.product_id || beanName) && (
        <Pressable
          onPress={() => item.product_id && onTapProduct(item.product_id)}
          disabled={!item.product_id}
        >
          <Text style={s.drinkBeanText}>{beanName || item.product_id}</Text>
        </Pressable>
      )}

      {item.notes && <Text style={s.drinkNotes}>{item.notes}</Text>}

      {hasMultiple && (
        <Text style={s.drinkBeanCount}>{activeIdx + 1} of {items.length} beans</Text>
      )}
    </View>
  );
}

function AddMenuItemForm({ cafe_slug, onAdded }: { cafe_slug: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [drinkName, setDrinkName] = useState("");
  const [manualRoasterName, setManualRoasterName] = useState("");
  const [manualRoasterUrl, setManualRoasterUrl] = useState("");
  const [manualBeanName, setManualBeanName] = useState("");
  const [roastLevel, setRoastLevel] = useState("");
  const [process, setProcess] = useState("");

  const handleAdd = async () => {
    if (!drinkName.trim()) return;
    try {
      await apiFetchRaw("/cafe_menu_items", {
        method: "POST",
        body: JSON.stringify({
          cafe_slug,
          drink_name: drinkName.trim(),
          manual_roaster_name: manualRoasterName.trim() || null,
          manual_roaster_url: manualRoasterUrl.trim() || null,
          manual_bean_name: manualBeanName.trim() || null,
          roast_level: roastLevel.trim() || null,
          process: process.trim() || null,
        }),
      });
      setDrinkName("");
      setManualRoasterName("");
      setManualRoasterUrl("");
      setManualBeanName("");
      setRoastLevel("");
      setProcess("");
      setOpen(false);
      onAdded();
    } catch (e) { console.warn("Menu add failed:", e); }
  };

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={s.addMenuBtn}>
        <Plus size={16} color={t.color.accent} />
        <Text style={s.addMenuBtnText}>Add drink to menu</Text>
      </Pressable>
    );
  }

  return (
    <View style={s.addMenuForm}>
      <TextInput style={s.addMenuInput} value={drinkName} onChangeText={setDrinkName} placeholder="Drink name (e.g. Pour Over)" placeholderTextColor={t.color["text.muted"]} />
      <TextInput style={s.addMenuInput} value={manualRoasterName} onChangeText={setManualRoasterName} placeholder="Roaster name" placeholderTextColor={t.color["text.muted"]} />
      <TextInput style={s.addMenuInput} value={manualRoasterUrl} onChangeText={setManualRoasterUrl} placeholder="Roaster URL (optional)" placeholderTextColor={t.color["text.muted"]} />
      <TextInput style={s.addMenuInput} value={manualBeanName} onChangeText={setManualBeanName} placeholder="Bean name (optional)" placeholderTextColor={t.color["text.muted"]} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput style={[s.addMenuInput, { flex: 1 }]} value={roastLevel} onChangeText={setRoastLevel} placeholder="Roast" placeholderTextColor={t.color["text.muted"]} />
        <TextInput style={[s.addMenuInput, { flex: 1 }]} value={process} onChangeText={setProcess} placeholder="Process" placeholderTextColor={t.color["text.muted"]} />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable onPress={() => setOpen(false)} style={[s.discardBtn, { flex: 1 }]}>
          <Text style={s.discardText}>Cancel</Text>
        </Pressable>
        <Pressable onPress={handleAdd} style={[s.saveBtn, { flex: 1 }]}>
          <Text style={s.saveText}>Add drink</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Posts Tab ──────────────────────────────────────────────────────────────

function PostsTab({ posts }: { posts: any[] }) {
  if (posts.length === 0) {
    return (
      <View style={s.tabContent}>
        <View style={s.emptyState}>
          <Text style={s.emptyText}>No posts yet</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={s.tabContent}>
      {posts.map((p) => (
        <View key={p.id} style={s.postCard}>
          <Text style={s.postAuthor}>{p.author?.display_name || "Unknown"}</Text>
          <Text style={s.postBody}>{p.teaser}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 100 },
  scroll: { flex: 1, backgroundColor: t.color.bg },
  scrollContent: { paddingTop: NAVBAR_H, paddingBottom: 60 },
  scrollContentWide: { paddingHorizontal: 0 },

  layout: { flexDirection: "column" },
  layoutWide: { flexDirection: "row", maxWidth: 1280, alignSelf: "center", width: "100%" },

  leftPanel: { paddingHorizontal: 24, paddingVertical: 24 },
  leftPanelWide: { width: 380, paddingRight: 32 },

  rightPanel: { paddingHorizontal: 24, paddingVertical: 24 },
  rightPanelWide: { flex: 1, paddingLeft: 32 },

  heroWrap: {
    height: 240,
    backgroundColor: t.color["card.front"],
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 16,
    position: "relative",
  },
  heroFallback: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.color["card.info"] },

  backBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12,
    alignSelf: "flex-start", paddingVertical: 4,
  },
  backText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.primary"] },

  cafeName: {
    fontFamily: t.font.display, fontSize: 36, color: t.color["text.primary"],
    lineHeight: 42, marginBottom: 12,
  },
  aboutBlurb: {
    fontFamily: t.font["body.regular"], fontSize: 14, color: t.color["text.secondary"],
    lineHeight: 20, marginBottom: 16,
  },
  aboutText: {
    fontFamily: t.font["body.regular"], fontSize: 14, color: t.color["text.secondary"],
    lineHeight: 20,
  },
  inlineEdit: {
    backgroundColor: t.color["card.info"],
    paddingHorizontal: 8, paddingVertical: 6,
    borderRadius: 4,
  },

  seasonalBadge: {
    alignSelf: "flex-start",
    backgroundColor: t.color["accent.soft"],
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 16,
  },
  seasonalText: { fontFamily: t.font["body.medium"], fontSize: 11, color: t.color["accent.cta"] },

  metaRows: { gap: 8, marginBottom: 20 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  metaText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.primary"] },
  metaTextLink: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.primary"], textDecorationLine: "underline" as any },

  ownerActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  editBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: t.color.border, borderRadius: 4,
  },
  editBtnText: { fontFamily: t.font["body.medium"], fontSize: 12, color: t.color["text.primary"] },
  scanBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 6,
    backgroundColor: t.color.accent, borderRadius: 4,
  },
  scanBtnText: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.on-dark"] },

  // Tabs
  tabs: { flexDirection: "row", gap: 32, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: "rgba(215,209,196,0.5)", marginBottom: 20 },
  tabBtn: { position: "relative", paddingBottom: 8 } as any,
  tabText: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.muted"], letterSpacing: 0.5 },
  tabTextActive: { color: t.color["text.primary"] },
  tabUnderline: { position: "absolute", bottom: -1, left: 0, right: 0, height: 3, backgroundColor: t.color["text.primary"] } as any,

  tabContent: { gap: 24 },

  sectionTitle: {
    fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.muted"],
    letterSpacing: 0.5, marginBottom: 12, textTransform: "uppercase",
  },

  // Stats
  statsBlock: {},
  statsRow: { flexDirection: "row", gap: 16 },
  statCell: { flex: 1, padding: 16, backgroundColor: t.color["card.info"], borderRadius: 8 },
  statValue: { fontFamily: t.font.display, fontSize: 28, color: t.color["text.primary"], lineHeight: 32 },
  statLabel: { fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.secondary"], marginTop: 4 },

  // Baristas
  baristasBlock: {},
  baristaCard: { width: 100, alignItems: "center" },
  baristaPhoto: { width: 80, height: 80, borderRadius: 40, marginBottom: 8 },
  baristaPhotoFallback: { backgroundColor: t.color["card.info"], alignItems: "center", justifyContent: "center" },
  baristaInitial: { fontFamily: t.font.display, fontSize: 28, color: t.color["text.muted"] },
  baristaName: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.primary"], textAlign: "center" },
  baristaSpecialty: { fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.secondary"], textAlign: "center", marginTop: 2 },

  // Hours
  hoursBlock: {},
  hoursRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.color["border.light"] },
  hoursDay: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.primary"] },
  hoursTime: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.secondary"] },

  // Menu / drink card
  drinkCard: {
    backgroundColor: t.color["card.front"],
    borderRadius: 8,
    padding: 16,
    borderWidth: 1, borderColor: t.color["border.light"],
  },
  drinkCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  drinkName: { fontFamily: t.font.display, fontSize: 22, color: t.color["text.primary"] },
  drinkCarouselDots: { flexDirection: "row", gap: 6 },
  drinkDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.color.border },
  drinkDotActive: { backgroundColor: t.color.accent },
  drinkDelete: { padding: 4 },

  drinkBeanLine: { flexDirection: "row", flexWrap: "wrap" as any, gap: 8, alignItems: "center", marginBottom: 4 },
  drinkRoasterText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.primary"], textDecorationLine: "underline" as any },
  drinkProcess: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.secondary"] },
  drinkBeanText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["accent.cta"], marginTop: 2 },
  drinkNotes: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.muted"], marginTop: 6, fontStyle: "italic" as any },
  drinkBeanCount: { fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.muted"], marginTop: 8 },

  // Add menu form
  addMenuBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    padding: 16, borderWidth: 1, borderStyle: "dashed", borderColor: t.color.border, borderRadius: 8,
  },
  addMenuBtnText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color.accent },
  addMenuForm: { gap: 8, padding: 16, backgroundColor: t.color["card.info"], borderRadius: 8 },
  addMenuInput: {
    fontFamily: t.font["body.regular"], fontSize: 14, color: t.color["text.primary"],
    backgroundColor: t.color["card.front"],
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4,
    borderWidth: 1, borderColor: t.color["border.light"],
  },

  // Empty
  emptyState: { paddingVertical: 40, alignItems: "center", gap: 12 },
  emptyText: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.muted"] },

  // Posts (placeholder until full PostCard wired in)
  postCard: { padding: 16, backgroundColor: t.color["card.front"], borderRadius: 8 },
  postAuthor: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.primary"], marginBottom: 4 },
  postBody: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.secondary"] },

  // Edit banner
  editBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 24, paddingVertical: 10,
    backgroundColor: t.color["roaster.panel"],
  },
  editBannerLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  editBannerLabel: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color.accent },
  editBannerRight: { flexDirection: "row", gap: 8 },
  discardBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  discardText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.on-dark"] },
  saveBtn: { paddingHorizontal: 14, paddingVertical: 6, backgroundColor: t.color.accent, borderRadius: 4 },
  saveText: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.primary"] },
});
