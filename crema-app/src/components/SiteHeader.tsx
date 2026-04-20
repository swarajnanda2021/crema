/**
 * SiteHeader — one entry point for "the top chrome of the app."
 *
 * Wide (tablet + desktop + wide laptop): renders the horizontal
 * Navbar (HOME / DISCOVER / logo / icons).
 * Mobile (viewport < 600): renders the compact MobileHeader (logo
 * left, Search / Messages / Bell right) wrapped in a SafeAreaView
 * so content clears the iPhone Dynamic Island / notch.
 *
 * Every screen that used to import Navbar directly should import
 * SiteHeader instead so the mobile chrome is consistent everywhere,
 * not just on tab screens.
 */
import Navbar from "./Navbar";
import MobileHeader from "./MobileHeader";
import { useBreakpoint } from "../hooks/useBreakpoint";

export default function SiteHeader() {
  const { isMobile } = useBreakpoint();
  return isMobile ? <MobileHeader /> : <Navbar />;
}
