/**
 * Responsive breakpoint primitive — one truth for every layout flip.
 *
 * Every mobile / tablet / wide gate in the app reads from here so
 * "what's mobile?" has exactly one definition. Before this hook,
 * individual files rolled their own useWindowDimensions() thresholds
 * (600 in café, 1024 in browse, 1100/720 in TractionDashboard) and
 * drifted out of sync. See BUILD_ROADMAP §2.32.
 *
 * Thresholds:
 *   mobile  : width <  600   (iPhone + narrow web)
 *   tablet  : 600 ≤ w < 1100 (iPad + narrow laptop)
 *   wide    : width ≥ 1100   (standard laptop + desktop)
 */
import { useWindowDimensions } from "react-native";

export const BP = { mobile: 600, tablet: 900, wide: 1100 } as const;

export function useBreakpoint() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isMobile: width < BP.mobile,
    isTablet: width >= BP.mobile && width < BP.wide,
    isWide: width >= BP.wide,
  };
}
