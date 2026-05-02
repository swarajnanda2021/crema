/**
 * htmlToBlocks — minimal HTML → block-list converter for the article
 * reader.
 *
 * Roaster blogs ship clean HTML (Shopify and WordPress both
 * normalise the rich-text editors before publish), so the long tail
 * of malformed markup is small. We render a curated set of block
 * tags as native primitives:
 *
 *   • h1, h2, h3, h4, h5, h6   → 'heading' blocks (level 1-6)
 *   • p                         → 'paragraph' block
 *   • blockquote                → 'quote' block
 *   • ul, ol                    → 'list' block (items[])
 *   • img                       → 'image' block (src)
 *   • hr                        → 'hr' block
 *   • figure with figcaption    → 'image' + 'caption' pair
 *
 * Everything else (script, style, iframe, embed, table, video) is
 * dropped — the bottom "Read on [roaster site]" CTA in the reader
 * lets users jump to the original page when an article needs the
 * full markup. Inline tags inside paragraphs (strong, em, a, code,
 * span) are stripped to plain text in v1; we'll add inline styled
 * spans in a follow-up if the content demands it.
 *
 * The parser is regex-based and intentionally forgiving — malformed
 * HTML degrades to plain-text paragraphs rather than throwing.
 */

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "image"; src: string; alt?: string }
  | { kind: "hr" };

export function htmlToBlocks(html: string | null | undefined): Block[] {
  if (!html || typeof html !== "string") return [];

  let cleaned = html;
  // Strip script + style blocks entirely — content + opening + closing
  // tag. The /s flag isn't always portable; a non-greedy match works.
  cleaned = cleaned.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  cleaned = cleaned.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  cleaned = cleaned.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
  // Drop iframe / embed / video — we don't render media in v1.
  cleaned = cleaned.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "");
  cleaned = cleaned.replace(/<embed\b[^>]*\/?>/gi, "");
  cleaned = cleaned.replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, "");
  // Drop tables — too structural to render with text/View in v1.
  cleaned = cleaned.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, "");
  // Comments + doctype.
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");

  const blocks: Block[] = [];

  // Walk top-level block tags. The regex matches an opening tag (or a
  // self-closing img/hr) and captures the contents up to the
  // corresponding closing tag (non-greedy). Unmatched plain text
  // between blocks is collected as a paragraph.
  const blockRe =
    /<(h1|h2|h3|h4|h5|h6|p|blockquote|ul|ol|figure|hr|img)\b([^>]*)>([\s\S]*?)(?:<\/\1>|(?<=<(?:hr|img)\b[^>]*>))/gi;

  // Simpler approach: find each top-level block tag occurrence and
  // walk linearly. Use a scanner.
  const re =
    /<\s*(\/?)\s*(h1|h2|h3|h4|h5|h6|p|blockquote|ul|ol|li|figure|figcaption|hr|img)\b([^>]*)>/gi;

  let pos = 0;
  let openTag: string | null = null;
  let openAttrs = "";
  let buf = "";
  let listItems: string[] = [];
  let listOrdered = false;
  let inList = false;
  let inFigure = false;
  let figureImage: { src: string; alt?: string } | null = null;
  let figureCaption: string | null = null;

  function flushParagraph(text: string) {
    const t = stripInline(text);
    if (t) blocks.push({ kind: "paragraph", text: t });
  }
  function flushHeading(level: number, text: string) {
    const lv = Math.min(6, Math.max(1, level)) as 1 | 2 | 3 | 4 | 5 | 6;
    const t = stripInline(text);
    if (t) blocks.push({ kind: "heading", level: lv, text: t });
  }
  function flushQuote(text: string) {
    const t = stripInline(text);
    if (t) blocks.push({ kind: "quote", text: t });
  }

  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const closing = !!m[1];
    const tag = m[2].toLowerCase();
    const attrs = m[3] || "";
    const interTextBefore = cleaned.slice(pos, m.index);
    pos = m.index + m[0].length;

    // Flush any inter-tag text accumulated outside an open block.
    if (!openTag && !inList && !inFigure && interTextBefore.trim()) {
      flushParagraph(interTextBefore);
    } else if (openTag) {
      buf += interTextBefore;
    } else if (inList) {
      // text outside <li> inside <ul>/<ol> — ignore
    } else if (inFigure) {
      // text inside figure but outside img/figcaption — ignore
    }

    // Open / close logic.
    if (!closing) {
      if (tag === "hr") {
        blocks.push({ kind: "hr" });
        continue;
      }
      if (tag === "img") {
        const src = attrMatch(attrs, "src");
        const alt = attrMatch(attrs, "alt");
        if (src) {
          if (inFigure) {
            figureImage = { src, alt: alt || undefined };
          } else {
            blocks.push({ kind: "image", src, alt: alt || undefined });
          }
        }
        continue;
      }
      if (tag === "ul" || tag === "ol") {
        inList = true;
        listOrdered = tag === "ol";
        listItems = [];
        continue;
      }
      if (tag === "li") {
        // Start collecting li body — reuse the openTag buffer state.
        openTag = "li";
        openAttrs = attrs;
        buf = "";
        continue;
      }
      if (tag === "figure") {
        inFigure = true;
        figureImage = null;
        figureCaption = null;
        continue;
      }
      if (tag === "figcaption") {
        openTag = "figcaption";
        openAttrs = attrs;
        buf = "";
        continue;
      }
      // Block text containers.
      if (
        tag === "p" ||
        tag === "h1" ||
        tag === "h2" ||
        tag === "h3" ||
        tag === "h4" ||
        tag === "h5" ||
        tag === "h6" ||
        tag === "blockquote"
      ) {
        openTag = tag;
        openAttrs = attrs;
        buf = "";
        continue;
      }
    } else {
      // closing tag
      if (tag === "li" && openTag === "li") {
        const text = stripInline(buf);
        if (text) listItems.push(text);
        openTag = null;
        buf = "";
        continue;
      }
      if (tag === "ul" || tag === "ol") {
        if (inList && listItems.length > 0) {
          blocks.push({
            kind: "list",
            ordered: listOrdered,
            items: listItems,
          });
        }
        inList = false;
        listItems = [];
        continue;
      }
      if (tag === "figcaption" && openTag === "figcaption") {
        figureCaption = stripInline(buf);
        openTag = null;
        buf = "";
        continue;
      }
      if (tag === "figure" && inFigure) {
        if (figureImage) {
          blocks.push({
            kind: "image",
            src: figureImage.src,
            alt: figureCaption || figureImage.alt,
          });
        }
        if (figureCaption && !figureImage) {
          blocks.push({ kind: "paragraph", text: figureCaption });
        }
        inFigure = false;
        figureImage = null;
        figureCaption = null;
        continue;
      }
      if (tag === openTag) {
        if (tag === "p") flushParagraph(buf);
        else if (tag === "blockquote") flushQuote(buf);
        else if (/^h[1-6]$/.test(tag)) {
          flushHeading(Number(tag.slice(1)), buf);
        }
        openTag = null;
        buf = "";
        continue;
      }
    }
  }

  // Anything left after the last close tag.
  const tail = cleaned.slice(pos);
  if (tail.trim()) flushParagraph(tail);

  return blocks;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function attrMatch(attrs: string, name: string): string | null {
  const m =
    new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs) ||
    new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(attrs);
  return m ? m[1] : null;
}

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

/** Strip remaining HTML tags + decode common entities + normalise
 *  whitespace. Keep newlines as paragraph breaks within the text? No
 *  — collapse to a single space, the block-level structure is already
 *  represented by `blocks`. */
function stripInline(text: string): string {
  if (!text) return "";
  // Strip every remaining tag (already past the block-level walker;
  // these are inline tags like strong/em/a/span).
  let out = text.replace(/<[^>]+>/g, "");
  // Decode entities — both named and numeric.
  out = out.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_m, e) => {
    if (e[0] === "#") {
      const n =
        e[1] === "x" || e[1] === "X"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      if (Number.isFinite(n)) return String.fromCodePoint(n);
      return "";
    }
    return ENTITY_MAP[e.toLowerCase()] || "";
  });
  // Collapse whitespace.
  out = out.replace(/\s+/g, " ").trim();
  return out;
}
