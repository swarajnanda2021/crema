/**
 * ProfileDropdown — Chrome-style profile menu anchored to the navbar avatar.
 *
 * Shows current account header, menu items (Manage / Edit / Sign out),
 * and a multi-account switcher with "Add another account".
 */
import { useState, useEffect } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Settings, PenLine, LogOut, UserPlus } from "lucide-react-native";
import { colors, fonts, cardShadow } from "../theme/colors";
import { resolveUploadUrl } from "../api/client";
import { useAuth, SavedAccount } from "../hooks/useAuth";

interface Props {
  visible: boolean;
  onClose: () => void;
  onEditProfile: () => void;
}

export default function ProfileDropdown({ visible, onClose, onEditProfile }: Props) {
  const { user, logout, switchAccount, getSavedAccounts, removeSavedAccount } = useAuth();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  // Delay backdrop so the opening click doesn't immediately close the dropdown
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (visible) {
      const id = setTimeout(() => setReady(true), 50);
      return () => { clearTimeout(id); setReady(false); };
    }
    setReady(false);
  }, [visible]);

  if (!visible || !user) return null;

  const initials = (user.display_name || user.username || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Other saved accounts (exclude the current user)
  const others = getSavedAccounts().filter((a) => a.username !== user.username);

  const handleManage = () => {
    onClose();
    if (user.account_type === "roaster" && user.roaster_slug) {
      router.push(`/roaster/${user.roaster_slug}`);
    } else {
      router.push("/profile");
    }
  };

  const handleEdit = () => {
    onClose();
    if (user.account_type === "roaster" && user.roaster_slug) {
      // Navigate to roaster profile page in edit mode
      router.push(`/roaster/${user.roaster_slug}?edit=1`);
    } else {
      // Consumer accounts — use the modal (future: in-place edit on profile page)
      onEditProfile();
    }
  };

  const handleSignOut = async () => {
    onClose();
    await logout();
    router.replace("/");
  };

  const handleSwitch = async (account: SavedAccount) => {
    if (switching) return;
    setSwitching(true);
    try {
      await switchAccount(account.token);
      onClose();
    } catch {
      // Token expired — remove stale account
      removeSavedAccount(account.username);
    } finally {
      setSwitching(false);
    }
  };

  const handleAddAccount = () => {
    onClose();
    router.push("/auth?addAccount=1");
  };

  // Inline styles for fixed positioning (StyleSheet.create can't handle conditional spreads)
  const backdropFixedStyle = Platform.OS === "web"
    ? { position: "fixed" as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 }
    : { position: "absolute" as any, top: -2000, left: -2000, width: 8000, height: 8000, zIndex: 9998 };

  const cardFixedStyle = Platform.OS === "web"
    ? { position: "fixed" as any, top: 72, right: 90, zIndex: 9999 }
    : { position: "absolute" as any, top: 8, right: 0, zIndex: 9999 };

  return (
    <>
      {/* Backdrop — delayed so the opening click doesn't close immediately */}
      {ready && <Pressable onPress={onClose} style={backdropFixedStyle} />}

      {/* Dropdown card */}
      <View style={[s.card, cardFixedStyle]}>
        {/* ── Current account header — clickable, goes to profile ── */}
        <Pressable onPress={handleManage} style={({ pressed }) => [s.accountHeader, pressed && s.menuItemPressed]}>
          {user.avatar_url ? (
            <Image
              source={{ uri: resolveUploadUrl(user.avatar_url) }}
              style={s.avatarLarge}
              contentFit="cover"
            />
          ) : (
            <View style={s.avatarLargeFallback}>
              <Text style={s.avatarLargeInitials}>{initials}</Text>
            </View>
          )}
          <View style={s.accountInfo}>
            <Text style={s.displayName} numberOfLines={1}>{user.display_name}</Text>
            <Text style={s.username} numberOfLines={1}>@{user.username}</Text>
          </View>
        </Pressable>

        <View style={s.divider} />

        {/* ── Menu items ─────────────────────────────────────── */}
        <MenuItem
          icon={<Settings size={18} color="#684F44" strokeWidth={1.5} />}
          label="Manage account"
          onPress={handleManage}
        />
        <MenuItem
          icon={<PenLine size={18} color="#684F44" strokeWidth={1.5} />}
          label="Edit profile"
          onPress={handleEdit}
        />

        <View style={s.divider} />

        <MenuItem
          icon={<LogOut size={18} color="#684F44" strokeWidth={1.5} />}
          label="Sign out"
          onPress={handleSignOut}
        />

        {/* ── Other accounts section ─────────────────────────── */}
        {others.length > 0 && (
          <>
            <View style={s.divider} />
            <Text style={s.sectionLabel}>Other accounts</Text>
            {others.map((acct) => (
              <Pressable
                key={acct.username}
                onPress={() => handleSwitch(acct)}
                style={({ pressed }) => [s.accountRow, pressed && s.menuItemPressed]}
                disabled={switching}
              >
                {acct.avatar_url ? (
                  <Image source={{ uri: resolveUploadUrl(acct.avatar_url) }} style={s.avatarSmall} contentFit="cover" />
                ) : (
                  <View style={s.avatarSmallFallback}>
                    <Text style={s.avatarSmallInitials}>
                      {(acct.display_name || acct.username)[0].toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={s.accountRowName} numberOfLines={1}>{acct.display_name}</Text>
                  <Text style={s.accountRowUser} numberOfLines={1}>@{acct.username}</Text>
                </View>
              </Pressable>
            ))}
          </>
        )}

        <View style={s.divider} />

        <MenuItem
          icon={<UserPlus size={18} color="#684F44" strokeWidth={1.5} />}
          label="Add another account"
          onPress={handleAddAccount}
        />
      </View>
    </>
  );
}

// ── Reusable menu item ───────────────────────────────────────────────────────

function MenuItem({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}
    >
      {icon}
      <Text style={s.menuItemText}>{label}</Text>
    </Pressable>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    minWidth: 280,
    maxWidth: 320,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },

  // ── Current account header
  accountHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  avatarLarge: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarLargeFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#351101",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLargeInitials: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 18,
    color: "#FAF8F0",
  },
  accountInfo: {
    flex: 1,
    minWidth: 0,
  },
  displayName: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: "#351101",
  },
  username: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    color: "#A09580",
    marginTop: 1,
  },

  // ── Divider
  divider: {
    height: 1,
    backgroundColor: "#EDE8E1",
    marginHorizontal: 12,
    marginVertical: 4,
  },

  // ── Menu item
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  menuItemPressed: {
    backgroundColor: "#FAF8F0",
  },
  menuItemText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: "#351101",
  },

  // ── Section label
  sectionLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: "#A09580",
    textTransform: "uppercase" as any,
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },

  // ── Saved account row
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  accountRowName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: "#351101",
  },
  accountRowUser: {
    fontFamily: fonts.bodyRegular,
    fontSize: 11,
    color: "#A09580",
  },
  avatarSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarSmallFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#351101",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSmallInitials: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: "#FAF8F0",
  },
});
