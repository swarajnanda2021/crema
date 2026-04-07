import { Heart } from "lucide-react";
import { useLikes } from "../hooks/useLikes";
import { useState } from "react";

export default function LikeButton({ productId, size = 20, showLabel = false, className = "", style }) {
  const { isLiked, toggleLike } = useLikes();
  const [pulse, setPulse] = useState(false);
  const liked = isLiked(productId);

  const handleClick = (e) => {
    e.stopPropagation();
    toggleLike(productId);
    if (!liked) {
      setPulse(true);
      setTimeout(() => setPulse(false), 300);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 transition-colors cursor-pointer ${className}`}
      style={style}
      aria-label={liked ? "Unlike" : "Like"}
    >
      <Heart
        size={size}
        className={`transition-all ${pulse ? "like-pulse" : ""}`}
        fill={liked ? "var(--color-like)" : "none"}
        stroke={liked ? "var(--color-like)" : "currentColor"}
      />
      {showLabel && (
        <span className="text-sm font-medium">
          {liked ? "Liked" : "Like"}
        </span>
      )}
    </button>
  );
}
