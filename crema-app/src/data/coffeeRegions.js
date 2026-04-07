/**
 * Indian coffee estates + regions → precise coordinates.
 * Keyed by lowercase name. The resolver does substring matching
 * against both the product title and origin field.
 */

const LOCATIONS = {
  // ── Specific estates (most precise) ──────────────────────────────────
  // Chikmagalur district estates
  "attikan estate":        { lat: 13.20, lng: 75.70 },
  "kalledevarapura estate": { lat: 13.25, lng: 75.65 },
  "baarbara estate":       { lat: 13.28, lng: 75.68 },
  "ratnagiri estate":      { lat: 13.30, lng: 75.72 },
  "melkodige estate":      { lat: 13.15, lng: 75.62 },
  "kuchally estate":       { lat: 13.22, lng: 75.74 },
  "gungegiri estate":      { lat: 13.18, lng: 75.69 },
  "thogarihunkal estate":  { lat: 13.35, lng: 75.73 },
  "basankhan estate":      { lat: 13.27, lng: 75.71 },
  "basan khan estate":     { lat: 13.27, lng: 75.71 },
  "mullayangiri estate":   { lat: 13.39, lng: 75.72 },
  "baba budangiri estate": { lat: 13.43, lng: 75.72 },
  "hoysala estate":        { lat: 13.32, lng: 75.77 },
  "krishna estate":        { lat: 13.26, lng: 75.76 },
  "aghora estate":         { lat: 13.24, lng: 75.73 },
  "bynemara estate":       { lat: 13.33, lng: 75.75 },
  "kuttin khan estate":    { lat: 13.30, lng: 75.70 },
  "thippanahalli estate":  { lat: 13.31, lng: 75.69 },
  "udaigiri estate":       { lat: 13.19, lng: 75.66 },

  // Sakleshpur / Hassan district estates
  "salawara estate":       { lat: 12.90, lng: 75.72 },
  "harley estate":         { lat: 12.94, lng: 75.78 },
  "kerehaklu estate":      { lat: 13.13, lng: 75.64 },
  "mooleh manay estate":   { lat: 13.10, lng: 75.60 },

  // Coorg / Kodagu estates
  "venkids valley estate": { lat: 12.33, lng: 75.80 },
  "balur estate":          { lat: 12.42, lng: 75.74 },
  "seethargundu estate":   { lat: 12.38, lng: 75.76 },
  "unakki estate":         { lat: 12.35, lng: 75.72 },
  "dunduga estate":        { lat: 12.40, lng: 75.78 },

  // BR Hills / Biligirirangan
  "kolli berry estate":    { lat: 11.97, lng: 77.16 },

  // Other Karnataka
  "honnametti estate":     { lat: 12.10, lng: 75.95 },
  "leo estate":            { lat: 12.30, lng: 75.75 },

  // Nilgiris
  "badra estate":          { lat: 11.40, lng: 76.73 },

  // Other
  "mondul estate":         { lat: 14.00, lng: 75.50 },
  "mandalkhan estate":     { lat: 13.32, lng: 75.77 },
  "joseph estate":         { lat: 13.25, lng: 75.72 },
  "riverdale estate":      { lat: 13.32, lng: 75.77 },

  // ── Coffee-growing regions (fallback) ────────────────────────────────
  "chikmagalur":    { lat: 13.32, lng: 75.77 },
  "chickmagalur":   { lat: 13.32, lng: 75.77 },
  "coorg":          { lat: 12.42, lng: 75.74 },
  "kodagu":         { lat: 12.42, lng: 75.74 },
  "sakleshpur":     { lat: 12.94, lng: 75.78 },
  "mudigere":       { lat: 13.13, lng: 75.64 },
  "baba budan":     { lat: 13.43, lng: 75.72 },
  "bababudan":      { lat: 13.43, lng: 75.72 },
  "br hills":       { lat: 11.97, lng: 77.16 },
  "biligiri":       { lat: 11.97, lng: 77.16 },
  "hassan":         { lat: 13.01, lng: 76.10 },
  "manjarabad":     { lat: 12.91, lng: 75.73 },
  "nilgiris":       { lat: 11.40, lng: 76.73 },
  "nilgiri":        { lat: 11.40, lng: 76.73 },
  "yercaud":        { lat: 11.77, lng: 78.20 },
  "shevaroy":       { lat: 11.77, lng: 78.20 },
  "pulney":         { lat: 10.23, lng: 77.49 },
  "kodaikanal":     { lat: 10.24, lng: 77.49 },
  "kolli":          { lat: 11.25, lng: 78.35 },
  "wayanad":        { lat: 11.69, lng: 76.13 },
  "idukki":         { lat: 9.85, lng: 76.97 },
  "munnar":         { lat: 10.09, lng: 77.06 },
  "araku":          { lat: 18.33, lng: 82.88 },
  "araku valley":   { lat: 18.33, lng: 82.88 },
  "visakhapatnam":  { lat: 17.69, lng: 83.22 },
  "koraput":        { lat: 18.81, lng: 82.71 },
  "dima hasao":     { lat: 25.50, lng: 93.01 },
  "assam":          { lat: 26.20, lng: 92.94 },
  "karnataka":      { lat: 13.00, lng: 76.00 },
  "south india":    { lat: 12.00, lng: 77.00 },
  "mysore":         { lat: 12.30, lng: 76.66 },
};

// Sort entries longest-first so "Salawara Estate" matches before "Sakleshpur"
const SORTED_ENTRIES = Object.entries(LOCATIONS).sort(
  (a, b) => b[0].length - a[0].length
);

/**
 * Resolve a product's origin to coordinates.
 * Searches both the origin text AND the product title for known estate/region names.
 * Returns { lat, lng } or null.
 */
export function resolveOriginCoords(originText, title) {
  const combined = ((originText || "") + " " + (title || "")).toLowerCase();
  if (!combined.trim()) return null;

  for (const [name, coords] of SORTED_ENTRIES) {
    if (combined.includes(name)) {
      return coords;
    }
  }
  return null;
}
