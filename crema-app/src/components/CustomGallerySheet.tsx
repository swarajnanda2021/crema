/**
 * CustomGallerySheet — in-app photo picker matching Figma 900:1908.
 *
 * Replaces the system iOS PHPicker / browser file dialog with our
 * own gallery sheet. Surfaces the user's photo library through
 * `expo-media-library` on native, and falls back to a single-shot
 * file input on web (browsers don't expose a photo-library API).
 *
 * Visual structure (per Figma):
 *
 *   • Cream sheet anchored to the bottom of the viewport, top
 *     corners rounded 20 px, leaves a slim peek of the underlying
 *     composer + warm scrim at the top.
 *   • Header row:
 *       - X close button (left) inside a 37 × 37 Beige circle
 *       - Photos / Collections pill (centred)
 *   • Body: 3-column edge-to-edge photo grid.
 *   • Bottom dock: "📍 Location Is Included" status (centred) +
 *     magnifying-glass disc on the right. Both are visual only
 *     for now — we don't strip exif location, and the search disc
 *     is unwired until the user specs its behaviour.
 *
 * On native, tapping a thumbnail uploads that photo to
 * `/upload/image?purpose=post` and calls `onImagePicked(url)` so
 * the composer can attach it. On web, the "Browse files" CTA
 * opens the OS file dialog as the only viable fallback.
 *
 * Permissions: we ask once on the first open and cache the result
 * for the session. If the user denies, we render an inline help
 * row prompting them to grant access from system settings.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as MediaLibrary from "expo-media-library";
import { MapPin, Search, X } from "lucide-react-native";

import { apiUpload } from "../api/client";
import { t, makeStyles } from "../tokens/useTokens";
import { tap as hapticTap, commit as hapticCommit } from "../utils/haptics";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called when the user picks + uploads a photo. `location` is the
   *  human-readable place name extracted from the photo's EXIF GPS
   *  if available — null when the photo has no embedded location or
   *  reverse-geocoding fails. The caller (ComposePost) uses it to
   *  render the location chip in the body. */
  onImagePicked: (url: string, location: string | null) => void;
}

type Tab = "photos" | "collections";

interface Photo {
  id: string;
  uri: string;
  /** ms since epoch — used by the search-by-date filter so the
   *  search disc can do something useful without an ML backend. */
  creationTime?: number;
}

export default function CustomGallerySheet({
  visible,
  onClose,
  onImagePicked,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>("photos");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [permission, setPermission] = useState<
    "unknown" | "granted" | "denied"
  >("unknown");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Search mode (Figma left this UI unspecified — freestyled): tap
  // the magnifier disc to flip the header into a text input that
  // filters photos by their creation date. Typing "today",
  // "yesterday", a year ("2024"), or a month name ("september" /
  // "sep") subsets the grid live; empty query resets it.
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const s = useStyles();

  // Slide-up animation, shared between scrim opacity + sheet
  // translateY (same pattern as TagCoffeeSheet).
  const sheetY = useRef(new Animated.Value(900)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.spring(sheetY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
        speed: 16,
      }).start();
    } else if (mounted) {
      Animated.timing(sheetY, {
        toValue: 900,
        duration: 220,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Load photos on first open. We only re-query if the user grants
  // permission mid-session (toggling settings while the app is
  // backgrounded → returning); the `permission` state guards against
  // re-fetching on every render.
  useEffect(() => {
    if (!visible) return;
    if (Platform.OS === "web") return; // Web: no library access; user uses the Browse fallback.
    if (permission === "denied") return;
    loadPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function loadPhotos() {
    setLoading(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        setPermission("denied");
        setLoading(false);
        return;
      }
      setPermission("granted");
      const page = await MediaLibrary.getAssetsAsync({
        first: 90,
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      });
      setPhotos(
        page.assets.map((a) => ({
          id: a.id,
          uri: a.uri,
          creationTime: a.creationTime,
        })),
      );
    } catch (e) {
      console.warn("Gallery load failed:", e);
      setPermission("denied");
    } finally {
      setLoading(false);
    }
  }

  async function uploadAndReturn(
    uri: string,
    mimeType?: string,
    location?: string | null,
  ) {
    setUploading(true);
    try {
      const formData = new FormData();
      if (Platform.OS === "web") {
        const r = await fetch(uri);
        const blob = await r.blob();
        const mime = blob.type || mimeType || "image/jpeg";
        const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
        formData.append("file", blob, `upload_${Date.now()}.${ext}`);
      } else {
        const filename = uri.split("/").pop() || "photo.jpg";
        const match = /\.(\w+)$/.exec(filename);
        const ext = match ? match[1] : "jpg";
        const mime = mimeType || `image/${ext === "jpg" ? "jpeg" : ext}`;
        formData.append("file", {
          uri,
          name: filename,
          type: mime,
        } as any);
      }
      const raw = await apiUpload<{ url: string }>(
        "/upload/image?purpose=post",
        formData,
      );
      const res = (raw as any)?.data ?? raw;
      if (res?.url) {
        hapticCommit();
        onImagePicked(res.url, location ?? null);
        onClose();
      }
    } catch (e) {
      console.warn("Gallery upload failed:", e);
    } finally {
      setUploading(false);
    }
  }

  /**
   * Resolve a MediaLibrary asset into the data we need to upload:
   *   • `localUri`  — a real `file://` path that fetch/FormData can
   *     read. The grid's `asset.uri` is `ph://…` on iOS (a Photos
   *     framework URI) which the network stack can't open; calling
   *     `getAssetInfoAsync` materialises the photo to a temp file
   *     and returns its file path here.
   *   • `location`  — reverse-geocoded place name from the EXIF
   *     GPS, or null if the photo has no coordinates / geocoding
   *     fails.
   *
   * Returns `{ localUri: null }` on web (MediaLibrary is native-
   * only), in which case the caller falls through to the file-
   * input path.
   */
  async function resolveAsset(
    assetId: string,
  ): Promise<{ localUri: string | null; location: string | null }> {
    if (Platform.OS === "web") return { localUri: null, location: null };
    try {
      const info = await MediaLibrary.getAssetInfoAsync(assetId);
      const localUri = (info as any)?.localUri || (info as any)?.uri || null;
      const loc = (info as any)?.location;
      // The latitude/longitude can come back as numbers OR strings
      // depending on the platform / expo-media-library version. The
      // previous `typeof === "number"` check failed silently when
      // they arrived as strings (the user reported `hasLocation:
      // true, location: null` despite the photo having GPS). Coerce
      // with `Number()` and guard with `Number.isFinite` so any
      // numeric representation is accepted.
      const lat = loc != null ? Number(loc.latitude) : NaN;
      const lng = loc != null ? Number(loc.longitude) : NaN;
      let location: string | null = null;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        // Reverse-geocode without prompting for foreground location
        // permission — `reverseGeocodeAsync` doesn't require it
        // (it's a query against Apple/Google's tile service, not
        // the device GPS).
        try {
          const places = await Location.reverseGeocodeAsync({
            latitude: lat,
            longitude: lng,
          });
          const p = places?.[0];
          if (p) {
            const head = p.city || p.subregion || p.region || p.district;
            const tail = p.country;
            if (head && tail) location = `${head}, ${tail}`;
            else location = head || tail || null;
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("Reverse-geocode failed:", e);
        }
        // Always surface SOMETHING when the photo carries GPS — if
        // the geocoder returned nothing useful, fall back to the
        // raw lat/long so the chip still appears and the user can
        // see the photo's location was detected.
        if (!location) {
          location = `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
        }
      }
      // eslint-disable-next-line no-console
      console.log("[gallery] resolved asset", {
        assetId,
        hasLocalUri: !!localUri,
        hasLocation: !!loc,
        rawLat: loc?.latitude,
        rawLng: loc?.longitude,
        coercedLat: lat,
        coercedLng: lng,
        location,
      });
      return { localUri, location };
    } catch (e) {
      console.warn("[gallery] resolveAsset failed:", e);
      return { localUri: null, location: null };
    }
  }

  // Filter photos live by the search query. Matches against the
  // creation date in three forms: full month name, short month
  // name ("Sep"), and 4-digit year. Plus the literal strings
  // "today" / "yesterday" for quick recency picks. Empty query →
  // pass through.
  const filteredPhotos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return photos;
    const now = new Date();
    const today = now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yest = yesterday.toDateString();
    return photos.filter((p) => {
      if (!p.creationTime) return false;
      const d = new Date(p.creationTime);
      if (q === "today") return d.toDateString() === today;
      if (q === "yesterday") return d.toDateString() === yest;
      const monthLong = d
        .toLocaleString("en", { month: "long" })
        .toLowerCase();
      const monthShort = d
        .toLocaleString("en", { month: "short" })
        .toLowerCase();
      const year = String(d.getFullYear());
      return (
        monthLong.includes(q) || monthShort.includes(q) || year.includes(q)
      );
    });
  }, [photos, searchQuery]);

  const onPhotoPress = async (p: Photo) => {
    if (uploading) return;
    hapticTap();
    // Resolve the asset to a real `file://` URI before upload —
    // the grid's `p.uri` is `ph://…` on iOS which fetch can't read
    // (this is what was hanging the upload in an "infinite buffer"
    // state). `getAssetInfoAsync` materialises the asset and
    // returns the local file path, plus the EXIF location while
    // we're already paying the round-trip.
    const { localUri, location } = await resolveAsset(p.id);
    const uri = localUri || p.uri; // fallback if resolve returns nothing
    uploadAndReturn(uri, undefined, location);
  };

  // Web fallback — open the browser's native file dialog.
  // expo-image-picker's web implementation invokes a transient
  // <input type="file"> for us; we surface the same flow here so
  // users on web can still pick something.
  const browseWeb = async () => {
    hapticTap();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets[0]) {
        await uploadAndReturn(
          result.assets[0].uri,
          result.assets[0].mimeType,
        );
      }
    } catch (e) {
      console.warn("Browse fallback failed:", e);
    }
  };

  if (!mounted) return null;

  // Scrim opacity follows the sheet position so dragging the sheet
  // (future: not wired yet here, but kept consistent with
  // TagCoffeeSheet's approach) fades the scrim in lockstep.
  const scrimOpacity = sheetY.interpolate({
    inputRange: [0, 900],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  // 3-column grid sized to the sheet's content width minus a
  // 1-px separator between thumbs.
  const cols = 3;
  const gap = 1;
  const sheetInset = 0; // grid runs edge-to-edge per Figma
  const thumbSize = Math.floor(
    (width - sheetInset * 2 - gap * (cols - 1)) / cols,
  );

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={s.host}>
        <Animated.View style={[s.scrim, { opacity: scrimOpacity }]}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={onClose}
            accessibilityLabel="Close"
          />
        </Animated.View>

        <Animated.View
          style={[
            s.sheet,
            { top: insets.top + 60, transform: [{ translateY: sheetY }] },
          ]}
        >
          {/* Header — two modes:
                - Default: X close + Photos/Collections pill +
                  (right-side spacer so the pill stays optically
                  centred).
                - Search mode: X-cancel + text input that filters
                  photos by date string. The magnifier disc in the
                  floating bottom dock toggles into this mode. */}
          <View style={s.header}>
            <Pressable
              onPress={() => {
                if (searchMode) {
                  // Cancel search and return to default header.
                  setSearchMode(false);
                  setSearchQuery("");
                } else {
                  onClose();
                }
              }}
              style={s.closeBtn}
              hitSlop={8}
              accessibilityLabel={searchMode ? "Cancel search" : "Close gallery"}
              accessibilityRole="button"
            >
              <X size={16} color={t.color["text.secondary"] as string} strokeWidth={2} />
            </Pressable>
            {searchMode ? (
              <View style={s.searchInputWrap}>
                <TextInput
                  style={s.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Today, September, 2024…"
                  placeholderTextColor={t.color["text.muted"] as string}
                  autoFocus
                  returnKeyType="search"
                />
              </View>
            ) : (
              <View style={s.tabPill}>
                <Pressable
                  onPress={() => setTab("photos")}
                  style={[s.tab, tab === "photos" && s.tabActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === "photos" }}
                >
                  <Text style={[s.tabLabel, tab === "photos" && s.tabLabelActive]}>
                    Photos
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setTab("collections")}
                  style={[s.tab, tab === "collections" && s.tabActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === "collections" }}
                >
                  <Text
                    style={[
                      s.tabLabel,
                      tab === "collections" && s.tabLabelActive,
                    ]}
                  >
                    Collections
                  </Text>
                </Pressable>
              </View>
            )}
            {/* Right-side spacer mirrors the close button so the
                pill stays optically centered. */}
            <View style={s.headerSpacer} />
          </View>

          {/* Body — 3-col photo grid (native) or browse CTA (web /
              denied permission / collections tab placeholder). */}
          <ScrollView
            style={s.bodyScroll}
            contentContainerStyle={s.bodyContent}
          >
            {tab === "photos" && Platform.OS !== "web" && permission !== "denied" ? (
              loading ? (
                <View style={s.loading}>
                  <ActivityIndicator size="small" color={t.color.accent} />
                </View>
              ) : filteredPhotos.length === 0 ? (
                <View style={s.emptyWrap}>
                  <Text style={s.emptyText}>
                    {searchQuery
                      ? `No photos for "${searchQuery}".`
                      : "No photos yet."}
                  </Text>
                </View>
              ) : (
                <View style={s.grid}>
                  {filteredPhotos.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => onPhotoPress(p)}
                      style={[
                        s.thumb,
                        { width: thumbSize, height: thumbSize },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Pick photo"
                    >
                      <Image
                        source={{ uri: p.uri }}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                        recyclingKey={p.id}
                      />
                    </Pressable>
                  ))}
                </View>
              )
            ) : tab === "collections" ? (
              <View style={s.emptyWrap}>
                <Text style={s.emptyText}>
                  Albums view coming soon.
                </Text>
              </View>
            ) : (
              // Web OR permission denied — fallback CTA.
              <View style={s.fallbackWrap}>
                <Text style={s.fallbackTitle}>
                  {permission === "denied"
                    ? "Photo access is off"
                    : "Browse your device"}
                </Text>
                <Text style={s.fallbackBody}>
                  {permission === "denied"
                    ? "Enable Photos access from system settings to pick from your library here."
                    : "Tap below to choose an image from your computer."}
                </Text>
                {permission !== "denied" ? (
                  <Pressable onPress={browseWeb} style={s.browseBtn}>
                    <Text style={s.browseBtnText}>Choose file</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </ScrollView>

          {/* Floating bottom dock — `position: absolute` so the
              photo grid extends behind it to the very bottom edge
              of the sheet (matches Figma 900:1908 where the last
              row of thumbnails fades into the sheet's bottom).
              Search disc toggles `searchMode`; tapping again exits
              and clears the query. */}
          <View style={s.dock} pointerEvents="box-none">
            <View style={s.dockCenter} pointerEvents="none">
              {/* Both glyph and label use constant Crema White
                  (`text.on-dark`) so the dock reads cleanly when
                  it floats over photos that may be light or dark.
                  Bold weight per the user's directive. */}
              <MapPin
                size={14}
                color={t.color["text.on-dark"] as string}
                strokeWidth={2.4}
              />
              <Text style={s.dockText}>Location Is Included</Text>
            </View>
            <Pressable
              onPress={() => {
                if (searchMode) {
                  setSearchMode(false);
                  setSearchQuery("");
                } else {
                  setSearchMode(true);
                }
              }}
              style={s.dockSearch}
              hitSlop={8}
              accessibilityLabel={searchMode ? "Close search" : "Search photos"}
              accessibilityRole="button"
            >
              <Search
                size={18}
                color={t.color["text.primary"] as string}
                strokeWidth={2}
              />
            </Pressable>
          </View>

          {uploading ? (
            <View style={s.uploadOverlay}>
              <ActivityIndicator size="large" color={t.color.accent} />
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  host: { flex: 1 } as any,
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(36,21,14,0.5)",
  } as any,
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: t.color.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  } as any,

  // ── Header ──────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  } as any,
  closeBtn: {
    width: 37,
    height: 37,
    borderRadius: 18.5,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  headerSpacer: { width: 37 } as any,
  // Photos / Collections pill — Figma shows a pill with a darker
  // active fill behind the selected tab. We approximate with the
  // brand's `accent.soft` for the active fill so it reads as a
  // muted Crema-pink wash without introducing a new colour.
  tabPill: {
    flexDirection: "row",
    backgroundColor: t.color["card.product.surface"],
    borderRadius: 999,
    padding: 4,
    gap: 4,
  } as any,
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
  } as any,
  tabActive: {
    backgroundColor: t.color["card.product.bg"],
  } as any,
  tabLabel: {
    fontFamily: t.font["body.medium"],
    fontSize: 14,
    color: t.color["text.secondary"],
  } as any,
  tabLabelActive: {
    fontFamily: t.font["body.semibold"],
    color: t.color["text.primary"],
  } as any,

  // ── Body / grid ─────────────────────────────────────────────
  // `paddingBottom: 0` so the photos truly extend to the very
  // bottom edge — the dock floats over them as an absolute
  // overlay (see `dock` below). The user can still scroll one
  // extra row up to bring obscured photos into the clear area
  // above the dock.
  bodyScroll: { flex: 1 } as any,
  bodyContent: { paddingBottom: 0 } as any,
  loading: {
    paddingVertical: 64,
    alignItems: "center",
  } as any,
  emptyWrap: {
    paddingVertical: 60,
    alignItems: "center",
  } as any,
  emptyText: {
    fontFamily: t.font["body.regular"],
    fontSize: 14,
    color: t.color["text.muted"],
  } as any,
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 1,
  } as any,
  thumb: {
    backgroundColor: t.color["card.info"],
    overflow: "hidden",
  } as any,

  // ── Web / denied fallback ──────────────────────────────────
  fallbackWrap: {
    paddingHorizontal: 24,
    paddingVertical: 48,
    alignItems: "center",
    gap: 10,
  } as any,
  fallbackTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: 16,
    color: t.color["text.primary"],
    textAlign: "center",
  } as any,
  fallbackBody: {
    fontFamily: t.font["body.regular"],
    fontSize: 14,
    color: t.color["text.secondary"],
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 20,
  } as any,
  browseBtn: {
    marginTop: 14,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: t.color.accent,
  } as any,
  browseBtnText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 14,
    color: t.color["text.on-cta"],
  } as any,

  // ── Bottom dock — floating overlay ──────────────────────────
  // Anchored to the bottom of the sheet via `position: absolute`
  // so the photo grid behind it extends edge-to-edge (last row
  // fades in/out of view under the dock). `pointerEvents: box-none`
  // lets taps on the empty space pass through to the photos
  // beneath; only the `dockSearch` Pressable inside the dock
  // captures clicks.
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 14,
  } as any,
  dockCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  } as any,
  // Crema White + bold per the user's directive. The label floats
  // over the photo grid, so we anchor it visually with an Espresso-
  // tinted drop shadow — the prior cream halo was the wrong direction
  // (cream-on-cream invisible against light photos). Espresso at
  // 55 % alpha gives the cream text a soft dark outline that reads
  // on both dark and light thumbnails.
  dockText: {
    fontFamily: t.font["body.bold"],
    fontSize: 12,
    color: t.color["text.on-dark"],
    textShadowColor: "rgba(53,17,1,0.55)",
    textShadowRadius: 4,
  } as any,
  dockSearch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
  } as any,

  // ── Search input (header swap) ──────────────────────────────
  searchInputWrap: {
    flex: 1,
    height: 38,
    borderRadius: 999,
    backgroundColor: t.color["card.product.bg"],
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 8,
  } as any,
  searchInput: {
    flex: 1,
    fontFamily: t.font["body.medium"],
    fontSize: 14,
    color: t.color["text.primary"],
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}),
  } as any,

  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.18)",
    alignItems: "center",
    justifyContent: "center",
  } as any,
}));
