/**
 * useSocial — CRUD Utopia edition.
 * Uses apiFetchRaw for envelope-aware fetching.
 */

import { useState, useCallback } from "react";
import { apiFetchRaw } from "../api/client";

export function useSocial() {
  const [likeStates, setLikeStates] = useState<Record<number, { liked: boolean; count: number }>>({});

  const setInitialLikeState = useCallback((noteId: number, liked: boolean, count: number) => {
    setLikeStates((prev) => ({ ...prev, [noteId]: { liked, count } }));
  }, []);

  const getLikeState = useCallback((noteId: number) => {
    return likeStates[noteId] || { liked: false, count: 0 };
  }, [likeStates]);

  const toggleLike = useCallback(async (noteId: number) => {
    const prev = likeStates[noteId] || { liked: false, count: 0 };
    setLikeStates((s) => ({ ...s, [noteId]: { liked: !prev.liked, count: prev.liked ? prev.count - 1 : prev.count + 1 } }));
    try {
      const res = await apiFetchRaw<any>(`/notes/${noteId}/like`, { method: "POST" });
      const data = res?.data ?? res;
      setLikeStates((s) => ({ ...s, [noteId]: { liked: data.liked, count: data.like_count } }));
    } catch {
      setLikeStates((s) => ({ ...s, [noteId]: prev }));
    }
  }, [likeStates]);

  const togglePostLike = useCallback(async (postId: number) => {
    const res = await apiFetchRaw<any>(`/posts/${postId}/like`, { method: "POST" });
    return res?.data ?? res;
  }, []);

  const fetchComments = useCallback(async (noteId: number) => {
    const res = await apiFetchRaw<any>(`/notes/${noteId}/comments`);
    return res?.data ?? res;
  }, []);

  const createComment = useCallback(async (noteId: number, text: string) => {
    const res = await apiFetchRaw<any>(`/notes/${noteId}/comments`, {
      method: "POST",
      body: JSON.stringify({ comment: text }),
    });
    return res?.data ?? res;
  }, []);

  const deleteComment = useCallback(async (commentId: number) => {
    await apiFetchRaw(`/post-comments/${commentId}`, { method: "DELETE" });
  }, []);

  const fetchPostComments = useCallback(async (postId: number) => {
    const res = await apiFetchRaw<any>(`/posts/${postId}/comments`);
    return res?.data ?? res;
  }, []);

  const createPostComment = useCallback(async (postId: number, text: string, parentId?: number) => {
    const body: any = { comment: text };
    if (parentId) body.parent_id = parentId;
    const res = await apiFetchRaw<any>(`/posts/${postId}/comments`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return res?.data ?? res;
  }, []);

  const editPostComment = useCallback(async (commentId: number, text: string) => {
    const res = await apiFetchRaw<any>(`/post-comments/${commentId}`, {
      method: "PUT",
      body: JSON.stringify({ comment: text }),
    });
    return res?.data ?? res;
  }, []);

  const deletePostComment = useCallback(async (commentId: number) => {
    await apiFetchRaw(`/post-comments/${commentId}`, { method: "DELETE" });
  }, []);

  const toggleCommentLike = useCallback(async (commentId: number) => {
    const res = await apiFetchRaw<any>(`/post-comments/${commentId}/like`, { method: "POST" });
    return res?.data ?? res;
  }, []);

  const fetchUserLikes = useCallback(async (username: string) => {
    const res = await apiFetchRaw<any>(`/users/${username}/likes`);
    return res?.data ?? res;
  }, []);

  const fetchUserComments = useCallback(async (username: string) => {
    const res = await apiFetchRaw<any>(`/users/${username}/comments`);
    return res?.data ?? res;
  }, []);

  return {
    likeStates, setInitialLikeState, getLikeState,
    toggleLike, togglePostLike,
    fetchComments, createComment, deleteComment,
    fetchPostComments, createPostComment, editPostComment, deletePostComment,
    toggleCommentLike, fetchUserLikes, fetchUserComments,
  };
}
