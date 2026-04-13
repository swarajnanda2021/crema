/**
 * TimeAgo — formats a timestamp as a human-readable relative time.
 *
 * Extracted as a utility. Same logic applies on any platform.
 */

export function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
