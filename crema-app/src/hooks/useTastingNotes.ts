import { useState, useCallback } from "react";
import { apiFetchRaw } from "../api/client";

export function useTastingNotes() {
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotes = useCallback(async (productId: string) => {
    setLoading(true);
    try {
      const res = await apiFetchRaw<any>(`/tasting-notes?product_id=${productId}`);
      const data = res?.data ?? res;
      setNotes(data.notes || []);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMyNotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetchRaw<any>("/tasting-notes/mine");
      const data = res?.data ?? res;
      setNotes(data);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const createNote = useCallback(async (note: any) => {
    const res = await apiFetchRaw<any>("/tasting-notes", { method: "POST", body: JSON.stringify(note) });
    return res?.data ?? res;
  }, []);

  const updateNote = useCallback(async (noteId: number, updates: any) => {
    const res = await apiFetchRaw<any>(`/tasting-notes/${noteId}`, { method: "PUT", body: JSON.stringify(updates) });
    return res?.data ?? res;
  }, []);

  const deleteNote = useCallback(async (noteId: number) => {
    await apiFetchRaw(`/tasting-notes/${noteId}`, { method: "DELETE" });
  }, []);

  return { notes, loading, fetchNotes, fetchMyNotes, createNote, updateNote, deleteNote };
}
