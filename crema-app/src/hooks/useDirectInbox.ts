/**
 * useDirectInbox — navbar Messages inbox hook (DM-only).
 *
 * Hits /my-threads which now serves direct-message threads only.
 * Polls every 15 seconds while enabled. Errors surface on `error`
 * so the UI doesn't silently render "no conversations" when the
 * fetch actually failed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchRaw } from "../api/client";
import { useAuth } from "./useAuth";

export type ThreadKind = "direct_message";

export interface InboxRow {
  kind: ThreadKind;
  thread_id: number;
  sort_at: string | null;
  last_read_at: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_message_user_id: number | null;
  unread_count: number;
  other_user_id?: number;
  other_username?: string;
  other_display_name?: string;
  other_avatar_url?: string | null;
  other_avatar_crop_x?: number | null;
  other_avatar_crop_y?: number | null;
  other_avatar_zoom?: number | null;
}

const POLL_MS = 15000;

export function useDirectInbox(enabled: boolean = true) {
  const { user } = useAuth();
  const active = enabled && !!user;

  const [threads, setThreads] = useState<InboxRow[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<any>(null);

  const fetchThreads = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const raw = await apiFetchRaw<any>("/my-threads");
      const data = raw?.data ?? raw;
      const list: InboxRow[] = Array.isArray(data) ? data : [];
      setThreads(list);
      setTotalUnread(Number(raw?.meta?.total_unread ?? list.reduce((s, t) => s + (t.unread_count || 0), 0)));
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Couldn't load conversations");
    } finally {
      setLoading(false);
    }
  }, [active]);

  const markRead = useCallback(async (row: InboxRow) => {
    try {
      await apiFetchRaw(`/direct-threads/${row.thread_id}/read`, { method: "POST" });
      setThreads((prev) =>
        prev.map((t) => (
          t.thread_id === row.thread_id ? { ...t, unread_count: 0 } : t
        )),
      );
      setTotalUnread((prev) => Math.max(0, prev - (row.unread_count || 0)));
    } catch {
      /* ignore — next fetch reconciles */
    }
  }, []);

  useEffect(() => {
    if (!active) {
      setThreads([]);
      setTotalUnread(0);
      return;
    }
    fetchThreads();
    intervalRef.current = setInterval(fetchThreads, POLL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [active, fetchThreads]);

  return {
    threads,
    totalUnread,
    loading,
    error,
    refresh: fetchThreads,
    markRead,
  };
}
