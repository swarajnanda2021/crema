/**
 * useSearchBarAutoHide — scroll-aware hide/show for the sticky search bar.
 *
 * Fixes §2.16. Replaces the one-liner `setHidden(y > lastY && y > 10)`
 * pattern that was scattered across browse.tsx (BeansList, RoastersList,
 * CafesList) and which thrashes at end-of-list rubber-banding — the
 * scroll direction flips rapidly in the last few frames of a momentum
 * scroll, toggling the bar state mid-animation.
 *
 * Four guards stack to keep the state stable:
 * - **Near the top** (y < TOP_FORCE_SHOW): always show. Users who scroll
 *   back up expect the bar to come back; never hide it in the first
 *   screen of content.
 * - **Near the bottom** (distFromBottom < BOTTOM_FREEZE): freeze current
 *   state. This is the actual bug fix — rubber-band / deceleration
 *   flicker only happens here, and freezing the state means the bar
 *   stays where the last real direction put it.
 * - **Dead-band** (|dy| < DEAD_BAND): ignore sub-pixel jitter. Cheap and
 *   keeps the hook robust on platforms with imprecise scroll deltas.
 * - **Hide threshold** (y > HIDE_PAST): only hide once the user has
 *   deliberately scrolled past the first chunk of content.
 *
 * The constants are tuned for desktop + Expo Web; same defaults work
 * fine on native iOS/Android per the same handler.
 */

import { useCallback, useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

const TOP_FORCE_SHOW = 40;
const BOTTOM_FREEZE = 24;
const DEAD_BAND = 4;
const HIDE_PAST = 80;

export function useSearchBarAutoHide() {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const y = contentOffset.y;
    const dy = y - lastY.current;
    lastY.current = y;

    // 1. Near the top — always reveal the bar.
    if (y < TOP_FORCE_SHOW) {
      setHidden(false);
      return;
    }
    // 2. Near the bottom — freeze state. Rubber-band flicker lives here.
    const distFromBottom = contentSize.height - layoutMeasurement.height - y;
    if (distFromBottom < BOTTOM_FREEZE) return;
    // 3. Dead-band — ignore jitter.
    if (Math.abs(dy) < DEAD_BAND) return;
    // 4. Apply direction, gated by a minimum scroll depth for hide.
    if (dy > 0 && y > HIDE_PAST) setHidden(true);
    else if (dy < 0) setHidden(false);
  }, []);

  return { hidden, handleScroll };
}
