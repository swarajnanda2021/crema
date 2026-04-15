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
import { ArrowLeft, Coffee, Camera, PenLine, Plus, Trash2 } from "lucide-react-native";
import Svg, { Path } from "react-native-svg";
import { t } from "../../src/tokens/useTokens";
import { apiFetchRaw, resolveUploadUrl } from "../../src/api/client";
import { useAuth } from "../../src/hooks/useAuth";
import Navbar from "../../src/components/Navbar";
import ScannerModal from "../../src/components/ScannerModal";
import ImageUploadModal from "../../src/components/ImageUploadModal";
import PostCard from "../../src/components/domain/PostCard";
import { openPostModal } from "../../src/components/primitives";
import type { Cafe, CafeMenuItem, CafeBarista } from "../../src/resources/types";

const NAVBAR_H = 72;

// ── Local SVG icons matching roaster profile language ───────────────────────

function MapPinIcon({ color = t.color.accent }: { color?: string }) {
  return (
    <Svg width={12} height={16} viewBox="0 0 13.9649 17.3005" fill="none">
      <Path d="M0.75 6.9138C0.75 11.2337 4.52909 14.806 6.20182 16.1756C6.44121 16.3716 6.56234 16.4708 6.74095 16.5211C6.88002 16.5602 7.0847 16.5602 7.22378 16.5211C7.40271 16.4707 7.523 16.3725 7.76329 16.1757C9.43602 14.8061 13.2149 11.234 13.2149 6.9142C13.2149 5.2794 12.5583 3.71137 11.3895 2.55539C10.2207 1.39942 8.63552 0.75 6.98257 0.75C5.32961 0.75 3.74427 1.39952 2.57545 2.55549C1.40664 3.71147 0.75 5.27901 0.75 6.9138Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.20178 6.09214C5.20178 7.0756 5.99903 7.87285 6.98249 7.87285C7.96595 7.87285 8.76321 7.0756 8.76321 6.09214C8.76321 5.10868 7.96595 4.31142 6.98249 4.31142C5.99903 4.31142 5.20178 5.10868 5.20178 6.09214Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ExternalLinkIcon({ color = t.color.accent }: { color?: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 15.5 15.5" fill="none">
      <Path d="M5.41685 1.68333H3.73685C2.69142 1.68333 2.16831 1.68333 1.76901 1.88679C1.41778 2.06575 1.13242 2.35111 0.953455 2.70234C0.750001 3.10165 0.750001 3.62475 0.750001 4.67018V11.7635C0.750001 12.8089 0.750001 13.3314 0.953455 13.7307C1.13242 14.0819 1.41778 14.3678 1.76901 14.5467C2.16792 14.75 2.69039 14.75 3.73378 14.75H10.8329C11.8763 14.75 12.398 14.75 12.7969 14.5467C13.1481 14.3678 13.4344 14.0817 13.6134 13.7304C13.8167 13.3315 13.8167 12.8096 13.8167 11.7662V10.0833M14.75 5.41667V0.75M14.75 0.75H10.0833M14.75 0.75L8.21667 7.28333" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function InstagramIcon({ color = t.color.accent }: { color?: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 16 16" fill="none">
      <Path d="M11 1H5C2.79086 1 1 2.79086 1 5V11C1 13.2091 2.79086 15 5 15H11C13.2091 15 15 13.2091 15 11V5C15 2.79086 13.2091 1 11 1Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M11.5 7.6C11.6233 8.4317 11.4811 9.2811 11.0938 10.0277C10.7064 10.7743 10.0938 11.3796 9.343 11.7574C8.5922 12.1352 7.7412 12.2664 6.9114 12.1322C6.0815 11.9979 5.3146 11.6051 4.7204 11.0094C4.1262 10.4137 3.7355 9.6457 3.6038 8.8157C3.4721 7.9856 3.6063 7.135 3.987 6.3854C4.3677 5.6358 4.9748 5.0249 5.7224 4.6398C6.4699 4.2547 7.3197 4.1149 8.151 4.24C8.999 4.3676 9.7837 4.7626 10.39 5.367C10.9963 5.9714 11.3934 6.7551 11.5 7.6Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M11.5 4.5H11.508" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_OF_WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

type TabKey = "bio" | "menu" | "posts";

export default function CafeDetailPage() {
  const { slug, edit } = useLocalSearchParams<{ slug: string; edit?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { width: winW, height: winH } = useWindowDimensions();

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
  const [editCover, setEditCover] = useState<string>("");
  const [editLogo, setEditLogo] = useState<string>("");
  const [showCoverUpload, setShowCoverUpload] = useState(false);
  const [showLogoUpload, setShowLogoUpload] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Auto-open edit mode from ?edit=1 query (set by navbar dropdown)
  useEffect(() => { if (edit === "1" && isOwner) setIsEditing(true); }, [edit, isOwner]);

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
        setEditCover(cafeData.cover_image_url || "");
        setEditLogo(cafeData.logo_url || "");
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
          cover_image_url: editCover || null,
          logo_url: editLogo || null,
        }),
      });
      setIsEditing(false);
      await fetchAll();
    } catch (e) {
      console.warn("Café save failed:", e);
    }
  }, [slug, editAbout, editAddress, editInstagram, editWebsite, editCover, editLogo, fetchAll]);

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

      {isWide ? (
        // Wide layout: full-height row with two independent scroll columns (matches roaster page)
        <View style={[s.pageContainer, { height: winH - NAVBAR_H }]}>
          <View style={s.leftPanelWide}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.leftPanelInner}>
            <Pressable onPress={() => router.back()} style={s.backBtn}>
              <ArrowLeft size={16} color={t.color["text.on-dark"]} />
              <Text style={s.backText}>Back</Text>
            </Pressable>

            {/* Logo (square) — sits above café name */}
            <View style={s.logoWrap}>
              {(isEditing ? editLogo : cafe.logo_url) ? (
                <Image source={{ uri: resolveUploadUrl(isEditing ? editLogo : cafe.logo_url || "") }} style={StyleSheet.absoluteFillObject as any} contentFit="cover" />
              ) : (
                <View style={s.logoFallback}>
                  <Text style={s.logoInitial}>{(cafe.name || "?")[0].toUpperCase()}</Text>
                </View>
              )}
              {isEditing && (
                <Pressable onPress={() => setShowLogoUpload(true)} style={s.logoEditBtn} hitSlop={8}>
                  <Camera size={14} color={t.color["text.on-dark"]} />
                </Pressable>
              )}
            </View>

            <Text style={s.cafeName}>{cafe.name}</Text>

            {isEditing ? (
              <TextInput
                style={[s.aboutText, s.inlineEdit, { minHeight: 60 }]}
                value={editAbout}
                onChangeText={setEditAbout}
                multiline
                placeholder="Tell people about your café…"
                placeholderTextColor="rgba(199,186,165,0.4)"
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

            {/* Meta rows — match roaster profile pattern: icon + Inter medium, no underline */}
            <View style={s.metaRows}>
              {(cafe.address || isEditing) && (
                isEditing ? (
                  <View style={s.metaItem}>
                    <MapPinIcon />
                    <TextInput
                      style={[s.metaText, s.inlineEditMeta]}
                      value={editAddress}
                      onChangeText={setEditAddress}
                      placeholder="Address"
                      placeholderTextColor="rgba(199,186,165,0.4)"
                    />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => cafe.address && Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(cafe.address)}`)}
                    style={s.metaItem}
                  >
                    <MapPinIcon />
                    <Text style={s.metaText} numberOfLines={2}>{cafe.address}</Text>
                  </Pressable>
                )
              )}
              {(cafe.instagram_handle || isEditing) && (
                isEditing ? (
                  <View style={s.metaItem}>
                    <InstagramIcon />
                    <TextInput
                      style={[s.metaText, s.inlineEditMeta]}
                      value={editInstagram}
                      onChangeText={setEditInstagram}
                      placeholder="Instagram handle"
                      placeholderTextColor="rgba(199,186,165,0.4)"
                    />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => Linking.openURL(`https://instagram.com/${cafe.instagram_handle}`)}
                    style={s.metaItem}
                  >
                    <InstagramIcon />
                    <Text style={s.metaText}>@{cafe.instagram_handle}</Text>
                  </Pressable>
                )
              )}
              {(cafe.website || isEditing) && (
                isEditing ? (
                  <View style={s.metaItem}>
                    <ExternalLinkIcon />
                    <TextInput
                      style={[s.metaText, s.inlineEditMeta]}
                      value={editWebsite}
                      onChangeText={setEditWebsite}
                      placeholder="Website URL"
                      placeholderTextColor="rgba(199,186,165,0.4)"
                    />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => cafe.website && Linking.openURL(cafe.website)}
                    style={s.metaItem}
                  >
                    <ExternalLinkIcon />
                    <Text style={s.metaText}>Website</Text>
                  </Pressable>
                )
              )}
            </View>

            {/* Owner triggers edit mode via the navbar profile dropdown — no inline button needed */}
          </ScrollView>
          </View>

          {/* RIGHT PANEL — independent scroll so columns are flush full-height */}
          <View style={s.rightPanelWide}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }}>
            <View style={s.heroWrap}>
              {(isEditing ? editCover : cafe.cover_image_url) ? (
                <Image source={{ uri: resolveUploadUrl(isEditing ? editCover : cafe.cover_image_url || "") }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
              ) : (
                <View style={s.heroFallback}>
                  <Coffee size={64} color={t.color["text.muted"]} />
                </View>
              )}
              {isEditing && (
                <Pressable onPress={() => setShowCoverUpload(true)} style={s.heroEditBtn}>
                  <Camera size={14} color={t.color["text.on-dark"]} />
                  <Text style={s.heroEditBtnText}>Change cover</Text>
                </Pressable>
              )}
            </View>

            <View style={s.rightInner}>
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

              {activeTab === "bio" && (
                <BioTab cafe={cafe} baristas={baristas} isOwner={isOwner} onScan={() => setShowScanner(true)} />
              )}
              {activeTab === "menu" && (
                <MenuTab cafe_slug={slug} menu={menu} isOwner={isOwner} onChange={fetchAll} />
              )}
              {activeTab === "posts" && (
                <PostsTab posts={posts} onRefresh={fetchAll} />
              )}
            </View>
          </ScrollView>
          </View>
        </View>
      ) : (
        // Narrow layout: single scroll, left panel stacked above right panel
        <ScrollView style={{ flex: 1, backgroundColor: t.color.bg }} contentContainerStyle={{ paddingBottom: 60 }}>
          <View style={s.leftPanel}>
            <Pressable onPress={() => router.back()} style={s.backBtn}>
              <ArrowLeft size={16} color={t.color["text.on-dark"]} />
              <Text style={s.backText}>Back</Text>
            </Pressable>
            <View style={s.logoWrap}>
              {(isEditing ? editLogo : cafe.logo_url) ? (
                <Image source={{ uri: resolveUploadUrl(isEditing ? editLogo : cafe.logo_url || "") }} style={StyleSheet.absoluteFillObject as any} contentFit="cover" />
              ) : (
                <View style={s.logoFallback}><Text style={s.logoInitial}>{(cafe.name || "?")[0].toUpperCase()}</Text></View>
              )}
              {isEditing && (
                <Pressable onPress={() => setShowLogoUpload(true)} style={s.logoEditBtn} hitSlop={8}>
                  <Camera size={14} color={t.color["text.on-dark"]} />
                </Pressable>
              )}
            </View>
            <Text style={s.cafeName}>{cafe.name}</Text>
            {isEditing ? (
              <TextInput style={[s.aboutText, s.inlineEdit, { minHeight: 60 }]} value={editAbout} onChangeText={setEditAbout} multiline placeholder="Tell people about your café…" placeholderTextColor="rgba(199,186,165,0.4)" />
            ) : cafe.about_blurb ? (
              <Text style={s.aboutBlurb}>{cafe.about_blurb}</Text>
            ) : null}
            {seasonalText && (
              <View style={s.seasonalBadge}><Text style={s.seasonalText}>{seasonalText}</Text></View>
            )}
            <View style={s.metaRows}>
              {cafe.address && (
                <Pressable onPress={() => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(cafe.address!)}`)} style={s.metaItem}>
                  <MapPinIcon /><Text style={s.metaText} numberOfLines={2}>{cafe.address}</Text>
                </Pressable>
              )}
              {cafe.instagram_handle && (
                <Pressable onPress={() => Linking.openURL(`https://instagram.com/${cafe.instagram_handle}`)} style={s.metaItem}>
                  <InstagramIcon /><Text style={s.metaText}>@{cafe.instagram_handle}</Text>
                </Pressable>
              )}
              {cafe.website && (
                <Pressable onPress={() => Linking.openURL(cafe.website!)} style={s.metaItem}>
                  <ExternalLinkIcon /><Text style={s.metaText}>Website</Text>
                </Pressable>
              )}
            </View>
          </View>
          <View style={s.heroWrap}>
            {cafe.cover_image_url ? (
              <Image source={{ uri: resolveUploadUrl(cafe.cover_image_url) }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
            ) : (
              <View style={s.heroFallback}><Coffee size={64} color={t.color["text.muted"]} /></View>
            )}
          </View>
          <View style={s.rightInner}>
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
            {activeTab === "bio" && (<BioTab cafe={cafe} baristas={baristas} isOwner={isOwner} onScan={() => setShowScanner(true)} />)}
            {activeTab === "menu" && (<MenuTab cafe_slug={slug} menu={menu} isOwner={isOwner} onChange={fetchAll} />)}
            {activeTab === "posts" && (<PostsTab posts={posts} onRefresh={fetchAll} />)}
          </View>
        </ScrollView>
      )}

      {showScanner && (
        <ScannerModal
          cafeSlug={slug}
          onClose={() => setShowScanner(false)}
        />
      )}

      <ImageUploadModal
        visible={showCoverUpload}
        title="Upload Cover Image"
        purpose="hero"
        currentUrl={editCover}
        onConfirm={(url) => setEditCover(url)}
        onClose={() => setShowCoverUpload(false)}
      />
      <ImageUploadModal
        visible={showLogoUpload}
        title="Upload Logo"
        purpose="logo"
        currentUrl={editLogo}
        onConfirm={(url) => setEditLogo(url)}
        onClose={() => setShowLogoUpload(false)}
      />
    </>
  );
}

// ── Bio Tab ────────────────────────────────────────────────────────────────

function BioTab({ cafe, baristas, isOwner, onScan }: {
  cafe: Cafe; baristas: CafeBarista[]; isOwner: boolean; onScan: () => void;
}) {
  const hours = cafe.hours_json;
  return (
    <View style={s.tabContent}>
      {/* Stamps stats sentence + (owner only) compact scan QR icon */}
      {cafe.stamps_enabled === 1 && (
        <View style={s.statsRowInline}>
          <Text style={s.statsSentence}>
            <Text style={s.statsNumber}>{cafe.stamps_given ?? 0}</Text> stamps given out · <Text style={s.statsNumber}>{cafe.rewards_redeemed ?? 0}</Text> {(cafe.stamp_reward || "rewards").toLowerCase()}{(cafe.rewards_redeemed ?? 0) === 1 ? "" : "s"} claimed · <Text style={s.statsNumber}>{cafe.stamp_target}</Text> stamps for a {(cafe.stamp_reward || "reward").toLowerCase()}.
          </Text>
          {isOwner && (
            <Pressable onPress={onScan} style={s.scanIconBtn} hitSlop={8} accessibilityLabel="Scan QR to stamp">
              <Camera size={18} color={t.color["text.primary"]} />
            </Pressable>
          )}
        </View>
      )}

      {/* Baristas — name + avatar only; tappable to user profile if linked */}
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
                <Text style={s.baristaName} numberOfLines={1}>{b.name}</Text>
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
        <DrinkRow
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

// Row layout: drink name on left, horizontal scroll of bean cards on right.
// Multi-roaster drinks become natural carousels — swipe the cards to see alternates.
function DrinkRow({ drinkName, items, isOwner, onDelete, onTapRoaster, onTapProduct }: {
  drinkName: string;
  items: CafeMenuItem[];
  isOwner: boolean;
  onDelete: (id: number) => void;
  onTapRoaster: (slug: string) => void;
  onTapProduct: (productId: string) => void;
}) {
  return (
    <View style={s.drinkRow}>
      <View style={s.drinkLabel}>
        <Text style={s.drinkRowName}>{drinkName}</Text>
        {items.length > 1 && (
          <Text style={s.drinkRowCount}>{items.length} options</Text>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingRight: 8 }}
        style={s.drinkScroll}
      >
        {items.map((item) => (
          <BeanCard
            key={item.id}
            item={item}
            isOwner={isOwner}
            onDelete={() => onDelete(item.id)}
            onTapRoaster={onTapRoaster}
            onTapProduct={onTapProduct}
          />
        ))}
      </ScrollView>
    </View>
  );
}

// Bean card — uses the same CoffeeLabel design language as the rest of the site.
// Canela display for bean name, "By Roaster" row, divider, Inter 10.2px for meta.
// Compact variant of CoffeeLabel adapted for a café menu context.
function BeanCard({ item, isOwner, onDelete, onTapRoaster, onTapProduct }: {
  item: CafeMenuItem;
  isOwner: boolean;
  onDelete: () => void;
  onTapRoaster: (slug: string) => void;
  onTapProduct: (productId: string) => void;
}) {
  const showRoaster = !!item.roaster_slug && item.hide_roaster !== 1;
  const isHidden = !!item.roaster_slug && item.hide_roaster === 1;
  const beanName = item.manual_bean_name || item.product_id || "—";
  const roasterName = item.roaster_slug
    ? item.roaster_slug.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
    : null;

  const detailLine = [
    item.process ? `${item.process} Process` : null,
    item.roast_level ? `${item.roast_level} Roast` : null,
  ].filter(Boolean).join(" \u2022 ");

  return (
    <View style={s.beanCard}>
      {isOwner && (
        <Pressable onPress={onDelete} style={s.beanCardDelete}>
          <Trash2 size={12} color="#684F44" />
        </Pressable>
      )}

      {/* Bean name — Canela 22.7, #351101 — same as CoffeeLabel coffeeName */}
      <Pressable
        onPress={() => item.product_id && onTapProduct(item.product_id)}
        disabled={!item.product_id}
      >
        <Text style={s.beanCardCoffeeName} numberOfLines={2}>{beanName}</Text>
      </Pressable>

      {/* Roaster row — "By " plain + tappable name (or "Roaster undisclosed") */}
      {showRoaster && roasterName ? (
        <View style={s.beanCardRoasterRow}>
          <Text style={s.beanCardRoasterLabel}>By </Text>
          <Pressable onPress={() => onTapRoaster(item.roaster_slug!)} style={s.beanCardRoasterPressable}>
            <Text style={s.beanCardRoasterLabel} numberOfLines={1}>{roasterName}</Text>
          </Pressable>
        </View>
      ) : isHidden ? (
        <View style={s.beanCardRoasterRow}>
          <Text style={s.beanCardRoasterLabel}>Roaster undisclosed</Text>
        </View>
      ) : null}

      {/* Divider line — same #C7BAA5 as CoffeeLabel */}
      {detailLine ? <View style={s.beanCardDivider} /> : null}

      {/* Process • Roast — Inter 10.2px, #684F44 — exactly CoffeeLabel.detailText */}
      {detailLine ? (
        <Text style={s.beanCardDetail} numberOfLines={1}>{detailLine}</Text>
      ) : null}
    </View>
  );
}

function AddMenuItemForm({ cafe_slug, onAdded }: { cafe_slug: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [drinkName, setDrinkName] = useState("");
  const [roasterSlug, setRoasterSlug] = useState<string | null>(null);
  const [roasterPickerOpen, setRoasterPickerOpen] = useState(false);
  const [roasterQuery, setRoasterQuery] = useState("");
  const [roasters, setRoasters] = useState<Array<{ roaster_slug: string; name: string | null }>>([]);
  const [manualBeanName, setManualBeanName] = useState("");
  const [roastLevel, setRoastLevel] = useState("");
  const [process, setProcess] = useState("");
  const [hideRoaster, setHideRoaster] = useState(false);

  // Load roaster catalog when the picker opens
  useEffect(() => {
    if (roasters.length > 0 || !roasterPickerOpen) return;
    apiFetchRaw<any>("/roaster_profiles?limit=200")
      .then((r) => {
        const data = r?.data ?? r;
        setRoasters(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
  }, [roasterPickerOpen, roasters.length]);

  const filteredRoasters = useMemo(() => {
    if (!roasterQuery) return roasters.slice(0, 50);
    const q = roasterQuery.toLowerCase();
    return roasters
      .filter((r) => (r.name || r.roaster_slug || "").toLowerCase().includes(q))
      .slice(0, 50);
  }, [roasters, roasterQuery]);

  const selectedRoasterName = roasterSlug
    ? (roasters.find((r) => r.roaster_slug === roasterSlug)?.name || roasterSlug.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()))
    : null;

  const handleAdd = async () => {
    if (!drinkName.trim()) return;
    try {
      await apiFetchRaw("/cafe_menu_items", {
        method: "POST",
        body: JSON.stringify({
          cafe_slug,
          drink_name: drinkName.trim(),
          roaster_slug: roasterSlug,
          manual_bean_name: manualBeanName.trim() || null,
          roast_level: roastLevel.trim() || null,
          process: process.trim() || null,
          hide_roaster: hideRoaster ? 1 : 0,
        }),
      });
      setDrinkName("");
      setRoasterSlug(null);
      setManualBeanName("");
      setRoastLevel("");
      setProcess("");
      setHideRoaster(false);
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

      {/* Roaster picker — only catalog roasters; leave blank if not in our catalog */}
      <Pressable onPress={() => setRoasterPickerOpen(true)} style={s.addMenuInput}>
        <Text style={selectedRoasterName ? s.pickerSelectedText : s.pickerPlaceholder}>
          {selectedRoasterName || "Pick a roaster (optional, from catalog)"}
        </Text>
      </Pressable>
      {selectedRoasterName && (
        <Pressable onPress={() => setRoasterSlug(null)}>
          <Text style={s.clearText}>× clear roaster</Text>
        </Pressable>
      )}

      <TextInput style={s.addMenuInput} value={manualBeanName} onChangeText={setManualBeanName} placeholder="Bean name (optional)" placeholderTextColor={t.color["text.muted"]} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput style={[s.addMenuInput, { flex: 1 }]} value={roastLevel} onChangeText={setRoastLevel} placeholder="Roast" placeholderTextColor={t.color["text.muted"]} />
        <TextInput style={[s.addMenuInput, { flex: 1 }]} value={process} onChangeText={setProcess} placeholder="Process" placeholderTextColor={t.color["text.muted"]} />
      </View>
      <Pressable onPress={() => setHideRoaster(!hideRoaster)} style={s.checkRow}>
        <View style={[s.checkbox, hideRoaster && s.checkboxChecked]}>
          {hideRoaster && <Text style={s.checkmark}>{"\u2713"}</Text>}
        </View>
        <Text style={s.checkLabel}>Hide roaster credit (safeguard sourcing)</Text>
      </Pressable>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable onPress={() => setOpen(false)} style={[s.discardBtn, { flex: 1 }]}>
          <Text style={s.discardText}>Cancel</Text>
        </Pressable>
        <Pressable onPress={handleAdd} style={[s.saveBtn, { flex: 1 }]}>
          <Text style={s.saveText}>Add drink</Text>
        </Pressable>
      </View>

      {roasterPickerOpen && (
        <View style={s.roasterPickerOverlay}>
          <View style={s.roasterPickerCard}>
            <Text style={s.roasterPickerTitle}>Pick a roaster</Text>
            <TextInput
              style={s.addMenuInput}
              value={roasterQuery}
              onChangeText={setRoasterQuery}
              placeholder="Search roasters…"
              placeholderTextColor={t.color["text.muted"]}
            />
            <ScrollView style={{ maxHeight: 280 }}>
              {filteredRoasters.map((r) => (
                <Pressable
                  key={r.roaster_slug}
                  onPress={() => {
                    setRoasterSlug(r.roaster_slug);
                    setRoasterPickerOpen(false);
                    setRoasterQuery("");
                  }}
                  style={s.roasterPickerRow}
                >
                  <Text style={s.roasterPickerName}>{r.name || r.roaster_slug}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => setRoasterPickerOpen(false)} style={s.discardBtn}>
              <Text style={s.discardText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Posts Tab ──────────────────────────────────────────────────────────────

function PostsTab({ posts, onRefresh }: { posts: any[]; onRefresh: () => void }) {
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
        <PostCard
          key={p.id}
          post={p}
          onComment={(post) => openPostModal({ postId: post.id, mode: "comment" })}
          onRepost={(post) => openPostModal({ postId: post.id, mode: "repost" })}
        />
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

  // Wide layout: full-height row with two flush columns (matches roaster page)
  pageContainer: { flexDirection: "row", overflow: "hidden" } as any,

  layout: { flexDirection: "column" },
  layoutWide: { flexDirection: "row", width: "100%" } as any,

  // Left panel — dark brown, matches roaster profile (42% width on wide, full on narrow)
  leftPanel: {
    paddingHorizontal: 24, paddingVertical: 24,
    backgroundColor: t.color["roaster.panel"],
  },
  // Match roaster profile widths/padding exactly. Width + horizontal padding on outer View
  // (so percentage is relative to viewport like roaster), inner ScrollView fills with vertical padding.
  leftPanelWide: {
    width: "42%",
    flexShrink: 0,
    backgroundColor: t.color["roaster.panel"],
    height: "100%",
    paddingHorizontal: "3.5%" as any,  // ≈ 6.25% of 42% column width — matches roaster's inset
  } as any,
  leftPanelInner: {
    paddingTop: 126, paddingBottom: 60,
  } as any,

  rightPanel: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 24, backgroundColor: t.color.bg } as any,
  rightPanelWide: { flex: 1, minWidth: 0, backgroundColor: t.color.bg, height: "100%" } as any,
  rightInner: { paddingHorizontal: 24, paddingTop: 0 } as any,

  // Logo — circle, sits above name
  logoWrap: {
    width: 96, height: 96,
    borderRadius: 48,
    overflow: "hidden",
    backgroundColor: t.color["card.front"],
    marginBottom: 20,
    position: "relative",
  } as any,
  logoFallback: { flex: 1, alignItems: "center", justifyContent: "center" } as any,
  logoInitial: { fontFamily: t.font.display, fontSize: 44, color: t.color["text.muted"] },
  logoEditBtn: {
    position: "absolute", bottom: 4, right: 4,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(53,17,1,0.85)",
    alignItems: "center", justifyContent: "center",
  },

  // Hero (right panel top) — full-width landscape
  heroWrap: {
    width: "100%",
    height: 280,
    backgroundColor: t.color["card.info"],
    overflow: "hidden",
    marginBottom: 16,
    position: "relative",
  } as any,
  heroFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  heroEditBtn: {
    position: "absolute", bottom: 12, right: 12,
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: "rgba(53,17,1,0.85)", borderRadius: 4,
  },
  heroEditBtnText: {
    fontFamily: t.font["body.medium"], fontSize: 12, color: t.color["text.on-dark"],
  },

  backBtn: {
    flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 60,
    alignSelf: "flex-start", paddingVertical: 4,
  },
  backText: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color.divider },

  cafeName: {
    fontFamily: t.font.display, fontSize: 48, color: t.color["text.on-dark"],
    lineHeight: 54, marginTop: 4, marginBottom: 12,
  },
  aboutBlurb: {
    fontFamily: t.font["body.regular"], fontSize: 12, color: t.color.divider,
    lineHeight: 18, marginBottom: 16,
  },
  aboutText: {
    fontFamily: t.font["body.regular"], fontSize: 12, color: t.color.divider,
    lineHeight: 18,
  },
  inlineEdit: {
    backgroundColor: "rgba(255,255,255,0.06)",
    color: t.color["text.on-dark"],
    paddingHorizontal: 8, paddingVertical: 6,
    borderRadius: 4,
  } as any,

  seasonalBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 12,
    marginBottom: 16,
  },
  seasonalText: { fontFamily: t.font["body.medium"], fontSize: 11, color: t.color["text.on-dark"], letterSpacing: 0.3 },

  metaRows: { gap: 8, marginBottom: 20 },
  metaItem: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 2 } as any,
  metaText: {
    fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.on-dark"],
    flex: 1, flexShrink: 1, lineHeight: 18,
  } as any,
  inlineEditMeta: {
    fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.on-dark"],
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3,
    flex: 1,
  } as any,

  // (Edit profile + Scan QR are now wired through navbar dropdown / bio scan icon)

  // Tabs
  tabs: { flexDirection: "row", gap: 32, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: "rgba(215,209,196,0.5)", marginBottom: 20 },
  tabBtn: { position: "relative", paddingBottom: 8 } as any,
  tabText: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.muted"], letterSpacing: 0.5 },
  tabTextActive: { color: t.color["text.primary"] },
  tabUnderline: { position: "absolute", bottom: -1, left: 0, right: 0, height: 3, backgroundColor: t.color["text.primary"] } as any,

  tabContent: { gap: 24 },

  sectionTitle: {
    fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.muted"],
    letterSpacing: 0.5, marginBottom: 12, textTransform: "uppercase",
  },

  // Stamps stats — inline sentence + optional compact scan icon (owner only)
  statsRowInline: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  statsSentence: {
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: "#684F44",
    lineHeight: 20,
    flex: 1,
  } as any,
  statsNumber: {
    fontFamily: t.font["body.semibold"],
    color: "#351101",
  },
  scanIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 1, borderColor: "#D7D1C4",
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },

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
  // Menu row layout: drink name (left) + horizontal scroll of bean cards (right)
  drinkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 20,
    paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: t.color["border.light"],
  } as any,
  drinkLabel: { width: 140, flexShrink: 0, paddingTop: 6 } as any,
  drinkRowName: {
    fontFamily: t.font.display, fontSize: 24, color: t.color["text.primary"],
    lineHeight: 28,
  },
  drinkRowCount: {
    fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.muted"],
    marginTop: 4, letterSpacing: 0.3,
  },
  drinkScroll: { flex: 1, minWidth: 0 } as any,

  // Bean card — borrows CoffeeLabel design language: cream bg #EFE9DB, Canela name,
  // "By Roaster" row, divider, Inter 10.2px detail.
  beanCard: {
    width: 200,
    backgroundColor: "#EFE9DB",
    borderRadius: 5,
    padding: 14,
    position: "relative",
  } as any,
  beanCardDelete: {
    position: "absolute", top: 6, right: 6, padding: 4, zIndex: 2,
  } as any,
  // Canela Text Regular, 22.7px, #351101 — exact match to CoffeeLabel.coffeeName
  beanCardCoffeeName: {
    fontFamily: t.font.display,
    fontSize: 22.7,
    color: "#351101",
    lineHeight: 27,
  },
  beanCardRoasterRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    overflow: "hidden",
  },
  beanCardRoasterLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: 10.9,
    color: "#684F44",
  },
  beanCardRoasterPressable: { flexShrink: 1, overflow: "hidden" } as any,
  // Divider — same #C7BAA5 as CoffeeLabel
  beanCardDivider: {
    height: 1,
    backgroundColor: "#C7BAA5",
    marginTop: 7,
    marginBottom: 7,
  },
  // Inter Regular 10.2px #684F44 — matches CoffeeLabel.detailText
  beanCardDetail: {
    fontFamily: t.font["body.regular"],
    fontSize: 10.2,
    color: "#684F44",
  },

  // Add menu form
  addMenuBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    padding: 16, borderWidth: 1, borderStyle: "dashed", borderColor: t.color.border, borderRadius: 8,
  },
  addMenuBtnText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color.accent },
  addMenuForm: { gap: 8, padding: 16, backgroundColor: t.color["card.info"], borderRadius: 8 },
  pickerSelectedText: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color["text.primary"] },
  pickerPlaceholder: { fontFamily: t.font["body.regular"], fontSize: 14, color: t.color["text.muted"] },
  clearText: { fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["accent.cta"], marginTop: -4 },
  roasterPickerOverlay: {
    position: "absolute" as any, top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center", zIndex: 100,
  },
  roasterPickerCard: {
    width: "90%", maxWidth: 360,
    backgroundColor: t.color.bg, borderRadius: 8, padding: 16, gap: 8,
  },
  roasterPickerTitle: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.primary"], marginBottom: 4 },
  roasterPickerRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.color["border.light"] } as any,
  roasterPickerName: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.primary"] },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 } as any,
  checkbox: {
    width: 18, height: 18, borderRadius: 3, borderWidth: 1.5, borderColor: t.color.border,
    alignItems: "center", justifyContent: "center", backgroundColor: t.color["card.front"],
  },
  checkboxChecked: { backgroundColor: t.color.accent, borderColor: t.color.accent },
  checkmark: { color: t.color["text.primary"], fontSize: 12, fontWeight: "700" as any },
  checkLabel: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.secondary"] },
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
