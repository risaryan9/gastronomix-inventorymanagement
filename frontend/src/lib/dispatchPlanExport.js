import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'

const MATERIAL_TYPE_ORDER = {
  finished: 0,
  semi_finished: 1,
  raw_material: 2
}

const MATERIAL_TYPE_LABELS = {
  finished: 'Finished Materials',
  semi_finished: 'Semi-Finished Materials',
  raw_material: 'Raw Materials'
}

/** plan_date from DB is YYYY-MM-DD */
function formatPlanDateDdMmYyyy(isoDate) {
  if (!isoDate) return 'N/A'
  const part = String(isoDate).split('T')[0]
  const [y, m, d] = part.split('-')
  if (!y || !m || !d) return part
  return `${d}/${m}/${y}`
}

function formatDateTimeDdMmYyyyHm(dateVal) {
  if (!dateVal) return ''
  const dt = new Date(dateVal)
  if (Number.isNaN(dt.getTime())) return ''
  const z = (n) => String(n).padStart(2, '0')
  return `${z(dt.getDate())}/${z(dt.getMonth() + 1)}/${dt.getFullYear()}, ${z(dt.getHours())}:${z(dt.getMinutes())}`
}

export async function fetchPlanExportData(supabase, planId, session) {
  try {
    // Fetch dispatch plan header
    const { data: planData, error: planError } = await supabase
      .from('dispatch_plan')
      .select('id, plan_date, status, brand, locked_at, notes')
      .eq('id', planId)
      .single()

    if (planError) throw planError
    if (!planData) throw new Error('Dispatch plan not found')

    // Fetch dispatch plan items with materials and outlets
    const { data: items, error: itemsError } = await supabase
      .from('dispatch_plan_items')
      .select(`
        id,
        quantity,
        raw_materials:raw_material_id (
          id,
          name,
          code,
          unit,
          material_type,
          category
        ),
        outlets:outlet_id (
          id,
          name,
          code
        )
      `)
      .eq('dispatch_plan_id', planId)

    if (itemsError) throw itemsError

    const rows = items || []
    if (rows.length === 0) {
      throw new Error('This dispatch plan has no items')
    }

    // Build material and outlet maps
    const materialMap = new Map()
    const outletMap = new Map()
    const qtyMap = {}

    rows.forEach(row => {
      const rm = row.raw_materials
      const outlet = row.outlets
      if (!rm || !outlet) return

      if (!materialMap.has(rm.id)) {
        materialMap.set(rm.id, rm)
      }
      if (!outletMap.has(outlet.id)) {
        outletMap.set(outlet.id, outlet)
      }

      if (!qtyMap[rm.id]) qtyMap[rm.id] = {}
      qtyMap[rm.id][outlet.id] = parseFloat(row.quantity || 0)
    })

    // Sort materials by type then name
    const materials = Array.from(materialMap.values()).sort((a, b) => {
      const orderA = MATERIAL_TYPE_ORDER[a.material_type] ?? 99
      const orderB = MATERIAL_TYPE_ORDER[b.material_type] ?? 99
      if (orderA !== orderB) return orderA - orderB
      const nameA = (a.name || '').toLowerCase()
      const nameB = (b.name || '').toLowerCase()
      return nameA.localeCompare(nameB)
    })

    // Sort outlets by code
    const outlets = Array.from(outletMap.values()).sort((a, b) => {
      const codeA = (a.code || '').toLowerCase()
      const codeB = (b.code || '').toLowerCase()
      return codeA.localeCompare(codeB)
    })

    return {
      plan: planData,
      materials,
      outlets,
      quantities: qtyMap,
      session
    }
  } catch (error) {
    console.error('Error fetching dispatch plan export data:', error)
    throw error
  }
}

export function exportDispatchPlanExcel(data) {
  const { plan, materials, outlets, quantities, session } = data

  const workbook = XLSX.utils.book_new()

  // Sheet 1: Summary (compact; single heading block)
  const summaryData = [
    ['Dispatch Plan Details'],
    [
      'Generated:',
      formatDateTimeDdMmYyyyHm(new Date()) || new Date().toLocaleString()
    ],
    ['Kitchen:', session?.cloud_kitchen_name || 'N/A'],
    [
      'Brand:',
      plan.brand ? plan.brand.replace(/_/g, ' ').toUpperCase() : 'N/A'
    ],
    ['Plan date:', formatPlanDateDdMmYyyy(plan.plan_date)],
    plan.locked_at
      ? ['Locked at:', formatDateTimeDdMmYyyyHm(plan.locked_at) || 'N/A']
      : null,
    plan.notes ? ['Notes:', plan.notes] : null
  ].filter(Boolean)

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

  // Sheet 2: Dispatch Grid
  const gridHeaders = ['Material', 'Code', 'Unit', 'Type', ...outlets.map(o => o.code), 'Total']
  const gridData = [gridHeaders]

  materials.forEach(material => {
    const row = [
      material.name || 'N/A',
      material.code || 'N/A',
      material.unit || 'N/A',
      material.material_type ? material.material_type.replace(/_/g, ' ') : 'N/A'
    ]

    let rowTotal = 0
    outlets.forEach(outlet => {
      const qty = quantities[material.id]?.[outlet.id] || 0
      row.push(qty)
      rowTotal += qty
    })
    row.push(rowTotal)

    gridData.push(row)
  })

  // Add column totals
  const totalsRow = ['', '', '', 'TOTALS']
  for (let i = 0; i < outlets.length; i++) {
    let colTotal = 0
    materials.forEach(material => {
      const qty = quantities[material.id]?.[outlets[i].id] || 0
      colTotal += qty
    })
    totalsRow.push(colTotal)
  }
  // Grand total
  let grandTotal = 0
  materials.forEach(material => {
    outlets.forEach(outlet => {
      grandTotal += quantities[material.id]?.[outlet.id] || 0
    })
  })
  totalsRow.push(grandTotal)
  gridData.push(totalsRow)

  const gridSheet = XLSX.utils.aoa_to_sheet(gridData)

  // Style header row
  const gridRange = XLSX.utils.decode_range(gridSheet['!ref'] || 'A1:A1')
  for (let C = gridRange.s.c; C <= gridRange.e.c; C++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: C })
    if (gridSheet[cellAddress]) {
      gridSheet[cellAddress].s = {
        font: { bold: true },
        fill: { fgColor: { rgb: 'CCCCCC' } }
      }
    }
  }

  XLSX.utils.book_append_sheet(workbook, gridSheet, 'Dispatch Grid')

  // Download
  const filename = `dispatch_plan_${plan.plan_date}_${plan.brand}.xlsx`
  XLSX.writeFile(workbook, filename)
}

export function exportDispatchPlanPdf(data) {
  const { plan, materials, outlets, quantities, session } = data

  const doc = new jsPDF('landscape', 'mm', 'a4')
  let yPos = 14

  const brandStr = plan.brand ? plan.brand.replace(/_/g, ' ').toUpperCase() : 'N/A'
  const genStr =
    formatDateTimeDdMmYyyyHm(new Date()) || new Date().toLocaleString()
  const planDateStr = formatPlanDateDdMmYyyy(plan.plan_date)
  const lockedStr = plan.locked_at
    ? formatDateTimeDdMmYyyyHm(plan.locked_at) || ''
    : ''

  doc.setFontSize(11)
  doc.setFont(undefined, 'bold')
  doc.text('Dispatch Plan Details', 20, yPos)
  yPos += 5

  doc.setFont(undefined, 'normal')
  doc.setFontSize(9)
  const lineGap = 4.2
  doc.text(`Gastronomix · Generated ${genStr}`, 20, yPos)
  yPos += lineGap
  doc.text(
    `Kitchen: ${session?.cloud_kitchen_name || 'N/A'} · Brand: ${brandStr} · Plan date: ${planDateStr}`,
    20,
    yPos
  )
  yPos += lineGap
  if (lockedStr) {
    doc.text(`Locked at: ${lockedStr}`, 20, yPos)
    yPos += lineGap
  }
  if (plan.notes) {
    const notesLine =
      plan.notes.length > 120 ? `${plan.notes.slice(0, 117)}…` : plan.notes
    doc.text(`Notes: ${notesLine}`, 20, yPos)
    yPos += lineGap
  }
  yPos += 2

  // Dispatch Grid Table
  const gridHeaders = ['Material', 'Code', 'Unit', ...outlets.map(o => o.code), 'Total']
  const gridBody = []

  materials.forEach(material => {
    const row = [
      material.name || 'N/A',
      material.code || 'N/A',
      material.unit || 'N/A'
    ]

    let rowTotal = 0
    outlets.forEach(outlet => {
      const qty = quantities[material.id]?.[outlet.id] || 0
      row.push(qty.toFixed(2))
      rowTotal += qty
    })
    row.push(rowTotal.toFixed(2))

    gridBody.push(row)
  })

  autoTable(doc, {
    startY: yPos,
    head: [gridHeaders],
    body: gridBody,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [66, 66, 66], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 20 },
      2: { cellWidth: 15 }
    },
    margin: { left: 20, right: 20 }
  })

  yPos = doc.lastAutoTable.finalY + 10

  // Totals by Material Type — always on page 2
  doc.addPage()
  yPos = 20

  doc.setFont(undefined, 'bold')
  doc.setFontSize(12)
  doc.text('Totals by Material Type', 20, yPos)
  yPos += 8

  const typeGroups = {}
  materials.forEach(material => {
    const type = material.material_type || 'unknown'
    if (!typeGroups[type]) {
      typeGroups[type] = []
    }
    let materialTotal = 0
    outlets.forEach(outlet => {
      materialTotal += quantities[material.id]?.[outlet.id] || 0
    })
    typeGroups[type].push({
      name: material.name,
      code: material.code,
      unit: material.unit,
      total: materialTotal
    })
  })

  const typeTotalsBody = []
  const orderedTypes = ['finished', 'semi_finished', 'raw_material']
  
  orderedTypes.forEach(type => {
    if (typeGroups[type]) {
      const label = MATERIAL_TYPE_LABELS[type] || type.replace(/_/g, ' ')
      typeTotalsBody.push([{ content: label.toUpperCase(), colSpan: 4, styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } }])
      
      typeGroups[type].forEach(item => {
        typeTotalsBody.push([
          item.name || 'N/A',
          item.code || 'N/A',
          item.unit || 'N/A',
          item.total.toFixed(2)
        ])
      })

      const typeTotal = typeGroups[type].reduce((sum, item) => sum + item.total, 0)
      typeTotalsBody.push([
        { content: 'Subtotal:', colSpan: 3, styles: { fontStyle: 'bold', halign: 'right' } },
        { content: typeTotal.toFixed(2), styles: { fontStyle: 'bold' } }
      ])
    }
  })

  autoTable(doc, {
    startY: yPos,
    head: [['Material Name', 'Code', 'Unit', 'Total Quantity']],
    body: typeTotalsBody,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [66, 66, 66], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 30 },
      2: { cellWidth: 20 },
      3: { cellWidth: 30, halign: 'right' }
    },
    margin: { left: 20, right: 20 }
  })

  // Save
  const filename = `dispatch_plan_${plan.plan_date}_${plan.brand}.pdf`
  doc.save(filename)
}
