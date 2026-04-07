import { createContext, useContext, useState, useCallback } from "react";

const STORAGE_KEY = "coffee_likes";
const LikesContext = createContext(null);

export function LikesProvider({ children }) {
  const [likes, setLikes] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const toggleLike = useCallback((productId) => {
    setLikes((prev) => {
      const next = prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const isLiked = useCallback(
    (productId) => likes.includes(productId),
    [likes]
  );

  return (
    <LikesContext.Provider value={{ likes, toggleLike, isLiked }}>
      {children}
    </LikesContext.Provider>
  );
}

export function useLikes() {
  const ctx = useContext(LikesContext);
  if (!ctx) throw new Error("useLikes must be used within LikesProvider");
  return ctx;
}
