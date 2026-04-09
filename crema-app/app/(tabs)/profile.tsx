import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, Pressable, RefreshControl,
  StyleSheet, useWindowDimensions, LayoutChangeEvent, Platform
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { Heart, MessageCircle, Plus } from "lucide-react-native";
import { useAuth } from "../../src/hooks/useAuth";
import { useShelves } from "../../src/hooks/useShelves";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useTastingNotes } from "../../src/hooks/useTastingNotes";
import { useSocial } from "../../src/hooks/useSocial";
import { colors, fonts, cardShadow, SHELF_LABELS, ShelfKey } from "../../src/theme/colors";
import ProfileEditModal from "../../src/components/ProfileEditModal";
import CoffeeCard from "../../src/components/CoffeeCard";
import TastingNoteDisplay from "../../src/components/TastingNoteDisplay";

type ProfileTab = "shelf" | "posts" | "activity";
const SHELF_KEYS: ShelfKey[] = ["currently_drinking", "drank", "want_to_try"];

const liningNumerals = Platform.OS === "web"
  ? { fontFeatureSettings: "'lnum', 'pnum'" } as any
  : {};

// ─── Icons ────────────────────────────────────────────────────────────────────

function EditIcon() {
  return (
    <Svg width={13} height={13} viewBox="0 0 14 14" fill="none">
      <Path
        d="M9.5 1.5L12.5 4.5M1 13H4L12.5 4.5L9.5 1.5L1 10V13Z"
        stroke="#C7BAA5"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function MapPinIcon() {
  return (
    <Svg width={12} height={14} viewBox="0 0 13.9221 17.2462" fill="none">
      <Path
        d="M0.75 6.89265C0.75 11.1977 4.51612 14.7577 6.18311 16.1227C6.42168 16.318 6.54239 16.4168 6.72038 16.467C6.85898 16.506 7.06296 16.506 7.20155 16.467C7.37988 16.4167 7.49975 16.3189 7.73922 16.1228C9.4062 14.7579 13.1721 11.1981 13.1721 6.89304C13.1721 5.26386 12.5178 3.70121 11.353 2.5492C10.1882 1.39719 8.60846 0.75 6.96117 0.75C5.31389 0.75 3.734 1.39729 2.56919 2.5493C1.40438 3.7013 0.75 5.26346 0.75 6.89265Z"
        stroke="#D798DA"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5.1865 6.0738C5.1865 7.05388 5.98101 7.8484 6.9611 7.8484C7.94118 7.8484 8.7357 7.05388 8.7357 6.0738C8.7357 5.09372 7.94118 4.2992 6.9611 4.2992C5.98101 4.2992 5.1865 5.09372 5.1865 6.0738Z"
        stroke="#D798DA"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ─── CoffeeGrid ───────────────────────────────────────────────────────────────

const GAP = 20;
const TARGET_CARD_W = 240;
const CARD_ASPECT = 400 / 240;
const GRID_PAD = 16;

function CoffeeGrid({
  coffees,
  shelfMode,
  activeShelf,
  onMove,
  onRemove,
}: {
  coffees: Array<{ coffee: any; entryId: string }>;
  shelfMode?: boolean;
  activeShelf?: ShelfKey;
  onMove?: (productId: string, shelf: string) => void;
  onRemove?: (entryId: string) => void;
}) {
  const [containerW, setContainerW] = useState(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerW(e.nativeEvent.layout.width);
  }, []);

  const availableWidth = containerW > 0 ? containerW - GRID_PAD * 2 : 960;
  const numCols = Math.max(1, Math.min(5, Math.round((availableWidth + GAP) / (TARGET_CARD_W + GAP))));
  const cardWidth = Math.floor((availableWidth - GAP * (numCols - 1)) / numCols);
  const cardHeight = Math.floor(cardWidth * CARD_ASPECT);

  if (coffees.length === 0) {
    return (
      <View style={g.empty}>
        <Text style={g.emptyText}>Nothing here yet.</Text>
        <Text style={g.emptySubtext}>Browse beans and tap ♥ to add coffees to this shelf.</Text>
      </View>
    );
  }

  return (
    <View onLayout={onLayout} style={[g.grid, { gap: GAP, paddingHorizontal: GRID_PAD, paddingBottom: 60 }]}>
      {coffees.map(({ coffee, entryId }) => (
        <View key={entryId} style={{ width: cardWidth, height: cardHeight }}>
          <CoffeeCard
            coffee={coffee}
            width={cardWidth}
            height={cardHeight}
            shelfMode={shelfMode}
            currentShelf={activeShelf}
            onMoveShelf={onMove}
            onRemove={onRemove ? () => onRemove(entryId) : undefined}
          />
        </View>
      ))}
    </View>
  );
}

const g = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  empty: { paddingVertical: 60, alignItems: "center", paddingHorizontal: 32 },
  emptyText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.textPrimary, marginBottom: 6 },
  emptySubtext: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.textSecondary, textAlign: "center" },
});

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MyShelfPage() {
  const { user, updateProfile } = useAuth();
  const { shelves, fetchShelves, addToShelf, removeFromShelf } = useShelves();
  const { productMap } = useCoffeeData();
  const { notes: myNotes, fetchMyNotes } = useTastingNotes();
  const social = useSocial();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  const [activeTab, setActiveTab] = useState<ProfileTab>("shelf");
  const [activeShelf, setActiveShelf] = useState<ShelfKey>("currently_drinking");
  const [refreshing, setRefreshing] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [userLikes, setUserLikes] = useState<any[]>([]);
  const [userComments, setUserComments] = useState<any[]>([]);

  useEffect(() => {
    if (user) { fetchShelves(); fetchMyNotes(); }
  }, [user]);

  useEffect(() => {
    if (user && activeTab === "activity") {
      social.fetchUserLikes(user.username).then((d: any) => setUserLikes(d.likes || [])).catch(() => {});
      social.fetchUserComments(user.username).then((d: any) => setUserComments(d.comments || [])).catch(() => {});
    }
  }, [user, activeTab]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchShelves();
    await fetchMyNotes();
    setRefreshing(false);
  };

  if (!user) return null;

  const heroH = Math.max(300, Math.min(480, Math.round(width * 0.32)));
  const drankCount = (shelves.drank || []).length;
  const totalShelfItems = SHELF_KEYS.reduce((sum, k) => sum + (shelves[k] || []).length, 0);

  const initials = (user.display_name || user.username || "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // Resolve shelf entries → { coffee, entryId }[]
  const shelfCoffees = (shelves[activeShelf] || [])
    .map((entry: any) => ({ coffee: productMap?.get(entry.product_id), entryId: entry.id }))
    .filter((e: any) => e.coffee != null) as Array<{ coffee: any; entryId: string }>;

  const handleMoveShelf = async (productId: string, toShelf: string) => {
    await addToShelf(productId, toShelf);
    await fetchShelves();
  };

  // ── Sidebar (desktop) ────────────────────────────────────────────────────────

  const renderSidebar = () => (
    <View style={s.sidebarOuter}>
      <View style={s.sidebarInner}>
        <Text style={[s.sidebarName, liningNumerals]}>{user.display_name || user.username}</Text>
        <Text style={s.sidebarUsername}>@{user.username}</Text>

        {/* My Shelf */}
        <View style={s.filterSection}>
          <View style={s.filterDivider} />
          <Pressable onPress={() => setActiveTab("shelf")} style={s.tabItemRow}>
            <Text style={[s.filterTitle, activeTab === "shelf" && s.filterTitleActive]}>My Shelf</Text>
            <View style={[s.countBadge, activeTab === "shelf" && s.countBadgeActive]}>
              <Text style={[s.countBadgeText, activeTab === "shelf" && s.countBadgeTextActive]}>{totalShelfItems}</Text>
            </View>
          </Pressable>
          {activeTab === "shelf" && SHELF_KEYS.map(key => (
            <Pressable key={key} onPress={() => setActiveShelf(key)} style={s.shelfSubRow}>
              <View style={[s.shelfDot, { backgroundColor: SHELF_LABELS[key].color, opacity: activeShelf === key ? 1 : 0.35 }]} />
              <Text style={[s.shelfSubLabel, activeShelf === key && s.shelfSubLabelActive]}>
                {SHELF_LABELS[key].label}
              </Text>
              <Text style={s.shelfSubCount}>{(shelves[key] || []).length}</Text>
            </Pressable>
          ))}
        </View>

        {/* My Posts */}
        <View style={s.filterSection}>
          <View style={s.filterDivider} />
          <Pressable onPress={() => setActiveTab("posts")} style={s.tabItemRow}>
            <Text style={[s.filterTitle, activeTab === "posts" && s.filterTitleActive]}>My Posts</Text>
            {myNotes.length > 0 && (
              <View style={[s.countBadge, activeTab === "posts" && s.countBadgeActive]}>
                <Text style={[s.countBadgeText, activeTab === "posts" && s.countBadgeTextActive]}>{myNotes.length}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* My Activity */}
        <View style={s.filterSection}>
          <View style={s.filterDivider} />
          <Pressable onPress={() => setActiveTab("activity")} style={s.tabItemRow}>
            <Text style={[s.filterTitle, activeTab === "activity" && s.filterTitleActive]}>My Activity</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  // ── Content area ─────────────────────────────────────────────────────────────

  const renderContent = () => {
    if (activeTab === "shelf") {
      return (
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.gridHeading, liningNumerals]} numberOfLines={1}>
            {`${SHELF_LABELS[activeShelf].label} — ${shelfCoffees.length} ${shelfCoffees.length === 1 ? "coffee" : "coffees"}`}
          </Text>
          <CoffeeGrid
            coffees={shelfCoffees}
            shelfMode
            activeShelf={activeShelf}
            onMove={handleMoveShelf}
            onRemove={(entryId) => removeFromShelf(entryId)}
          />
        </View>
      );
    }

    if (activeTab === "posts") {
      return (
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.gridHeading, liningNumerals]}>My Tasting Notes</Text>
          {myNotes.length === 0 ? (
            <View style={s.emptyContainer}>
              <Text style={s.emptyText}>No tasting notes yet.</Text>
              <Text style={s.emptySubtext}>Add a coffee to your shelf and write your first note.</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: GRID_PAD, paddingBottom: 60 }}>
              {myNotes.map((note: any) => {
                const coffee = productMap?.get(note.product_id);
                return (
                  <View key={note.id} style={s.postCard}>
                    {coffee && (
                      <Pressable onPress={() => router.push(`/coffee/${coffee.product_id}`)} style={s.postCoffeeRow}>
                        {coffee.image_url ? (
                          <Image source={{ uri: coffee.image_url }} style={s.postThumb} contentFit="cover" />
                        ) : (
                          <View style={[s.postThumb, { backgroundColor: colors.tagBg }]} />
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={s.postCoffeeName} numberOfLines={1}>{coffee.coffee_name}</Text>
                          <Text style={s.postRoaster} numberOfLines={1}>{coffee.roaster_name}</Text>
                        </View>
                      </Pressable>
                    )}
                    <TastingNoteDisplay note={note} />
                  </View>
                );
              })}
            </View>
          )}
        </View>
      );
    }

    if (activeTab === "activity") {
      const items = [
        ...userLikes.map((l: any) => ({ ...l, _type: "like", _date: l.liked_at })),
        ...userComments.map((c: any) => ({ ...c, _type: "comment", _date: c.created_at })),
      ].sort((a, b) => (b._date || "").localeCompare(a._date || ""));

      return (
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.gridHeading, liningNumerals]}>My Activity</Text>
          {items.length === 0 ? (
            <View style={s.emptyContainer}>
              <Text style={s.emptyText}>No activity yet.</Text>
              <Text style={s.emptySubtext}>Like and comment on posts in the feed.</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: GRID_PAD, paddingBottom: 60 }}>
              {items.map((item: any, i: number) => (
                <View key={`${item._type}-${item.id || i}`} style={s.activityRow}>
                  <View style={[s.activityIcon, {
                    backgroundColor: item._type === "like" ? `${colors.purple}20` : `${colors.textPrimary}15`,
                  }]}>
                    {item._type === "like" ? (
                      <Heart size={14} color={colors.purple} fill={colors.purple} />
                    ) : (
                      <MessageCircle size={14} color={colors.textSecondary} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    {item._type === "like" ? (
                      <Text style={s.activityText}>
                        Liked <Text style={s.activityBold}>{item.note_author?.display_name}</Text>'s note
                      </Text>
                    ) : (
                      <>
                        <Text style={s.activityText}>
                          Commented on <Text style={s.activityBold}>{item.note_author?.display_name}</Text>'s note
                        </Text>
                        <Text style={s.activityPreview} numberOfLines={2}>"{item.comment}"</Text>
                      </>
                    )}
                    <Text style={s.activityDate}>{new Date(item._date).toLocaleDateString()}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      );
    }

    return null;
  };

  // ── Mobile tab bar ────────────────────────────────────────────────────────────

  const renderMobileTabs = () => (
    <View>
      <View style={s.mobileTabRow}>
        {(["shelf", "posts", "activity"] as ProfileTab[]).map(tab => (
          <Pressable key={tab} onPress={() => setActiveTab(tab)} style={[s.mobileTab, activeTab === tab && s.mobileTabActive]}>
            <Text style={[s.mobileTabLabel, activeTab === tab && s.mobileTabLabelActive]}>
              {tab === "shelf" ? "My Shelf" : tab === "posts" ? "My Posts" : "Activity"}
            </Text>
          </Pressable>
        ))}
      </View>
      {activeTab === "shelf" && (
        <View style={s.mobileShelfTabs}>
          {SHELF_KEYS.map(key => (
            <Pressable key={key} onPress={() => setActiveShelf(key)} style={[s.mobileShelfTab, activeShelf === key && s.mobileShelfTabActive]}>
              <View style={[s.shelfDot, { backgroundColor: SHELF_LABELS[key].color, opacity: activeShelf === key ? 1 : 0.4 }]} />
              <Text style={[s.mobileShelfLabel, activeShelf === key && s.mobileShelfLabelActive]}>
                {SHELF_LABELS[key].label}
              </Text>
              <Text style={s.shelfSubCount}>{(shelves[key] || []).length}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <View style={s.container}>
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* ── Hero ──────────────────────────────────────────────────── */}
        <View style={[s.hero, { height: heroH }]}>

          {/* Left — name, bio, stats */}
          <View style={s.heroLeft}>

            {/* Edit button — top right corner of heroLeft */}
            <Pressable onPress={() => setShowEditModal(true)} style={s.editBtn}>
              <EditIcon />
              <Text style={s.editBtnText}>Edit Profile</Text>
            </Pressable>

            <Text style={[s.heroName, liningNumerals]} numberOfLines={2}>
              {user.display_name || user.username}
            </Text>

            {user.bio ? (
              <Text style={s.heroBio}>{user.bio}</Text>
            ) : null}

            <View style={{ flex: 1 }} />

            {/* Stats band — mirrors tagBand in roaster page */}
            <View style={s.statsBand}>
              <View style={s.statsBandRule} />
              <Text style={[s.statsBandText, liningNumerals]}>
                {drankCount} {drankCount === 1 ? "coffee" : "coffees"} tried · Member since {new Date(user.created_at).getFullYear()}
              </Text>
              <View style={s.statsBandRule} />
            </View>

            {/* Footer row — location, preferences */}
            <View style={s.heroFooterRow}>
              {user.location ? (
                <View style={s.heroFooterItem}>
                  <MapPinIcon />
                  <Text style={s.heroFooterText}>{user.location.toUpperCase()}</Text>
                </View>
              ) : null}
              {(user.coffee_preference || user.brewing_style) ? (
                <View style={s.heroFooterItem}>
                  <Text style={s.heroFooterMuted}>
                    {[user.coffee_preference, user.brewing_style].filter(Boolean).join(" · ")}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Right — avatar */}
          <View style={s.heroRight}>
            {user.avatar_url ? (
              <Image
                source={{ uri: user.avatar_url }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
              />
            ) : (
              <View style={[StyleSheet.absoluteFillObject, s.avatarFallback]}>
                <Text style={s.initials}>{initials}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Body ──────────────────────────────────────────────────── */}
        {isDesktop ? (
          <View style={s.body}>
            {renderSidebar()}
            <View style={s.verticalDivider} />
            {renderContent()}
          </View>
        ) : (
          <View>
            {renderMobileTabs()}
            {renderContent()}
          </View>
        )}
      </ScrollView>

      {/* FAB — Browse to add coffee */}
      <Pressable onPress={() => router.push("/browse")} style={s.addFab}>
        <Plus size={18} color="#FFFFFF" />
        <Text style={s.addFabText}>Add Coffee</Text>
      </Pressable>

      <ProfileEditModal
        visible={showEditModal}
        user={user}
        onSave={async (data: any) => { await updateProfile(data); }}
        onClose={() => setShowEditModal(false)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },

  // ── Hero ──────────────────────────────────────────────────────────
  hero: {
    flexDirection: "row",
    backgroundColor: "#2a0d00",
    overflow: "hidden",
  },

  heroLeft: {
    flex: 42,
    paddingLeft: "6.25%" as any,
    paddingRight: 24,
    paddingTop: 44,
    paddingBottom: 32,
    flexDirection: "column",
    overflow: "hidden",
    position: "relative",
  } as any,

  editBtn: {
    position: "absolute" as any,
    top: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(199,186,165,0.4)",
    zIndex: 10,
  } as any,
  editBtnText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: "#C7BAA5",
  },

  heroName: {
    fontFamily: fonts.displayRegular,
    fontSize: 56.8,
    color: "#FAF8F0",
    lineHeight: 62,
    marginTop: 36,
  },

  heroBio: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: "#C7BAA5",
    lineHeight: 18,
    marginTop: 12,
  },

  statsBand: {
    marginBottom: 14,
    paddingRight: 32,
  },
  statsBandRule: {
    height: 1,
    backgroundColor: "rgba(250,248,240,0.35)",
  },
  statsBandText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: "#FAF8F0",
    lineHeight: 18,
    paddingVertical: 7,
  },

  heroFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 28,
  },
  heroFooterItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroFooterText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: "#C7BAA5",
  },
  heroFooterMuted: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: "rgba(199,186,165,0.7)",
    textTransform: "capitalize" as any,
  },

  heroRight: {
    flex: 58,
    overflow: "hidden",
    position: "relative",
  } as any,

  avatarFallback: {
    backgroundColor: "#1a0800",
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    fontFamily: fonts.displayRegular,
    fontSize: 96,
    color: "rgba(250,248,240,0.2)",
  },

  // ── Body ──────────────────────────────────────────────────────────
  body: {
    flexDirection: "row",
    paddingLeft: "6.25%" as any,
    paddingRight: "6.25%" as any,
    alignItems: "flex-start",
  } as any,

  // Sidebar — sticky below navbar
  sidebarOuter: {
    width: 195,
    minWidth: 195,
    maxWidth: 195,
    flexShrink: 0,
    position: "sticky" as any,
    top: 72,
    alignSelf: "flex-start",
  } as any,

  sidebarInner: {
    paddingTop: 20,
    paddingRight: 16,
    paddingBottom: 40,
  },

  sidebarName: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  sidebarUsername: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: 4,
  },

  filterSection: { marginBottom: 4 },
  filterDivider: { height: 1, backgroundColor: "#D7D1C4", marginVertical: 12 },

  tabItemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  filterTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    letterSpacing: -0.375,
    color: colors.textMuted,
  },
  filterTitleActive: {
    color: colors.textPrimary,
  },

  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: colors.tagBg,
  },
  countBadgeActive: { backgroundColor: `${colors.textPrimary}15` as any },
  countBadgeText: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.textMuted },
  countBadgeTextActive: { color: colors.textPrimary },

  // Shelf sub-items
  shelfSubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 5,
    marginBottom: 2,
  },
  shelfDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  shelfSubLabel: {
    flex: 1,
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: colors.textMuted,
    letterSpacing: -0.26,
  },
  shelfSubLabelActive: {
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  shelfSubCount: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
  },

  // Vertical divider
  verticalDivider: {
    width: 1,
    backgroundColor: "rgba(215,209,196,0.5)",
    alignSelf: "stretch",
    marginTop: 20,
  } as any,

  // Grid heading
  gridHeading: {
    fontFamily: fonts.displayRegular,
    fontSize: 28,
    color: colors.textPrimary,
    lineHeight: 33.6,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 20,
  },

  // Mobile tabs
  mobileTabRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 24,
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
  },
  mobileTab: {
    paddingBottom: 10,
    borderBottomWidth: 2.5,
    borderBottomColor: "transparent",
  },
  mobileTabActive: { borderBottomColor: colors.textPrimary },
  mobileTabLabel: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.textMuted },
  mobileTabLabelActive: { color: colors.textPrimary },

  mobileShelfTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 10,
  },
  mobileShelfTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: colors.tagBg,
  },
  mobileShelfTabActive: {
    backgroundColor: `${colors.textPrimary}15` as any,
  },
  mobileShelfLabel: {
    fontFamily: fonts.bodyRegular,
    fontSize: 12,
    color: colors.textMuted,
  },
  mobileShelfLabelActive: {
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },

  // Posts
  postCard: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: colors.cardFront,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...cardShadow,
  },
  postCoffeeRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  postThumb: { width: 44, height: 44, borderRadius: 4 },
  postCoffeeName: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.textPrimary },
  postRoaster: { fontFamily: fonts.bodyRegular, fontSize: 11, color: colors.textMuted, marginTop: 2 },

  // Activity
  activityRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  activityText: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.textSecondary },
  activityBold: { fontFamily: fonts.bodySemiBold, color: colors.textPrimary },
  activityPreview: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.textMuted, marginTop: 2, fontStyle: "italic" },
  activityDate: { fontFamily: fonts.bodyRegular, fontSize: 11, color: colors.textMuted, marginTop: 4 },

  // Empty states
  emptyContainer: { paddingVertical: 60, alignItems: "center", paddingHorizontal: 32 },
  emptyText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.textPrimary, marginBottom: 6 },
  emptySubtext: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.textMuted, textAlign: "center" },

  // FAB
  addFab: {
    position: "absolute" as any,
    bottom: 24,
    right: 80,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.textPrimary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  } as any,
  addFabText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.textOnDark },
});
