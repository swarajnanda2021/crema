import { useState, useCallback } from "react";
import { apiFetch } from "../api";

export function useTastingNotes() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchNotes = useCallback(async (productId) => {
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

  const createNote = useCallback(async (note) => {
    const created = await apiFetch("/tasting-notes", {
      method: "POST",
      body: JSON.stringify(note),
    });
    return created;
  }, []);

  const updateNote = useCallback(async (noteId, updates) => {
    const updated = await apiFetch(`/tasting-notes/${noteId}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
    return updated;
  }, []);

  const deleteNote = useCallback(async (noteId) => {
    await apiFetch(`/tasting-notes/${noteId}`, { method: "DELETE" });
  }, []);

  return { notes, loading, fetchNotes, fetchMyNotes, createNote, updateNote, deleteNote };
}
