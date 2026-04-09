import { useState, useCallback } from "react";
import { apiFetch } from "../api/client";

export function useTastingNotes() {
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotes = useCallback(async (productId: string) => {
    setLoading(true);
    try {
      const data = await apiFetch(`/tasting-notes?product_id=${productId}`);
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
      const data = await apiFetch("/tasting-notes/mine");
      setNotes(data);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const createNote = useCallback(async (note: any) => {
    return apiFetch("/tasting-notes", { method: "POST", body: JSON.stringify(note) });
  }, []);

  const updateNote = useCallback(async (noteId: number, updates: any) => {
    return apiFetch(`/tasting-notes/${noteId}`, { method: "PUT", body: JSON.stringify(updates) });
  }, []);

  const deleteNote = useCallback(async (noteId: number) => {
    await apiFetch(`/tasting-notes/${noteId}`, { method: "DELETE" });
  }, []);

  return { notes, loading, fetchNotes, fetchMyNotes, createNote, updateNote, deleteNote };
}
