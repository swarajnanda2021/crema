import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl, StyleSheet, useWindowDimensions } from "react-native";
import { Heart, MessageCircle, Plus } from "lucide-react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/hooks/useAuth";
import { useShelves } from "../../src/hooks/useShelves";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useTastingNotes } from "../../src/hooks/useTastingNotes";
import { useSocial } from "../../src/hooks/useSocial";
import { colors, fonts, cardShadow, SHELF_LABELS, ShelfKey } from "../../src/theme/colors";
import ProfileCard from "../../src/components/ProfileCard";
import ProfileEditModal from "../../src/components/ProfileEditModal";
import CoffeeCard from "../../src/components/CoffeeCard";
import TastingNoteDisplay from "../../src/components/TastingNoteDisplay";

type ProfileTab = "shelf" | "posts" | "activity";

const SHELF_KEYS: ShelfKey[] = ["currently_drinking", "drank", "want_to_try"];
const SHELF_ORDER: ShelfKey[] = ["currently_drinking", "drank", "want_to_try"];

export default function MyShelfPage() {
  const { user, updateProfile } = useAuth();
  const { shelves, fetchShelves, addToShelf, removeFromShelf } = useShelves();
  const { products, productMap } = useCoffeeData();
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
      social.fetchUserLikes(user.username).then(d => setUserLikes(d.likes || [])).catch(() => {});
      social.fetchUserComments(user.username).then(d => setUserComments(d.comments || [])).catch(() => {});
    }
  }, [user, activeTab]);

  const onRefresh = async () => { setRefreshing(true); await fetchShelves(); await fetchMyNotes(); setRefreshing(false); };

  const handleSaveProfile = async (data: any) => {
    await updateProfile(data);
  };

  const handleMoveShelf = async (productId: string, toShelf: string) => {
    await addToShelf(productId, toShelf);
    await fetchShelves();
  };

  if (!user) return null;

  const drankCount = (shelves.drank || []).length;

  // Calculate card dimensions for shelf grid
  const contentWidth = isDesktop ? width - 260 - 160 - 48 : width - 32;
  const cardW = isDesktop ? Math.floor((contentWidth - 60) / 4) : Math.floor((contentWidth - 20) / 2);
  const cardH = Math.floor(cardW * 1.55);

  return (
    <View style={s.container}>
      {isDesktop ? (
        /* Desktop: fixed profile column + scrollable right content */
        <View style={s.desktopLayout}>
          {/* LEFT: Profile card — fixed, not scrollable */}
          <View style={s.profileColFixed}>
            <ProfileCard user={user} drankCount={drankCount} isOwner onEdit={() => setShowEditModal(true)} />
          </View>

          {/* RIGHT: Scrollable tabbed content */}
          <ScrollView
            style={s.contentScrollCol}
            contentContainerStyle={s.contentScrollInner}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          >
            <View style={s.tabRow}>
              <TabBtn label="My Shelf" active={activeTab === "shelf"} onPress={() => setActiveTab("shelf")} />
              <TabBtn label="My Posts" active={activeTab === "posts"} onPress={() => setActiveTab("posts")} />
              <TabBtn label="My Activity" active={activeTab === "activity"} onPress={() => setActiveTab("activity")} />
            </View>
            <View style={s.tabDivider} />

            {activeTab === "shelf" && (
              <ShelfTab shelves={shelves} activeShelf={activeShelf} setActiveShelf={setActiveShelf} productMap={productMap} onMove={handleMoveShelf} removeFromShelf={removeFromShelf} router={router} cardW={cardW} cardH={cardH} />
            )}
            {activeTab === "posts" && (
              <PostsTab myNotes={myNotes} productMap={productMap} router={router} />
            )}
            {activeTab === "activity" && (
              <ActivityTab likes={userLikes} comments={userComments} productMap={productMap} />
            )}
          </ScrollView>
        </View>
      ) : (
        /* Mobile: single scroll */
        <ScrollView
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        >
          <ProfileCard user={user} drankCount={drankCount} isOwner onEdit={() => setShowEditModal(true)} />
          <View style={{ marginTop: 24 }}>
            <View style={s.tabRow}>
              <TabBtn label="My Shelf" active={activeTab === "shelf"} onPress={() => setActiveTab("shelf")} />
              <TabBtn label="My Posts" active={activeTab === "posts"} onPress={() => setActiveTab("posts")} />
              <TabBtn label="My Activity" active={activeTab === "activity"} onPress={() => setActiveTab("activity")} />
            </View>
            <View style={s.tabDivider} />

            {activeTab === "shelf" && (
              <ShelfTab shelves={shelves} activeShelf={activeShelf} setActiveShelf={setActiveShelf} productMap={productMap} onMove={handleMoveShelf} removeFromShelf={removeFromShelf} router={router} cardW={cardW} cardH={cardH} />
            )}
            {activeTab === "posts" && (
              <PostsTab myNotes={myNotes} productMap={productMap} router={router} />
            )}
            {activeTab === "activity" && (
              <ActivityTab likes={userLikes} comments={userComments} productMap={productMap} />
            )}
          </View>
        </ScrollView>
      )}

      {/* Sticky "Add coffee" button */}
      <Pressable onPress={() => router.push("/browse")} style={s.addFab}>
        <Plus size={20} color="#FFFFFF" />
        <Text style={s.addFabText}>Add Coffee</Text>
      </Pressable>

      <ProfileEditModal
        visible={showEditModal}
        user={user}
        onSave={handleSaveProfile}
        onClose={() => setShowEditModal(false)}
      />
    </View>
  );
}

function TabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.tabBtn, active && s.tabBtnActive]}>
      <Text style={[s.tabLabel, active && s.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

// ── SHELF TAB ───────────────────────────────────────────────────────────────

function ShelfTab({ shelves, activeShelf, setActiveShelf, productMap, onMove, removeFromShelf, router, cardW, cardH }: any) {
  const nextShelf = (current: ShelfKey): ShelfKey => {
    const idx = SHELF_ORDER.indexOf(current);
    return SHELF_ORDER[(idx + 1) % SHELF_ORDER.length];
  };

  return (
    <View>
      {/* Shelf sub-tabs — text only, no icons */}
      <View style={s.shelfTabRow}>
        {SHELF_KEYS.map((key) => {
          const count = (shelves[key] || []).length;
          const isActive = activeShelf === key;
          return (
            <Pressable key={key} onPress={() => setActiveShelf(key)} style={[s.shelfTab, isActive && s.shelfTabActive]}>
              <Text style={[s.shelfTabLabel, isActive && s.shelfTabLabelActive]}>{SHELF_LABELS[key].label}</Text>
              <View style={[s.shelfTabBadge, isActive && s.shelfTabBadgeActive]}>
                <Text style={[s.shelfTabCount, isActive && s.shelfTabCountActive]}>{count}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Shelf items as card grid */}
      {(shelves[activeShelf] || []).length === 0 ? (
        <View style={s.emptyContainer}>
          <Text style={s.emptyText}>No coffees on this shelf yet.</Text>
          <Text style={s.emptySubtext}>Browse beans and tap the heart to add coffees.</Text>
        </View>
      ) : (
        <View style={s.shelfGrid}>
          {(shelves[activeShelf] as any[]).map((entry: any) => {
            const coffee = productMap?.get(entry.product_id);
            if (!coffee) return null;
            return (
              <View key={entry.id} style={{ width: cardW }}>
                <CoffeeCard
                  coffee={coffee}
                  width={cardW}
                  height={cardH}
                  shelfMode
                  currentShelf={activeShelf}
                  onMoveShelf={onMove}
                  onRemove={() => removeFromShelf(entry.id)}
                />
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ── POSTS TAB ───────────────────────────────────────────────────────────────

function PostsTab({ myNotes, productMap, router }: any) {
  if (!myNotes || myNotes.length === 0) {
    return (
      <View style={s.emptyContainer}>
        <Text style={s.emptyText}>No tasting notes yet.</Text>
        <Text style={s.emptySubtext}>Add a coffee to your shelf and write a tasting note.</Text>
      </View>
    );
  }

  return (
    <View>
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
  );
}

// ── ACTIVITY TAB ────────────────────────────────────────────────────────────

function ActivityTab({ likes, comments }: any) {
  const items = [
    ...likes.map((l: any) => ({ ...l, _type: "like", _date: l.liked_at })),
    ...comments.map((c: any) => ({ ...c, _type: "comment", _date: c.created_at })),
  ].sort((a, b) => (b._date || "").localeCompare(a._date || ""));

  if (items.length === 0) {
    return (
      <View style={s.emptyContainer}>
        <Text style={s.emptyText}>No activity yet.</Text>
        <Text style={s.emptySubtext}>Like and comment on posts in the feed.</Text>
      </View>
    );
  }

  return (
    <View>
      {items.map((item: any, i: number) => (
        <View key={`${item._type}-${item.id || i}`} style={s.activityRow}>
          <View style={[s.activityIcon, { backgroundColor: item._type === "like" ? `${colors.purple}20` : `${colors.textPrimary}15` }]}>
            {item._type === "like" ? (
              <Heart size={14} color={colors.purple} fill={colors.purple} />
            ) : (
              <MessageCircle size={14} color={colors.textSecondary} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            {item._type === "like" ? (
              <>
                <Text style={s.activityText}>
                  Liked <Text style={s.activityBold}>{item.note_author?.display_name}</Text>'s note
                </Text>
                {item.comment && <Text style={s.activityPreview} numberOfLines={1}>"{item.comment}"</Text>}
              </>
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
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    paddingBottom: 100,
  },
  // Desktop: side-by-side, profile fixed, content scrolls
  desktopLayout: {
    flex: 1,
    flexDirection: "row",
    paddingHorizontal: 80,
    paddingTop: 24,
    maxWidth: 1600,
    alignSelf: "center" as any,
    width: "100%" as any,
    gap: 24,
  } as any,
  profileColFixed: {
    width: 260,
    alignSelf: "flex-start" as any,
    position: "sticky" as any,
    top: 96,
  } as any,
  contentScrollCol: {
    flex: 1,
  },
  contentScrollInner: {
    paddingBottom: 100,
  },

  // Main tab bar
  tabRow: { flexDirection: "row", gap: 24 },
  tabBtn: { paddingBottom: 10, borderBottomWidth: 3, borderBottomColor: "transparent" },
  tabBtnActive: { borderBottomColor: colors.textPrimary },
  tabLabel: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.textMuted },
  tabLabelActive: { color: colors.textPrimary },
  tabDivider: { height: 1, backgroundColor: colors.divider, marginBottom: 16 },

  // Shelf sub-tabs — text only, no icons
  shelfTabRow: { flexDirection: "row", gap: 20, marginBottom: 20 },
  shelfTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  shelfTabActive: { borderBottomColor: colors.textPrimary },
  shelfTabLabel: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.textMuted },
  shelfTabLabelActive: { color: colors.textPrimary },
  shelfTabBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: colors.tagBg,
  },
  shelfTabBadgeActive: { backgroundColor: `${colors.textPrimary}15` as any },
  shelfTabCount: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.textMuted },
  shelfTabCountActive: { color: colors.textPrimary },

  // Shelf card grid
  shelfGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 20,
  },

  // Sticky add button
  addFab: {
    position: "absolute",
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

  // Posts
  postCard: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: colors.cardFront,
    borderRadius: 12,
    ...cardShadow,
  },
  postCoffeeRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  postThumb: { width: 40, height: 40, borderRadius: 4 },
  postCoffeeName: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.textPrimary },
  postRoaster: { fontFamily: fonts.bodyRegular, fontSize: 11, color: colors.textMuted },

  // Activity
  activityRow: { flexDirection: "row", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.borderLight },
  activityIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  activityText: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.textSecondary },
  activityBold: { fontFamily: fonts.bodySemiBold, color: colors.textPrimary },
  activityPreview: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.textMuted, marginTop: 2, fontStyle: "italic" },
  activityDate: { fontFamily: fonts.bodyRegular, fontSize: 11, color: colors.textMuted, marginTop: 4 },

  // Empty states
  emptyContainer: { paddingVertical: 48, alignItems: "center" },
  emptyText: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.textPrimary, marginBottom: 6 },
  emptySubtext: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.textMuted },
});
