/**
 * useInquiryInbox — navbar Messages inbox hook (unified).
 *
 * Hits /my-threads which merges wholesale inquiry threads with
 * direct-message threads in one ordered-by-activity list. Each row
 * carries a `kind` discriminator the caller uses to route taps.
 *
 * Polls every 15 seconds while enabled. Errors are surfaced on the
 * `error` field so the UI doesn't silently show "no conversations"
 * when the fetch actually failed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchRaw } from "../api/client";
import { useAuth } from "./useAuth";

export type ThreadKind = "wholesale_inquiry" | "direct_message";

export interface InboxRow {
  kind: ThreadKind;
  /** Discriminated id — inquiry_id for wholesale, thread_id for DMs. */
  inquiry_id?: number;
  thread_id?: number;
  sort_at: string | null;
  last_read_at: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_message_user_id: number | null;
  unread_count: number;
  // Wholesale-specific
  cafe_slug?: string;
  roaster_slug?: string;
  product_id?: string | null;
  product_name?: string | null;
  status?: "open" | "responded" | "archived";
  inquiry_note?: string | null;
  opened_at?: string;
  cafe_name?: string | null;
  cafe_logo_url?: string | null;
  cafe_logo_crop_x?: number | null;
  cafe_logo_crop_y?: number | null;
  cafe_logo_zoom?: number | null;
  roaster_name?: string | null;
  roaster_logo_url?: string | null;
  // Direct-message-specific
  other_user_id?: number;
  other_username?: string;
  other_display_name?: string;
  other_avatar_url?: string | null;
  other_avatar_crop_x?: number | null;
  other_avatar_crop_y?: number | null;
  other_avatar_zoom?: number | null;
}

// Keep the old name exported as an alias so existing import sites
// (including stale type imports) don't break during the refactor.
export type InquiryThreadRow = InboxRow;

const POLL_MS = 15000;

export function useInquiryInbox(enabled: boolean = true) {
  const { user } = useAuth();
  // Every authenticated user gets an inbox now — DMs are available
  // to regular user accounts, not just café + roaster.
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
    const path = row.kind === "wholesale_inquiry"
      ? `/wholesale-inquiries/${row.inquiry_id}/read`
      : `/direct-threads/${row.thread_id}/read`;
    try {
      await apiFetchRaw(path, { method: "POST" });
      setThreads((prev) =>
        prev.map((t) => (
          (t.kind === row.kind
            && (t.inquiry_id === row.inquiry_id || t.thread_id === row.thread_id))
            ? { ...t, unread_count: 0 } : t
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
