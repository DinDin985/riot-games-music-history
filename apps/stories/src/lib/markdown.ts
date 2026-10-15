/**
 * Tiny, safe Markdown renderer for the curated story text (paragraphs, lists,
 * block quotes, headings, *emphasis*, **strong**, `code` and [links](url)).
 * Everything is HTML-escaped first, so the output is safe for `set:html`.
 * The research files only use this small subset; anything else renders as text.
 */

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const safeHref = (href: string): string | null => {
  const trimmed = href.trim()
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed
  return null
}

/** Inline formatting on already-escaped text. */
const emphasis = (text: string): string =>
  text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>")

const renderInline = (escaped: string): string => {
  // Code spans and links become placeholders so emphasis never touches their contents (e.g. `_` in URLs).
  const tokens: Array<string> = []
  const hold = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`
  let out = escaped.replace(/`([^`]+)`/g, (_match, code: string) => hold(`<code>${code}</code>`))
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
    // `href` was escaped with the rest of the text; un-escape `&amp;` so query strings survive.
    const target = safeHref(href.replace(/&amp;/g, "&"))
    if (!target) return label
    const external = /^https?:/i.test(target)
    return hold(
      `<a href="${escapeHtml(target)}"${external ? ' target="_blank" rel="noreferrer"' : ""}>${emphasis(label)}</a>`,
    )
  })
  return emphasis(out).replace(/\u0000(\d+)\u0000/g, (_match, i: string) => tokens[Number(i)] ?? "")
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/

export const renderMarkdown = (source: string | null | undefined): string => {
  if (!source) return ""
  const blocks = source.replace(/\r\n?/g, "\n").split(/\n{2,}/)
  const html: Array<string> = []
  for (const raw of blocks) {
    const block = raw.trim()
    if (!block) continue
    const lines = block.split("\n")
    const heading = /^(#{1,6})\s+(.*)$/.exec(block)
    if (heading && lines.length === 1) {
      // Story sections already have an h2, so markdown headings start at h3.
      const level = Math.min(6, (heading[1]?.length ?? 1) + 2)
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2] ?? ""))}</h${level}>`)
    } else if (lines.every((line) => LIST_ITEM.test(line))) {
      const ordered = /^\s*\d/.test(lines[0] ?? "")
      const items = lines.map((line) => `<li>${renderInline(escapeHtml(line.replace(LIST_ITEM, "")))}</li>`)
      html.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`)
    } else if (lines.every((line) => line.startsWith(">"))) {
      const text = lines.map((line) => line.replace(/^>\s?/, "")).join(" ")
      html.push(`<blockquote><p>${renderInline(escapeHtml(text))}</p></blockquote>`)
    } else {
      html.push(`<p>${renderInline(escapeHtml(lines.join(" ")))}</p>`)
    }
  }
  return html.join("\n")
}

/** Inline-only render (for one-line fields such as taglines that may contain *emphasis*). */
export const renderInlineMarkdown = (source: string | null | undefined): string =>
  source ? renderInline(escapeHtml(source)) : ""
