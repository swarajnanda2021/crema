import { useState, useEffect, useRef, useCallback } from "react";
import CoffeeCard from "./CoffeeCard";

const PAGE_SIZE = 24;

export default function CardGrid({ coffees, popularity = {} }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef(null);

  // Reset visible count when coffees list changes (filter/search)
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [coffees]);

  // Infinite scroll via IntersectionObserver
  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, coffees.length));
  }, [coffees.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const visible = coffees.slice(0, visibleCount);

  if (coffees.length === 0) {
    return (
      <div className="text-center py-20 px-4">
        <p className="text-5xl mb-4">☕</p>
        <p className="text-xl font-semibold mb-2">No coffees match your filters.</p>
        <p style={{ color: "var(--color-text-secondary)" }}>
          Try broadening your search or clearing some filters.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div
        className="grid gap-4 justify-items-center"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
        }}
      >
        {visible.map((coffee) => (
          <CoffeeCard key={coffee.product_id} coffee={coffee} userCount={popularity[coffee.product_id]} />
        ))}
      </div>
      {visibleCount < coffees.length && (
        <div ref={sentinelRef} className="h-8" />
      )}
    </div>
  );
}
