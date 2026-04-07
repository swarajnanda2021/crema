import { Link } from "react-router-dom";
import { useCoffeeData } from "../hooks/useCoffeeData";

export default function AboutPage() {
  const { products, roasters } = useCoffeeData();

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <h1
        className="text-3xl font-bold mb-6"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        About Crema
      </h1>

      <div className="space-y-4 text-base leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
        <p>
          India's specialty coffee scene is vibrant but fragmented across {roasters.length}+ independent
          roasters, each with their own website and product catalog.
        </p>
        <p>
          <strong style={{ color: "var(--color-text-primary)" }}>Crema</strong> brings them all together in one place.
          Browse {products.length} coffees, compare prices, discover new roasters, and find your
          next favourite cup.
        </p>
        <p>
          Every product links directly to the roaster's own website so you can buy fresh,
          roasted-to-order coffee straight from the source.
        </p>
      </div>

      <div className="mt-8 pt-6 border-t" style={{ borderColor: "var(--color-border)" }}>
        <h2 className="text-lg font-semibold mb-3" style={{ fontFamily: "var(--font-serif)" }}>
          Featured Roasters
        </h2>
        <div className="flex flex-wrap gap-2">
          {roasters.map((r) => (
            <Link
              key={r.slug}
              to={`/roaster/${r.slug}`}
              className="text-sm px-3 py-1.5 rounded-full transition-colors hover:opacity-80"
              style={{
                background: "var(--color-tag-bg)",
                color: "var(--color-tag-text)",
              }}
            >
              {r.name} ({r.coffeeCount})
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
