const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

export const STOCK_IN_DRAFT_TTL_MS = DRAFT_TTL_MS

function storageKey(cloudKitchenId) {
  return `gastronomix_stock_in_draft_${cloudKitchenId}`
}

function serializeItem(item) {
  const m = item.material
  return {
    id: item.id,
    raw_material_id: item.raw_material_id,
    material: m
      ? {
          id: m.id,
          name: m.name,
          code: m.code,
          unit: m.unit,
          category: m.category,
          material_type: m.material_type
        }
      : null,
    quantity: item.quantity,
    unit_cost: item.unit_cost,
    previous_cost: item.previous_cost,
    gst_percent: item.gst_percent,
    total_cost: item.total_cost
  }
}

/**
 * True if the slip has anything worth restoring (avoids empty drafts).
 */
export function draftHasMeaningfulContent({ purchaseSlip, purchaseItems }) {
  const slip = purchaseSlip || {}
  if ((slip.supplier_name || '').trim()) return true
  if ((slip.invoice_number || '').trim()) return true
  if ((slip.notes || '').trim()) return true
  for (const row of purchaseItems || []) {
    if (row.raw_material_id) return true
    const q = row.quantity
    if (q !== '' && q != null && !Number.isNaN(parseFloat(q)) && parseFloat(q) !== 0) return true
    const uc = row.unit_cost
    if (uc != null && uc !== '' && parseFloat(uc) > 0) return true
  }
  return false
}

export function loadStockInDraft(cloudKitchenId) {
  if (!cloudKitchenId || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(storageKey(cloudKitchenId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const savedAt = parsed.savedAt
    if (typeof savedAt !== 'number' || Date.now() - savedAt > DRAFT_TTL_MS) {
      localStorage.removeItem(storageKey(cloudKitchenId))
      return null
    }
    if (!parsed.purchaseSlip || !Array.isArray(parsed.purchaseItems)) {
      localStorage.removeItem(storageKey(cloudKitchenId))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function saveStockInDraft(cloudKitchenId, { stockInType, purchaseSlip, purchaseItems }) {
  if (!cloudKitchenId || typeof localStorage === 'undefined') return
  if (!draftHasMeaningfulContent({ purchaseSlip, purchaseItems })) return
  try {
    const payload = {
      savedAt: Date.now(),
      stockInType: stockInType === 'kitchen' ? 'kitchen' : 'purchase',
      purchaseSlip: { ...purchaseSlip },
      purchaseItems: (purchaseItems || []).map(serializeItem)
    }
    localStorage.setItem(storageKey(cloudKitchenId), JSON.stringify(payload))
  } catch (e) {
    console.warn('Could not save stock-in draft:', e)
  }
}

export function clearStockInDraft(cloudKitchenId) {
  if (!cloudKitchenId || typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(storageKey(cloudKitchenId))
  } catch {
    /* ignore */
  }
}

export function formatDraftAge(savedAt) {
  if (typeof savedAt !== 'number') return ''
  const sec = Math.floor((Date.now() - savedAt) / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} hr ago`
  const d = Math.floor(h / 24)
  return `${d} day(s) ago`
}
