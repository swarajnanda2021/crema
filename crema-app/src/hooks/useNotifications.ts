/**
 * useNotifications — lightweight hook for notification state.
 * Polls unread count every 30s, fetches full list on demand.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../api/client";

export interface Notification {
  id: number;
  type: "like" | "comment" | "follow" | "repost" | "comment_like";
  actor_id: number;
  actor_username: string;
  actor_display_name: string;
  actor_avatar_url: string | null;
  actor_crop_x: number | null;
  actor_crop_y: number | null;
  actor_zoom: number | null;
  post_id: number | null;
  comment_id: number | null;
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
      const data = await apiFetch<{ count: number }>("/notifications/unread-count");
      setUnreadCount(data.count);
    } catch {}
  }, [enabled]);

  const fetchNotifications = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const data = await apiFetch<{ notifications: Notification[] }>("/notifications");
      setNotifications(data.notifications || []);
      setUnreadCount(data.notifications?.filter((n) => !n.read).length || 0);
    } catch {} finally {
      setLoading(false);
    }
  }, [enabled]);

  const markAllRead = useCallback(async () => {
    try {
      await apiFetch("/notifications/read", { method: "POST" });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {}
  }, []);

  const markRead = useCallback(async (id: number) => {
    try {
      await apiFetch(`/notifications/${id}/read`, { method: "POST" });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {}
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
