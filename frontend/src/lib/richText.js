// Formatted text: recipe notes, written in the editor (components/
// RichTextEditor.jsx), shown as written (components/RichTextView.jsx), and
// drawn into the recipe PDF.
//
// STORED AS HTML in a plain text column (recipes.notes), the editor's own
// output. Only a small set of formatting is allowed, the toolbar's: headings
// 1–3, paragraphs, bold, italic, underline, strike, text colour and highlight
// from small palettes, bullet and numbered lists, quotes and dividers.
//
// NOTES ARE UNTRUSTED. Anyone holding the internal app's public key can save a
// recipe through save_recipe (decision 0022), so what comes back from the
// database is never put on the page as it is. sanitizeNotesHtml keeps only the
// tags above, no attributes except a palette colour on a highlight or a text
// colour span, and is
// applied when notes are SAVED and again every time they are SHOWN. The second
// is the one that protects; the first keeps the stored copy tidy.
//
// THE PDF draws the same structure with jsPDF's built-in fonts, which cannot
// encode anything outside Windows-1252 (decision 0007). ₹ becomes "Rs." and a
// few arrows become ASCII; any other such character, Devanagari included,
// prints as "?". Screen and CSV show everything.

import DOMPurify from 'dompurify'

export const HIGHLIGHT_COLORS = [
  { name: 'Yellow', value: '#fde047' },
  { name: 'Green', value: '#86efac' },
  { name: 'Pink', value: '#f9a8d4' },
  { name: 'Blue', value: '#93c5fd' },
  { name: 'Orange', value: '#fdba74' },
]
const DEFAULT_HIGHLIGHT = HIGHLIGHT_COLORS[0].value
const PALETTE = new Set(HIGHLIGHT_COLORS.map((color) => color.value))

// Text colours have to read on the dark screen and on the PDF's white page,
// so they are mid-tones, not the brightest or darkest of each.
export const TEXT_COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#ea580c' },
  { name: 'Green', value: '#16a34a' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
]
const TEXT_PALETTE = new Set(TEXT_COLORS.map((color) => color.value))

// A colour as lower-case #rrggbb, from #rgb, #rrggbb or rgb(r, g, b).
const normalizeColor = (value) => {
  const text = String(value || '').trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(text)) return text
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${[...text.slice(1)].map((c) => c + c).join('')}`
  const rgb = text.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/)
  if (rgb) return `#${rgb.slice(1, 4).map((n) => Math.min(Number(n), 255).toString(16).padStart(2, '0')).join('')}`
  return ''
}

// The text colour in an inline style, if it is one of ours. `color` only:
// not background-color.
const paletteTextColor = (style) => {
  const match = String(style || '').match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)
  const color = normalizeColor(match?.[1])
  return TEXT_PALETTE.has(color) ? color : ''
}

const ALLOWED_TAGS = ['p', 'br', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'span', 'ul', 'ol', 'li', 'blockquote', 'hr']

// A highlight keeps its colour only if it is one of ours, written back as a
// bare background-color; a span keeps a text colour only if it is one of ours.
// Every other style attribute goes.
const keepPaletteHighlight = (node) => {
  if (!node.hasAttribute) return
  if (node.tagName === 'MARK') {
    const color = (node.getAttribute('data-color') || '').toLowerCase()
    const kept = PALETTE.has(color) ? color : DEFAULT_HIGHLIGHT
    node.setAttribute('data-color', kept)
    node.setAttribute('style', `background-color: ${kept}`)
  } else if (node.tagName === 'SPAN') {
    const color = paletteTextColor(node.getAttribute('style'))
    node.removeAttribute('data-color')
    if (color) node.setAttribute('style', `color: ${color}`)
    else node.removeAttribute('style')
  } else {
    node.removeAttribute('style')
    node.removeAttribute('data-color')
  }
}

/** Notes HTML reduced to the formatting the editor offers. '' for nothing. */
export function sanitizeNotesHtml(html) {
  if (!html) return ''
  DOMPurify.addHook('afterSanitizeAttributes', keepPaletteHighlight)
  try {
    return DOMPurify.sanitize(String(html), {
      ALLOWED_TAGS,
      ALLOWED_ATTR: ['style', 'data-color'],
      ALLOW_DATA_ATTR: false,
    })
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes', keepPaletteHighlight)
  }
}

const parse = (html) => new DOMParser().parseFromString(`<body>${sanitizeNotesHtml(html)}</body>`, 'text/html').body

/* ------------------------------------------------------------------ *
 * Structure: blocks of styled runs, shared by plain text and the PDF
 * ------------------------------------------------------------------ */

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR'])

// Inline content of one element as runs: { text, bold, italic, underline,
// strike, highlight, color } or { br: true }.
const inlineRuns = (element, marks = {}) => {
  const runs = []
  for (const node of element.childNodes) {
    if (node.nodeType === 3) {
      if (node.nodeValue) runs.push({ ...marks, text: node.nodeValue })
      continue
    }
    if (node.nodeType !== 1 || BLOCK_TAGS.has(node.tagName)) continue
    const tag = node.tagName
    if (tag === 'BR') { runs.push({ br: true }); continue }
    const next = { ...marks }
    if (tag === 'STRONG' || tag === 'B') next.bold = true
    if (tag === 'EM' || tag === 'I') next.italic = true
    if (tag === 'U') next.underline = true
    if (tag === 'S') next.strike = true
    if (tag === 'MARK') next.highlight = node.getAttribute('data-color') || DEFAULT_HIGHLIGHT
    if (tag === 'SPAN') next.color = paletteTextColor(node.getAttribute('style')) || next.color
    runs.push(...inlineRuns(node, next))
  }
  return runs
}

/**
 * Notes as a flat list of blocks:
 *   { kind: 'heading', level, runs } | { kind: 'para', runs } | { kind: 'hr' }
 * with `indent` (list depth), `marker` ('•' or '3.') on a list item's first
 * paragraph, and `quote` inside a blockquote.
 */
export function notesBlocks(html) {
  const blocks = []
  const walk = (container, ctx) => {
    let loose = []
    const flushLoose = () => {
      if (loose.some((run) => run.br || run.text?.trim())) blocks.push({ kind: 'para', runs: loose, ...ctx })
      loose = []
    }
    for (const node of container.childNodes) {
      if (node.nodeType === 1 && BLOCK_TAGS.has(node.tagName)) {
        flushLoose()
        const tag = node.tagName
        if (tag === 'P') blocks.push({ kind: 'para', runs: inlineRuns(node), ...ctx })
        else if (/^H[1-3]$/.test(tag)) blocks.push({ kind: 'heading', level: Number(tag[1]), runs: inlineRuns(node), ...ctx })
        else if (tag === 'HR') blocks.push({ kind: 'hr', ...ctx })
        else if (tag === 'BLOCKQUOTE') walk(node, { ...ctx, quote: true })
        else if (tag === 'UL' || tag === 'OL') {
          let number = 0
          for (const item of node.children) {
            if (item.tagName !== 'LI') continue
            number += 1
            const marker = tag === 'OL' ? `${number}.` : '•'
            const start = blocks.length
            walk(item, { ...ctx, indent: (ctx.indent || 0) + 1, marker: undefined })
            // The marker goes on the item's first own line, or alone if empty.
            const first = blocks.slice(start).find((block) => block.indent === (ctx.indent || 0) + 1)
            if (first) first.marker = marker
            else blocks.push({ kind: 'para', runs: [], ...ctx, indent: (ctx.indent || 0) + 1, marker })
          }
        } else if (tag === 'LI') walk(node, ctx)
      } else if (node.nodeType === 1 || node.nodeType === 3) {
        loose.push(...inlineRuns({ childNodes: [node] }))
      }
    }
    flushLoose()
  }
  walk(parse(html), { indent: 0 })
  return blocks
}

const blockText = (block) => block.runs.map((run) => (run.br ? '\n' : run.text)).join('')

/** Notes as plain text, for the CSV and the list. */
export function notesPlainText(html) {
  if (!html) return ''
  return notesBlocks(html)
    .map((block) => {
      if (block.kind === 'hr') return '---'
      const pad = '  '.repeat(Math.max((block.indent || 0) - 1, 0))
      const marker = block.marker ? `${block.marker === '•' ? '-' : block.marker} ` : block.indent ? '  ' : ''
      return `${block.quote ? '> ' : ''}${pad}${marker}${blockText(block)}`
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const hasNotes = (html) => Boolean(html) && notesBlocks(html).some((block) => block.kind === 'hr' || blockText(block).trim())

/* ------------------------------------------------------------------ *
 * PDF
 * ------------------------------------------------------------------ */

// Windows-1252's characters above 0x7F that are not in Latin-1's 0xA0–0xFF.
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
const PDF_REPLACEMENTS = { '₹': 'Rs.', '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '≈': '~', '✓': 'v' }

/** Text the built-in PDF fonts can print (decision 0007). */
export const pdfSafeText = (text) =>
  Array.from(String(text), (char) => {
    if (PDF_REPLACEMENTS[char]) return PDF_REPLACEMENTS[char]
    const code = char.codePointAt(0)
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff) || CP1252_EXTRA.has(char)) return char
    if (code === 0x09) return ' '
    return '?'
  }).join('')

const hexToRgb = (hex) => {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

const PT = 0.3528 // mm in a point
const SIZE = { 1: 14, 2: 12, 3: 10.5, body: 9.5 }

const fontStyle = (run) => (run.bold && run.italic ? 'bolditalic' : run.bold ? 'bold' : run.italic ? 'italic' : 'normal')

/**
 * Draws notes into a jsPDF document and returns the y below them.
 *   x, width   the column, in mm
 *   y          where to start
 *   bottom     the lowest y a line may sit on before a new page
 *   newPage    () => y to continue from, after adding a page
 *   ink, muted text colours as [r, g, b]
 */
export function drawNotesPdf(doc, html, { x, y, width, bottom, newPage, ink = [24, 24, 27], muted = [110, 110, 118] }) {
  const ensure = (height) => {
    if (y + height > bottom) y = newPage()
  }

  for (const block of notesBlocks(html)) {
    const indentX = x + (block.indent || 0) * 6 + (block.quote ? 4 : 0)
    const right = x + width

    if (block.kind === 'hr') {
      ensure(5)
      doc.setDrawColor(200)
      doc.setLineWidth(0.3)
      doc.line(indentX, y + 1.5, right, y + 1.5)
      y += 5
      continue
    }

    const heading = block.kind === 'heading'
    const size = heading ? SIZE[block.level] : SIZE.body
    const lineHeight = size * PT * 1.4
    y += heading ? 2.5 : 0.8
    doc.setFontSize(size)

    // Lay the runs out word by word, each in its own style, into lines.
    const lines = [[]]
    let cursor = indentX
    const place = (text, run) => {
      doc.setFont('helvetica', heading ? (run.italic ? 'bolditalic' : 'bold') : fontStyle(run))
      const itemWidth = doc.getTextWidth(text)
      lines[lines.length - 1].push({ text, run, x: cursor, width: itemWidth })
      cursor += itemWidth
    }
    for (const run of block.runs) {
      if (run.br) { lines.push([]); cursor = indentX; continue }
      for (const token of pdfSafeText(run.text).split(/(\s+)/)) {
        if (!token) continue
        const space = /^\s+$/.test(token)
        if (space && cursor === indentX) continue
        doc.setFont('helvetica', heading ? 'bold' : fontStyle(run))
        let piece = space ? ' ' : token
        if (!space && cursor + doc.getTextWidth(piece) > right && cursor > indentX) {
          lines.push([])
          cursor = indentX
        }
        // A word wider than the column is broken where it runs out.
        while (!space && doc.getTextWidth(piece) > right - cursor && piece.length > 1) {
          let cut = piece.length - 1
          while (cut > 1 && doc.getTextWidth(piece.slice(0, cut)) > right - cursor) cut -= 1
          place(piece.slice(0, cut), run)
          lines.push([])
          cursor = indentX
          piece = piece.slice(cut)
        }
        place(piece, run)
      }
    }

    lines.forEach((line, index) => {
      ensure(lineHeight)
      doc.setFontSize(size) // a new page's footer leaves its own size set
      const baseline = y + size * PT
      if (index === 0 && block.marker) {
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...muted)
        doc.text(block.marker, indentX - 1.5, baseline, { align: 'right' })
      }
      if (block.quote) {
        doc.setDrawColor(225, 187, 7)
        doc.setLineWidth(0.8)
        doc.line(x + 1, y, x + 1, y + lineHeight)
      }
      for (const item of line) {
        const { run } = item
        if (run.highlight) {
          doc.setFillColor(...hexToRgb(run.highlight))
          doc.rect(item.x, y + 0.3, item.width, lineHeight - 0.4, 'F')
        }
        doc.setFont('helvetica', heading ? (run.italic ? 'bolditalic' : 'bold') : fontStyle(run))
        doc.setTextColor(...(run.color ? hexToRgb(run.color) : block.quote && !run.highlight ? muted : ink))
        doc.text(item.text, item.x, baseline)
        doc.setDrawColor(...(run.color ? hexToRgb(run.color) : ink))
        doc.setLineWidth(0.2)
        if (run.underline) doc.line(item.x, baseline + 0.6, item.x + item.width, baseline + 0.6)
        if (run.strike) doc.line(item.x, baseline - size * PT * 0.3, item.x + item.width, baseline - size * PT * 0.3)
      }
      y += lineHeight
    })
    y += heading ? 0.8 : 1.2
  }

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0)
  return y
}
