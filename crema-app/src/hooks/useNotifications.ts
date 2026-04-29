/**
 * useNotifications — lightweight hook for notification state.
 * Polls unread count every 30s, fetches full list on demand.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetchRaw } from "../api/client";

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

export function useNotifications(enabled: boolean = true) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<any>(null);

  const fetchUnreadCount = useCallback(async () => {
    if (!enabled) return;
    try {
      const raw = await apiFetchRaw<any>("/notification-count");
      const data = raw?.data ?? raw;
      setUnreadCount(data.count ?? 0);
    } catch {}
  }, [enabled]);

  const fetchNotifications = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const raw = await apiFetchRaw<any>("/notifications");
      const data = raw?.data ?? raw;
      const list = Array.isArray(data) ? data : [];
      setNotifications(list);
      setUnreadCount(list.filter((n: any) => !n.read).length || 0);
    } catch (e) { console.warn("Fetch notifications failed:", e); } finally {
      setLoading(false);
    }
  }, [enabled]);

  const markAllRead = useCallback(async () => {
    try {
      await apiFetchRaw("/notifications-mark-read", { method: "POST" });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (e) { console.warn("Mark all read failed:", e); }
  }, []);

  const markRead = useCallback(async (id: number) => {
    try {
      await apiFetchRaw(`/notification-read/${id}`, { method: "POST" });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (e) { console.warn("Mark read failed:", e); }
  }, []);

  // Poll unread count every 30s
  useEffect(() => {
    if (!enabled) return;
    fetchUnreadCount();
    intervalRef.current = setInterval(fetchUnreadCount, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [enabled, fetchUnreadCount]);

  return {
    notifications,
    unreadCount,
    loading,
    fetchNotifications,
    markAllRead,
    markRead,
    refresh: fetchNotifications,
  };
}
