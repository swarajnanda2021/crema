/**
 * Generic resource hook — fetches, caches, and mutates any CRUD resource.
 *
 * Usage:
 *   const posts = useResource<Post>("posts", { limit: 20 });
 *   const comments = useResource<Comment>("post_comments", { parent: { resource: "posts", id: 42 } });
 *
 * Returns: { data, loading, error, total, refetch, create, update, remove }
 *
 * When building iOS: this becomes a Swift ObservableObject with @Published properties.
 */

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api/client";
import type { Envelope, ToggleResult } from "./types";

interface UseResourceOptions {
  /** Filter params appended to the list URL */
  filters?: Record<string, any>;
  /** For nested resources: fetch /api/{parent.resource}/{parent.id}/{resource} */
  parent?: { resource: string; id: string | number };
  /** Max items per page (default: resource default) */
  limit?: number;
  /** Start offset (default: 0) */
  offset?: number;
  /** If false, don't fetch on mount (default: true) */
  autoFetch?: boolean;
}

export function useResource<T = any>(resource: string, options: UseResourceOptions = {}) {
  const { filters, parent, limit, offset = 0, autoFetch = true } = options;

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const buildUrl = useCallback(() => {
    let base: string;
    if (parent) {
      base = `/${parent.resource}/${parent.id}/${resource}`;
    } else if (filters && Object.keys(filters).length > 0) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== null) params.set(k, String(v));
      }
      if (limit) params.set("limit", String(limit));
      if (offset) params.set("offset", String(offset));
      return `/${resource}/filter?${params.toString()}`;
    } else {
      base = `/${resource}`;
    }
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (offset) params.set("offset", String(offset));
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }, [resource, parent, filters, limit, offset]);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = buildUrl();
      const envelope: Envelope<T[]> = await apiFetch(url);
      const items = envelope.data;
      if (Array.isArray(items)) {
        setData(items);
      } else {
        // Grouped data (e.g. shelves) — flatten or pass through
        setData(items as any);
      }
      setTotal(envelope.meta?.total ?? 0);
    } catch (e: any) {
      setError(e.message || "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  useEffect(() => {
    if (autoFetch) refetch();
  }, [autoFetch, refetch]);

  const create = useCallback(async (body: Partial<T>): Promise<T | null> => {
    try {
      let url: string;
      if (parent) {
        url = `/${parent.resource}/${parent.id}/${resource}`;
      } else {
        url = `/${resource}`;
      }
      const envelope: Envelope<T> = await apiFetch(url, {
        method: "POST",
        body: JSON.stringify(body),
      });
      refetch();
      return envelope.data;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, [resource, parent, refetch]);

  const update = useCallback(async (id: string | number, body: Partial<T>): Promise<T | null> => {
    try {
      const envelope: Envelope<T> = await apiFetch(`/${resource}/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      refetch();
      return envelope.data;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, [resource, refetch]);

  const remove = useCallback(async (id: string | number): Promise<boolean> => {
    try {
      await apiFetch(`/${resource}/${id}`, { method: "DELETE" });
      refetch();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }, [resource, refetch]);

  return { data, loading, error, total, refetch, create, update, remove };
}


/**
 * Fetch a single resource by ID.
 */
export function useResourceById<T = any>(resource: string, id: string | number | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const envelope: Envelope<T> = await apiFetch(`/${resource}/${id}`);
      setData(envelope.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [resource, id]);

  useEffect(() => { if (id) refetch(); }, [id, refetch]);

  return { data, loading, refetch };
}
