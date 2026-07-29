// ⚠️ TEMPORARY — DELETE THIS FILE WHEN THE AUDIT SUBSECTIONS ARE SIGNED OFF.
//
// docs/AUDIT_TRAIL_REQUIREMENTS.md catalogues twenty audited action points, but
// most of them have never actually fired in this database yet. At the time of
// writing `audit_events` holds only `auth` and `inventory_out` rows — nothing
// at all for `inventory_in` or `catalog` — so the Inventory & Catalog
// subsection would render an empty page and none of its layouts could be
// judged.
//
// These rows exist ONLY to make the UI reviewable. They are:
//   * held in the frontend, never written to `audit_events`. An audit trail is
//     a contemporaneous record; §3.D3 and §6.5 both refuse to backfill it, and
//     seeding invented rows into the real table would be the same mistake.
//   * marked `__demo: true`, which the UI renders as a visible DEMO badge, so
//     nothing on screen can be mistaken for a real event.
//   * shaped exactly like the payloads the RPCs actually write, so the
//     rendering they exercise is the rendering real events will get.
//
// TO REMOVE: delete this file and the `demoAuditEvents` import + merge in
// pages/admin/audits/AuditInventoryCatalog.jsx. Nothing else references it.

const hoursAgo = (hours) => new Date(Date.now() - hours * 3600_000).toISOString()

const KITCHEN = {
  CK1: { id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', name: 'Cloud Kitchen CK1' },
  CK2: { id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', name: 'Central Store CK2' },
  CK3: { id: 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f', name: 'Cloud Kitchen CK3' },
}

const ACTOR = {
  PM1: { id: '2b6c8f14-91b4-4a67-8d5a-3f6e2c9a1b21', full_name: 'Purchase Manager (CK1)', role: 'purchase_manager', email: null },
  PM2: { id: '4e1a7b2d-3c84-4a6f-9e15-0b8c2d9f6a43', full_name: 'Purchase Manager (CK2)', role: 'purchase_manager', email: null },
  PM3: { id: '6a4b9c1e-2d35-4f8a-91c7-0e5d2b3a6f65', full_name: 'Purchase Manager (CK3)', role: 'purchase_manager', email: null },
  ADMIN: { id: '4565b86c-5c2b-437f-aea7-bd3adb70d07d', full_name: 'Admin User', role: 'admin', email: null },
}

// Real raw_materials ids, so the material-name lookup resolves exactly as it
// will for genuine events.
const MATERIAL = {
  HALDI: '6307e67d-aad9-461c-9e7e-32ab72a74a00',
  TOMATO: '0cd04d14-7039-437f-86d8-602490734c63',
  ONION: '66c3e355-cb85-4723-91df-6c3ffd3a7249',
  WATER: '3582e721-fdcf-4aee-bd5d-d6c1004897e6',
  SPRING_CAP: 'e9be0a2d-9d9c-436b-9ceb-95fedaa29496',
  EGGS: 'd5595af6-c0ad-4eb7-a4b0-d9a2ee782704',
  SPINACH: '8a76edc3-247b-4864-8adf-d7c22733bad0',
  CHICKEN: 'c0287b0c-44e2-4eb8-ab03-69cb3bb650fe',
  CHILLI: '441901e2-8bed-47b1-8554-a1cdae129c0a',
  GARLIC_BUTTER: '0a304d73-c05f-4bcb-a8a9-7ad92940d767',
  GELATO_CUP: '25456a5f-fb39-4327-b4cf-52e2b5b3d8e9',
  CELLO_TAPE: '29b73d0d-8c6b-421e-87a7-e6b342756f2e',
  MARINADE: '6e6e6ac0-a655-4457-a65a-c8ba189fbd3d',
}

const UA_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; RMX3771) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36'

const line = (rawMaterialId, quantity, unitCost, gstPercent) => ({
  raw_material_id: rawMaterialId,
  quantity,
  unit_cost: unitCost,
  gst_percent: gstPercent,
  line_total: Number((quantity * unitCost * (1 + gstPercent / 100)).toFixed(2)),
})

const sum = (items) => Number(items.reduce((total, item) => total + item.line_total, 0).toFixed(2))

// The two legs of the inter-cloud transfer share this id, exactly as the real
// flow does: both derive correlation_id from the source stock_out's id.
const TRANSFER_CORRELATION = 'demo-corr-1f2e3d4c-5b6a-7988-9a0b-1c2d3e4f5a6b'

const stockInItems = [
  line(MATERIAL.ONION, 120, 32.5, 0),
  line(MATERIAL.TOMATO, 80, 41, 0),
  line(MATERIAL.CHICKEN, 45, 218, 0),
  line(MATERIAL.HALDI, 12, 265, 5),
  line(MATERIAL.CHILLI, 8, 310, 5),
]

const packagingItems = [
  line(MATERIAL.GELATO_CUP, 2000, 4.2, 18),
  line(MATERIAL.SPRING_CAP, 60, 145, 18),
  line(MATERIAL.CELLO_TAPE, 150, 22, 18),
]

const kitchenItems = [
  line(MATERIAL.MARINADE, 18, 186.4, 0),
  line(MATERIAL.GARLIC_BUTTER, 40, 62.75, 0),
]

const transferItems = [
  { raw_material_id: MATERIAL.CHICKEN, quantity: 22, unit_cost: 218, source_cost: 4796 },
  { raw_material_id: MATERIAL.EGGS, quantity: 360, unit_cost: 6.4, source_cost: 2304 },
]

export const DEMO_AUDIT_EVENTS = [
  /* ---------------- B1 — stock-in finalize (purchase) ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0001',
    actor_user_id: ACTOR.PM1.id,
    actor_role: 'purchase_manager',
    actor: ACTOR.PM1,
    cloud_kitchen_id: KITCHEN.CK1.id,
    cloud_kitchen: KITCHEN.CK1,
    outlet_id: null,
    category: 'inventory_in',
    action: 'stock_in_received',
    entity_type: 'stock_in',
    entity_id: 'demo-stockin-0001',
    correlation_id: null,
    reversed_event_id: null,
    severity: 'review',
    old_values: null,
    new_values: {
      stock_in_type: 'purchase',
      receipt_date: new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10),
      supplier_name: 'Sri Balaji Fresh Traders',
      invoice_number: 'SBF/2026-27/1184',
      invoice_image_url: 'https://example.invalid/storage/invoices/demo-sbf-1184.jpg',
      total_cost: sum(stockInItems),
      item_count: stockInItems.length,
      items: stockInItems,
    },
    ip_address: '103.21.244.17',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(3),
  },

  /* ---------------- C3 — deactivate (critical) ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0002',
    actor_user_id: ACTOR.ADMIN.id,
    actor_role: 'admin',
    actor: ACTOR.ADMIN,
    cloud_kitchen_id: null,
    cloud_kitchen: null,
    outlet_id: null,
    category: 'catalog',
    action: 'deactivate',
    entity_type: 'raw_material',
    entity_id: MATERIAL.WATER,
    correlation_id: null,
    reversed_event_id: null,
    severity: 'critical',
    old_values: { is_active: true, name: 'Water Bottle (500 Ml)', code: 'FF-011', unit: 'nos' },
    new_values: { is_active: false, name: 'Water Bottle (500 Ml)', code: 'FF-011', unit: 'nos' },
    ip_address: '49.207.183.92',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(7),
  },

  /* ---------------- B2 — manual decrement (short-filled) ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0003',
    actor_user_id: ACTOR.PM1.id,
    actor_role: 'purchase_manager',
    actor: ACTOR.PM1,
    cloud_kitchen_id: KITCHEN.CK1.id,
    cloud_kitchen: KITCHEN.CK1,
    outlet_id: null,
    category: 'inventory_out',
    action: 'inventory_decrement',
    entity_type: 'inventory',
    entity_id: 'demo-inv-0003',
    correlation_id: null,
    reversed_event_id: null,
    severity: 'review',
    old_values: {
      quantity: 46.5,
      raw_material_id: MATERIAL.SPINACH,
      cloud_kitchen_id: KITCHEN.CK1.id,
      reason: 'Physical count correction',
      details: 'Cold room count showed 38 kg against 46.5 kg on system. Wilted stock discarded before the count.',
      adjustment_type: 'decrement',
      adjustment_amount: 8.5,
      stock_in_id: null,
      stock_out_id: 'demo-stockout-0003',
    },
    new_values: {
      quantity: 38,
      raw_material_id: MATERIAL.SPINACH,
      cloud_kitchen_id: KITCHEN.CK1.id,
      // FIFO could only consume 7.2 of the 8.5 requested — the batches ran out.
      actual_new_quantity: 39.3,
      stock_in_id: null,
      stock_out_id: 'demo-stockout-0003',
    },
    ip_address: '103.21.244.17',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(9),
  },

  /* ---------------- D3 — inter-cloud transfer, destination leg ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0004',
    actor_user_id: ACTOR.PM2.id,
    actor_role: 'purchase_manager',
    actor: ACTOR.PM2,
    cloud_kitchen_id: KITCHEN.CK2.id,
    cloud_kitchen: KITCHEN.CK2,
    outlet_id: null,
    category: 'inventory_in',
    action: 'inter_cloud_transfer_received',
    entity_type: 'stock_in',
    entity_id: 'demo-stockin-0004',
    correlation_id: TRANSFER_CORRELATION,
    reversed_event_id: null,
    severity: 'review',
    old_values: null,
    new_values: {
      source_cloud_kitchen_id: KITCHEN.CK1.id,
      source_cloud_kitchen_name: KITCHEN.CK1.name,
      source_stock_out_id: TRANSFER_CORRELATION,
      destination_cloud_kitchen_id: KITCHEN.CK2.id,
      total_cost: 7100,
      item_count: transferItems.length,
      items: transferItems,
    },
    ip_address: '106.51.72.204',
    user_agent: UA_ANDROID,
    session_id: null,
    created_at: hoursAgo(21),
  },

  /* -- the matching source leg. Belongs to Requisitions & Stock Out, so it is
        filtered out of this list — it exists here purely so the destination
        leg's correlation link has something real to resolve to. -- */
  {
    __demo: true,
    __demoOutOfScope: true,
    id: 'demo-evt-0004-source',
    actor_user_id: ACTOR.PM1.id,
    actor_role: 'purchase_manager',
    actor: ACTOR.PM1,
    cloud_kitchen_id: KITCHEN.CK1.id,
    cloud_kitchen: KITCHEN.CK1,
    outlet_id: null,
    category: 'inventory_out',
    action: 'stock_out',
    entity_type: 'stock_out',
    entity_id: TRANSFER_CORRELATION,
    correlation_id: TRANSFER_CORRELATION,
    reversed_event_id: null,
    severity: 'review',
    old_values: null,
    new_values: {
      self_stock_out: true,
      reason: 'inter-cloud-kitchen',
      destination_cloud_kitchen_id: KITCHEN.CK2.id,
      item_count: transferItems.length,
      items: transferItems,
    },
    ip_address: '103.21.244.17',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(21.2),
  },

  /* ---------------- C2 — material edited (unit changed) ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0005',
    actor_user_id: ACTOR.ADMIN.id,
    actor_role: 'admin',
    actor: ACTOR.ADMIN,
    cloud_kitchen_id: null,
    cloud_kitchen: null,
    outlet_id: null,
    category: 'catalog',
    action: 'update',
    entity_type: 'raw_material',
    entity_id: MATERIAL.HALDI,
    correlation_id: null,
    reversed_event_id: null,
    severity: 'review',
    old_values: {
      name: 'Haldi Powder',
      code: 'RM-HBSP-020',
      unit: 'kg',
      category: 'Herbs & Spices',
      brand: null,
      description: 'Turmeric powder, bulk pack',
      low_stock_threshold: 5,
      brand_codes: null,
    },
    new_values: {
      name: 'Haldi Powder (Turmeric)',
      code: 'RM-HBSP-020',
      unit: 'g',
      category: 'Herbs & Spices',
      brand: 'Everest',
      description: 'Turmeric powder, bulk pack',
      low_stock_threshold: 5000,
      brand_codes: null,
    },
    ip_address: '49.207.183.92',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(26),
  },

  /* ---------------- B2 — manual increment ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0006',
    actor_user_id: ACTOR.PM3.id,
    actor_role: 'purchase_manager',
    actor: ACTOR.PM3,
    cloud_kitchen_id: KITCHEN.CK3.id,
    cloud_kitchen: KITCHEN.CK3,
    outlet_id: null,
    category: 'inventory_in',
    action: 'inventory_increment',
    entity_type: 'inventory',
    entity_id: 'demo-inv-0006',
    correlation_id: null,
    reversed_event_id: null,
    severity: 'review',
    old_values: {
      quantity: 240,
      raw_material_id: MATERIAL.EGGS,
      cloud_kitchen_id: KITCHEN.CK3.id,
      reason: 'Delivery not recorded in stock-in',
      details: 'Tray of 120 received Saturday evening; invoice raised Monday. Adding to match the physical count.',
      adjustment_type: 'increment',
      adjustment_amount: 120,
      stock_in_id: 'demo-stockin-0006',
      stock_out_id: null,
    },
    new_values: {
      quantity: 360,
      raw_material_id: MATERIAL.EGGS,
      cloud_kitchen_id: KITCHEN.CK3.id,
      actual_new_quantity: 360,
      stock_in_id: 'demo-stockin-0006',
      stock_out_id: null,
    },
    ip_address: '157.51.19.88',
    user_agent: UA_ANDROID,
    session_id: null,
    created_at: hoursAgo(30),
  },

  /* ---------------- B1 — stock-in finalize (packaging, GST) ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0007',
    actor_user_id: ACTOR.PM2.id,
    actor_role: 'purchase_manager',
    actor: ACTOR.PM2,
    cloud_kitchen_id: KITCHEN.CK2.id,
    cloud_kitchen: KITCHEN.CK2,
    outlet_id: null,
    category: 'inventory_in',
    action: 'stock_in_received',
    entity_type: 'stock_in',
    entity_id: 'demo-stockin-0007',
    correlation_id: null,
    reversed_event_id: null,
    severity: 'review',
    old_values: null,
    new_values: {
      stock_in_type: 'purchase',
      receipt_date: new Date(Date.now() - 34 * 3600_000).toISOString().slice(0, 10),
      supplier_name: 'Nova Packaging Solutions',
      invoice_number: 'NPS-8842',
      invoice_image_url: null,
      total_cost: sum(packagingItems),
      item_count: packagingItems.length,
      items: packagingItems,
    },
    ip_address: '106.51.72.204',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(34),
  },

  /* ---------------- C1 — material created ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0008',
    actor_user_id: ACTOR.ADMIN.id,
    actor_role: 'admin',
    actor: ACTOR.ADMIN,
    cloud_kitchen_id: null,
    cloud_kitchen: null,
    outlet_id: null,
    category: 'catalog',
    action: 'create',
    entity_type: 'raw_material',
    entity_id: 'demo-material-0008',
    correlation_id: null,
    reversed_event_id: null,
    severity: 'review',
    old_values: null,
    new_values: {
      name: 'Peri Peri Seasoning',
      code: 'RM-HBSP-061',
      unit: 'kg',
      category: 'Herbs & Spices',
      brand: 'Keya',
      description: 'Dry seasoning blend for wings and fries',
      low_stock_threshold: 2,
      brand_codes: null,
    },
    ip_address: '49.207.183.92',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(52),
  },

  /* ---------------- C3 — reactivate (critical) ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0009',
    actor_user_id: ACTOR.ADMIN.id,
    actor_role: 'admin',
    actor: ACTOR.ADMIN,
    cloud_kitchen_id: null,
    cloud_kitchen: null,
    outlet_id: null,
    category: 'catalog',
    action: 'reactivate',
    entity_type: 'raw_material',
    entity_id: MATERIAL.GARLIC_BUTTER,
    correlation_id: null,
    reversed_event_id: null,
    severity: 'critical',
    old_values: { is_active: false, name: 'Garlic Butter', code: 'SF-018', unit: 'nos' },
    new_values: { is_active: true, name: 'Garlic Butter', code: 'SF-018', unit: 'nos' },
    ip_address: '49.207.183.92',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(74),
  },

  /* ---------------- B1 — stock-in finalize (kitchen production) ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0010',
    actor_user_id: ACTOR.PM1.id,
    actor_role: 'purchase_manager',
    actor: ACTOR.PM1,
    cloud_kitchen_id: KITCHEN.CK1.id,
    cloud_kitchen: KITCHEN.CK1,
    outlet_id: null,
    category: 'inventory_in',
    action: 'stock_in_received',
    entity_type: 'stock_in',
    entity_id: 'demo-stockin-0010',
    correlation_id: null,
    reversed_event_id: null,
    severity: 'review',
    old_values: null,
    new_values: {
      stock_in_type: 'kitchen',
      receipt_date: new Date(Date.now() - 80 * 3600_000).toISOString().slice(0, 10),
      supplier_name: null,
      invoice_number: null,
      invoice_image_url: null,
      total_cost: sum(kitchenItems),
      item_count: kitchenItems.length,
      items: kitchenItems,
    },
    ip_address: '103.21.244.17',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(80),
  },

  /* ---------------- B2 — manual decrement (large write-off) ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0011',
    actor_user_id: ACTOR.PM2.id,
    actor_role: 'purchase_manager',
    actor: ACTOR.PM2,
    cloud_kitchen_id: KITCHEN.CK2.id,
    cloud_kitchen: KITCHEN.CK2,
    outlet_id: null,
    category: 'inventory_out',
    action: 'inventory_decrement',
    entity_type: 'inventory',
    entity_id: 'demo-inv-0011',
    correlation_id: null,
    reversed_event_id: null,
    severity: 'review',
    old_values: {
      quantity: 96,
      raw_material_id: MATERIAL.TOMATO,
      cloud_kitchen_id: KITCHEN.CK2.id,
      reason: 'Damaged in storage',
      details: 'Crate stacked under a leaking chiller line overnight. Photos with the wastage report.',
      adjustment_type: 'decrement',
      adjustment_amount: 34,
      stock_in_id: null,
      stock_out_id: 'demo-stockout-0011',
    },
    new_values: {
      quantity: 62,
      raw_material_id: MATERIAL.TOMATO,
      cloud_kitchen_id: KITCHEN.CK2.id,
      actual_new_quantity: 62,
      stock_in_id: null,
      stock_out_id: 'demo-stockout-0011',
    },
    ip_address: '106.51.72.204',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(101),
  },

  /* ---------------- C2 — material edited (threshold only) ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0012',
    actor_user_id: ACTOR.ADMIN.id,
    actor_role: 'admin',
    actor: ACTOR.ADMIN,
    cloud_kitchen_id: null,
    cloud_kitchen: null,
    outlet_id: null,
    category: 'catalog',
    action: 'update',
    entity_type: 'raw_material',
    entity_id: MATERIAL.ONION,
    correlation_id: null,
    reversed_event_id: null,
    severity: 'review',
    old_values: {
      name: 'Onion',
      code: 'RM-FRVG-031',
      unit: 'kg',
      category: 'Fruits & Vegetables',
      brand: null,
      description: null,
      low_stock_threshold: 20,
      brand_codes: null,
    },
    new_values: {
      name: 'Onion',
      code: 'RM-FRVG-031',
      unit: 'kg',
      category: 'Fruits & Vegetables',
      brand: null,
      description: null,
      low_stock_threshold: 60,
      brand_codes: null,
    },
    ip_address: '49.207.183.92',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(126),
  },
]

/** Events this subsection lists. Excludes rows that exist only for linkage. */
export const demoSubsectionEvents = () => DEMO_AUDIT_EVENTS.filter((event) => !event.__demoOutOfScope)

/** Correlation siblings for a demo event, including out-of-subsection legs. */
export const demoCorrelatedEvents = (correlationId, excludeEventId) =>
  DEMO_AUDIT_EVENTS.filter(
    (event) => event.correlation_id === correlationId && event.id !== excludeEventId
  )
