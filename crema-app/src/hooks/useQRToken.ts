/**
 * CRUD Utopia — composite-action hook (not a generic resource).
 * Wraps the /me/qr-token endpoint. Tokens are short-lived (5 min); this
 * hook refreshes automatically when within 60s of expiry, and on demand
 * via refresh().
 * See CRUD_UTOPIA.md at repo root.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetchRaw } from "../api/client";
import type { QRTokenResponse } from "../resources/types";

interface UseQRTokenResult {
  token: string | null;
  expiresAt: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const REFRESH_THRESHOLD_MS = 60 * 1000;

export function useQRToken(enabled: boolean = true): UseQRTokenResult {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<any>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const raw = await apiFetchRaw<any>("/me/qr-token", { method: "POST" });
      const data = (raw?.data ?? raw) as QRTokenResponse;
      setToken(data.token);
      setExpiresAt(data.expires_at);
    } catch (e) {
      console.warn("QR token fetch failed:", e);
      setToken(null);
      setExpiresAt(null);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
  }, [enabled, refresh]);

  // Auto-refresh when nearing expiry
  useEffect(() => {
    if (!expiresAt) return;
    const expiryMs = new Date(expiresAt).getTime();
    const now = Date.now();
    const refreshIn = Math.max(0, expiryMs - now - REFRESH_THRESHOLD_MS);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { refresh(); }, refreshIn);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [expiresAt, refresh]);

  return { token, expiresAt, loading, refresh };
}
