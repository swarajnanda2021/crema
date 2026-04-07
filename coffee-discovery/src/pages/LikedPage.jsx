import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useCoffeeData } from "../hooks/useCoffeeData";
import { useLikes } from "../hooks/useLikes";
import CardGrid from "../components/CardGrid";
import { Heart } from "lucide-react";

export default function LikedPage() {
  const { products } = useCoffeeData();
  const { likes } = useLikes();

  const likedCoffees = useMemo(
    () => products.filter((p) => likes.includes(p.product_id)),
    [products, likes]
  );

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-6">
      <h1
        className="text-3xl font-bold mb-6"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Liked Coffees
      </h1>

      {likedCoffees.length > 0 ? (
        <CardGrid coffees={likedCoffees} />
      ) : (
        <div className="text-center py-20">
          <Heart
            size={48}
            className="mx-auto mb-4"
            style={{ color: "var(--color-border)" }}
          />
          <p className="text-xl font-semibold mb-2">
            You haven't liked any coffees yet.
          </p>
          <p className="mb-4" style={{ color: "var(--color-text-secondary)" }}>
            Start browsing and tap the heart on coffees you love!
          </p>
          <Link
            to="/browse"
            className="inline-block px-5 py-2.5 rounded-lg text-white text-sm font-semibold"
            style={{ background: "var(--color-accent)" }}
          >
            Browse coffees
          </Link>
        </div>
      )}
    </div>
  );
}
