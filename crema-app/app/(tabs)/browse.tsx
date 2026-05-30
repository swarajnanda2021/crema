/**
 * Browse/Shop page — faithfully ported from main with CRUD Utopia imports/API.
 *
 * Layout, styles, component structure, and responsive patterns are identical to main.
 * Only imports, API calls, and component references are updated for crud-utopia.
 */

import { useCallback, useMemo, useState, useEffect } from "react";
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, useWindowDimensions, ActivityIndicator } from "react-native";
import { useTabSlider } from "../../src/components/primitives";
import Animated from "react-native-reanimated";
import { useBreakpoint } from "../../src/hooks/useBreakpoint";
import { Image } from "expo-image";
import { Search, X, ArrowRight, ChevronDown, ChevronRight } from "lucide-react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useRoasterProfiles } from "../../src/hooks/useRoasterProfiles";
import { useRoasterArticles } from "../../src/hooks/useRoasterArticles";
import ArticleListRow from "../../src/components/domain/ArticleListRow";
import { TOPIC_CHIPS, topicBucketKey } from "../../src/utils/articleMeta";
import RoasterLogo from "../../src/components/primitives/RoasterLogo";
import { useSearchBarAutoHide } from "../../src/hooks/useSearchBarAutoHide";
import { onChromeScroll } from "../../src/utils/chromeScroll";
import { t, cardShadow, makeStyles } from "../../src/tokens/useTokens";
import CoffeeList from "../../src/components/CoffeeList";
import RoasterRow from "../../src/components/RoasterRow";
import { apiFetchRaw, resolveUploadUrl } from "../../src/api/client";
import type { RoasterProfile } from "../../src/resources/types";
import SlidePanel from "../../src/components/mobile/SlidePanel";
import { SlidersHorizontal } from "lucide-react-native";
import { useScaAddresses } from "../../src/hooks/useScaAddresses";
import {
  productAddresses,
  coffeeMatchesSelection,
  type Address,
  type SelectedFlavor,
} from "../../src/utils/scaTree";
import FlavorWheelModal from "../../src/components/FlavorWheelModal";

// Specialty-catalog filter axes. Bean Type chip set mirrors the
// canonical species names; long-tail values (the rare "Arabica-Robusta"
// etc.) stay invisible under any active Bean Type chip — same rule as
// missing altitude. Heavier curation lands later via the Coffee
// Standardization sub-tab in Catalog Ops.
const BEAN_TYPES: { key: string; label: string }[] = [
  { key: "Arabica", label: "Arabica" },
  { key: "Blend", label: "Blend" },
  { key: "Robusta", label: "Robusta" },
  { key: "Excelsa", label: "Excelsa" },
  { key: "Liberica", label: "Liberica" },
];

// Altitude bands (masl). Specialty-coffee shorthand: <1200 lowland,
// 1200-1500 high-grown, 1500+ strictly high-grown / SHB tier.
const ALTITUDE_BANDS: { key: string; label: string; test: (a: number) => boolean }[] = [
  { key: "lt1200", label: "Up to 1200m", test: (a) => a < 1200 },
  { key: "1200_1500", label: "1200–1500m", test: (a) => a >= 1200 && a < 1500 },
  { key: "gte1500", label: "1500m+", test: (a) => a >= 1500 },
];

// Price bands per 100g. Comparing absolute price across pack sizes is
// meaningless (a 100g bag at ₹500 is much pricier per gram than a
// 250g bag at ₹500); ppg-per-100g is the specialty-buyer's mental
// model.
const PRICE_BANDS: { key: string; label: string; test: (ppg: number) => boolean }[] = [
  { key: "under_200", label: "Under ₹200/100g", test: (ppg) => ppg < 200 },
  { key: "200_400", label: "₹200–400/100g", test: (ppg) => ppg >= 200 && ppg < 400 },
  { key: "over_400", label: "₹400+/100g", test: (ppg) => ppg >= 400 },
];

export default function BrowsePage() {
  const { products, roasters, roastLevels, processes, fetchProducts } = useCoffeeData();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;
  const { isMobile } = useBreakpoint();
  const s = useStyles();

  // Re-fetch products every time the user lands on Discover. Admin
  // approvals on a fresh enrichment land in `products`; without this
  // hook the consumer-side cache stays stale until app reload.
  useFocusEffect(
    useCallback(() => {
      fetchProducts();
    }, [fetchProducts]),
  );
  const sidebarW = Math.max(160, Math.min(280, Math.round(width * 0.135)));
  const [query, setQuery] = useState("");
  const [popularity, setPopularity] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<"beans" | "roasters" | "journal">("beans");
  const tabSlider = useTabSlider(activeTab);
  const [sortBy, setSortBy] = useState<string>("featured");
  const [selectedRoasters, setSelectedRoasters] = useState<string[]>([]);
  const [selectedRoasts, setSelectedRoasts] = useState<string[]>([]);
  const [selectedProcesses, setSelectedProcesses] = useState<string[]>([]);
  // Specialty-catalog filter axes. All multi-select; NULLs hidden when
  // any chip in the section is active (no "Other" bucket — see the
  // canonicalize.py module on the backend for the matching rule).
  const [selectedBeanTypes, setSelectedBeanTypes] = useState<string[]>([]);
  // Location filter — values are canonical estate names from the
  // standardization pass (`origin_estate_canonical`), plus the synthetic
  // "Multi-estate" / "International" buckets. "Unknown" rows are hidden
  // from the chip list per the standardization spec.
  const [selectedEstates, setSelectedEstates] = useState<string[]>([]);
  // Varietal + natural-mutation filter — one combined section. Keys
  // can be canonical varieties (SLN 9, Geisha, …) OR morphologies
  // (Peaberry); the predicate matches against either column.
  const [selectedVarietals, setSelectedVarietals] = useState<string[]>([]);
  const [selectedAltitudes, setSelectedAltitudes] = useState<string[]>([]);
  const [selectedPriceBands, setSelectedPriceBands] = useState<string[]>([]);
  // Roasters tab — Location filter (city) and Estate-exposure filter.
  // Both lifted to BrowsePage so the mobile filter drawer (rendered
  // here) can edit the same arrays that the desktop sidebar inside
  // RoastersList reads. Estate exposure asks "which roasters source
  // from estate X" — derived from products' `origin_estate_canonical`.
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [selectedRoasterEstates, setSelectedRoasterEstates] = useState<string[]>([]);
  // §2.16 — stable search-bar hide that doesn't thrash at
  // end-of-list. Replaces the old raw `y > lastY && y > 10` toggle.
  const { hidden: searchBarHidden, handleScroll: handleBeansScroll } = useSearchBarAutoHide();
  // §2.34 — mobile filter drawer. On narrow screens the sidebar is
  // hidden; a Filters button next to the search bar slides this in
  // from the right using the shared SlidePanel primitive.
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  // Discover Flavor lens — the wheel modal lives over the BEANS list
  // so background results update as the pick changes. v3 wheel is
  // single-select: at most one sector picked at a time. `null` = no
  // filter (every coffee passes).
  const [selectedFlavor, setSelectedFlavor] = useState<SelectedFlavor>(null);
  const [flavorModalOpen, setFlavorModalOpen] = useState(false);
  const { resolutions: scaResolutions } = useScaAddresses();

  useEffect(() => {
    apiFetchRaw("/products/popularity").then((r) => {
      const d = r?.data ?? r;
      setPopularity(typeof d === "object" && !Array.isArray(d) ? d : {});
    }).catch(() => {});
  }, []);

  // Per-product SCA address index — derived once per (products, resolutions)
  // change. Map<product_id, Address[]> of every valid address resolved from
  // each coffee's flavor_notes / tasting_notes via the public sca/addresses
  // map. The wheel filter and the chip-counter both look up here in O(1).
  const addressesByProduct = useMemo(() => {
    const map = new Map<string, Address[]>();
    if (!products || !scaResolutions) return map;
    (products as any[]).forEach((p: any) => {
      if (!p?.product_id) return;
      // Schema arg defaults to FALLBACK_SCHEMA — addresses are validated
      // server-side by the Standardization Tasting pass against the
      // active schema, so any row in `sca_addresses` already names a
      // sector that exists. Client-side validation is a safety net.
      const addrs = productAddresses(p, scaResolutions);
      if (addrs.length > 0) map.set(p.product_id, addrs);
    });
    return map;
  }, [products, scaResolutions]);

  // Inline filtering (replaces filterCoffees utility)
  const filtered = useMemo(() => {
    // In-stock only — sold-out beans are dropped from the consumer
    // catalog entirely.
    let list = products.filter(
      (p: any) => p.available !== false && p.available !== 0,
    );
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((p: any) =>
        (p.coffee_name || "").toLowerCase().includes(q) ||
        (p.roaster_name || "").toLowerCase().includes(q) ||
        (p.origin || "").toLowerCase().includes(q) ||
        (p.tasting_notes || "").toLowerCase().includes(q)
      );
    }
    if (selectedRoasters.length > 0) list = list.filter((p: any) => selectedRoasters.includes(p.roaster_slug));
    if (selectedRoasts.length > 0) list = list.filter((p: any) => selectedRoasts.includes(p.roast_level));
    if (selectedProcesses.length > 0) {
      // Filter against the canonical bucket — chips are bucket-grouped
      // (8 entries: Washed / Natural / Honey / Anaerobic / Wet-Hulled
      // / Monsooned / Experimental / Decaf) so 60+ raw process strings
      // collapse cleanly. Falls back to the legacy `process` column
      // for rows that haven't been classified yet.
      list = list.filter((p: any) =>
        selectedProcesses.includes(p.process_canonical || p.process)
      );
    }
    if (selectedBeanTypes.length > 0) {
      // bean_type_canonical wins when standardization has filled it;
      // legacy bean_type is the fallback so newly-scraped rows stay
      // searchable in the moments before the next standardization run.
      list = list.filter((p: any) => {
        const bt = p.bean_type_canonical || p.bean_type;
        return bt && selectedBeanTypes.includes(bt);
      });
    }
    if (selectedEstates.length > 0) {
      list = list.filter((p: any) =>
        p.origin_estate_canonical &&
        p.origin_estate_canonical !== "Unknown" &&
        selectedEstates.includes(p.origin_estate_canonical),
      );
    }
    if (selectedVarietals.length > 0) {
      // Combined varietal + morphology filter. A bean passes if its
      // canonical_varietal OR its morphology lands in the selection.
      list = list.filter((p: any) =>
        (!!p.varietal_canonical && selectedVarietals.includes(p.varietal_canonical)) ||
        (!!p.morphology && selectedVarietals.includes(p.morphology)),
      );
    }
    if (selectedAltitudes.length > 0) {
      list = list.filter((p: any) => {
        if (p.altitude_masl == null) return false;
        return selectedAltitudes.some(k => {
          const band = ALTITUDE_BANDS.find(b => b.key === k);
          return band ? band.test(p.altitude_masl) : false;
        });
      });
    }
    if (selectedPriceBands.length > 0) {
      list = list.filter((p: any) => {
        if (!p.price_inr || !p.weight_grams || p.weight_grams <= 0) return false;
        const ppg = (p.price_inr / p.weight_grams) * 100;
        return selectedPriceBands.some(k => {
          const band = PRICE_BANDS.find(b => b.key === k);
          return band ? band.test(ppg) : false;
        });
      });
    }
    // Flavor wheel — single-select. Coffees survive only if at least
    // one of their resolved addresses points at the picked sector.
    // Coffees with no resolved addresses drop out the moment a sector
    // is picked.
    if (selectedFlavor) {
      list = list.filter((p: any) => {
        const addrs = addressesByProduct.get(p.product_id);
        if (!addrs) return false;
        return coffeeMatchesSelection(addrs, selectedFlavor);
      });
    }

    // Sort
    if (sortBy === "featured" && Object.keys(popularity).length > 0) {
      list = [...list].sort((a, b) => (popularity[b.product_id] || 0) - (popularity[a.product_id] || 0));
    } else if (sortBy === "price_low" || sortBy === "price_high") {
      // Sort by PRICE PER GRAM (₹/g), not sticker price — a ₹750/1kg bag
      // is cheaper per gram than a ₹400/100g micro-lot, and that's what
      // "cheapest" should mean. Mirrors the ₹/100g basis the price-band
      // filter already uses (selectedPriceBands above). Rows with no
      // computable ₹/g (missing price or weight) sort to the END in both
      // directions so they never masquerade as the cheapest/priciest.
      const ppg = (p: typeof list[number]): number | null =>
        p.price_inr != null && p.price_inr > 0 && p.weight_grams && p.weight_grams > 0
          ? p.price_inr / p.weight_grams
          : null;
      const dir = sortBy === "price_low" ? 1 : -1;
      list = [...list].sort((a, b) => {
        const pa = ppg(a);
        const pb = ppg(b);
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1; // a goes after b
        if (pb == null) return -1; // b goes after a
        return (pa - pb) * dir;
      });
    } else if (sortBy === "newest") {
      list = [...list].sort((a, b) => {
        const ta = Date.parse(a.created_at || "") || 0;
        const tb = Date.parse(b.created_at || "") || 0;
        return tb - ta;
      });
    }
    return list;
  }, [products, query, selectedRoasters, selectedRoasts, selectedProcesses, selectedBeanTypes, selectedEstates, selectedVarietals, selectedAltitudes, selectedPriceBands, selectedFlavor, addressesByProduct, sortBy, popularity]);

  const filteredRoasterCount = useMemo(() => new Set(filtered.map((p: any) => p.roaster_slug)).size, [filtered]);

  // Cities derived once for the mobile drawer — same shape the
  // RoastersList sidebar uses, kept in sync because both consume the
  // same `roasters` from useCoffeeData. Plain array; the count-bearing
  // option list is `cityOptions` below.
  const cities = useMemo(() => {
    const set = new Set<string>();
    (roasters as any[]).forEach((r: any) => { if (r.city) set.add(r.city); });
    return Array.from(set).sort();
  }, [roasters]);

  // Estate-exposure map for the ROASTERS tab: roaster_slug → Set of
  // estates that roaster has on shelf. Driven by products'
  // `origin_estate_canonical` — only specific estate names land here,
  // since "Multi-estate" / "International" / "Unknown" don't add
  // discoverable signal at the roaster level.
  const roasterEstateMap = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    (products as any[]).forEach((p: any) => {
      const slug = p.roaster_slug;
      const e = p.origin_estate_canonical;
      if (!slug || !e) return;
      if (e === "Unknown" || e === "Multi-estate" || e === "International") return;
      if (!map[slug]) map[slug] = new Set();
      map[slug].add(e);
    });
    return map;
  }, [products]);

  // Faceted count helpers for the ROASTERS tab. The "base list of
  // roasters" excludes the chip-set we're counting so each chip's
  // number reads as "how many roasters remain if I toggle this on?".
  const baseRoastersExcept = (skip: "city" | "estate") => {
    let list = roasters as any[];
    if (skip !== "city" && selectedCities.length > 0) {
      list = list.filter((r) => r.city && selectedCities.includes(r.city));
    }
    if (skip !== "estate" && selectedRoasterEstates.length > 0) {
      list = list.filter((r) => {
        const exposes = roasterEstateMap[r.slug];
        if (!exposes) return false;
        return selectedRoasterEstates.some((e) => exposes.has(e));
      });
    }
    return list;
  };

  const cityOptions = useMemo(() => {
    const base = baseRoastersExcept("city");
    const counts = new Map<string, number>();
    base.forEach((r: any) => {
      if (r.city) counts.set(r.city, (counts.get(r.city) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, label: key, count }))
      .sort((a, b) => b.count - a.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roasters, roasterEstateMap, selectedRoasterEstates]);

  const roasterEstateOptions = useMemo(() => {
    const base = baseRoastersExcept("estate");
    const counts = new Map<string, number>();
    base.forEach((r: any) => {
      const exposes = roasterEstateMap[r.slug];
      if (!exposes) return;
      exposes.forEach((e) => counts.set(e, (counts.get(e) || 0) + 1));
    });
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, label: key, count }))
      .sort((a, b) => b.count - a.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roasters, roasterEstateMap, selectedCities]);

  // Faceted counts — for each section X, count is computed against the
  // products list with all OTHER active filters applied. The number
  // beside each chip answers "if I toggle this on now, how many
  // coffees remain in view?". Sorted descending so the highest-yield
  // chips surface first.
  //
  // Predicates are pure (read each chip's selection state from the
  // closure) so the helper below can swap in / out individual filters
  // by name when computing per-section base lists.
  const passRoasters = (p: any) =>
    selectedRoasters.length === 0 || selectedRoasters.includes(p.roaster_slug);
  const passRoasts = (p: any) =>
    selectedRoasts.length === 0 || (!!p.roast_level && selectedRoasts.includes(p.roast_level));
  const passProcesses = (p: any) =>
    selectedProcesses.length === 0 ||
      (!!(p.process_canonical || p.process) &&
        selectedProcesses.includes(p.process_canonical || p.process));
  const passBeanTypes = (p: any) => {
    if (selectedBeanTypes.length === 0) return true;
    const bt = p.bean_type_canonical || p.bean_type;
    return !!bt && selectedBeanTypes.includes(bt);
  };
  const passEstates = (p: any) =>
    selectedEstates.length === 0 ||
    (!!p.origin_estate_canonical &&
     p.origin_estate_canonical !== "Unknown" &&
     selectedEstates.includes(p.origin_estate_canonical));
  const passVarietals = (p: any) => {
    if (selectedVarietals.length === 0) return true;
    if (p.varietal_canonical && selectedVarietals.includes(p.varietal_canonical)) return true;
    if (p.morphology && selectedVarietals.includes(p.morphology)) return true;
    return false;
  };
  const passAltitudes = (p: any) =>
    selectedAltitudes.length === 0 ||
    selectedAltitudes.some((k) => {
      const band = ALTITUDE_BANDS.find((b) => b.key === k);
      return band && p.altitude_masl != null && band.test(p.altitude_masl);
    });
  const passPriceBands = (p: any) => {
    if (selectedPriceBands.length === 0) return true;
    if (p.price_inr == null || !p.weight_grams) return false;
    const ppg = (p.price_inr / p.weight_grams) * 100;
    return selectedPriceBands.some((k) => {
      const band = PRICE_BANDS.find((b) => b.key === k);
      return band && band.test(ppg);
    });
  };
  const passQuery = (p: any) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (p.coffee_name || "").toLowerCase().includes(q)
      || (p.roaster_name || "").toLowerCase().includes(q)
      || (p.tasting_notes || "").toLowerCase().includes(q)
      || (p.origin || "").toLowerCase().includes(q);
  };
  const passFlavors = (p: any) => {
    if (!selectedFlavor) return true;
    const addrs = addressesByProduct.get(p.product_id);
    if (!addrs) return false;
    return coffeeMatchesSelection(addrs, selectedFlavor);
  };

  // `inStock` shrinks the universe to in-stock products once; every
  // section's base list starts here.
  const inStock = useMemo(
    () => (products as any[]).filter((p: any) => p.available !== false && p.available !== 0),
    [products],
  );

  const baseExcept = (skip: string) =>
    inStock.filter((p: any) =>
      (skip === "roasters" || passRoasters(p)) &&
      (skip === "roast" || passRoasts(p)) &&
      (skip === "process" || passProcesses(p)) &&
      (skip === "beanType" || passBeanTypes(p)) &&
      (skip === "estate" || passEstates(p)) &&
      (skip === "varietal" || passVarietals(p)) &&
      (skip === "altitude" || passAltitudes(p)) &&
      (skip === "price" || passPriceBands(p)) &&
      (skip === "flavor" || passFlavors(p)) &&
      passQuery(p),
    );

  // Bean Type chip set — present-only, reading the canonical column
  // first (set by standardization) with the legacy `bean_type` as
  // fallback for products that haven't been re-standardized yet.
  const beanTypeOptions = useMemo(() => {
    const base = baseExcept("beanType");
    const counts = new Map<string, number>();
    base.forEach((p: any) => {
      const bt = p.bean_type_canonical || p.bean_type;
      if (bt) counts.set(bt, (counts.get(bt) || 0) + 1);
    });
    return BEAN_TYPES
      .filter((b) => counts.has(b.key))
      .map((b) => ({ ...b, count: counts.get(b.key)! }))
      .sort((a, b) => b.count - a.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inStock, query, selectedRoasters, selectedRoasts, selectedProcesses, selectedEstates, selectedVarietals, selectedAltitudes, selectedPriceBands]);

  // Location chip set — derived from `products.origin_estate_canonical`
  // (set by the standardization pass). "Unknown" is hidden — that's
  // the standardization bucket for "no farm-level provenance to
  // surface".
  const estateOptions = useMemo(() => {
    const base = baseExcept("estate");
    const counts = new Map<string, number>();
    base.forEach((p: any) => {
      const e = p.origin_estate_canonical;
      if (e && e !== "Unknown") counts.set(e, (counts.get(e) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, label: key, count }))
      .sort((a, b) => b.count - a.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inStock, query, selectedRoasters, selectedRoasts, selectedProcesses, selectedBeanTypes, selectedVarietals, selectedAltitudes, selectedPriceBands]);

  // Varietal chip set — combines `varietal_canonical` (named cultivars
  // + "Multi-cultivar") with `morphology` (Peaberry, Triangular)
  // because mutations and cultivars are conceptually one filter
  // surface from the consumer's standpoint. A bean tagged as both
  // Geisha + Peaberry shows up under either chip and both are
  // selectable in the same section.
  const varietalOptions = useMemo(() => {
    const base = baseExcept("varietal");
    const counts = new Map<string, number>();
    base.forEach((p: any) => {
      const v = p.varietal_canonical;
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
      const m = p.morphology;
      if (m && m !== v) counts.set(m, (counts.get(m) || 0) + 1);
    });
    // Drop singleton named varietals (≥2-product threshold) but keep
    // every morphology even when a single bean carries it — Peaberry
    // is a small but meaningful filter even at low counts.
    const isMorphology = (k: string) => k === "Peaberry" || k === "Triangular";
    return Array.from(counts.entries())
      .filter(([key, n]) => isMorphology(key) || n >= 2)
      .map(([key, count]) => ({ key, label: key, count }))
      .sort((a, b) => b.count - a.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inStock, query, selectedRoasters, selectedRoasts, selectedProcesses, selectedBeanTypes, selectedEstates, selectedAltitudes, selectedPriceBands]);

  // Roast Level chip set — faceted, descending count. `<UNKNOWN>` is
  // hidden from the chip list — that's a placeholder Sonnet writes
  // when it can't infer a roast level, and it adds nothing to the
  // consumer's filter surface.
  const roastOptions = useMemo(() => {
    const base = baseExcept("roast");
    const counts = new Map<string, number>();
    base.forEach((p: any) => {
      const r = p.roast_level;
      if (r && r !== "<UNKNOWN>") counts.set(r, (counts.get(r) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, label: key, count }))
      .sort((a, b) => b.count - a.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inStock, query, selectedRoasters, selectedProcesses, selectedBeanTypes, selectedEstates, selectedVarietals, selectedAltitudes, selectedPriceBands]);

  // Process chip set — grouped by canonical bucket (the 8 buckets
  // Standardization produces) so 60+ raw process strings collapse to
  // 8 chips. `<UNKNOWN>` hidden. Falls back to the legacy `process`
  // column for rows that haven't been Standardized yet.
  const processOptions = useMemo(() => {
    const base = baseExcept("process");
    const counts = new Map<string, number>();
    base.forEach((p: any) => {
      const pr = p.process_canonical || p.process;
      if (pr && pr !== "<UNKNOWN>") counts.set(pr, (counts.get(pr) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, label: key, count }))
      .sort((a, b) => b.count - a.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inStock, query, selectedRoasters, selectedRoasts, selectedBeanTypes, selectedEstates, selectedVarietals, selectedAltitudes, selectedPriceBands]);

  // Roasters chip set — count = how many products this roaster has in
  // the faceted base list. Pulls slug from products + label from the
  // `roasters` map fed by useCoffeeData.
  const roasterOptions = useMemo(() => {
    const base = baseExcept("roasters");
    const counts = new Map<string, number>();
    base.forEach((p: any) => {
      const slug = p.roaster_slug;
      if (slug) counts.set(slug, (counts.get(slug) || 0) + 1);
    });
    const labelBySlug = new Map<string, string>();
    (roasters as any[]).forEach((r: any) => {
      if (r.slug) labelBySlug.set(r.slug, r.name || r.slug);
    });
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, label: labelBySlug.get(key) || key, count }))
      .sort((a, b) => b.count - a.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inStock, roasters, query, selectedRoasts, selectedProcesses, selectedBeanTypes, selectedEstates, selectedVarietals, selectedAltitudes, selectedPriceBands]);

  // Altitude bands — count = how many in-base products fall in each
  // band. Bands themselves stay in fixed order (lowland → SHB) since
  // that's the consumer's mental model; only counts vary with facets.
  const altitudeOptions = useMemo(() => {
    const base = baseExcept("altitude");
    return ALTITUDE_BANDS.map((b) => {
      const count = base.filter((p: any) =>
        p.altitude_masl != null && b.test(p.altitude_masl),
      ).length;
      return { key: b.key, label: b.label, count };
    }).filter((x) => x.count > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inStock, query, selectedRoasters, selectedRoasts, selectedProcesses, selectedBeanTypes, selectedEstates, selectedVarietals, selectedPriceBands]);

  // Price bands — same idea; ppg = price per 100g.
  const priceOptions = useMemo(() => {
    const base = baseExcept("price");
    return PRICE_BANDS.map((b) => {
      const count = base.filter((p: any) => {
        if (p.price_inr == null || !p.weight_grams) return false;
        const ppg = (p.price_inr / p.weight_grams) * 100;
        return b.test(ppg);
      }).length;
      return { key: b.key, label: b.label, count };
    }).filter((x) => x.count > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inStock, query, selectedRoasters, selectedRoasts, selectedProcesses, selectedBeanTypes, selectedEstates, selectedVarietals, selectedAltitudes]);

  // Per-tab filter activity. The drawer + the filter-icon dot need
  // to reflect what's actually editable from the current tab, not
  // the union of bean + roaster filters.
  const beansFilterCount =
    selectedRoasters.length +
    selectedRoasts.length +
    selectedProcesses.length +
    selectedBeanTypes.length +
    selectedEstates.length +
    selectedVarietals.length +
    selectedAltitudes.length +
    selectedPriceBands.length +
    (selectedFlavor ? 1 : 0);
  const roastersFilterCount = selectedCities.length + selectedRoasterEstates.length;
  const activeFilterCount = activeTab === "roasters" ? roastersFilterCount : beansFilterCount;
  const hasActiveFilters = activeTab === "roasters"
    ? roastersFilterCount > 0
    : (beansFilterCount > 0 || !!query);

  const toggleArray = (arr: string[], setter: (v: string[]) => void, val: string) => {
    setter(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);
  };

  const clearAll = () => {
    if (activeTab === "roasters") {
      setSelectedCities([]);
      setSelectedRoasterEstates([]);
    } else {
      setSelectedRoasters([]); setSelectedRoasts([]); setSelectedProcesses([]);
      setSelectedBeanTypes([]); setSelectedEstates([]); setSelectedVarietals([]);
      setSelectedAltitudes([]); setSelectedPriceBands([]);
      setSelectedFlavor(null);
      setQuery("");
    }
  };

  return (
    <View style={s.container}>
      {/* Sub-tabs. Mobile layout mirrors Figma 63:4890 exactly:
         60-px tall cream strip, BEANS + ROASTERS + CAFÉS
         left-aligned with a 26-px gap between them, and a
         FadersHorizontal filter icon pinned to the right INSIDE
         the same row. The filter icon toggles the §2.34
         FilterDrawer. The wide-web layout keeps the old
         LOOKING FOR prefix + evenly-spaced tabs. */}
      <View style={[s.tabBar, isMobile && s.tabBarMobile]}>
        <View style={s.tabBarInner}>
          {!isMobile && (
            <View style={[s.tabBarLeft, { width: sidebarW }]}>
              <Text style={s.lookingForLabel}>LOOKING FOR</Text>
            </View>
          )}
          <View style={[s.tabBarRight, isMobile && s.tabBarRightMobile]}>
            {/* Sub-tab toggles flip local state, not router pathname,
               so NavigationLoader's pathname-change effect never fires.
               No `crema:loading-*` emit on switch — the sliding
               underline IS the navigation feedback, and a 350-ms
               full-screen curtain over the tab strip hides the slide
               (defeating the affordance). The data swap is in-memory
               from `useCoffeeData` / `useRoasterProfiles`, so the
               BEANS↔ROASTERS↔JOURNAL flip paints in one frame
               anyway. */}
            {/* `slideTo` fires the underline animation on the UI
               thread immediately (reanimated worklet). `setActiveTab`
               queues a React state update that swaps the content
               area asynchronously. The slide is in flight before
               React processes the swap, so heavy content mounting
               can't stutter the animation. */}
            <TabButton
              label="BEANS"
              active={activeTab === "beans"}
              tabRef={tabSlider.trackTab("beans")}
              onPress={() => {
                tabSlider.slideTo("beans");
                setActiveTab("beans");
              }}
            />
            <TabButton
              label="ROASTERS"
              active={activeTab === "roasters"}
              tabRef={tabSlider.trackTab("roasters")}
              onPress={() => {
                tabSlider.slideTo("roasters");
                setActiveTab("roasters");
              }}
            />
            <TabButton
              label="JOURNAL"
              active={activeTab === "journal"}
              tabRef={tabSlider.trackTab("journal")}
              onPress={() => {
                tabSlider.slideTo("journal");
                setActiveTab("journal");
              }}
            />
            {/* One animated underline for the whole row — slides
               between BEANS / ROASTERS / JOURNAL when the active tab
               changes. Lives inside `tabBarRight` so the underline's
               x coordinates match the tabs' onLayout x coordinates
               (same coordinate space). The static per-tab underline
               that used to ride on each TabButton was replaced by
               this single bar (`useTabSlider` primitive). */}
            <Animated.View
              pointerEvents="none"
              style={[s.tabUnderlineAnimated, tabSlider.underlineStyle]}
            />
          </View>
        </View>
        {/* Filter icon — absolutely positioned so it doesn't push
           the BEANS / ROASTERS / JOURNAL labels off their Figma x
           coordinates. Paddings + glyph size match the navbar bell
           exactly (paddingRight: 3xl = 32, glyph 24×24 stroke 2),
           so this icon sits directly below the bell on the chrome
           stack — same center, same right edge. Hides on JOURNAL
           — that tab is a chronological feed only in v1 (the
           topic + roaster filters arrive once the feed is live and
           we can pick the dimensions that pull weight). */}
        {isMobile && activeTab !== "journal" && (
          <Pressable
            onPress={() => setFilterDrawerOpen(true)}
            style={({ pressed }) => [
              s.tabBarFilterBtn,
              pressed && s.tabBarFilterBtnPressed,
            ]}
            hitSlop={10}
            accessibilityLabel={`Filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ""}`}
            accessibilityRole="button"
          >
            <SlidersHorizontal size={24} color={t.color["text.primary"]} strokeWidth={2} />
            {activeFilterCount > 0 && <View style={s.tabBarFilterDot} />}
          </Pressable>
        )}
      </View>

      {activeTab === "beans" ? (
        <View style={[s.browseLayout, isMobile && s.browseLayoutMobile]}>
          {isDesktop && (
            <ScrollView
              style={[s.sidebar, { width: sidebarW, minWidth: sidebarW, maxWidth: sidebarW }]}
              contentContainerStyle={{ paddingRight: 16, paddingTop: 20, paddingBottom: 60 }}
              showsVerticalScrollIndicator={false}
            >
              <Text style={s.sidebarCount}>
                <Text style={s.sidebarCountBold}>{filtered.length}</Text> coffees from{" "}
                <Text style={s.sidebarCountBold}>{filteredRoasterCount}</Text> roasters
              </Text>

              {hasActiveFilters && (
                <Pressable onPress={clearAll} style={{ marginBottom: 12 }}>
                  <Text style={s.clearText}>Clear all</Text>
                </Pressable>
              )}


              <View style={s.filterSection}>
                <Text style={s.filterTitle}>Sort By</Text>
                {[
                  { key: "featured", label: "Featured" },
                  { key: "newest", label: "Newest" },
                  { key: "price_low", label: "Price: Low\u2013High" },
                  { key: "price_high", label: "Price: High\u2013Low" },
                ].map(opt => (
                  <Pressable key={opt.key} onPress={() => setSortBy(opt.key)} style={s.radioRow}>
                    <View style={[s.radio, sortBy === opt.key && s.radioSelected]}>
                      {sortBy === opt.key && <View style={s.radioDot} />}
                    </View>
                    <Text style={s.checkLabel}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={s.filterDivider} />
              <FilterSection title="Roast" items={roastOptions} selected={selectedRoasts} onToggle={v => toggleArray(selectedRoasts, setSelectedRoasts, v)} />
              <View style={s.filterDivider} />
              <FilterSection title="Bean Type" items={beanTypeOptions} selected={selectedBeanTypes} onToggle={v => toggleArray(selectedBeanTypes, setSelectedBeanTypes, v)} />
              <View style={s.filterDivider} />
              <FilterSection title="Location" items={estateOptions} selected={selectedEstates} onToggle={v => toggleArray(selectedEstates, setSelectedEstates, v)} maxVisible={12} />
              <View style={s.filterDivider} />
              <FilterSection title="Varietal" items={varietalOptions} selected={selectedVarietals} onToggle={v => toggleArray(selectedVarietals, setSelectedVarietals, v)} maxVisible={12} />
              <View style={s.filterDivider} />
              <FilterSection title="Altitude" items={altitudeOptions} selected={selectedAltitudes} onToggle={v => toggleArray(selectedAltitudes, setSelectedAltitudes, v)} />
              <View style={s.filterDivider} />
              <FilterSection title="Price" items={priceOptions} selected={selectedPriceBands} onToggle={v => toggleArray(selectedPriceBands, setSelectedPriceBands, v)} />
              <View style={s.filterDivider} />
              <FilterSection title="Roasters" items={roasterOptions} selected={selectedRoasters} onToggle={v => toggleArray(selectedRoasters, setSelectedRoasters, v)} maxVisible={20} />
              <View style={s.filterDivider} />
              <FilterSection title="Process" items={processOptions} selected={selectedProcesses} onToggle={v => toggleArray(selectedProcesses, setSelectedProcesses, v)} />
            </ScrollView>
          )}

          {isDesktop && <View style={s.verticalDivider} />}

          <View style={{ flex: 1, minWidth: 0 }}>
            {flavorModalOpen ? (
              // Flavor wheel page — replaces the search bar + BEANS
              // list while open. Single-select v3 wheel; the host's
              // filter chain already reads `selectedFlavor`, so
              // dismissing returns to a BEANS list filtered by the
              // sector the user picked.
              <FlavorWheelModal
                onClose={() => setFlavorModalOpen(false)}
                selected={selectedFlavor}
                onSelectedChange={setSelectedFlavor}
                addressesByProduct={addressesByProduct}
                inStockProducts={inStock}
              />
            ) : (
            <>
            {/* Scroll-aware search bar. On mobile the filter icon
                lives INSIDE the tab bar (§Figma 63:5934) — the
                search row is input-only. */}
            {/* Search bar. On mobile the MobileHeader + chrome-scroll
                already hides out of the way — running BOTH hide
                animations in parallel caused jitter (setState reflow
                on every scroll event fighting the chrome anim), so
                we skip the state-based collapse here on mobile and
                leave the search row sticky. Web wide still runs the
                §2.16 useSearchBarAutoHide pattern. */}
            <View style={[s.searchBarWrap, !isMobile && searchBarHidden && s.searchBarWrapHidden] as any}>
              <View style={s.stickySearchWrap}>
                <View style={s.searchBar}>
                  <Search size={16} color={t.color["text.muted"]} />
                  <TextInput placeholder="Search" placeholderTextColor={t.color["text.muted"]} value={query} onChangeText={setQuery} style={s.searchInput} />
                  {query ? <Pressable onPress={() => setQuery("")} hitSlop={14} accessibilityLabel="Clear search"><X size={16} color={t.color["text.muted"]} /></Pressable> : null}
                </View>
                {/* Live coffee + roaster count under the search bar.
                   Always visible (not just on desktop sidebar) so the
                   admin can watch numbers move as enrichment runs
                   land new beans. */}
                <Text style={s.beansCount}>
                  <Text style={s.beansCountBold}>{filtered.length}</Text>{" "}
                  {filtered.length === 1 ? "coffee" : "coffees"} from{" "}
                  <Text style={s.beansCountBold}>{filteredRoasterCount}</Text>{" "}
                  {filteredRoasterCount === 1 ? "roaster" : "roasters"}
                </Text>
              </View>
            </View>

            <CoffeeList
              coffees={filtered}
              popularity={popularity}
              onScroll={(e) => { onChromeScroll(e); if (!isMobile) handleBeansScroll(e); }}
              ListHeaderComponent={
                hasActiveFilters ? (
                  <View style={s.listHeader}>
                    <View style={s.activeChips}>
                      {selectedRoasts.map(v => <ActiveChip key={`rl:${v}`} label={v} onRemove={() => toggleArray(selectedRoasts, setSelectedRoasts, v)} />)}
                      {selectedBeanTypes.map(v => <ActiveChip key={`bt:${v}`} label={v} onRemove={() => toggleArray(selectedBeanTypes, setSelectedBeanTypes, v)} />)}
                      {selectedEstates.map(v => <ActiveChip key={`es:${v}`} label={v} onRemove={() => toggleArray(selectedEstates, setSelectedEstates, v)} />)}
                      {selectedVarietals.map(v => <ActiveChip key={`vt:${v}`} label={v} onRemove={() => toggleArray(selectedVarietals, setSelectedVarietals, v)} />)}
                      {selectedAltitudes.map(k => {
                        const band = ALTITUDE_BANDS.find(b => b.key === k);
                        return <ActiveChip key={`alt:${k}`} label={band?.label || k} onRemove={() => toggleArray(selectedAltitudes, setSelectedAltitudes, k)} />;
                      })}
                      {selectedPriceBands.map(k => {
                        const band = PRICE_BANDS.find(b => b.key === k);
                        return <ActiveChip key={`pr:${k}`} label={band?.label || k} onRemove={() => toggleArray(selectedPriceBands, setSelectedPriceBands, k)} />;
                      })}
                      {selectedProcesses.map(v => <ActiveChip key={`pc:${v}`} label={v} onRemove={() => toggleArray(selectedProcesses, setSelectedProcesses, v)} />)}
                      {selectedRoasters.map(slug => {
                        const r = roasters.find((r: any) => r.slug === slug);
                        return <ActiveChip key={`rs:${slug}`} label={r?.name || slug} onRemove={() => toggleArray(selectedRoasters, setSelectedRoasters, slug)} />;
                      })}
                    </View>
                  </View>
                ) : null
              }
            />
            </>
            )}
          </View>
        </View>
      ) : activeTab === "roasters" ? (
        <RoastersList
          cityOptions={cityOptions}
          selectedCities={selectedCities}
          setSelectedCities={setSelectedCities}
          estateOptions={roasterEstateOptions}
          selectedEstates={selectedRoasterEstates}
          setSelectedEstates={setSelectedRoasterEstates}
          roasterEstateMap={roasterEstateMap}
        />
      ) : (
        <JournalList />
      )}

      {/* §2.34 — Mobile filter drawer. Reuses the SlidePanel primitive
          and binds to the exact same state the desktop sidebar does,
          so toggling between narrow and wide viewports mid-session
          never resets a filter. */}
      {!isDesktop && (
        <View style={StyleSheet.absoluteFillObject as any} pointerEvents={filterDrawerOpen ? "auto" : "none"}>
          <SlidePanel
            visible={filterDrawerOpen}
            onClose={() => setFilterDrawerOpen(false)}
            side="right"
            widthPercent={88}
            dimBackdrop={false}
          >
            <View style={s.filterDrawerBody}>
              <View style={s.filterDrawerHeader}>
                <Text style={s.filterDrawerTitle}>Filter</Text>
                <Pressable
                  onPress={() => setFilterDrawerOpen(false)}
                  hitSlop={10}
                  accessibilityLabel="Close filters"
                  accessibilityRole="button"
                  style={s.filterDrawerClose}
                >
                  <X size={18} color={t.color["text.primary"]} strokeWidth={1.75} />
                </Pressable>
              </View>
              <View style={s.filterDivider} />
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 }}
                showsVerticalScrollIndicator={false}
              >
                {/* Live result count — mirrors the desktop sidebar's
                    `sidebarCount` so the mobile drawer also tells the
                    user how many beans are still in scope as filters
                    flip on / off. The denominator is the BEANS view
                    even on the ROASTERS tab so the number reads as
                    "your current Discover surface". */}
                <View style={s.filterDrawerCountWrap}>
                  <Text style={s.sidebarCount}>
                    <Text style={s.sidebarCountBold}>{filtered.length}</Text>{" "}
                    {filtered.length === 1 ? "coffee" : "coffees"} from{" "}
                    <Text style={s.sidebarCountBold}>{filteredRoasterCount}</Text>{" "}
                    {filteredRoasterCount === 1 ? "roaster" : "roasters"}
                  </Text>
                  {hasActiveFilters && (
                    <Pressable onPress={clearAll} hitSlop={6}>
                      <Text style={s.clearText}>Clear all</Text>
                    </Pressable>
                  )}
                </View>
                <View style={s.filterDivider} />
                {activeTab === "roasters" ? (
                  // ROASTERS tab — Location (city) + Estate exposure.
                  // The estate filter narrows the roaster list to ones
                  // whose catalog exposes the chosen estates.
                  <>
                    <FilterSection
                      title="Location"
                      items={cityOptions}
                      selected={selectedCities}
                      onToggle={v => toggleArray(selectedCities, setSelectedCities, v)}
                      maxVisible={20}
                    />
                    {roasterEstateOptions.length > 0 ? (
                      <>
                        <View style={s.filterDivider} />
                        <FilterSection
                          title="Estate exposure"
                          items={roasterEstateOptions}
                          selected={selectedRoasterEstates}
                          onToggle={v => toggleArray(selectedRoasterEstates, setSelectedRoasterEstates, v)}
                          maxVisible={20}
                        />
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    <View style={s.filterSection}>
                      <Text style={s.filterTitle}>Sort By</Text>
                      {[
                        { key: "featured", label: "Featured" },
                        { key: "newest", label: "Newest" },
                        { key: "price_low", label: "Price: Low\u2013High" },
                        { key: "price_high", label: "Price: High\u2013Low" },
                      ].map(opt => (
                        <Pressable key={opt.key} onPress={() => setSortBy(opt.key)} style={s.radioRow}>
                          <View style={[s.radio, sortBy === opt.key && s.radioSelected]}>
                            {sortBy === opt.key && <View style={s.radioDot} />}
                          </View>
                          <Text style={s.checkLabel}>{opt.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={s.filterDivider} />
                    {/* Flavor \u2014 opens the SCA wheel modal over the BEANS
                        list. The drawer dismisses so the background
                        results are visible while the user picks. */}
                    <Pressable
                      onPress={() => {
                        setFilterDrawerOpen(false);
                        setFlavorModalOpen(true);
                      }}
                      style={s.filterSection}
                      accessibilityRole="button"
                      accessibilityLabel={`Flavor wheel${selectedFlavor ? `, ${selectedFlavor} selected` : ""}`}
                    >
                      <View style={s.filterHead}>
                        <Text style={s.filterTitle}>Flavor</Text>
                        {selectedFlavor ? (
                          <Text style={s.filterHeadBadge}>{selectedFlavor}</Text>
                        ) : null}
                        <View style={{ flex: 1 }} />
                        <Text style={s.flavorOpenHint}>
                          {selectedFlavor ? "Edit" : "Open wheel"}
                        </Text>
                        <ChevronRight size={16} color={t.color["text.muted"]} strokeWidth={1.75} />
                      </View>
                    </Pressable>
                    <View style={s.filterDivider} />
                    <FilterSection title="Roast" items={roastOptions} selected={selectedRoasts} onToggle={v => toggleArray(selectedRoasts, setSelectedRoasts, v)} />
                    <View style={s.filterDivider} />
                    <FilterSection title="Bean Type" items={beanTypeOptions} selected={selectedBeanTypes} onToggle={v => toggleArray(selectedBeanTypes, setSelectedBeanTypes, v)} />
                    <View style={s.filterDivider} />
                    <FilterSection title="Location" items={estateOptions} selected={selectedEstates} onToggle={v => toggleArray(selectedEstates, setSelectedEstates, v)} maxVisible={12} />
                    <View style={s.filterDivider} />
                    <FilterSection title="Varietal" items={varietalOptions} selected={selectedVarietals} onToggle={v => toggleArray(selectedVarietals, setSelectedVarietals, v)} maxVisible={12} />
                    <View style={s.filterDivider} />
                    <FilterSection title="Altitude" items={altitudeOptions} selected={selectedAltitudes} onToggle={v => toggleArray(selectedAltitudes, setSelectedAltitudes, v)} />
                    <View style={s.filterDivider} />
                    <FilterSection title="Price" items={priceOptions} selected={selectedPriceBands} onToggle={v => toggleArray(selectedPriceBands, setSelectedPriceBands, v)} />
                    <View style={s.filterDivider} />
                    <FilterSection title="Roasters" items={roasterOptions} selected={selectedRoasters} onToggle={v => toggleArray(selectedRoasters, setSelectedRoasters, v)} maxVisible={20} />
                    <View style={s.filterDivider} />
                    <FilterSection title="Process" items={processOptions} selected={selectedProcesses} onToggle={v => toggleArray(selectedProcesses, setSelectedProcesses, v)} />
                  </>
                )}
              </ScrollView>
              {/* Footer actions — reset (with per-tab count) on the
                  left, apply on the right. */}
              <View style={s.filterDrawerFooter}>
                <Pressable
                  onPress={clearAll}
                  disabled={!hasActiveFilters}
                  style={[s.filterResetBtn, !hasActiveFilters && s.filterResetBtnDisabled]}
                >
                  <Text style={s.filterResetText}>
                    Reset{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                  </Text>
                </Pressable>
                <Pressable onPress={() => setFilterDrawerOpen(false)} style={s.filterApplyBtn}>
                  <Text style={s.filterApplyText}>Apply</Text>
                </Pressable>
              </View>
            </View>
          </SlidePanel>
        </View>
      )}

    </View>
  );
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const s = useStyles();
  return (
    <View style={s.activeChip}>
      <Text style={s.activeChipText}>{label}</Text>
      <Pressable onPress={onRemove} hitSlop={14} accessibilityLabel={`Remove ${label}`}><X size={10} color={t.color["tag.text"]} /></Pressable>
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
  tabRef,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  tabRef?: (node: any) => void;
}) {
  const s = useStyles();
  return (
    <Pressable
      testID={`browse-tab-${label.toLowerCase()}`}
      onPress={onPress}
      ref={tabRef as any}
      style={s.tabBtn}
    >
      <Text style={[s.tabLabel, active && s.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function FilterSection({ title, items, selected, onToggle, maxVisible = 10 }: {
  title: string;
  // count is optional \u2014 when present the chip renders "Label \u00b7 N"
  // where N = how many products would remain in view if this chip
  // were toggled on (faceted, considering other active filters).
  items: { key: string; label: string; count?: number }[];
  selected: string[]; onToggle: (key: string) => void; maxVisible?: number;
}) {
  // Each section starts collapsed so the consumer can scan every
  // available filter category at a glance, then expand only the ones
  // they want to act on. A section auto-opens whenever it has an
  // active selection \u2014 the visible chip is the strongest signal that
  // the consumer cares about this dimension, and re-collapsing on
  // every render would just hide the toggles they're using.
  const hasSelection = selected.length > 0;
  const [open, setOpen] = useState(hasSelection);
  useEffect(() => {
    if (hasSelection) setOpen(true);
  }, [hasSelection]);

  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, maxVisible);
  const hasMore = items.length > maxVisible;
  const s = useStyles();

  return (
    <View style={s.filterSection}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={s.filterHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}${selected.length > 0 ? `, ${selected.length} selected` : ""}, ${open ? "expanded" : "collapsed"}`}
      >
        <Text style={s.filterTitle}>{title}</Text>
        {selected.length > 0 ? (
          <Text style={s.filterHeadBadge}>{selected.length}</Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {open ? (
          <ChevronDown size={16} color={t.color["text.muted"]} strokeWidth={1.75} />
        ) : (
          <ChevronRight size={16} color={t.color["text.muted"]} strokeWidth={1.75} />
        )}
      </Pressable>
      {open ? (
        <>
          {visible.map(({ key, label, count }) => (
            <Pressable key={key} onPress={() => onToggle(key)} style={s.checkRow}>
              <View style={[s.checkbox, selected.includes(key) && s.checkboxChecked]}>
                {selected.includes(key) && <Text style={s.checkmark}>{"\u2713"}</Text>}
              </View>
              <Text style={s.checkLabel} numberOfLines={2}>{label}</Text>
              {typeof count === "number" ? (
                <Text style={s.checkCount}>{count}</Text>
              ) : null}
            </Pressable>
          ))}
          {hasMore ? (
            <Pressable onPress={() => setExpanded((v) => !v)}>
              <Text style={s.showMoreText}>
                {expanded ? "Show less" : `Show all ${items.length}`}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

// ─── Roasters tab ────────────────────────────────────────────────────────────

/**
 * Grid-sized roaster / café card. Mirrors CoffeeCard's 240-wide
 * portrait geometry so Discover feels like one consistent browsing
 * surface across BEANS / ROASTERS / CAFÉS. Image on top, info block
 * below on `card.info` cream so the card stacks neatly next to
 * CoffeeCards.
 */
function BrowseCard({
  imageUrl, fallbackInitial, name, subtitle, onPress, width: cardW,
}: {
  imageUrl?: string; fallbackInitial: string; name: string; subtitle: string;
  onPress: () => void; width: number;
}) {
  // Image takes a fixed fraction of the card width (square-ish hero
  // so the bean / cafe photo reads cleanly regardless of aspect),
  // info sits below with just enough height for a 2-line Canela name
  // + 1-line subtitle. No wasted cream — keeps the card feeling
  // tight the way CoffeeCard does.
  const imgH = Math.round(cardW * 0.7);
  const s = useStyles();
  return (
    <Pressable onPress={onPress} style={[s.bcCard, { width: cardW }]}>
      <View style={[s.bcImage, { width: cardW, height: imgH }]}>
        {imageUrl ? (
          <Image source={{ uri: resolveUploadUrl(imageUrl) }} style={StyleSheet.absoluteFillObject as any} contentFit="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFillObject as any, { alignItems: "center", justifyContent: "center" }]}>
            <Text style={s.bcFallback}>{fallbackInitial.toUpperCase()}</Text>
          </View>
        )}
      </View>
      <View style={[s.bcInfo, { width: cardW }]}>
        <Text style={s.bcName} numberOfLines={2}>{name}</Text>
        {subtitle ? <Text style={s.bcSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

function RoastersList({
  cityOptions,
  selectedCities,
  setSelectedCities,
  estateOptions,
  selectedEstates,
  setSelectedEstates,
  roasterEstateMap,
}: {
  cityOptions: { key: string; label: string; count: number }[];
  selectedCities: string[];
  setSelectedCities: (next: string[]) => void;
  estateOptions: { key: string; label: string; count: number }[];
  selectedEstates: string[];
  setSelectedEstates: (next: string[]) => void;
  // roaster_slug → set of estate names that roaster exposes via its
  // products. Driven from `origin_estate_canonical`. Used to filter
  // the roaster list down when the consumer picks Estate chips.
  roasterEstateMap: Record<string, Set<string>>;
}) {
  const router = useRouter();
  const { products } = useCoffeeData();
  // Discover ROASTERS reads from the sitewide `RoasterProfilesProvider`
  // cache so the list shares storage with the per-roaster page (tap
  // a row → roaster page hydrates synchronously) and with the admin
  // Catalog Ops list. Profiles with `published=0` (unreviewed drafts)
  // stay hidden from consumers.
  const profilesCache = useRoasterProfiles();
  const { width } = useWindowDimensions();
  const { isMobile } = useBreakpoint();
  const isDesktop = width >= 1024;
  const sidebarW = Math.max(160, Math.min(280, Math.round(width * 0.135)));
  const [roasterQuery, setRoasterQuery] = useState("");
  const { hidden: searchBarHidden, handleScroll } = useSearchBarAutoHide();
  const s = useStyles();

  // Silent refresh on focus so admin-approved roasters appear without
  // an app reload. The shared cache means this fetch updates Discover
  // ROASTERS, the per-roaster page, and any other reader in lockstep.
  useFocusEffect(
    useCallback(() => {
      profilesCache.refetch({ silent: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // Per-roaster fallback image — the profile's own logo / hero takes
  // precedence; the first product image is the fallback for legacy
  // roasters whose profile assets haven't been filled in yet.
  const roasterImages = useMemo(() => {
    const map: Record<string, string> = {};
    (products as any[]).forEach((p: any) => {
      if (p.image_url && !map[p.roaster_slug]) map[p.roaster_slug] = p.image_url;
    });
    return map;
  }, [products]);

  const publishedProfiles = useMemo(() => {
    return (profilesCache.profiles || []).filter((p: any) => p.published === 1);
  }, [profilesCache.profiles]);

  const filteredRoasters = useMemo(() => {
    let result = publishedProfiles;
    if (roasterQuery) {
      const q = roasterQuery.toLowerCase();
      result = result.filter((r) =>
        (r.name || "").toLowerCase().includes(q) ||
        (r.city || "").toLowerCase().includes(q)
      );
    }
    if (selectedCities.length > 0) {
      result = result.filter((r) => !!r.city && selectedCities.includes(r.city));
    }
    if (selectedEstates.length > 0) {
      // Roaster passes if its catalog exposes ANY of the selected
      // estates. Empty/missing entries get dropped.
      result = result.filter((r) => {
        const exposes = roasterEstateMap[r.roaster_slug];
        if (!exposes) return false;
        return selectedEstates.some((e) => exposes.has(e));
      });
    }
    // Sort: most-stocked roasters surface first; alphabetical secondary.
    return [...result].sort((a, b) => {
      const ap = a.products_count || 0;
      const bp = b.products_count || 0;
      if (ap !== bp) return bp - ap;
      return (a.name || a.roaster_slug).localeCompare(b.name || b.roaster_slug);
    });
  }, [publishedProfiles, roasterQuery, selectedCities, selectedEstates, roasterEstateMap]);

  const toggleCity = (city: string) => {
    // setSelectedCities arrives from BrowsePage as a plain `(next) =>`
    // setter, so we resolve the new array from the current `selectedCities`
    // prop instead of the functional-setter pattern.
    setSelectedCities(
      selectedCities.includes(city)
        ? selectedCities.filter(c => c !== city)
        : [...selectedCities, city]
    );
  };

  const toggleEstate = (estate: string) => {
    setSelectedEstates(
      selectedEstates.includes(estate)
        ? selectedEstates.filter(e => e !== estate)
        : [...selectedEstates, estate]
    );
  };

  return (
    <View style={[s.browseLayout, isMobile && s.browseLayoutMobile]}>
      {/* City filter sidebar */}
      {isDesktop && (
        <ScrollView
          style={[s.sidebar, { width: sidebarW, minWidth: sidebarW, maxWidth: sidebarW }]}
          contentContainerStyle={{ paddingRight: 16, paddingTop: 20, paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.sidebarCount}>
            <Text style={s.sidebarCountBold}>{filteredRoasters.length}</Text> roasters
          </Text>
          <View style={s.filterDivider} />
          <FilterSection
            title="Location"
            items={cityOptions}
            selected={selectedCities}
            onToggle={toggleCity}
            maxVisible={20}
          />
          {estateOptions.length > 0 ? (
            <>
              <View style={s.filterDivider} />
              <FilterSection
                title="Estate exposure"
                items={estateOptions}
                selected={selectedEstates}
                onToggle={toggleEstate}
                maxVisible={20}
              />
            </>
          ) : null}
        </ScrollView>
      )}

      {isDesktop && <View style={s.verticalDivider} />}

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={[s.searchBarWrap, !isMobile && searchBarHidden && s.searchBarWrapHidden] as any}>
          <View style={s.stickySearchWrap}>
            <View style={s.searchBar}>
              <Search size={16} color={t.color["text.muted"]} />
              <TextInput placeholder="Search" placeholderTextColor={t.color["text.muted"]} value={roasterQuery} onChangeText={setRoasterQuery} style={s.searchInput} />
              {roasterQuery ? <Pressable onPress={() => setRoasterQuery("")} hitSlop={14} accessibilityLabel="Clear roaster search"><X size={16} color={t.color["text.muted"]} /></Pressable> : null}
            </View>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          onScroll={(e) => { onChromeScroll(e); if (!isMobile) handleScroll(e); }}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: 100 }}
        >
          {filteredRoasters.map((r, idx) => (
            <RoasterRow
              key={r.roaster_slug}
              imageUrl={
                r.logo_url ||
                r.hero_image_url ||
                roasterImages[r.roaster_slug] ||
                undefined
              }
              name={r.name || r.roaster_slug}
              city={r.city}
              state={r.state}
              productsCount={r.products_count || 0}
              showDivider={idx < filteredRoasters.length - 1}
              onPress={() => router.push(`/roaster/${r.roaster_slug}`)}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

// ── JOURNAL ────────────────────────────────────────────────────────────────
//
// Chronological article feed — newest first, paginated by the SWR
// cache fed via `RoasterArticlesProvider`. v1 has no filter scope
// (the prompt explicitly defers the filter dimensions until the feed
// is live and we can react to the actual content shape). The row
// component (`ArticleListRow`) handles its own tap → /article/[id]
// + the engagement strip + the trailing hairline divider.

function JournalList() {
  const articlesCache = useRoasterArticles();
  const profilesCache = useRoasterProfiles();
  const { width } = useWindowDimensions();
  const { isMobile } = useBreakpoint();
  const isWide = width >= 768;
  const s = useStyles();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  // Filter axes added 2026-05-10. Sort defaults to "newest" so the
  // chronological feed reads top-down on first paint; tapping the
  // sort pill flips to oldest-first. Topic filter is multi-select —
  // empty array = "all topics". The "other" chip key collapses
  // both topic_category='other' AND NULL rows (legacy + Haiku
  // failures) — see articleMeta.topicBucketKey.
  const [sortDir, setSortDir] = useState<"newest" | "oldest">("newest");
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);

  useFocusEffect(
    useCallback(() => {
      articlesCache.refetch({ silent: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // When the user picks a roaster from the strip, fetch that
  // roaster's full article set and merge into the cache. The
  // sitewide /articles?limit=500 endpoint orders chronologically and
  // older articles (Caffena's 2022 evergreens, etc.) fall past the
  // cap — without this fetch, the Caffena chip would surface only
  // ~5 of 9 articles. Bounded per call (5–30 articles per roaster);
  // cache.upsert merges in so subsequent navigation keeps benefit.
  useEffect(() => {
    if (!selectedSlug) return;
    let cancelled = false;
    apiFetchRaw(
      `/roasters/${encodeURIComponent(selectedSlug)}/articles?limit=100`,
    )
      .then((res: any) => {
        if (cancelled) return;
        const list = res?.data || res || [];
        if (Array.isArray(list)) {
          for (const a of list) {
            if (a?.id != null) articlesCache.upsert(a);
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlug]);

  const allArticles = articlesCache.articles;

  // Roster strip — one entry per roaster that has at least one
  // article. Sorted by their newest article (published_at, falling
  // back to scraped_at) DESC so the freshest publishers surface
  // first. Each entry carries the latest-published timestamp for
  // display in the future ("posted 2d ago").
  const roastersByLatest = useMemo(() => {
    const byRoaster = new Map<string, { latest: number; count: number }>();
    for (const a of allArticles) {
      if (!a.roaster_slug) continue;
      const ts = Date.parse(a.published_at || a.scraped_at) || 0;
      const cur = byRoaster.get(a.roaster_slug);
      if (!cur) {
        byRoaster.set(a.roaster_slug, { latest: ts, count: 1 });
      } else {
        cur.count += 1;
        if (ts > cur.latest) cur.latest = ts;
      }
    }
    return Array.from(byRoaster.entries())
      .map(([slug, info]) => {
        const profile = profilesCache.getBySlug(slug);
        return {
          slug,
          name: profile?.name || slug,
          logo_url: profile?.logo_url || null,
          ...info,
        };
      })
      .sort((a, b) => b.latest - a.latest);
  }, [allArticles, profilesCache]);

  // Apply all three filter axes + sort in one pass. Roaster chip,
  // topic chips, sort direction. Stable order for ties (id DESC) so
  // a re-sort doesn't shuffle articles with identical timestamps.
  const articles = useMemo(() => {
    let out = allArticles;
    if (selectedSlug) {
      out = out.filter((a) => a.roaster_slug === selectedSlug);
    }
    if (selectedTopics.length > 0) {
      const set = new Set(selectedTopics);
      out = out.filter((a) => set.has(topicBucketKey(a.topic_category)));
    }
    // Make a copy before sorting — `cache.articles` is reactive
    // shared state, in-place sorts ripple to other consumers.
    const dir = sortDir === "newest" ? -1 : 1;
    return [...out].sort((a, b) => {
      const ta = Date.parse(a.published_at || a.scraped_at) || 0;
      const tb = Date.parse(b.published_at || b.scraped_at) || 0;
      if (ta !== tb) return (ta - tb) * dir;
      // Tie-break on id DESC (matches the server's
      // ORDER BY ... t.id DESC for newest-first; flipped for oldest).
      return ((Number(a.id) || 0) - (Number(b.id) || 0)) * dir;
    });
  }, [allArticles, selectedSlug, selectedTopics, sortDir]);

  const toggleTopic = useCallback((key: string) => {
    setSelectedTopics((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }, []);

  // JOURNALS is now a single editorial column — `<ArticleListRow>`
  // stacks tag/date · title · byline · hero · excerpt · action bar
  // separated by hairlines, in the spirit of how the major editorial
  // sites (Anthropic, NYT, The Verge) present article lists. On wide
  // viewports the column is centered with a max width so the long
  // form reads at a comfortable measure rather than spanning a
  // 1200-px line. Outer GRID_PAD matches the rest of Discover.
  const GRID_PAD = 16;
  const GRID_GAP = 0; // dividers handle inter-row separation
  const COLUMN_MAX = 720;
  const cardWidth = useMemo(() => {
    const inner = Math.max(0, width - GRID_PAD * 2);
    return isWide ? Math.min(inner, COLUMN_MAX) : inner;
  }, [width, isWide]);

  const showSpinner =
    articlesCache.loading && allArticles.length === 0;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: 16,
          paddingBottom: 100,
          gap: GRID_GAP,
        }}
        onScroll={(e) => onChromeScroll(e)}
        scrollEventThrottle={16}
      >
        {/* Roaster strip — newest-first carousel above the feed.
           Hidden when there are no roasters yet (empty state). */}
        {roastersByLatest.length > 0 ? (
          <RoasterStrip
            roasters={roastersByLatest}
            selectedSlug={selectedSlug}
            onSelect={setSelectedSlug}
          />
        ) : null}

        {/* Filter strip — sort toggle + 8 topic chips. Sits below the
            roster carousel and above the editorial column. The "Other"
            chip catches both topic_category='other' AND null rows so
            unenriched / legacy articles still surface under a single
            opt-in. Hidden when there's nothing to filter (empty
            cache). */}
        {allArticles.length > 0 ? (
          <JournalFilterStrip
            sortDir={sortDir}
            onToggleSort={() =>
              setSortDir((d) => (d === "newest" ? "oldest" : "newest"))
            }
            selectedTopics={selectedTopics}
            onToggleTopic={toggleTopic}
            onClearTopics={() => setSelectedTopics([])}
          />
        ) : null}

        <View
          style={{
            // Single-column editorial layout — center the column on
            // wide viewports, span full width on mobile.
            alignSelf: "center",
            width: cardWidth,
          }}
        >
          {showSpinner ? (
            <View style={{ paddingVertical: 64, alignItems: "center" }}>
              <ActivityIndicator size="small" color={t.color["text.primary"]} />
            </View>
          ) : articles.length === 0 ? (
            // Canonical empty state per DESIGN_LANGUAGE §6 — single
            // line, body.regular, font.md, text.muted, centered.
            <View style={{ paddingVertical: 96 }}>
              <Text
                style={{
                  fontFamily: t.font["body.regular"],
                  fontSize: t.size["font.md"],
                  color: t.color["text.muted"],
                  textAlign: "center",
                }}
              >
                {selectedSlug
                  ? "No articles from this roaster yet."
                  : "Nothing here yet."}
              </Text>
            </View>
          ) : (
            articles.map((a, idx) => (
              <ArticleListRow
                key={a.id}
                article={a}
                showDivider={idx < articles.length - 1}
              />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}


// ── RoasterStrip — horizontal carousel of roasters that have published
//    articles, sorted newest-first. Tap an avatar to filter the feed
//    below; the leading "All" pill clears the filter.

function RoasterStrip({
  roasters,
  selectedSlug,
  onSelect,
}: {
  roasters: Array<{ slug: string; name: string; logo_url: string | null; count: number; latest: number }>;
  selectedSlug: string | null;
  onSelect: (slug: string | null) => void;
}) {
  const s = useStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
      style={{ flexGrow: 0 }}
    >
      <Pressable
        onPress={() => onSelect(null)}
        style={({ pressed }) => [
          s.roasterStripAllPill,
          selectedSlug === null && s.roasterStripAllPillActive,
          pressed && s.roasterStripPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Show all journal articles"
      >
        <Text
          style={[
            s.roasterStripAllText,
            selectedSlug === null && s.roasterStripAllTextActive,
          ]}
        >
          All
        </Text>
      </Pressable>
      {roasters.map((r) => {
        const active = selectedSlug === r.slug;
        return (
          <Pressable
            key={r.slug}
            onPress={() => onSelect(active ? null : r.slug)}
            style={({ pressed }) => [
              s.roasterStripItem,
              pressed && s.roasterStripPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Filter to ${r.name}'s articles`}
          >
            <View
              style={[
                s.roasterStripAvatarWrap,
                active && s.roasterStripAvatarWrapActive,
              ]}
            >
              <RoasterLogo
                url={r.logo_url}
                size={56}
                fallbackInitial={r.name}
              />
            </View>
            <Text
              style={[
                s.roasterStripName,
                active && s.roasterStripNameActive,
              ]}
              numberOfLines={1}
            >
              {r.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}


// ── JournalFilterStrip — sort toggle + topic chips ──────────────────────────
// Sits below the roaster carousel. Horizontal scroll on every viewport
// (the 8 topic chips overflow most mobile widths). Sort pill on the
// left flips between "Newest" and "Oldest" when tapped; the active
// state is implicit (the label reflects the current order). Topic
// chips are multi-select with a pink fill in the active state. A
// trailing "Clear" pill appears when any topic is selected so the
// user can reset without scrolling back.

function JournalFilterStrip({
  sortDir,
  onToggleSort,
  selectedTopics,
  onToggleTopic,
  onClearTopics,
}: {
  sortDir: "newest" | "oldest";
  onToggleSort: () => void;
  selectedTopics: string[];
  onToggleTopic: (key: string) => void;
  onClearTopics: () => void;
}) {
  const s = useStyles();
  const sortLabel = sortDir === "newest" ? "Newest first" : "Oldest first";
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 8,
        alignItems: "center",
      }}
      style={{ flexGrow: 0 }}
    >
      <Pressable
        onPress={onToggleSort}
        style={({ pressed }) => [
          s.journalSortPill,
          pressed && { opacity: 0.7 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Sort: ${sortLabel}. Tap to flip.`}
      >
        <Text style={s.journalSortLabel}>{sortLabel}</Text>
        <ChevronDown
          size={14}
          color={t.color["text.primary"]}
          strokeWidth={2}
          style={{
            transform: [
              { rotate: sortDir === "oldest" ? "180deg" : "0deg" },
            ],
          }}
        />
      </Pressable>

      {/* Vertical separator between sort and topic axes — calm
          divider line, not a chip. Same divider color the rest of the
          page uses. */}
      <View style={s.journalFilterSep} />

      {TOPIC_CHIPS.map((chip) => {
        const active = selectedTopics.includes(chip.key);
        return (
          <Pressable
            key={chip.key}
            onPress={() => onToggleTopic(chip.key)}
            style={({ pressed }) => [
              s.journalTopicChip,
              active && s.journalTopicChipActive,
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Filter by ${chip.label}`}
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[
                s.journalTopicChipText,
                active && s.journalTopicChipTextActive,
              ]}
            >
              {chip.label}
            </Text>
          </Pressable>
        );
      })}

      {selectedTopics.length > 0 ? (
        <Pressable
          onPress={onClearTopics}
          style={({ pressed }) => [
            s.journalClearPill,
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Clear all topic filters"
        >
          <Text style={s.journalClearText}>Clear</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}


// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((t) => ({
  container: { flex: 1, backgroundColor: t.color.bg },

  // Tab bar
  tabBar: {
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.color.border,
    backgroundColor: t.color.bg, height: 80, justifyContent: "center",
  },
  // Mobile: exact Figma 63:5927 geometry — 60 px tall, cream bg,
  // single hairline divider top + bottom (the cross-tab separator
  // plus the navbar/search edge). Paddings are baked into
  // `tabBarRightMobile` (paddingHorizontal 32) so the BEANS text
  // starts at x=32 per Figma 63:4979.
  tabBarMobile: {
    height: (t.size as any)["tabbar.mobile.height"],
  } as any,
  // `height: "100%"` + `alignItems: "stretch"` so the tab buttons
  // span the full tabBar height — this is what lets the
  // tabUnderline's `bottom: -1` ride the parent's borderBottom line
  // instead of hugging the text baseline. Without the explicit
  // height, tabBarInner collapses to content height (~17px) and the
  // underline sits just below the word.
  tabBarInner: { flexDirection: "row", alignItems: "stretch", paddingLeft: "6.25%" as any, paddingRight: "6.25%" as any, width: "100%" as any, height: "100%" as any },
  tabBarLeft: { width: 195, flexShrink: 0, justifyContent: "center" } as any,
  tabBarRight: { flex: 1, flexDirection: "row", alignItems: "stretch", paddingLeft: 16, gap: 48 } as any,
  // Mobile: BEANS / ROASTERS / CAFÉS left-aligned with a 26 px gap
  // (Figma 63:4979→63:4981 = 58 px center-to-center minus the BEANS
  // text width of 32 = ~26 gap); filter icon pinned to the right
  // inside the same row. Absolute `paddingHorizontal: 32` overrides
  // the parent's percentage paddings on `tabBarInner`.
  tabBarRightMobile: {
    paddingLeft: 0,
    paddingHorizontal: t.spacing["3xl"],
    gap: t.spacing["2xl"],
    justifyContent: "flex-start",
  } as any,
  lookingForLabel: {
    fontFamily: t.font["body.medium"], fontSize: 14, color: t.color["text.primary"],
    textTransform: "uppercase", alignSelf: "center",
  } as any,
  tabBtn: { justifyContent: "center", position: "relative" } as any,
  tabLabel: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.muted"] },
  tabLabelActive: { fontFamily: t.font["body.semibold"], color: t.color["text.primary"] },
  tabUnderline: { position: "absolute", bottom: -1, left: 0, right: 0, height: 4, backgroundColor: t.color["text.primary"] } as any,
  // Animated counterpart — only chrome (bottom offset, height, color).
  // `left` + `width` come from `useTabSlider`'s Animated.Values, so
  // those properties are deliberately absent here.
  tabUnderlineAnimated: {
    bottom: -1,
    height: 4,
    backgroundColor: t.color["text.primary"],
  } as any,
  // Filter icon — absolutely pinned to the right of the tab bar
  // at the same `paddingRight` the navbar bell uses (3xl = 32) so
  // the two icons stack vertically aligned on the chrome stack.
  // Bare glyph (no cream disc) — the disc previously here read as
  // a sibling-affordance of marketplace controls, but stacking it
  // below the bell calls attention to the size mismatch. Same
  // geometry as the bell now (24-pt SlidersHorizontal at stroke 2)
  // means the filter icon's optical weight matches the bell's
  // exactly. Dot badge appears top-right when any filter is active.
  tabBarFilterBtn: {
    position: "absolute" as any,
    right: t.spacing["3xl"],
    top: 0,
    bottom: 0,
    width: 24,
    justifyContent: "center",
    alignItems: "center",
  } as any,
  tabBarFilterBtnPressed: {
    opacity: 0.7,
  } as any,
  tabBarFilterDot: {
    position: "absolute",
    top: 8,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.color.accent,
  } as any,

  // Browse layout
  browseLayout: { flex: 1, flexDirection: "row", paddingLeft: "6.25%" as any, paddingRight: "6.25%" as any, paddingTop: 63 } as any,
  // Mobile: collapse the 63-px top pad entirely. The stickySearchWrap
  // below already brings its own paddingTop (12), so anything added
  // here just doubles up the gap above the search field.
  browseLayoutMobile: { paddingTop: 0, paddingLeft: 0 as any, paddingRight: 0 as any } as any,

  // Vertical divider
  verticalDivider: { width: 1, backgroundColor: "rgba(215,209,196,0.5)" } as any,

  // Sidebar
  sidebar: { width: 195, minWidth: 195, maxWidth: 195, flexShrink: 0, flexGrow: 0 },
  sidebarCount: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.primary"], marginBottom: 16, lineHeight: 18 },
  sidebarCountBold: { fontFamily: t.font["body.semibold"] },
  // Live count under the search bar — visible on every viewport so
  // the admin can watch the catalog grow as enrichment runs land.
  beansCount: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
    paddingTop: t.spacing.sm,
  } as any,
  beansCountBold: {
    fontFamily: t.font["body.semibold"],
    color: t.color["text.primary"],
  } as any,

  clearText: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color.accent, marginBottom: 12 },
  filterDivider: { height: 1, backgroundColor: "rgba(215,209,196,0.5)", marginVertical: 12 },
  filterSection: { marginBottom: 8 },
  // Header row is a tappable strip — collapsed by default so the
  // consumer can scan every filter category at a glance, then expand
  // only the ones they want. Chevron + optional selection-count badge
  // sit on the right edge.
  filterHead: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: 8,
  } as any,
  filterTitle: { fontFamily: t.font["body.semibold"], fontSize: 15, letterSpacing: -0.375, color: t.color["text.primary"], marginBottom: 0 },
  // Pink dot-with-number badge in the heading row when one or more
  // chips are selected — visible even when the section is collapsed.
  filterHeadBadge: {
    fontFamily: t.font["body.semibold"],
    fontSize: 11,
    color: t.color["text.on-cta"],
    backgroundColor: t.color.accent,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 6,
    textAlign: "center",
    lineHeight: 18,
    overflow: "hidden",
  } as any,
  // Right-aligned hint on the Flavor row in the filter drawer ("Open
  // wheel" / "Edit"). Reads quieter than the section title — the
  // chevron carries the affordance.
  flavorOpenHint: {
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: t.color["text.muted"],
    marginRight: 6,
  } as any,
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 14, minHeight: 24, marginBottom: 4 },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: t.color.border,
    alignItems: "center", justifyContent: "center", backgroundColor: t.color["card.front"], marginTop: 1,
  },
  checkboxChecked: { backgroundColor: t.color["text.primary"], borderColor: t.color["text.primary"] },
  checkmark: { color: "white", fontSize: 11, fontWeight: "700" as any },
  checkLabel: { fontFamily: t.font["body.regular"], fontSize: 14, letterSpacing: -0.336, color: t.color["text.primary"], flex: 1, lineHeight: 21 },
  // Count badge sitting at the right edge of each filter row. The
  // number reads as "if I toggle this on now, N coffees remain".
  // Tabular numerals so digits align across rows.
  checkCount: {
    fontFamily: t.font["body.medium"],
    fontSize: 13,
    color: t.color["text.muted"],
    marginLeft: 8,
    fontVariant: ["tabular-nums"],
  } as any,
  showMoreText: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color.accent, marginTop: 6 },

  radioRow: { flexDirection: "row", alignItems: "center", gap: 14, height: 32 },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: t.color.border,
    alignItems: "center", justifyContent: "center", backgroundColor: t.color["card.front"],
  },
  radioSelected: { borderColor: t.color["text.primary"] },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.color["text.primary"] },

  // Wholesale-only filter (§2.2, café viewers)
  wholesaleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 2 } as any,
  wholesaleBox: {
    width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: t.color.border,
    backgroundColor: t.color["card.front"], alignItems: "center", justifyContent: "center",
  } as any,
  wholesaleBoxOn: { borderColor: t.color["text.primary"], backgroundColor: t.color["text.primary"] } as any,
  // Checkmark tick replaces the earlier minus-sign dot (per user
  // feedback — a check reads as "enabled" rather than "unavailable").
  wholesaleBoxTick: {
    fontFamily: t.font["body.semibold"], fontSize: 11, color: t.color["text.on-cta"],
    lineHeight: 13,
  } as any,
  wholesaleLabel: {
    fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.primary"],
  } as any,
  wholesaleHint: {
    fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.muted"],
    marginTop: 6, marginLeft: 30, lineHeight: 15,
  } as any,

  // Search bar
  stickySearchWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  searchBarWrap: {
    overflow: "hidden", maxHeight: 58, opacity: 1,
    transitionProperty: "max-height, opacity",
    transitionDuration: "240ms, 180ms",
    transitionTimingFunction: "ease, ease",
  },
  searchBarWrapHidden: { maxHeight: 0, opacity: 0 },
  searchBar: {
    flexDirection: "row", alignItems: "center", borderRadius: 20, paddingHorizontal: 14, height: 38,
    backgroundColor: t.color["card.front"], borderWidth: 1, borderColor: t.color.border,
    alignSelf: "flex-start" as any, width: 500, maxWidth: "100%" as any,
  },
  searchInput: { flex: 1, marginLeft: 8, fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.primary"] },

  listHeader: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4 },
  activeChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8, marginTop: 4 },
  activeChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: t.color["tag.bg"],
  },
  activeChipText: { fontFamily: t.font["body.medium"], fontSize: 11, color: t.color["tag.text"] },

  // Roasters tab
  rPageTitle: {
    fontFamily: t.font.display, fontSize: 26, lineHeight: 32, color: t.color["text.primary"],
    paddingHorizontal: 16, paddingTop: 20, paddingBottom: 20,
  } as any,
  rDivider: { height: 1, backgroundColor: "rgba(160,149,128,0.5)", marginLeft: 16 } as any,

  // Roaster / café grid cards — dimensions mirror CoffeeCard's
  // 240-wide portrait geometry; image claims the top ~43% of the
  // card, info claims the remainder on the site's cream `card.info`
  // fill so they stack cleanly next to CoffeeCards on the BEANS tab.
  browseGrid: { flexDirection: "row", flexWrap: "wrap" } as any,
  bcCard: {
    backgroundColor: t.color["card.front"],
    borderRadius: t.radius.md,
    overflow: "hidden",
    ...cardShadow,
  } as any,
  bcImage: {
    position: "relative",
    backgroundColor: t.color["card.info"],
  } as any,
  bcFallback: {
    fontFamily: t.font.display,
    fontSize: t.size["font.display"],
    color: t.color["text.muted"],
  } as any,
  bcInfo: {
    backgroundColor: t.color["card.info"],
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.md,
    gap: t.spacing["2xs"],
  } as any,
  bcName: {
    fontFamily: t.font.display,
    fontSize: t.size["font.xl"],
    lineHeight: 22,
    color: t.color["text.primary"],
  } as any,
  bcSub: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
  } as any,

  // §2.34 Drawer body (SlidePanel's child — already absolute)
  filterDrawerBody: {
    flex: 1,
    backgroundColor: t.color.bg,
  },
  filterDrawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
  } as any,
  filterDrawerTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xl"],
    color: t.color["text.primary"],
  } as any,
  filterDrawerClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  filterDrawerFooter: {
    flexDirection: "row",
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.color["border.light"],
    backgroundColor: t.color.bg,
  } as any,
  // Sits at the top of the mobile drawer's ScrollView, mirroring the
  // desktop sidebar's count + clear-all row. Same `sidebarCount` text
  // style; this wrapper just lays out the count + the inline clear-all
  // pressable side-by-side so the action stays reachable without
  // scrolling.
  filterDrawerCountWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.sm,
    marginBottom: t.spacing.sm,
  } as any,
  filterResetBtn: {
    flex: 1,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.full,
    borderWidth: 1,
    borderColor: t.color["text.primary"],
    alignItems: "center",
    backgroundColor: t.color.bg,
  } as any,
  filterResetBtnDisabled: {
    opacity: 0.4,
  } as any,
  filterResetText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  } as any,
  filterApplyBtn: {
    flex: 1,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.full,
    backgroundColor: t.color["text.primary"],
    alignItems: "center",
  } as any,
  filterApplyText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.on-cta"],
  } as any,

  rRow: {
    height: 104, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 16,
    backgroundColor: "transparent",
    transitionProperty: "background-color", transitionDuration: "150ms", transitionTimingFunction: "ease",
  } as any,
  rRowHovered: { backgroundColor: t.color.accent } as any,
  rImage: { width: 167, height: 76, borderRadius: 2, overflow: "hidden", flexShrink: 0, backgroundColor: t.color["card.info"] } as any,
  rInfo: { flex: 1, minWidth: 0, justifyContent: "center", gap: 4 },
  rName: { fontFamily: t.font["body.regular"], fontSize: 25, lineHeight: 30, color: t.color["text.primary"] },
  rSub: { fontFamily: t.font["body.regular"], fontSize: 14, lineHeight: 22, color: t.color["text.secondary"] },
  rArrowBtn: {
    width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, borderColor: t.color["text.muted"],
    alignItems: "center", justifyContent: "center", flexShrink: 0,
    transitionProperty: "border-color", transitionDuration: "150ms", transitionTimingFunction: "ease",
  } as any,
  rArrowBtnHovered: { borderColor: "transparent" } as any,

  // ── JOURNAL roaster strip ──────────────────────────────────────────
  // Stacked avatar + name pill; active state lights up with a Crema
  // ring around the avatar (the Crema-pink accent is reserved for
  // post-action icons elsewhere, but the avatar ring is a discovery
  // affordance so it earns the pink). Inactive items use the brand
  // text colour and stay subtle.
  roasterStripPressed: { opacity: 0.75 },
  roasterStripItem: {
    alignItems: "center",
    width: 72,
    gap: 6,
  } as any,
  roasterStripAvatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
    padding: 2,
  } as any,
  roasterStripAvatarWrapActive: {
    borderColor: t.color["accent.cta"],
  } as any,
  roasterStripName: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    lineHeight: 14,
    color: t.color["text.muted"],
    textAlign: "center",
    width: "100%" as any,
  } as any,
  roasterStripNameActive: {
    color: t.color["text.primary"],
    fontFamily: t.font["body.semibold"],
  } as any,
  roasterStripAllPill: {
    width: 64,
    height: 64,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.color.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  } as any,
  // Active state: Crema-pink fill with Espresso text (per
  // §2.40.19 — every actionable pill in the app reads as
  // "selected" via the brand-pink fill, not the mode-flipping
  // text.primary). text.on-cta is constant Espresso post-§2.40.19
  // so it pairs correctly with the pink bg.
  roasterStripAllPillActive: {
    borderColor: t.color.accent,
    backgroundColor: t.color.accent,
  } as any,
  roasterStripAllText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  roasterStripAllTextActive: {
    color: t.color["text.on-cta"],
  },

  // ── JOURNAL filter strip ──────────────────────────────────────────
  // Sort pill + topic chips in one horizontal scroll. The sort pill is
  // bordered (not filled) so it reads as a control, not a selection;
  // topic chips fill in pink when active so they pair with the
  // roaster-strip "All" pill's active style above. Sort + topics are
  // separated by a small vertical hairline so the eye groups them
  // correctly.
  journalSortPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.full,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color["card.subtle"],
  } as any,
  journalSortLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  } as any,
  journalFilterSep: {
    width: 1,
    height: 20,
    backgroundColor: t.color.divider,
    marginHorizontal: 4,
  } as any,
  journalTopicChip: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.full,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: "transparent",
  } as any,
  journalTopicChipActive: {
    borderColor: t.color["accent.cta"],
    backgroundColor: t.color["accent.cta"],
  } as any,
  journalTopicChipText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  } as any,
  journalTopicChipTextActive: {
    color: t.color["text.on-cta"],
    fontFamily: t.font["body.semibold"],
  } as any,
  journalClearPill: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.full,
  } as any,
  journalClearText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    textDecorationLine: "underline",
  } as any,
}));
