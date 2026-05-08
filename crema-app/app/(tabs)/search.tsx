/**
 * Search — a peer (tabs) route, reached from MobileFooter's Search
 * tab (between Messages and Profile).
 *
 * Lives inside the `(tabs)` group so navigating into it is a tab
 * switch (no Stack push, no slide-from-side animation) — same
 * behaviour as Home / Discover / Messages / Profile. The shared
 * SiteHeader paints above it; the page body is `SearchDropdown`
 * in fullScreen mode (input + Users / Beans / Roasters / Cafés
 * sections fill the viewport).
 *
 * Wide web continues to use the floating dropdown triggered from
 * the Navbar; same component, same logic — only the presentation
 * flips on the breakpoint.
 *
 * The X disc inside SearchDropdown's fullScreen header routes to
 * `/` so users have a fast back-out without touching the footer.
 */
import { View } from "react-native";
import { useRouter } from "expo-router";
import { makeStyles } from "../../src/tokens/useTokens";
import SearchDropdown from "../../src/components/SearchDropdown";

export default function SearchScreen() {
  const s = useStyles();
  const router = useRouter();
  return (
    <View style={s.wrap}>
      <SearchDropdown
        visible={true}
        onClose={() => router.replace("/")}
        fullScreen
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { flex: 1, backgroundColor: t.color.bg },
}));
