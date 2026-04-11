import { searchCoffees } from "./searchCoffees";

export function filterCoffees(products, filters) {
  let result = products;

  // Hard filters: always hide sold-out products.
  // Roaster-managed products (product_id starts with "rp_") bypass the roast_level
  // requirement because the roaster may not have filled that field yet.
  result = result.filter((p) => {
    if (p.available === false) return false;
    const isRoasterManaged = typeof p.product_id === "string" && p.product_id.startsWith("rp_");
    if (isRoasterManaged) return true;
    return p.roast_level && p.roast_level !== "Unknown";
  });

  // Text search
  if (filters.query) {
    result = searchCoffees(result, filters.query);
  }

  // Multi-select: Roasters (OR within, AND across)
  if (filters.roasters.length) {
    result = result.filter((p) => filters.roasters.includes(p.roaster_slug));
  }

  // Roast levels
  if (filters.roastLevels.length) {
    result = result.filter((p) => filters.roastLevels.includes(p.roast_level));
  }

  // Origins
  if (filters.origins.length) {
    result = result.filter((p) => filters.origins.includes(p.origin));
  }

  // Process
  if (filters.processes.length) {
    result = result.filter((p) => filters.processes.includes(p.process));
  }

  // Price range
  if (filters.priceMin != null) {
    result = result.filter((p) => p.price_inr >= filters.priceMin);
  }
  if (filters.priceMax != null) {
    result = result.filter((p) => p.price_inr <= filters.priceMax);
  }

  // Sort
  result = sortCoffees(result, filters.sortBy);

  return result;
}

function sortCoffees(products, sortBy) {
  const sorted = [...products];
  switch (sortBy) {
    case "ppg-asc":
      return sorted.sort(
        (a, b) => (a.price_per_gram ?? Infinity) - (b.price_per_gram ?? Infinity)
      );
    case "ppg-desc":
      return sorted.sort(
        (a, b) => (b.price_per_gram ?? 0) - (a.price_per_gram ?? 0)
      );
    case "roaster-az":
      return sorted.sort((a, b) => a.roaster_name.localeCompare(b.roaster_name));
    case "name-az":
      return sorted.sort((a, b) => a.coffee_name.localeCompare(b.coffee_name));
    case "newest":
    default:
      return sorted;
  }
}
