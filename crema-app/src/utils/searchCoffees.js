export function searchCoffees(products, query) {
  const q = query.toLowerCase().trim();
  if (!q) return products;

  return products.filter(
    (p) =>
      p.coffee_name.toLowerCase().includes(q) ||
      p.roaster_name.toLowerCase().includes(q) ||
      (p.tasting_notes && p.tasting_notes.toLowerCase().includes(q)) ||
      (p.origin && p.origin.toLowerCase().includes(q)) ||
      (p.tags && p.tags.some((t) => t.toLowerCase().includes(q)))
  );
}
