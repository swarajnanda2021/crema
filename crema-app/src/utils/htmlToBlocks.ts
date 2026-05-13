/**
 * htmlToBlocks — HTML → block-list converter for the article reader.
 *
 * Roaster blogs ship clean HTML (Shopify and WordPress both
 * normalise the rich-text editors before publish). The Haiku
 * enricher (v3) re-emits a curated subset:
 *
 *   • h2, h3                    → 'heading' blocks (level 2-3)
 *   • p                         → 'paragraph' block (with inline runs)
 *   • blockquote                → 'quote' block
 *   • ul, ol                    → 'list' block (items[] of runs[])
 *   • img                       → 'image' block
 *   • figure with figcaption    → 'image' block with caption
 *   • hr                        → 'adslot' block
 *
 * Inline tags inside paragraphs/headings/quotes/list-items are
 * preserved as RUNS — small text segments tagged with optional
 * bold/italic/href flags. The renderer maps runs to nested <Text>
 * children with bold/italic font swap and href tap-handling. This
 * is what lets the article read as editorial: cross-references stay
 * tappable, source emphasis carries through, and the downstream
 * link-resolver can match an `href` to an in-catalog product or
 * sibling article and surface them as embedded cards.
 *
 * Recognized inline tags: <a href>, <strong>, <em>, <b>, <i>.
 * Everything else (script, style, iframe, embed, table, video, span,
 * div, code) is stripped — the bottom "Read on [roaster site]" CTA
 * in the reader lets users jump to the original page when an article
 * needs the full markup.
 *
 * The parser is regex-based and intentionally forgiving — malformed
 * HTML degrades to plain-text paragraphs rather than throwing.
 */

/**
 * `adslot` is the v2-enricher convention: Haiku emits `<hr>` between
 * major topical sections of the article body (every 2-4 paragraphs at
 * natural breaks). The renderer surfaces these as typed `adslot`
 * blocks so the reader can render an ad placeholder, a sponsored
 * coffee card, or just an editorial ornament — all from the same
 * authored anchor. Articles rarely use real horizontal rules
 * mid-body, so co-opting `<hr>` is safe.
 */

/** A run is a contiguous slice of inline text with optional formatting
 *  flags. Renderers pair each flag with a token-driven style
 *  (bold → t.font["body.bold"], italic → italic style, href → tappable
 *  link in t.color.accent). Empty `text` runs are dropped at parse
 *  time. */
export type Run = {
  text: string;
  href?: string;
  bold?: boolean;
  italic?: boolean;
};

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; runs: Run[] }
  | { kind: "paragraph"; runs: Run[] }
  | { kind: "quote"; runs: Run[] }
  | { kind: "list"; ordered: boolean; items: Run[][] }
  | { kind: "image"; src: string; alt?: string; caption?: string }
  // <video-embed src="https://youtu.be/ID" /> emitted by the Haiku
  // enricher. The renderer derives `videoId` + `thumbnailUrl` from
  // the canonical youtu.be / vimeo.com URL; we don't trust src
  // patterns outside that allow-list.
  | { kind: "video"; platform: "youtube" | "vimeo"; videoId: string; url: string; thumbnailUrl: string | null }
  | { kind: "adslot" };

export function htmlToBlocks(html: string | null | undefined): Block[] {
  if (!html || typeof html !== "string") return [];

  let cleaned = html;
  // Strip script + style blocks entirely — content + opening + closing
  // tag. The /s flag isn't always portable; a non-greedy match works.
  cleaned = cleaned.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  cleaned = cleaned.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  cleaned = cleaned.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
  // Drop iframe / embed / native <video> — we don't render those
  // forms. The `<video>` strip uses `<video(?:\s|>)` (whitespace OR
  // closing-bracket immediately after) so the custom `<video-embed>`
  // tag we DO render isn't matched and stripped here.
  cleaned = cleaned.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "");
  cleaned = cleaned.replace(/<embed\b[^>]*\/?>/gi, "");
  cleaned = cleaned.replace(/<video(?:\s[^>]*)?>[\s\S]*?<\/video>/gi, "");
  // Drop tables — too structural to render with text/View in v1.
  cleaned = cleaned.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, "");
  // Comments + doctype.
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");

  const blocks: Block[] = [];

  // Block-level scanner — same forgiving approach as v1.
  // `video-embed` is the Haiku-emitted custom element for video
  // references (see article_enricher.py prompt). Self-closing in
  // practice; paired form falls through harmlessly since the
  // closing tag has no handler.
  const re =
    /<\s*(\/?)\s*(h1|h2|h3|h4|h5|h6|p|blockquote|ul|ol|li|figure|figcaption|hr|img|video-embed)\b([^>]*)>/gi;

  let pos = 0;
  let openTag: string | null = null;
  let buf = "";
  let listItems: Run[][] = [];
  let listOrdered = false;
  let inList = false;
  let inFigure = false;
  let figureImage: { src: string; alt?: string } | null = null;
  let figureCaption: string | null = null;

  function flushParagraph(text: string) {
    const runs = parseInline(text);
    if (runs.length) blocks.push({ kind: "paragraph", runs });
  }
  function flushHeading(level: number, text: string) {
    const lv = Math.min(6, Math.max(1, level)) as 1 | 2 | 3 | 4 | 5 | 6;
    const runs = parseInline(text);
    if (runs.length) blocks.push({ kind: "heading", level: lv, runs });
  }
  function flushQuote(text: string) {
    const runs = parseInline(text);
    if (runs.length) blocks.push({ kind: "quote", runs });
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
        // v2 convention: <hr> = ad-slot anchor. Collapse consecutive
        // adslot blocks (Haiku occasionally double-emits at section
        // seams) so the reader doesn't render two placeholders in a
        // row.
        const last = blocks[blocks.length - 1];
        if (!last || last.kind !== "adslot") {
          blocks.push({ kind: "adslot" });
        }
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
      if (tag === "video-embed") {
        const src = attrMatch(attrs, "src");
        const parsed = parseVideoSrc(src);
        if (parsed) {
          const canonicalUrl =
            parsed.platform === "youtube"
              ? `https://youtu.be/${parsed.videoId}`
              : `https://vimeo.com/${parsed.videoId}`;
          blocks.push({
            kind: "video",
            platform: parsed.platform,
            videoId: parsed.videoId,
            url: canonicalUrl,
            thumbnailUrl: videoThumbnail(parsed.platform, parsed.videoId),
          });
        }
        // Silently drop unrecognised src patterns — Haiku is told
        // to only emit YouTube / Vimeo canonical URLs; anything
        // else is enricher drift, not user content to preserve.
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
        buf = "";
        continue;
      }
    } else {
      // closing tag
      if (tag === "li" && openTag === "li") {
        const runs = parseInline(buf);
        if (runs.length) listItems.push(runs);
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
        // Caption is plain text — Figma typography for captions is
        // calm and unstyled; we don't carry inline emphasis through.
        figureCaption = stripToText(buf);
        openTag = null;
        buf = "";
        continue;
      }
      if (tag === "figure" && inFigure) {
        if (figureImage) {
          blocks.push({
            kind: "image",
            src: figureImage.src,
            alt: figureImage.alt,
            caption: figureCaption || undefined,
          });
        } else if (figureCaption) {
          // Figcaption without an image — render as a paragraph so
          // the source text isn't dropped.
          const runs = parseInline(figureCaption);
          if (runs.length) blocks.push({ kind: "paragraph", runs });
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

// ── Inline parsing ─────────────────────────────────────────────────────────

/** Parse an inline-HTML buffer into a list of Runs. Recognized inline
 *  tags: <a>, <strong>, <b>, <em>, <i>. Anything else has its tags
 *  stripped (text content kept). The result is a list of contiguous
 *  text segments tagged with the active formatting flags at that
 *  position. Adjacent runs with identical flags are merged. Whitespace
 *  is collapsed within each run.
 */
export function parseInline(html: string): Run[] {
  if (!html) return [];

  // Inline-tag scanner. Matches ANY HTML tag — recognized inline tags
  // (a, strong, em, b, i, br) push/pop formatting state; everything
  // else (span, font, code, abbr, sub, sup, mark, rogue stray <div>,
  // etc.) is consumed silently so its bytes don't bleed into the
  // run text. Haiku v3's prompt forbids span/style/class but we've
  // observed it pass them through anyway — the parser has to
  // tolerate that drift rather than print the literal markup.
  const tagRe =
    /<\s*(\/?)\s*([a-z][a-z0-9-]*)\b([^>]*?)\/?\s*>/gi;

  // State stack — each entry adds bold/italic/href to subsequent
  // text runs. The mode is recomputed from the stack on every
  // emission so nested + crossed tags don't desync.
  type Frame = { kind: "bold" | "italic" | "link"; href?: string };
  const stack: Frame[] = [];

  function modeFromStack(): { bold?: boolean; italic?: boolean; href?: string } {
    let bold = false;
    let italic = false;
    let href: string | undefined;
    for (const f of stack) {
      if (f.kind === "bold") bold = true;
      if (f.kind === "italic") italic = true;
      if (f.kind === "link" && f.href) href = f.href; // innermost link wins
    }
    return { bold: bold || undefined, italic: italic || undefined, href };
  }

  const runs: Run[] = [];

  function emit(text: string) {
    if (!text) return;
    const decoded = decodeEntities(text);
    // Collapse runs of whitespace including newlines to single space.
    const normalised = decoded.replace(/\s+/g, " ");
    if (!normalised || normalised === " ") {
      // Pure-whitespace run between tags (e.g. text wrapped on a new
      // line in source). Keep ONE space at the seam between two
      // non-empty runs so word boundaries survive — but don't emit a
      // standalone whitespace-only run as the first/last element.
      const prev = runs[runs.length - 1];
      if (prev && prev.text.length > 0 && !prev.text.endsWith(" ")) {
        prev.text += " ";
      }
      return;
    }
    const mode = modeFromStack();
    // Merge with previous run when the formatting flags match
    // exactly. Reduces an N-segment paragraph to a 1-run paragraph
    // when the source had no inline markup.
    const prev = runs[runs.length - 1];
    const sameFlags =
      prev &&
      !!prev.bold === !!mode.bold &&
      !!prev.italic === !!mode.italic &&
      (prev.href || undefined) === (mode.href || undefined);
    if (sameFlags && prev) {
      prev.text += normalised;
    } else {
      runs.push({
        text: normalised,
        ...(mode.bold ? { bold: true } : {}),
        ...(mode.italic ? { italic: true } : {}),
        ...(mode.href ? { href: mode.href } : {}),
      });
    }
  }

  let pos = 0;
  let tm: RegExpExecArray | null;
  while ((tm = tagRe.exec(html)) !== null) {
    const before = html.slice(pos, tm.index);
    if (before) emit(before);
    pos = tm.index + tm[0].length;

    const closing = !!tm[1];
    const name = tm[2].toLowerCase();
    const attrs = tm[3] || "";

    if (name === "br") {
      // Treat <br> as a single space — paragraph rendering doesn't
      // honour line breaks in the editorial reader, but we shouldn't
      // glue words together either.
      const prev = runs[runs.length - 1];
      if (prev && !prev.text.endsWith(" ")) prev.text += " ";
      continue;
    }

    if (!closing) {
      if (name === "a") {
        const href = attrMatch(attrs, "href") || "";
        // Drop empty/javascript: hrefs — they're nav remnants Haiku
        // shouldn't have emitted in the first place.
        const cleanHref = sanitiseHref(href);
        if (cleanHref) {
          stack.push({ kind: "link", href: cleanHref });
        } else {
          // Unmatched: still push a frame so balancing on </a> works.
          stack.push({ kind: "link", href: undefined });
        }
      } else if (name === "strong" || name === "b") {
        stack.push({ kind: "bold" });
      } else if (name === "em" || name === "i") {
        stack.push({ kind: "italic" });
      }
    } else {
      // Pop matching frame from the top of the stack. If the stack
      // is balanced, this is always the topmost frame; if it's not
      // (rare malformed source) we still pop the topmost so we
      // don't leak the mode into the rest of the paragraph.
      const expected =
        name === "a" ? "link" : (name === "b" || name === "strong") ? "bold" : "italic";
      // Find the topmost frame matching expected; pop it (and any
      // crossed frames above to balance). For balanced markup this
      // collapses to a simple pop.
      let idx = stack.length - 1;
      while (idx >= 0 && stack[idx].kind !== expected) idx--;
      if (idx >= 0) stack.splice(idx, 1);
    }
  }

  const tail = html.slice(pos);
  if (tail) emit(tail);

  // Trim leading/trailing whitespace on the run sequence.
  if (runs.length) {
    runs[0].text = runs[0].text.replace(/^\s+/, "");
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, "");
    // Drop empty runs after trim.
    return runs.filter((r) => r.text.length > 0);
  }
  return runs;
}

/** Plain-text representation of a Run[]. Useful for accessibility
 *  labels, share captions, search indexing — anything that doesn't
 *  care about formatting. */
export function runsToText(runs: Run[]): string {
  return runs.map((r) => r.text).join("").trim();
}

// ── Helpers ────────────────────────────────────────────────────────────────

function attrMatch(attrs: string, name: string): string | null {
  const m =
    new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs) ||
    new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(attrs);
  return m ? m[1] : null;
}

/** Map a video-embed `src` to a (platform, videoId) pair. Returns
 *  null when the URL isn't a recognized YouTube / Vimeo form — the
 *  caller drops the block silently in that case. Tolerant of the
 *  legacy embed forms (`youtube.com/embed/ID`, `watch?v=ID`) in
 *  case Haiku drifts from the canonical `youtu.be/ID` it's
 *  prompted to emit. */
function parseVideoSrc(
  src: string | null,
): { platform: "youtube" | "vimeo"; videoId: string } | null {
  if (!src) return null;
  // Canonical form Haiku is told to emit.
  let m = /^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{11})/i.exec(src);
  if (m) return { platform: "youtube", videoId: m[1] };
  // Tolerant fallbacks.
  m = /youtube\.com\/(?:embed\/|watch\?(?:[^#]*&)?v=|v\/|shorts\/)([A-Za-z0-9_-]{11})/i.exec(
    src,
  );
  if (m) return { platform: "youtube", videoId: m[1] };
  m = /^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{6,12})/i.exec(
    src,
  );
  if (m) return { platform: "vimeo", videoId: m[1] };
  return null;
}

/** Resolve a thumbnail URL for a video. YouTube serves `hqdefault.jpg`
 *  unauthenticated (480×360, 4:3 with letterbox bars exactly 45px
 *  top+bottom — the renderer crops those out via objectFit:cover in
 *  a 16:9 frame, leaving only the content area visible). Vimeo
 *  requires an oEmbed call to resolve a thumbnail and we defer that
 *  to a future pass — Vimeo embeds render with no thumbnail, just
 *  the play affordance + platform label. */
function videoThumbnail(
  platform: "youtube" | "vimeo",
  videoId: string,
): string | null {
  if (platform === "youtube") {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }
  return null;
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

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_m, e) => {
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
}

/** Strip every tag + decode entities + collapse whitespace. Used for
 *  contexts that don't need inline runs (figure captions). */
function stripToText(text: string): string {
  if (!text) return "";
  let out = text.replace(/<[^>]+>/g, "");
  out = decodeEntities(out);
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

/** Reject non-http(s) hrefs (`javascript:`, `mailto:`, empty, anchor
 *  fragments). Return null when the href shouldn't render as a link.
 *  We keep `mailto:` out of the editorial reader on purpose — it's
 *  not the right surface for contact actions. */
function sanitiseHref(href: string): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return null;
  if (/^javascript:/i.test(trimmed)) return null;
  if (/^mailto:/i.test(trimmed)) return null;
  // Allow http(s) + protocol-relative + relative. Relative gets
  // resolved against the article URL by the renderer when needed.
  return trimmed;
}
