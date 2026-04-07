import { RefreshCw } from "lucide-react";

export default function ScrapeProgress({ progress }) {
  if (!progress) return null;

  const { index, total, roaster, coffeesFound } = progress;
  const pct = total > 0 ? Math.round((index / total) * 100) : 0;

  return (
    <div
      className="fixed top-16 left-0 right-0 z-40 px-4 py-3 shadow-sm"
      style={{
        background: "var(--color-bg)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <div className="max-w-3xl mx-auto">
        {/* Top row */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <RefreshCw
              size={14}
              className="animate-spin"
              style={{ color: "var(--color-accent)" }}
            />
            <span className="text-sm font-medium">
              Refreshing catalog&hellip; {index}/{total}
            </span>
          </div>
          <span
            className="text-sm tabular-nums"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {coffeesFound} coffee{coffeesFound !== 1 ? "s" : ""} found
          </span>
        </div>

        {/* Progress bar */}
        <div
          className="h-2 rounded-full overflow-hidden"
          style={{ background: "var(--color-tag-bg)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${pct}%`,
              background: "var(--color-accent)",
            }}
          />
        </div>

        {/* Current roaster */}
        <p
          className="text-xs mt-1 truncate"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Currently: {roaster}
        </p>
      </div>
    </div>
  );
}
