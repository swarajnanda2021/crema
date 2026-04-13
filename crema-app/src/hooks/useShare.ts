/**
 * useShare — share/copy URL utility.
 */

import { useCallback, useState } from "react";

export function useShare() {
  const [copied, setCopied] = useState(false);

  const share = useCallback(async (url: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, []);

  return { share, copied };
}
