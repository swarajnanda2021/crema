/**
 * ProfileDropdown — Chrome-style profile menu anchored to the navbar avatar.
 *
 * Shows current account header, menu items (Manage / Edit / Sign out),
 * and a multi-account switcher with "Add another account".
 */
import { useState, useEffect, useRef } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Settings, PenLine, LogOut, UserPlus, QrCode, Trash2, X } from "lucide-react-native";
import { t, cardShadow } from "../tokens/useTokens";
import { resolveUploadUrl } from "../api/client";
import { useAuth, SavedAccount } from "../hooks/useAuth";
import { emit } from "../utils/events";
import { CroppedAvatar } from "./primitives";
import QRModal from "./QRModal";
import RecycleBinModal from "./RecycleBinModal";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Full-viewport mode for the mobile /account Stack screen. */
  fullScreen?: boolean;
}

export default function ProfileDropdown({ visible, onClose, fullScreen }: Props) {
  const { user, logout, switchAccount, getSavedAccounts, removeSavedAccount } = useAuth();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showBin, setShowBin] = useState(false);
  const cardRef = useRef<any>(null);

  // Outside-click dismissal on web — mirrors Messages + Notifications
  // so opening this dropdown no longer freezes the rest of the site.
  // Armed 150ms after open so the opening click doesn't instantly
  // close the panel. Ignores clicks inside the card or on the navbar
  // (toggle-off logic on the avatar button still works).
  useEffect(() => {
    if (!visible || Platform.OS !== "web" || fullScreen) return;
    let armed = false;
    const armTimer = setTimeout(() => { armed = true; }, 150);
    const handler = (e: MouseEvent) => {
      if (!armed) return;
      const card = cardRef.current as any;
      const target = e.target as Node;
      if (card && typeof card.contains === "function" && card.contains(target)) return;
      const navbar = (typeof document !== "undefined")
        ? document.querySelector('[data-role="navbar"]') : null;
      if (navbar && (navbar as any).contains && (navbar as any).contains(target)) return;
      onClose();
    };
    if (typeof document !== "undefined") document.addEventListener("click", handler);
    return () => {
      clearTimeout(armTimer);
      if (typeof document !== "undefined") document.removeEventListener("click", handler);
    };
  }, [visible, onClose]);

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
    } else if (user.account_type === "cafe" && user.cafe_slug) {
      router.push(`/cafe/${user.cafe_slug}` as any);
    } else {
      router.push("/profile");
    }
  };

  const handleEdit = () => {
    onClose();
    if (user.account_type === "roaster" && user.roaster_slug) {
      router.push(`/roaster/${user.roaster_slug}?edit=1`);
    } else if (user.account_type === "cafe" && user.cafe_slug) {
      router.push(`/cafe/${user.cafe_slug}?edit=1` as any);
    } else {
      // Navigate to profile page, then signal edit mode via custom
      // event (Expo Router tabs don't re-render params on same-route
      // push). Delay generously — the account panel's exit animation
      // runs ~220ms; we want the event to arrive AFTER the panel's
      // backdrop + slide are fully gone so the edit banner doesn't
      // animate in on top of the dying panel. (§2.40.5)
      router.push("/profile");
      setTimeout(() => emit("crema:edit-profile"), 280);
    }
  };

  const handleSignOut = async () => {
    onClose();
    // `logout()` handles its own navigation — hard-reloads into the
    // next saved account's entity home on web, or resets to "/" when
    // none are left. Calling `router.replace("/")` afterwards used
    // to cause a flicker by briefly routing through a client-side
    // "/" before the hard reload took over.
    await logout();
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
    // Open the sitewide floating AuthModal instead of navigating away —
    // users keep their current page and can add a second account inline.
    if (Platform.OS === "web") {
      emit("crema:open-auth-modal");
    } else {
      router.push("/auth?addAccount=1");
    }
  };

  const cardFixedStyle = fullScreen
    ? { flex: 1, width: "100%" as any }
    : Platform.OS === "web"
      ? { position: "fixed" as any, top: 72, right: 90, zIndex: 9999 }
      : { position: "absolute" as any, top: 8, right: 0, zIndex: 9999 };
  const cardOverrides = fullScreen
    ? { minWidth: undefined, maxWidth: undefined, width: "100%" as any, borderRadius: 0, shadowOpacity: 0, elevation: 0, backgroundColor: t.color.bg }
    : null;

  return (
    <>
      {/* No full-viewport backdrop — dismissed via outside-click
         listener above (web) or the avatar icon toggle (native). */}

      {/* Dropdown card */}
      <View ref={cardRef} style={[s.card, cardFixedStyle, cardOverrides]}>
        {/* FullScreen panel gets a "Account" title bar with an X
           close — mirrors SearchDropdown / NotificationsDropdown so
           every mobile slide-panel has a consistent dismiss
           affordance on top of the backdrop tap. */}
        {fullScreen && (
          <>
            <View style={s.panelHeader}>
              <Text style={s.panelTitle}>Account</Text>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                accessibilityLabel="Close"
                accessibilityRole="button"
                style={s.panelCloseBtn}
              >
                <X size={18} color={t.color["text.primary"]} strokeWidth={1.75} />
              </Pressable>
            </View>
            <View style={s.divider} />
          </>
        )}

        {/* ── Current account header — clickable, goes to profile ── */}
        <Pressable onPress={handleManage} style={({ pressed }) => [s.accountHeader, pressed && s.menuItemPressed]}>
          {user.avatar_url ? (
            <CroppedAvatar
              url={user.avatar_url}
              cropX={user.avatar_crop_x}
              cropY={user.avatar_crop_y}
              zoom={user.avatar_zoom}
              size={48}
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
        {user.account_type === "user" && (
          <MenuItem
            icon={<QrCode size={18} color="#684F44" strokeWidth={1.5} />}
            label="Show QR"
            onPress={() => setShowQR(true)}
          />
        )}
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
        {/* Recycle bin — opens the sitewide floating modal with every
           item the user has deleted, grouped by category. Populated by
           backend `services/trash.py` on every hard-delete path. */}
        <MenuItem
          icon={<Trash2 size={18} color="#684F44" strokeWidth={1.5} />}
          label="Recycle bin"
          onPress={() => setShowBin(true)}
        />

        <View style={s.divider} />

        <MenuItem
          icon={<LogOut size={18} color="#684F44" strokeWidth={1.5} />}
          label="Sign out"
          onPress={handleSignOut}
        />

        {/* ── Other accounts section ─────────────────────────── */}
        {others.length > 0 && (
          <View>
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
                  <CroppedAvatar url={acct.avatar_url} size={32} />
                ) : (
                  <View style={s.avatarSmallFallback}>
                    <Text style={s.avatarSmallInitials}>
                      {(acct.display_name || acct.username || "?")[0].toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={s.accountRowName} numberOfLines={1}>{acct.display_name}</Text>
                  <Text style={s.accountRowUser} numberOfLines={1}>@{acct.username}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <View style={s.divider} />

        <MenuItem
          icon={<UserPlus size={18} color="#684F44" strokeWidth={1.5} />}
          label="Add another account"
          onPress={handleAddAccount}
        />
      </View>

      {showQR && (
        <QRModal visible={showQR} onClose={() => setShowQR(false)} />
      )}
      {showBin && (
        <RecycleBinModal visible={showBin} onClose={() => setShowBin(false)} />
      )}
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

  // ── Panel title bar (fullScreen only)
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
  } as any,
  panelTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.lg"],
    color: t.color["text.primary"],
  } as any,
  panelCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
  } as any,

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
    fontFamily: t.font["body.semibold"],
    fontSize: 18,
    color: "#FAF8F0",
  },
  accountInfo: {
    flex: 1,
    minWidth: 0,
  },
  displayName: {
    fontFamily: t.font["body.semibold"],
    fontSize: 15,
    color: "#351101",
  },
  username: {
    fontFamily: t.font["body.regular"],
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
    fontFamily: t.font["body.medium"],
    fontSize: 14,
    color: "#351101",
  },

  // ── Section label
  sectionLabel: {
    fontFamily: t.font["body.medium"],
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
    fontFamily: t.font["body.medium"],
    fontSize: 13,
    color: "#351101",
  },
  accountRowUser: {
    fontFamily: t.font["body.regular"],
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
    fontFamily: t.font["body.semibold"],
    fontSize: 13,
    color: "#FAF8F0",
  },
});
