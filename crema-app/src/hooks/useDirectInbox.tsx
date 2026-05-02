/**
 * DirectInboxProvider — sitewide cache for direct-message threads.
 *
 * Pre-context, the navbar badge (`Navbar.tsx`) and the
 * `MessagesDropdown` panel each ran their own `useDirectInbox(...)`,
 * which meant `/my-threads` got polled twice on every wide-web load
 * (the badge polls for unread totals, the panel polls for the row
 * list — same endpoint, same interval). Same antipattern as the
 * notifications and roaster-profiles moves: per-component fetches
 * that should share state via a context provider. The hook signature
 * stays the same so consumers aren't touched; under the hood there's
 * one shared poll feeding every reader.
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

interface DirectInboxCtx {
  threads: InboxRow[];
  totalUnread: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markRead: (row: InboxRow) => Promise<void>;
  setEnabled: (on: boolean) => void;
}

const DirectInboxContext = createContext<DirectInboxCtx | null>(null);

export function DirectInboxProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [threads, setThreads] = useState<InboxRow[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Consumers toggle this via the legacy hook signature; polling
  // additionally requires an authenticated session.
  const [consumerEnabled, setConsumerEnabled] = useState(false);
  const active = consumerEnabled && !!user;
  const intervalRef = useRef<any>(null);

  const fetchThreads = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const raw = await apiFetchRaw<any>("/my-threads");
      const data = raw?.data ?? raw;
      const list: InboxRow[] = Array.isArray(data) ? data : [];
      setThreads(list);
      setTotalUnread(
        Number(
          raw?.meta?.total_unread ??
            list.reduce((s, t) => s + (t.unread_count || 0), 0),
        ),
      );
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Couldn't load conversations");
    } finally {
      setLoading(false);
    }
  }, [active]);

  const markRead = useCallback(async (row: InboxRow) => {
    try {
      await apiFetchRaw(`/direct-threads/${row.thread_id}/read`, {
        method: "POST",
      });
      setThreads((prev) =>
        prev.map((t) =>
          t.thread_id === row.thread_id ? { ...t, unread_count: 0 } : t,
        ),
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
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }
    fetchThreads();
    intervalRef.current = setInterval(fetchThreads, POLL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active, fetchThreads]);

  return (
    <DirectInboxContext.Provider
      value={{
        threads,
        totalUnread,
        loading,
        error,
        refresh: fetchThreads,
        markRead,
        setEnabled: setConsumerEnabled,
      }}
    >
      {children}
    </DirectInboxContext.Provider>
  );
}

/**
 * Backwards-compatible signature. The optional `enabled` flag tells
 * the provider whether this consumer wants polling on (the navbar
 * badge passes `!!user`; the dropdown passes `visible`). When *any*
 * mounted consumer wants polling on, the shared poll runs.
 */
export function useDirectInbox(enabled: boolean = true) {
  const ctx = useContext(DirectInboxContext);
  if (!ctx) {
    throw new Error(
      "useDirectInbox must be used inside <DirectInboxProvider>",
    );
  }
  useEffect(() => {
    ctx.setEnabled(enabled);
  }, [enabled, ctx]);
  return {
    threads: ctx.threads,
    totalUnread: ctx.totalUnread,
    loading: ctx.loading,
    error: ctx.error,
    refresh: ctx.refresh,
    markRead: ctx.markRead,
  };
}
