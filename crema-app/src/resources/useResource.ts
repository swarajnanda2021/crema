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

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { apiFetchRaw } from "../api/client";
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

  // Stabilize dependencies with serialized keys to prevent infinite loops
  const parentKey = parent ? `${parent.resource}/${parent.id}` : "";
  const filterKey = filters ? JSON.stringify(filters) : "";

  const url = useMemo(() => {
    if (parentKey) {
      const [pRes, pId] = parentKey.split("/");
      let base = `/${pRes}/${pId}/${resource}`;
      const params = new URLSearchParams();
      if (limit) params.set("limit", String(limit));
      if (offset) params.set("offset", String(offset));
      const qs = params.toString();
      return qs ? `${base}?${qs}` : base;
    } else if (filterKey && filterKey !== "{}") {
      const params = new URLSearchParams();
      const f = JSON.parse(filterKey);
      for (const [k, v] of Object.entries(f)) {
        if (v !== undefined && v !== null) params.set(k, String(v));
      }
      if (limit) params.set("limit", String(limit));
      if (offset) params.set("offset", String(offset));
      return `/${resource}/filter?${params.toString()}`;
    } else {
      let base = `/${resource}`;
      const params = new URLSearchParams();
      if (limit) params.set("limit", String(limit));
      if (offset) params.set("offset", String(offset));
      const qs = params.toString();
      return qs ? `${base}?${qs}` : base;
    }
  }, [resource, parentKey, filterKey, limit, offset]);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Use raw fetch to get both data and meta (for pagination)
      const raw: any = await apiFetchRaw(url);
      const items = raw?.data ?? raw;
      if (Array.isArray(items)) {
        setData(items);
      } else {
        setData(items as any);
      }
      setTotal(raw?.meta?.total ?? (Array.isArray(items) ? items.length : 0));
    } catch (e: any) {
      setError(e.message || "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [url]);

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
      const res: any = await apiFetchRaw(url, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const created = res?.data ?? res;
      refetch();
      return created;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, [resource, parent, refetch]);

  const update = useCallback(async (id: string | number, body: Partial<T>): Promise<T | null> => {
    try {
      const res: any = await apiFetchRaw(`/${resource}/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      const updated = res?.data ?? res;
      refetch();
      return updated;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, [resource, refetch]);

  const remove = useCallback(async (id: string | number): Promise<boolean> => {
    try {
      await apiFetchRaw(`/${resource}/${id}`, { method: "DELETE" });
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
      const res: any = await apiFetchRaw(`/${resource}/${id}`);
      const item = res?.data ?? res;
      setData(item);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [resource, id]);

  useEffect(() => { if (id) refetch(); }, [id, refetch]);

  return { data, loading, refetch };
}
