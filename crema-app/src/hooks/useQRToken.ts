/**
 * CRUD Utopia — client-side wrapper around /api/me/qr-token. Auto-refreshes
 * when the current token has under 60 seconds left, so the displayed QR
 * never expires mid-scan.
 * See CRUD_UTOPIA.md at repo root.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetchRaw } from "../api/client";
import type { QRTokenResponse } from "../resources/types";

interface UseQRTokenResult {
  token: string | null;
  expiresAt: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const REFRESH_BEFORE_SECONDS = 60;

export function useQRToken(enabled: boolean = true): UseQRTokenResult {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<any>(null);

  const fetchToken = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await apiFetchRaw<any>("/me/qr-token", { method: "POST" });
      const d = (raw?.data ?? raw) as QRTokenResponse;
      setToken(d.token);
      setExpiresAt(d.expires_at);
    } catch (e: any) {
      setError(e?.message || "Failed to issue QR token");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetchToken();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, fetchToken]);

  // Schedule auto-refresh
  useEffect(() => {
    if (!enabled || !expiresAt) return;
    const ms = new Date(expiresAt).getTime() - Date.now() - REFRESH_BEFORE_SECONDS * 1000;
    if (ms <= 0) {
      fetchToken();
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchToken(), ms);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, expiresAt, fetchToken]);

  return { token, expiresAt, loading, error, refresh: fetchToken };
}
