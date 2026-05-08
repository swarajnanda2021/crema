/**
 * NotificationsProvider — sitewide cache for notifications.
 *
 * Pre-context, every component that needed notifications kept its
 * own state: the navbar badge (`Navbar.tsx` on wide, `MobileHeader`
 * on phones) for the unread count, and the `NotificationsDropdown`
 * panel for the full list. Each ran its own `useNotifications(...)`,
 * which meant every panel-open paid a fresh `/notifications` round-
 * trip even though the badge had already polled the count and the
 * list could share the same fetch. Same antipattern as the
 * `RoasterProfilesProvider` move — replace per-component state with
 * a single context, keep the hook signature so consumers don't need
 * to change.
 *
 * Behavior preserved: 30s unread-count polling for the badge,
 * on-demand list fetch when the panel opens, optimistic mark-read
 * mutations. The `enabled` parameter still gates polling so anonymous
 * sessions don't beat on the API.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { Image } from "expo-image";
import { apiFetchRaw, resolveUploadUrl } from "../api/client";

export type NotificationType =
  // ── Activity (social) ──────────────────────────────────────────────
  | "like"
  | "comment"
  | "follow"
  | "repost"
  | "comment_like"
  | "reply"
  // ── Catalog change fanout to roaster followers ────────────────────
  | "product_added"
  | "product_removed"
  // ── Cross-roaster sourcing-story fanout ───────────────────────────
  | "sourcing_story"
  // ── User ↔ user DMs ───────────────────────────────────────────────
  | "direct_message";

export interface Notification {
  id: number;
  type: NotificationType;
  actor_id: number;
  actor_username: string;
  actor_display_name: string;
  actor_avatar_url: string | null;
  actor_crop_x: number | null;
  actor_crop_y: number | null;
  actor_zoom: number | null;
  post_id: number | null;
  comment_id: number | null;
  direct_thread_id: number | null;
  // Catalog-change extras: "roaster:blue-tokai-coffee-roasters"
  target_slug: string | null;
  subject: string | null;
  read: boolean;
  created_at: string;
}

interface NotificationsCtx {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  fetchNotifications: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markRead: (id: number) => Promise<void>;
  refresh: () => Promise<void>;
  setEnabled: (on: boolean) => void;
}

const NotificationsContext = createContext<NotificationsCtx | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const intervalRef = useRef<any>(null);

  // Background-prefetch the full list whenever the badge poll sees
  // activity change. Without this the panel would only fetch on
  // open — by then the user is already waiting on a network round-
  // trip + a fresh avatar download. With it, the badge's 30-s
  // count-poll cascades into a list fetch on every new event, and
  // `fetchNotifications` immediately fires `Image.prefetch` for
  // every actor avatar — so opening the panel paints from cache.
  const lastSeenCountRef = useRef<number>(-1);

  const fetchNotifications = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const raw = await apiFetchRaw<any>("/notifications");
      const data = raw?.data ?? raw;
      const list = Array.isArray(data) ? data : [];
      setNotifications(list);
      setUnreadCount(list.filter((n: any) => !n.read).length || 0);
      // Eagerly warm expo-image's cache for every actor avatar in the
      // response. By the time React commits the panel rows, the
      // avatars are either already on disk or in flight on the same
      // network round-trip cycle as the list fetch — no second wait
      // for the row to render and only THEN start the image load.
      // Same antipattern as the roaster-page logo we already fixed:
      // surface the URL early, let the cache do the work in parallel.
      const seen = new Set<string>();
      for (const n of list) {
        const raw = (n as any)?.actor_avatar_url;
        if (!raw) continue;
        const url = resolveUploadUrl(raw);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        Image.prefetch(url).catch(() => {});
      }
    } catch (e) {
      console.warn("Fetch notifications failed:", e);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const fetchUnreadCount = useCallback(async () => {
    if (!enabled) return;
    try {
      const raw = await apiFetchRaw<any>("/notification-count");
      const data = raw?.data ?? raw;
      const newCount = data.count ?? 0;
      setUnreadCount(newCount);
      // Trigger a list fetch when the count actually changes (first
      // poll's `-1 → N` transition included). Stable counts skip the
      // fetch so the polling loop doesn't beat on /notifications.
      if (newCount !== lastSeenCountRef.current) {
        lastSeenCountRef.current = newCount;
        if (newCount > 0) fetchNotifications();
      }
    } catch {}
  }, [enabled, fetchNotifications]);

  const markAllRead = useCallback(async () => {
    try {
      await apiFetchRaw("/notifications-mark-read", { method: "POST" });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (e) {
      console.warn("Mark all read failed:", e);
    }
  }, []);

  const markRead = useCallback(async (id: number) => {
    try {
      await apiFetchRaw(`/notification-read/${id}`, { method: "POST" });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (e) {
      console.warn("Mark read failed:", e);
    }
  }, []);

  // Poll unread count every 30s while the session is authenticated.
  // Anonymous sessions skip the polling so the API isn't hit while
  // the user is on /auth or browsing logged-out.
  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }
    fetchUnreadCount();
    intervalRef.current = setInterval(fetchUnreadCount, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, fetchUnreadCount]);

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        fetchNotifications,
        markAllRead,
        markRead,
        refresh: fetchNotifications,
        setEnabled,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

/**
 * Backwards-compatible signature. The optional `enabled` param turns
 * polling on/off based on the auth state — internally it just toggles
 * the shared provider's `enabled` flag, so multiple consumers passing
 * `true` is fine (last writer wins; the badge typically owns this).
 */
export function useNotifications(enabled: boolean = true) {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error(
      "useNotifications must be used inside <NotificationsProvider>",
    );
  }
  // The badge components pass `!!user` as `enabled`. Forward that into
  // the provider so polling syncs with the auth state. Calling this in
  // a useEffect avoids a setState-during-render warning.
  useEffect(() => {
    ctx.setEnabled(enabled);
  }, [enabled, ctx]);
  return {
    notifications: ctx.notifications,
    unreadCount: ctx.unreadCount,
    loading: ctx.loading,
    fetchNotifications: ctx.fetchNotifications,
    markAllRead: ctx.markAllRead,
    markRead: ctx.markRead,
    refresh: ctx.refresh,
  };
}
