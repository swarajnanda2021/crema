export function formatPrice(price) {
  if (price == null) return "—";
  return `₹${Math.round(Number(price)).toLocaleString("en-IN")}`;
}

/**
 * Standard comparison price: cost per 250g.
 * Accepts price_per_gram (from scraper) and returns ₹X / 250g.
 */
export function formatPricePer250g(pricePerGram) {
  if (pricePerGram == null) return null;
  const per250 = Math.round(pricePerGram * 250);
  return `₹${per250.toLocaleString("en-IN")} / 250g`;
}

export function pricePer250g(pricePerGram) {
  if (pricePerGram == null) return null;
  return Math.round(pricePerGram * 250);
}

export function formatWeight(grams) {
  if (grams == null) return "";
  if (grams >= 1000) return `${(grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 1)}kg`;
  return `${grams}g`;
}
