// Excel writers for the two admin requisition reports.
//
// Each workbook opens on a Summary sheet that states the period, the scope and
// how the money was arrived at, then gives the detail as one flat table per
// sheet. Flat because these are read in Excel and pivoted: a sectioned layout
// with an outlet heading every few rows looks tidier and cannot be filtered.

import * as XLSX from 'xlsx'
import { costBasisLabel } from './requisitionReports'

const round = (value) => Number((value || 0).toFixed(2))

const formatDay = (value) => {
  if (!value) return ''
  const [y, m, d] = String(value).slice(0, 10).split('-')
  return y && m && d ? `${d}/${m}/${y}` : String(value)
}

const boldHeaderRow = (sheet, rowIndex = 0) => {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1')
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: col })]
    if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: 'CCCCCC' } } }
  }
}

const withColumnWidths = (sheet, widths) => {
  sheet['!cols'] = widths.map((width) => ({ wch: width }))
  return sheet
}

const scopeLabel = (kitchenName) => kitchenName || 'All cloud kitchens'

const COST_NOTE = [
  ['How the cost is calculated'],
  ['Rate:', 'Weighted average of what the material cost to buy inside the period, GST inclusive.'],
  ['', 'Weighted by quantity purchased, so a small top-up cannot swing the average.'],
  ['Fallback:', 'A material not purchased during the period is priced from its most recent'],
  ['', 'earlier batch, marked "Last known price" in the Cost basis column.'],
  ['', 'A material never purchased prices at zero, marked "Never purchased".'],
]

const meta = (title, { startDate, endDate, kitchenName, outletName }) => [
  ['Gastronomix Inventory Management'],
  [title],
  [],
  ['Period:', `${formatDay(startDate)} to ${formatDay(endDate)}`],
  ...(outletName ? [['Outlet:', outletName]] : []),
  ['Cloud kitchen:', scopeLabel(kitchenName)],
  ['Generated:', new Date().toLocaleString()],
]

/** Requisitions have no human-readable number, so the id's head stands in. */
const shortRef = (id) => (id ? String(id).slice(0, 8) : '')

const fileSlug = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'outlet'

/**
 * Report 1 — item-wise consumption per outlet.
 *
 * Consumption is what was requisitioned, packed or not, which is why the note
 * says so on the sheet: a reader comparing this against a stock-out ledger
 * needs to know the two are measuring different moments.
 */
export const exportItemWiseConsumptionExcel = (report, options) => {
  const workbook = XLSX.utils.book_new()

  const summaryRows = [
    ...meta('Item-wise Consumption Report', options),
    [],
    ['Outlets included:', report.outlets.length],
    ['Requisitions counted:', report.requisitionCount],
    ['Total value:', round(report.totalAmount)],
    [],
    ['What this report counts'],
    ['Consumed:', 'The quantity an outlet asked for in requisitions raised during the period.'],
    ['', 'Requisitions still waiting to be packed are included — this is demand, not dispatch.'],
    ['Outlets:', 'Active outlets with at least one requisition in the period. Others are omitted.'],
    [],
    ...COST_NOTE,
    [],
    ['Outlet totals (highest first)'],
    ['Cloud Kitchen', 'Outlet', 'Requisitions', 'Items', 'Total Value'],
    ...report.outlets.map((outlet) => [
      outlet.kitchenName,
      outlet.outletName,
      outlet.requisitionCount,
      outlet.items.length,
      round(outlet.totalAmount),
    ]),
  ]

  const summarySheet = withColumnWidths(XLSX.utils.aoa_to_sheet(summaryRows), [22, 28, 14, 10, 14])
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

  const detailRows = [
    ['Cloud Kitchen', 'Outlet', 'Material', 'Code', 'Unit', 'Quantity Consumed', 'Avg Cost (incl. GST)', 'Total Amount', 'Cost Basis'],
  ]
  report.outlets.forEach((outlet) => {
    outlet.items.forEach((item) => {
      detailRows.push([
        outlet.kitchenName,
        outlet.outletName,
        item.name,
        item.code,
        item.unit,
        round(item.quantity),
        round(item.avgCost),
        round(item.amount),
        costBasisLabel(item.costBasis),
      ])
    })
  })
  if (detailRows.length > 1) {
    detailRows.push([])
    detailRows.push(['', '', '', '', '', '', 'Grand Total', round(report.totalAmount), ''])
  }

  const detailSheet = withColumnWidths(XLSX.utils.aoa_to_sheet(detailRows), [22, 26, 30, 14, 10, 18, 20, 16, 20])
  boldHeaderRow(detailSheet)
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'Item-wise Consumption')

  XLSX.writeFile(workbook, `item-wise-consumption_${options.startDate}_to_${options.endDate}.xlsx`)
}

/**
 * Report 2 — requested against allocated, per outlet, with the line-level
 * detail behind every figure on a second sheet.
 */
export const exportRequestedVsAllocatedExcel = (report, options) => {
  const workbook = XLSX.utils.book_new()
  const { totals } = report

  const summaryRows = [
    ...meta('Requested vs Allocated Difference Report', options),
    [],
    ['Outlets included:', report.rows.length],
    ['Requisitions compared:', totals.requisitionsCompared],
    ['Requisitions excluded (not yet packed):', report.pendingExcluded],
    ['Lines increased:', totals.itemsIncreased],
    ['Lines decreased:', totals.itemsDecreased],
    ['Value increased:', round(totals.increaseValue)],
    ['Value decreased:', round(totals.decreaseValue)],
    ['Net difference:', round(totals.increaseValue + totals.decreaseValue)],
    ['Absolute difference:', round(totals.absoluteValue)],
    [],
    ['What this report counts'],
    ['Difference:', 'Allocated quantity minus requested quantity, per material, per requisition.'],
    ['Increase:', 'The purchase manager sent more than the outlet asked for.'],
    ['Decrease:', 'The purchase manager sent less, or nothing at all.'],
    ['Excluded:', 'Requisitions with no stock-out yet. They have no allocation to differ from,'],
    ['', 'and counting them would read as every line having been cut to zero.'],
    ['Quantities:', 'Counted as lines changed, not summed. Items are measured in kg, litres and'],
    ['', 'pieces, so a single quantity total across them would carry no unit. Rupees are'],
    ['', 'the one dimension every item shares — the value columns are the comparable ones.'],
    [],
    ...COST_NOTE,
  ]

  const summarySheet = withColumnWidths(XLSX.utils.aoa_to_sheet(summaryRows), [40, 40])
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

  const outletRows = [
    ['Cloud Kitchen', 'Outlet', 'Requisitions Compared', 'Lines Increased', 'Lines Decreased', 'Value Increased', 'Value Decreased', 'Net Difference', 'Absolute Difference'],
    ...report.rows.map((row) => [
      row.kitchenName,
      row.outletName,
      row.requisitionsCompared,
      row.itemsIncreased,
      row.itemsDecreased,
      round(row.increaseValue),
      round(row.decreaseValue),
      round(row.netValue),
      round(row.absoluteValue),
    ]),
  ]
  if (report.rows.length > 0) {
    outletRows.push([])
    outletRows.push([
      '',
      'Total',
      totals.requisitionsCompared,
      totals.itemsIncreased,
      totals.itemsDecreased,
      round(totals.increaseValue),
      round(totals.decreaseValue),
      round(totals.increaseValue + totals.decreaseValue),
      round(totals.absoluteValue),
    ])
  }

  const outletSheet = withColumnWidths(XLSX.utils.aoa_to_sheet(outletRows), [22, 26, 20, 16, 16, 16, 16, 16, 18])
  boldHeaderRow(outletSheet)
  XLSX.utils.book_append_sheet(workbook, outletSheet, 'Difference by Outlet')

  const detailRows = [
    ['Cloud Kitchen', 'Outlet', 'Request Date', 'Material', 'Code', 'Unit', 'Requested', 'Allocated', 'Difference', 'Avg Cost (incl. GST)', 'Value of Difference', 'Cost Basis'],
  ]
  report.rows.forEach((row) => {
    row.details.forEach((detail) => {
      detailRows.push([
        row.kitchenName,
        row.outletName,
        formatDay(detail.requestDate),
        detail.name,
        detail.code,
        detail.unit,
        round(detail.requested),
        round(detail.allocated),
        round(detail.difference),
        round(detail.avgCost),
        round(detail.value),
        costBasisLabel(detail.costBasis),
      ])
    })
  })

  const detailSheet = withColumnWidths(XLSX.utils.aoa_to_sheet(detailRows), [22, 26, 14, 30, 14, 10, 12, 12, 12, 20, 20, 20])
  boldHeaderRow(detailSheet)
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'Line Detail')

  XLSX.writeFile(workbook, `requested-vs-allocated_${options.startDate}_to_${options.endDate}.xlsx`)
}

// ---------------------------------------------------------------------------
// Single-outlet workbooks
//
// Same numbers, laid out for a reader who already knows which outlet they are
// looking at. The outlet and kitchen move up into the header instead of being
// repeated down two columns of every row, and the space that frees is spent on
// the cuts one outlet actually makes possible: a dated requisition-by-
// requisition roll-up, and each material's share of the outlet's spend.

/**
 * Report 1, one outlet — items on one sheet, its requisitions on another.
 */
export const exportOutletConsumptionExcel = (report, options) => {
  const workbook = XLSX.utils.book_new()
  const meta_ = { ...options, outletName: report.outletName, kitchenName: report.kitchenName }

  const summaryRows = [
    ...meta('Item-wise Consumption Report — Single Outlet', meta_),
    [],
    ['Requisitions raised:', report.requisitionCount],
    ['Distinct materials:', report.items.length],
    ['Total value:', round(report.totalAmount)],
    [],
    ['What this report counts'],
    ['Consumed:', 'The quantity this outlet asked for in requisitions raised during the period.'],
    ['', 'Requisitions still waiting to be packed are included — this is demand, not dispatch.'],
    ['Outlet:', 'Shown as named, whether or not it is still active.'],
    [],
    ...COST_NOTE,
  ]

  const summarySheet = withColumnWidths(XLSX.utils.aoa_to_sheet(summaryRows), [26, 46])
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

  const shareOf = (amount) => (report.totalAmount > 0 ? round((amount / report.totalAmount) * 100) : 0)

  const itemRows = [
    ['Material', 'Code', 'Unit', 'Quantity Consumed', 'Requisitions', 'Avg Cost (incl. GST)', 'Total Amount', '% of Outlet Spend', 'Cost Basis'],
    ...report.items.map((item) => [
      item.name,
      item.code,
      item.unit,
      round(item.quantity),
      item.requisitionCount,
      round(item.avgCost),
      round(item.amount),
      shareOf(item.amount),
      costBasisLabel(item.costBasis),
    ]),
  ]
  if (report.items.length > 0) {
    itemRows.push([])
    itemRows.push(['Grand Total', '', '', '', '', '', round(report.totalAmount), 100, ''])
  }

  const itemSheet = withColumnWidths(XLSX.utils.aoa_to_sheet(itemRows), [30, 14, 10, 18, 14, 20, 16, 18, 20])
  boldHeaderRow(itemSheet)
  XLSX.utils.book_append_sheet(workbook, itemSheet, 'Item-wise Consumption')

  const requisitionRows = [
    ['Request Date', 'Requisition', 'Supervisor', 'Status', 'Lines', 'Value'],
    ...report.requisitions.map((requisition) => [
      formatDay(requisition.requestDate),
      shortRef(requisition.id),
      requisition.supervisorName,
      requisition.isPacked ? 'Packed' : 'Pending',
      requisition.lineCount,
      round(requisition.amount),
    ]),
  ]

  const requisitionSheet = withColumnWidths(XLSX.utils.aoa_to_sheet(requisitionRows), [14, 14, 24, 12, 10, 14])
  boldHeaderRow(requisitionSheet)
  XLSX.utils.book_append_sheet(workbook, requisitionSheet, 'By Requisition')

  XLSX.writeFile(
    workbook,
    `item-wise-consumption_${fileSlug(report.outletName)}_${options.startDate}_to_${options.endDate}.xlsx`
  )
}

/**
 * Report 2, one outlet — the difference by material, by requisition, and line
 * by line.
 */
export const exportOutletRequestedVsAllocatedExcel = (report, options) => {
  const workbook = XLSX.utils.book_new()
  const { totals } = report
  const meta_ = { ...options, outletName: report.outletName, kitchenName: report.kitchenName }

  const summaryRows = [
    ...meta('Requested vs Allocated Difference Report — Single Outlet', meta_),
    [],
    ['Requisitions compared:', totals.requisitionsCompared],
    ['Requisitions excluded (not yet packed):', report.pendingExcluded],
    ['Lines increased:', totals.itemsIncreased],
    ['Lines decreased:', totals.itemsDecreased],
    ['Value increased:', round(totals.increaseValue)],
    ['Value decreased:', round(totals.decreaseValue)],
    ['Net difference:', round(totals.increaseValue + totals.decreaseValue)],
    ['Absolute difference:', round(totals.absoluteValue)],
    [],
    ['What this report counts'],
    ['Difference:', 'Allocated quantity minus requested quantity, per material, per requisition.'],
    ['Increase:', 'The purchase manager sent more than the outlet asked for.'],
    ['Decrease:', 'The purchase manager sent less, or nothing at all.'],
    ['Excluded:', 'Requisitions with no stock-out yet. They have no allocation to differ from,'],
    ['', 'and counting them would read as every line having been cut to zero.'],
    ['By Material:', 'Period totals per item across every compared requisition, including the'],
    ['', 'materials that matched exactly — a met ask is part of the picture too.'],
    ['By Requisition:', 'The same differences dated, so a bad week shows up as a bad week.'],
    [],
    ...COST_NOTE,
  ]

  const summarySheet = withColumnWidths(XLSX.utils.aoa_to_sheet(summaryRows), [40, 46])
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

  const materialRows = [
    ['Material', 'Code', 'Unit', 'Total Requested', 'Total Allocated', 'Difference', 'Times Increased', 'Times Decreased', 'Avg Cost (incl. GST)', 'Value of Difference', 'Cost Basis'],
    ...report.materials.map((material) => [
      material.name,
      material.code,
      material.unit,
      round(material.requested),
      round(material.allocated),
      round(material.difference),
      material.timesIncreased,
      material.timesDecreased,
      round(material.avgCost),
      round(material.value),
      costBasisLabel(material.costBasis),
    ]),
  ]

  const materialSheet = withColumnWidths(XLSX.utils.aoa_to_sheet(materialRows), [30, 14, 10, 16, 16, 12, 16, 16, 20, 20, 20])
  boldHeaderRow(materialSheet)
  XLSX.utils.book_append_sheet(workbook, materialSheet, 'By Material')

  const requisitionRows = [
    ['Request Date', 'Stock Out Date', 'Requisition', 'Supervisor', 'Lines Increased', 'Lines Decreased', 'Value Increased', 'Value Decreased', 'Net Difference', 'Absolute Difference'],
    ...report.requisitions.map((requisition) => [
      formatDay(requisition.requestDate),
      formatDay(requisition.allocationDate),
      shortRef(requisition.id),
      requisition.supervisorName,
      requisition.linesIncreased,
      requisition.linesDecreased,
      round(requisition.increaseValue),
      round(requisition.decreaseValue),
      round(requisition.netValue),
      round(requisition.absoluteValue),
    ]),
  ]
  if (report.requisitions.length > 0) {
    requisitionRows.push([])
    requisitionRows.push([
      'Total',
      '',
      '',
      '',
      totals.itemsIncreased,
      totals.itemsDecreased,
      round(totals.increaseValue),
      round(totals.decreaseValue),
      round(totals.increaseValue + totals.decreaseValue),
      round(totals.absoluteValue),
    ])
  }

  const requisitionSheet = withColumnWidths(XLSX.utils.aoa_to_sheet(requisitionRows), [14, 14, 14, 24, 16, 16, 16, 16, 16, 18])
  boldHeaderRow(requisitionSheet)
  XLSX.utils.book_append_sheet(workbook, requisitionSheet, 'By Requisition')

  const detailRows = [
    ['Request Date', 'Requisition', 'Material', 'Code', 'Unit', 'Requested', 'Allocated', 'Difference', 'Avg Cost (incl. GST)', 'Value of Difference', 'Cost Basis'],
  ]
  report.requisitions.forEach((requisition) => {
    requisition.details.forEach((detail) => {
      detailRows.push([
        formatDay(detail.requestDate),
        shortRef(detail.requisitionId),
        detail.name,
        detail.code,
        detail.unit,
        round(detail.requested),
        round(detail.allocated),
        round(detail.difference),
        round(detail.avgCost),
        round(detail.value),
        costBasisLabel(detail.costBasis),
      ])
    })
  })

  const detailSheet = withColumnWidths(XLSX.utils.aoa_to_sheet(detailRows), [14, 14, 30, 14, 10, 12, 12, 12, 20, 20, 20])
  boldHeaderRow(detailSheet)
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'Line Detail')

  XLSX.writeFile(
    workbook,
    `requested-vs-allocated_${fileSlug(report.outletName)}_${options.startDate}_to_${options.endDate}.xlsx`
  )
}
