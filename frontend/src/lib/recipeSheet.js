// A saved recipe written out for an amount of product: the sheet the Recipes
// page shows in its View window and downloads as CSV or PDF.
//
// A recipe is kept as shares of the mix and a yield fraction (decision 0022),
// which is right for costing and useless at the stove. The kitchen wants "to
// make 10 kg, weigh this much of each". That is a multiplication, but of the
// OUTPUT, not the mix:
//
//   mix to weigh       = amount of product ÷ yield
//   each ingredient    = its share × mix to weigh
//
// so 10 kg of a 0.62-yield marination means weighing 16.129 kg of mix. Asking
// for an amount of mix instead would make the kitchen do the division, and the
// division is the step that goes wrong.
//
// The amount can be given in kg or g, and in pieces for a product counted in
// pieces whose recipe says what one piece weighs.
//
// A litre is 1,000 g here as everywhere in recipes, so a liquid's weight in
// grams is its volume in ml. It is shown in ml and L because that is how it is
// measured out.
//
// COSTS ON THE SHEET are the Recipes page's preview, per kitchen, from
// lib/recipeCost.js: GST-inclusive (decision 0003) and not the franchise price,
// which the partner server works out. A sheet handed to a cook can leave them
// off.
//
// Money in the PDF goes through pdfMoney, since jsPDF cannot print ₹ (decision
// 0007). The CSV keeps ₹ and starts with a byte-order mark so Excel reads it as
// UTF-8.

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { pdfMoney, PDF_CURRENCY } from './pdfCurrency'
import { isCounted, isMade } from './recipeCost'

export const MATERIAL_TYPE_LABEL = {
  raw_material: 'Raw material',
  semi_finished: 'Semi-finished',
  finished: 'Finished',
  non_food: 'Non-food',
}

export const DEFAULT_AMOUNT = { quantity: '1', unit: 'kg' }

const num = (value) => {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const decimals = (value, places) => value.toLocaleString('en-IN', { maximumFractionDigits: places })

/** The units an amount of this product can be asked for in. */
export const amountUnits = (product, recipe) =>
  isCounted(product) && num(recipe?.pieceWeightGrams) > 0 ? ['kg', 'g', 'pcs'] : ['kg', 'g']

/** Grams of product asked for, or 0 if the amount is not usable. */
export const outputGramsFor = (amount, recipe) => {
  const quantity = num(amount?.quantity)
  if (!(quantity > 0)) return 0
  if (amount.unit === 'g') return quantity
  if (amount.unit === 'pcs') return quantity * num(recipe?.pieceWeightGrams)
  return quantity * 1000
}

/** A weight in grams the way it is measured out: g/kg, or ml/L for a liquid. */
export const formatWeight = (grams, unit) => {
  const liquid = unit === 'liter'
  if (grams >= 1000) return `${decimals(grams / 1000, 3)} ${liquid ? 'L' : 'kg'}`
  return `${decimals(grams, 2)} ${liquid ? 'ml' : 'g'}`
}

/** "10 kg", "500 g", "125 pieces (10 kg)". */
export const amountLabel = (amount, recipe) => {
  const grams = outputGramsFor(amount, recipe)
  if (amount.unit === 'pcs') {
    const pieces = num(amount.quantity)
    return `${decimals(pieces, 2)} piece${pieces === 1 ? '' : 's'} (${formatWeight(grams)})`
  }
  return formatWeight(grams)
}

/**
 * The recipe for an amount of product.
 *   recipe     { yield, pieceWeightGrams, items: [{ componentId, share }] }
 *   materials  Map id → { name, code, unit, material_type }
 * Returns null when the amount is not usable.
 */
export function scaleRecipe({ recipe, materials, amount }) {
  const outputGrams = outputGramsFor(amount, recipe)
  const yieldValue = num(recipe?.yield)
  if (!(outputGrams > 0) || !(yieldValue > 0)) return null
  const mixGrams = outputGrams / yieldValue
  return {
    outputGrams,
    mixGrams,
    lines: recipe.items.map((item, index) => {
      const material = materials.get(item.componentId)
      return {
        position: index + 1,
        id: item.componentId,
        name: material?.name || 'Inactive material',
        code: material?.code || '',
        unit: material?.unit || 'kg',
        type: MATERIAL_TYPE_LABEL[material?.material_type] || material?.material_type || '',
        made: isMade(material),
        share: item.share,
        grams: item.share * mixGrams,
      }
    }),
  }
}

/**
 * What the amount costs in each kitchen.
 *   resolvers  Map kitchen id → resolve (lib/recipeCost.js recipeCostResolver)
 * Each entry is { kitchen, total, perKg, perPiece } or { kitchen, reason }.
 */
export function sheetCosts({ product, outputGrams, kitchens, resolvers }) {
  return kitchens.map((kitchen) => {
    const cost = resolvers.get(kitchen.id)?.(product.id)
    if (!cost || cost.cost === null) return { kitchen, reason: cost?.reason || 'no costs loaded' }
    return {
      kitchen,
      perKg: cost.perKg,
      total: (cost.perKg * outputGrams) / 1000,
      perPiece: isCounted(product) ? cost.cost : null,
    }
  })
}

const fileName = (product, amount, extension) =>
  `recipe_${(product.code || product.name).replace(/[^\w-]+/g, '_')}_${String(amount.quantity).replace(/[^\d.]+/g, '')}${amount.unit}.${extension}`

const yieldLabel = (value) => `${value} (${decimals(value * 100, 2)}%)`

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * The sheet as CSV text. Details first, then one row per ingredient, then the
 * costs if they are included.
 *   sheet  { product, recipe, amount, scaled, costs: [...] | null }
 */
export function recipeCsv({ product, recipe, amount, scaled, costs }) {
  const rows = [
    ['Recipe', product.name],
    ['Code', product.code],
    ['Type', MATERIAL_TYPE_LABEL[product.material_type] || product.material_type],
    ['Makes', amountLabel(amount, recipe)],
    ['Mix to weigh (g)', scaled.mixGrams.toFixed(2)],
    ['Yield', yieldLabel(recipe.yield)],
    [],
    ['#', 'Material', 'Code', 'Type', 'Share of mix (%)', 'Quantity', 'Unit', 'Quantity (kg or L)'],
    ...scaled.lines.map((line) => [
      line.position,
      line.name,
      line.code,
      line.type,
      (line.share * 100).toFixed(4),
      line.grams.toFixed(2),
      line.unit === 'liter' ? 'ml' : 'g',
      (line.grams / 1000).toFixed(3),
    ]),
    ['', 'Total mix', '', '', '100.0000', scaled.mixGrams.toFixed(2), 'g', (scaled.mixGrams / 1000).toFixed(3)],
  ]
  if (costs) {
    rows.push(
      [],
      ['Cost in kitchen', `Cost of ${amountLabel(amount, recipe)} (₹)`, 'Cost per kg (₹)', 'Cost per piece (₹)', 'Note'],
      ...costs.map((entry) => entry.reason
        ? [entry.kitchen.name, '', '', '', `Cannot be costed: ${entry.reason}`]
        : [entry.kitchen.name, entry.total.toFixed(2), entry.perKg.toFixed(2), entry.perPiece === null ? '' : entry.perPiece.toFixed(2), 'GST inclusive']),
    )
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\n')
}

export function downloadRecipeCsv(sheet) {
  const blob = new Blob(['﻿', recipeCsv(sheet)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName(sheet.product, sheet.amount, 'csv')
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/* ------------------------------------------------------------------ *
 * PDF
 * ------------------------------------------------------------------ */

const ACCENT = [225, 187, 7]

// autoTable's columnStyles reach only the body; headers and totals of a
// right-aligned column are aligned to match here.
const alignRight = (columns) => (data) => {
  if (columns.includes(data.column.index)) data.cell.styles.halign = 'right'
}
const INK = [24, 24, 27]
const MUTED = [110, 110, 118]

export function downloadRecipePdf({ product, recipe, amount, scaled, costs }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 14

  // Title block, on an accent band.
  doc.setFillColor(...ACCENT)
  doc.rect(0, 0, pageWidth, 4, 'F')
  doc.setTextColor(...MUTED)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('RECIPE', margin, 14)
  doc.setTextColor(...INK)
  doc.setFontSize(18)
  const titleLines = doc.splitTextToSize(product.name, pageWidth - margin * 2)
  doc.text(titleLines, margin, 22)
  let y = 22 + (titleLines.length - 1) * 7 + 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text(
    [product.code, MATERIAL_TYPE_LABEL[product.material_type] || product.material_type, `counted in ${product.unit}`]
      .filter(Boolean).join('  ·  '),
    margin,
    y
  )
  y += 7

  // The four figures the cook reads first.
  const figures = [
    ['Makes', amountLabel(amount, recipe)],
    ['Mix to weigh', formatWeight(scaled.mixGrams)],
    ['Yield', yieldLabel(recipe.yield)],
    ['Ingredients', String(scaled.lines.length)],
  ]
  const gap = 3
  const boxWidth = (pageWidth - margin * 2 - gap * (figures.length - 1)) / figures.length
  figures.forEach(([label, value], index) => {
    const x = margin + index * (boxWidth + gap)
    doc.setDrawColor(220)
    doc.setFillColor(248, 248, 248)
    doc.roundedRect(x, y, boxWidth, 15, 1.5, 1.5, 'FD')
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text(label.toUpperCase(), x + 3, y + 5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...INK)
    doc.text(doc.splitTextToSize(value, boxWidth - 6)[0], x + 3, y + 11)
    doc.setFont('helvetica', 'normal')
  })
  y += 22

  const footer = () => {
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text(`Gastronomix  ·  ${product.name}  ·  generated ${new Date().toLocaleString('en-IN')}`, margin, pageHeight - 8)
    doc.text(`Page ${doc.getCurrentPageInfo().pageNumber}`, pageWidth - margin, pageHeight - 8, { align: 'right' })
    doc.setTextColor(0)
  }

  autoTable(doc, {
    startY: y,
    head: [['#', 'Material', 'Code', 'Share', 'Quantity']],
    body: scaled.lines.map((line) => [
      line.position,
      line.made ? `${line.name}\n${line.type}, made from its own recipe` : line.name,
      line.code,
      `${(line.share * 100).toFixed(2)}%`,
      formatWeight(line.grams, line.unit),
    ]),
    foot: [['', 'Total mix', '', '100.00%', formatWeight(scaled.mixGrams)]],
    theme: 'grid',
    margin: { left: margin, right: margin, bottom: 16 },
    styles: { fontSize: 9, cellPadding: 2.2, textColor: INK, lineColor: [225, 225, 225] },
    headStyles: { fillColor: ACCENT, textColor: 20, fontStyle: 'bold' },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: {
      0: { cellWidth: 9, halign: 'center' },
      2: { cellWidth: 28, textColor: MUTED },
      3: { cellWidth: 20, halign: 'right' },
      4: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: alignRight([3, 4]),
    didDrawPage: footer,
  })
  y = doc.lastAutoTable.finalY + 8

  if (costs) {
    autoTable(doc, {
      startY: y,
      head: [['Cost in kitchen', `Cost of ${amountLabel(amount, recipe)}`, 'Per kg', ...(isCounted(product) ? ['Per piece'] : [])]],
      body: costs.map((entry) => entry.reason
        ? [entry.kitchen.name, { content: `Cannot be costed: ${entry.reason}`, colSpan: isCounted(product) ? 3 : 2, styles: { textColor: MUTED } }]
        : [entry.kitchen.name, pdfMoney(entry.total), pdfMoney(entry.perKg), ...(isCounted(product) ? [entry.perPiece === null ? '' : pdfMoney(entry.perPiece)] : [])]),
      theme: 'grid',
      margin: { left: margin, right: margin, bottom: 16 },
      styles: { fontSize: 9, cellPadding: 2.2, textColor: INK, lineColor: [225, 225, 225] },
      headStyles: { fillColor: [60, 60, 66], textColor: 255, fontStyle: 'bold' },
      didParseCell: (data) => { if (data.column.index > 0 && data.cell.colSpan === 1) data.cell.styles.halign = 'right' },
      didDrawPage: footer,
    })
    y = doc.lastAutoTable.finalY + 5
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text(
      `Amounts in ${PDF_CURRENCY}, GST paid to vendors included. A preview from each kitchen's stock, not the franchise price.`,
      margin,
      y
    )
  }

  doc.save(fileName(product, amount, 'pdf'))
}
