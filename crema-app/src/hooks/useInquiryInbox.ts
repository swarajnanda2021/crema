/**
 * useInquiryInbox — navbar Messages inbox hook.
 *
 * Currently scoped to wholesale inquiry threads (§2.1) because those
 * are the only cross-party conversations the product supports. The
 * shape is deliberately chat-generic (counterparty, last message,
 * unread count, time) so user↔user DMs can slot in later without
 * another hook.
 *
 * Polls every 15 seconds while enabled so the navbar badge stays
 * fresh. Separate from the message-level poll that InquiryThreadModal
 * runs while a specific thread is open (which is faster).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchRaw } from "../api/client";
import { useAuth } from "./useAuth";

export interface InquiryThreadRow {
  inquiry_id: number;
  cafe_slug: string;
  roaster_slug: string;
  product_id: string | null;
  inquiry_note: string | null;
  status: "open" | "responded" | "archived";
  opened_at: string;
  last_read_at: string | null;
  cafe_name: string | null;
  cafe_logo_url: string | null;
  cafe_logo_crop_x: number | null;
  cafe_logo_crop_y: number | null;
  cafe_logo_zoom: number | null;
  roaster_name: string | null;
  roaster_logo_url: string | null;
  product_name: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_message_user_id: number | null;
  unread_count: number;
}

type Perspective = "cafe" | "roaster" | "none";

const POLL_MS = 15000;

export function useInquiryInbox(enabled: boolean = true) {
  const { user } = useAuth();
  const active = enabled && (user?.account_type === "cafe" || user?.account_type === "roaster");

  const [threads, setThreads] = useState<InquiryThreadRow[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [perspective, setPerspective] = useState<Perspective>("none");
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<any>(null);

  const fetchThreads = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const raw = await apiFetchRaw<any>("/my-inquiry-threads");
      const data = raw?.data ?? raw;
      const list: InquiryThreadRow[] = Array.isArray(data) ? data : [];
      setThreads(list);
      setTotalUnread(Number(raw?.meta?.total_unread ?? list.reduce((s, t) => s + (t.unread_count || 0), 0)));
      setPerspective((raw?.meta?.perspective as Perspective) ?? "none");
    } catch {
      // Silent — inbox is a background poll, errors shouldn't nag the UI.
    } finally {
      setLoading(false);
    }
  }, [active]);

  const markRead = useCallback(async (inquiryId: number) => {
    try {
      await apiFetchRaw(`/wholesale-inquiries/${inquiryId}/read`, { method: "POST" });
      setThreads((prev) =>
        prev.map((t) => (t.inquiry_id === inquiryId ? { ...t, unread_count: 0 } : t)),
      );
      setTotalUnread((prev) => {
        const target = threads.find((t) => t.inquiry_id === inquiryId);
        return Math.max(0, prev - (target?.unread_count || 0));
      });
    } catch {
      // Ignore — read-state desync is fine to retry on next fetch.
    }
  }, [threads]);

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
    perspective,
    loading,
    refresh: fetchThreads,
    markRead,
  };
}
