import { useState, useCallback } from "react";
import { apiFetch } from "../api/client";

export function useSocial() {
  const [likeStates, setLikeStates] = useState<Record<number, { liked: boolean; count: number }>>({});

  const toggleLike = useCallback(async (noteId: number) => {
    const res = await apiFetch<{ liked: boolean; like_count: number }>(`/notes/${noteId}/like`, { method: "POST" });
    setLikeStates(prev => ({ ...prev, [noteId]: { liked: res.liked, count: res.like_count } }));
    return res;
  }, []);

  const setInitialLikeState = useCallback((noteId: number, liked: boolean, count: number) => {
    setLikeStates(prev => {
      if (prev[noteId]) return prev;
      return { ...prev, [noteId]: { liked, count } };
    });
  }, []);

  const getLikeState = useCallback((noteId: number) => {
    return likeStates[noteId] || { liked: false, count: 0 };
  }, [likeStates]);

  const fetchComments = useCallback(async (noteId: number) => {
    return apiFetch<{ comments: any[] }>(`/notes/${noteId}/comments`);
  }, []);

  const createComment = useCallback(async (noteId: number, comment: string) => {
    return apiFetch(`/notes/${noteId}/comments`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    });
  }, []);

  const deleteComment = useCallback(async (commentId: number) => {
    return apiFetch(`/comments/${commentId}`, { method: "DELETE" });
  }, []);

  const fetchUserLikes = useCallback(async (username: string) => {
    return apiFetch<{ likes: any[] }>(`/users/${username}/likes`);
  }, []);

  const fetchUserComments = useCallback(async (username: string) => {
    return apiFetch<{ comments: any[] }>(`/users/${username}/comments`);
  }, []);

  return { toggleLike, setInitialLikeState, getLikeState, fetchComments, createComment, deleteComment, fetchUserLikes, fetchUserComments };
}
