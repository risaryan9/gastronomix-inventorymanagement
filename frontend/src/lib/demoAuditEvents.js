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
      notes: 'Sent to Central Store CK2',
      outlet_id: null,
      allocation_request_id: null,
      items: [
        { name: 'Whole Chicken Without Skin', unit: 'kg', quantity: '22', raw_material_id: MATERIAL.CHICKEN },
        { name: 'Eggs', unit: 'nos', quantity: '360', raw_material_id: MATERIAL.EGGS },
      ],
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

/* ================================================================== *
 * Requisitions & Stock Out
 *
 * Packing (`requisition_packed`) and self stock-outs (`stock_out`) have real
 * events already, so nothing is invented for them. These cover the five types
 * that have never fired.
 * ================================================================== */

const OUTLET = {
  INDIRANAGAR: { id: '55ac3afb-7df3-4c4d-a498-c405ae94e2dd', name: 'Boom Pizza - Indiranagar' },
  HSR: { id: '480ce943-4812-4a36-8552-a9138f982d68', name: 'Boom Pizza - HSR' },
  JAYANAGAR: { id: 'daff0dfe-fc1d-4d4e-b8d7-f3f3a7864987', name: 'Boom Pizza - Jayanagar' },
  BTM: { id: '16ab2d15-7a0e-4569-ac1f-dc53d5ad1a49', name: 'Boom Pizza - BTM Layout' },
}

const SUPERVISOR_CK2 = {
  id: '5f8c3a9d-1e24-4c7b-bd0e-6a2f1c9e4b54',
  full_name: 'Supervisor (CK2)',
  role: 'supervisor',
  email: null,
}

const req = (rawMaterialId, quantity) => ({ raw_material_id: rawMaterialId, quantity })

// An edit and the line it dropped are one action by the user, so they share a
// correlation id exactly as the real flow does.
const EDIT_CORRELATION = 'demo-corr-9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d'

const hsrBefore = [
  req(MATERIAL.ONION, 25),
  req(MATERIAL.TOMATO, 18),
  req(MATERIAL.CHICKEN, 12),
  req(MATERIAL.GELATO_CUP, 300),
]
const hsrAfter = [
  req(MATERIAL.ONION, 25),
  req(MATERIAL.TOMATO, 30),
  req(MATERIAL.CHICKEN, 9),
  req(MATERIAL.CHILLI, 2),
]

const cancelledItems = [
  { raw_material_id: MATERIAL.ONION, quantity: 40 },
  { raw_material_id: MATERIAL.SPINACH, quantity: 12 },
  { raw_material_id: MATERIAL.CELLO_TAPE, quantity: 25 },
]

DEMO_AUDIT_EVENTS.push(
  /* ---------------- E1 — requisition raised ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0101',
    actor_user_id: SUPERVISOR_CK2.id,
    actor_role: 'supervisor',
    actor: SUPERVISOR_CK2,
    cloud_kitchen_id: KITCHEN.CK2.id,
    cloud_kitchen: KITCHEN.CK2,
    outlet_id: OUTLET.INDIRANAGAR.id,
    outlet: OUTLET.INDIRANAGAR,
    category: 'requisition',
    action: 'requisition_created',
    entity_type: 'allocation_request',
    entity_id: 'demo-req-0101',
    correlation_id: null,
    reversed_event_id: null,
    severity: 'review',
    old_values: null,
    new_values: {
      request_date: new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10),
      supervisor_name: 'Ravi Kumar',
      item_count: 5,
      items: [
        req(MATERIAL.ONION, 30),
        req(MATERIAL.TOMATO, 22),
        req(MATERIAL.CHICKEN, 15),
        req(MATERIAL.GELATO_CUP, 400),
        req(MATERIAL.WATER, 96),
      ],
    },
    ip_address: '106.51.72.204',
    user_agent: UA_ANDROID,
    session_id: null,
    created_at: hoursAgo(5),
  },

  /* ---------------- E2 — requisition edited ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0102',
    actor_user_id: SUPERVISOR_CK2.id,
    actor_role: 'supervisor',
    actor: SUPERVISOR_CK2,
    cloud_kitchen_id: KITCHEN.CK2.id,
    cloud_kitchen: KITCHEN.CK2,
    outlet_id: OUTLET.HSR.id,
    outlet: OUTLET.HSR,
    category: 'requisition',
    action: 'requisition_updated',
    entity_type: 'allocation_request',
    entity_id: 'demo-req-0102',
    correlation_id: EDIT_CORRELATION,
    reversed_event_id: null,
    severity: 'review',
    old_values: { supervisor_name: 'Meera Nair', items: hsrBefore },
    new_values: {
      supervisor_name: 'Meera Nair',
      items: hsrAfter,
      items_deleted: 1,
      items_updated: 2,
      items_inserted: 1,
    },
    ip_address: '106.51.72.204',
    user_agent: UA_ANDROID,
    session_id: null,
    created_at: hoursAgo(11),
  },

  /* ---------------- E3 — lines removed (critical) ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0103',
    actor_user_id: SUPERVISOR_CK2.id,
    actor_role: 'supervisor',
    actor: SUPERVISOR_CK2,
    cloud_kitchen_id: KITCHEN.CK2.id,
    cloud_kitchen: KITCHEN.CK2,
    outlet_id: OUTLET.HSR.id,
    outlet: OUTLET.HSR,
    category: 'reversal',
    action: 'requisition_items_deleted',
    entity_type: 'allocation_request',
    entity_id: 'demo-req-0102',
    correlation_id: EDIT_CORRELATION,
    reversed_event_id: null,
    severity: 'critical',
    old_values: {
      deleted_items: [req(MATERIAL.GELATO_CUP, 300)],
      items_before: hsrBefore,
    },
    new_values: { deleted_count: 1, items_after: hsrAfter },
    ip_address: '106.51.72.204',
    user_agent: UA_ANDROID,
    session_id: null,
    created_at: hoursAgo(11),
  },

  /* ---------------- E4 — purchase manager adds lines ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0104',
    actor_user_id: ACTOR.PM2.id,
    actor_role: 'purchase_manager',
    actor: ACTOR.PM2,
    cloud_kitchen_id: KITCHEN.CK2.id,
    cloud_kitchen: KITCHEN.CK2,
    outlet_id: OUTLET.JAYANAGAR.id,
    outlet: OUTLET.JAYANAGAR,
    category: 'requisition',
    action: 'requisition_items_added_by_pm',
    entity_type: 'allocation_request',
    entity_id: 'demo-req-0104',
    correlation_id: null,
    reversed_event_id: null,
    severity: 'review',
    old_values: null,
    new_values: {
      added_by_purchase_manager: true,
      requested_by: SUPERVISOR_CK2.id,
      supervisor_name: 'Arun Prasad',
      added_count: 2,
      added_items: [req(MATERIAL.CELLO_TAPE, 20), req(MATERIAL.SPRING_CAP, 6)],
    },
    ip_address: '106.51.72.204',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(28),
  },

  /* ---------------- D4 — packing cancelled (critical) ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0105',
    actor_user_id: ACTOR.PM2.id,
    actor_role: 'purchase_manager',
    actor: ACTOR.PM2,
    cloud_kitchen_id: KITCHEN.CK2.id,
    cloud_kitchen: KITCHEN.CK2,
    outlet_id: OUTLET.BTM.id,
    outlet: OUTLET.BTM,
    category: 'reversal',
    action: 'requisition_packing_cancelled',
    entity_type: 'stock_out',
    entity_id: 'demo-stockout-0105',
    correlation_id: null,
    reversed_event_id: null,
    severity: 'critical',
    old_values: {
      stock_out: { id: 'demo-stockout-0105', outlet_id: OUTLET.BTM.id },
      items: cancelledItems,
      consumption: [],
    },
    new_values: {
      allocation_request_id: 'demo-req-0105',
      restored_batch_rows: 4,
      restored_qty: 77,
    },
    ip_address: '106.51.72.204',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(47),
  }
)

/* ================================================================== *
 * Dispatch & Checkout
 *
 * Nothing has ever been recorded for any of these seven types, so all of
 * them are examples.
 * ================================================================== */

const EC_OUTLET = {
  EC1026: { id: '16120f1e-fa85-418e-a40c-bb0b51e8c315', name: 'El Chaapo EC1026' },
  EC1079: { id: 'b22186b4-9641-448b-8a18-4ebcff83dc1a', name: 'El Chaapo EC1079' },
  EC1089: { id: 'a2c3bc24-1d64-4492-bef6-a748485c3a38', name: 'El Chaapo EC1089' },
}

const DISPATCH_EXEC = {
  id: 'demo-user-dispatch-exec',
  full_name: 'Dispatch Executive (CK2)',
  role: 'dispatch_executive',
  email: null,
}

const KITCHEN_EXEC = {
  id: 'demo-user-kitchen-exec',
  full_name: 'Kitchen Executive (CK2)',
  role: 'kitchen_executive',
  email: null,
}

const planLine = (rawMaterialId, outletId, quantity) => ({
  raw_material_id: rawMaterialId,
  outlet_id: outletId,
  quantity,
})

const PLAN_ID = 'demo-plan-0201'
const PLAN_DATE = new Date(Date.now() - 30 * 3600_000).toISOString().slice(0, 10)

// v1 of the plan, the revision that replaced it, and what the kitchen actually
// locked — three versions of the same day so the chain is visible.
const planV1 = [
  planLine(MATERIAL.MARINADE, EC_OUTLET.EC1026.id, 6),
  planLine(MATERIAL.CHICKEN, EC_OUTLET.EC1026.id, 14),
  planLine(MATERIAL.MARINADE, EC_OUTLET.EC1079.id, 4),
  planLine(MATERIAL.CHICKEN, EC_OUTLET.EC1079.id, 9),
  planLine(MATERIAL.GARLIC_BUTTER, EC_OUTLET.EC1089.id, 20),
]

const planV2 = [
  planLine(MATERIAL.MARINADE, EC_OUTLET.EC1026.id, 8),
  planLine(MATERIAL.CHICKEN, EC_OUTLET.EC1026.id, 14),
  planLine(MATERIAL.MARINADE, EC_OUTLET.EC1079.id, 4),
  planLine(MATERIAL.CHICKEN, EC_OUTLET.EC1079.id, 12),
  planLine(MATERIAL.GARLIC_BUTTER, EC_OUTLET.EC1089.id, 20),
  planLine(MATERIAL.CHILLI, EC_OUTLET.EC1089.id, 1.5),
]

const planLocked = [
  planLine(MATERIAL.MARINADE, EC_OUTLET.EC1026.id, 8),
  planLine(MATERIAL.CHICKEN, EC_OUTLET.EC1026.id, 11),
  planLine(MATERIAL.MARINADE, EC_OUTLET.EC1079.id, 4),
  planLine(MATERIAL.CHICKEN, EC_OUTLET.EC1079.id, 12),
  planLine(MATERIAL.GARLIC_BUTTER, EC_OUTLET.EC1089.id, 20),
  planLine(MATERIAL.CHILLI, EC_OUTLET.EC1089.id, 1.5),
]

const CLOSING_FORM_ID = 'demo-checkout-0207'

const returnLine = (rawMaterialId, dispatched, returned) => ({
  raw_material_id: rawMaterialId,
  dispatched_quantity: dispatched,
  returned_quantity: returned,
})

const wastageLine = (rawMaterialId, dispatched, wasted) => ({
  raw_material_id: rawMaterialId,
  dispatched_quantity: dispatched,
  wasted_quantity: wasted,
})

DEMO_AUDIT_EVENTS.push(
  /* ---------------- G1 — plan created ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0201',
    actor_user_id: DISPATCH_EXEC.id,
    actor_role: 'dispatch_executive',
    actor: DISPATCH_EXEC,
    cloud_kitchen_id: KITCHEN.CK2.id,
    cloud_kitchen: KITCHEN.CK2,
    outlet_id: null,
    outlet: null,
    category: 'dispatch_plan',
    action: 'dispatch_plan_created',
    entity_type: 'dispatch_plan',
    entity_id: PLAN_ID,
    correlation_id: null,
    reversed_event_id: null,
    severity: 'review',
    old_values: null,
    new_values: {
      plan_date: PLAN_DATE,
      brand: 'el_chaapo',
      status: 'draft',
      item_count: planV1.length,
      items: planV1,
    },
    ip_address: '106.51.72.204',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(30),
  },

  /* ---------------- G1 — plan revised ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0202',
    actor_user_id: DISPATCH_EXEC.id,
    actor_role: 'dispatch_executive',
    actor: DISPATCH_EXEC,
    cloud_kitchen_id: KITCHEN.CK2.id,
    cloud_kitchen: KITCHEN.CK2,
    outlet_id: null,
    outlet: null,
    category: 'dispatch_plan',
    action: 'dispatch_plan_updated',
    entity_type: 'dispatch_plan',
    entity_id: PLAN_ID,
    correlation_id: PLAN_ID,
    reversed_event_id: null,
    severity: 'review',
    old_values: { items: planV1 },
    new_values: {
      plan_date: PLAN_DATE,
      brand: 'el_chaapo',
      status: 'draft',
      item_count: planV2.length,
      items: planV2,
    },
    ip_address: '106.51.72.204',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(27),
  },

  /* ---------------- G2 — previous plan discarded (critical) ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0203',
    actor_user_id: DISPATCH_EXEC.id,
    actor_role: 'dispatch_executive',
    actor: DISPATCH_EXEC,
    cloud_kitchen_id: KITCHEN.CK2.id,
    cloud_kitchen: KITCHEN.CK2,
    outlet_id: null,
    outlet: null,
    category: 'reversal',
    action: 'dispatch_plan_items_replaced',
    entity_type: 'dispatch_plan',
    entity_id: PLAN_ID,
    correlation_id: PLAN_ID,
    reversed_event_id: 'demo-evt-0201',
    severity: 'critical',
    old_values: { replaced_items: planV1, replaced_count: planV1.length },
    new_values: { items: planV2, item_count: planV2.length },
    ip_address: '106.51.72.204',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(27),
  },

  /* ---------------- H1 — plan locked, kitchen cut a quantity ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0204',
    actor_user_id: KITCHEN_EXEC.id,
    actor_role: 'kitchen_executive',
    actor: KITCHEN_EXEC,
    cloud_kitchen_id: KITCHEN.CK2.id,
    cloud_kitchen: KITCHEN.CK2,
    outlet_id: null,
    outlet: null,
    category: 'dispatch_plan',
    action: 'dispatch_plan_locked',
    entity_type: 'dispatch_plan',
    entity_id: PLAN_ID,
    correlation_id: PLAN_ID,
    reversed_event_id: null,
    severity: 'review',
    old_values: { status: 'draft', items: planV2 },
    new_values: {
      status: 'locked',
      locked_by: KITCHEN_EXEC.id,
      plan_date: PLAN_DATE,
      brand: 'el_chaapo',
      items: planLocked,
      item_count: planLocked.length,
      items_replaced: planV2.length,
      quantities_changed_by_kitchen: true,
    },
    ip_address: '157.51.19.88',
    user_agent: UA_CHROME,
    session_id: null,
    created_at: hoursAgo(24),
  },

  /* ---------------- F1 — closing sheet started ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0205',
    actor_user_id: SUPERVISOR_CK2.id,
    actor_role: 'supervisor',
    actor: SUPERVISOR_CK2,
    cloud_kitchen_id: KITCHEN.CK2.id,
    cloud_kitchen: KITCHEN.CK2,
    outlet_id: EC_OUTLET.EC1026.id,
    outlet: EC_OUTLET.EC1026,
    category: 'checkout',
    action: 'checkout_draft_created',
    entity_type: 'checkout_form',
    entity_id: CLOSING_FORM_ID,
    correlation_id: CLOSING_FORM_ID,
    reversed_event_id: null,
    severity: 'review',
    old_values: null,
    new_values: {
      supervisor_name: 'Meera Nair',
      operator_id: null,
      dispatch_plan_id: PLAN_ID,
      return_count: 2,
      wastage_count: 1,
      returns: [returnLine(MATERIAL.MARINADE, 8, 1.5), returnLine(MATERIAL.CHICKEN, 11, 2)],
      wastage: [wastageLine(MATERIAL.CHICKEN, 11, 0.5)],
      additional: { cash: 0, payment_onside: 0 },
    },
    ip_address: '106.51.72.204',
    user_agent: UA_ANDROID,
    session_id: null,
    created_at: hoursAgo(15),
  },

  /* ---------------- F1 — closing sheet saved again, wastage grew ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0206',
    actor_user_id: SUPERVISOR_CK2.id,
    actor_role: 'supervisor',
    actor: SUPERVISOR_CK2,
    cloud_kitchen_id: KITCHEN.CK2.id,
    cloud_kitchen: KITCHEN.CK2,
    outlet_id: EC_OUTLET.EC1026.id,
    outlet: EC_OUTLET.EC1026,
    category: 'checkout',
    action: 'checkout_draft_updated',
    entity_type: 'checkout_form',
    entity_id: CLOSING_FORM_ID,
    correlation_id: CLOSING_FORM_ID,
    reversed_event_id: null,
    severity: 'review',
    old_values: {
      supervisor_name: 'Meera Nair',
      operator_id: null,
      returns: [returnLine(MATERIAL.MARINADE, 8, 1.5), returnLine(MATERIAL.CHICKEN, 11, 2)],
      wastage: [wastageLine(MATERIAL.CHICKEN, 11, 0.5)],
      additional: { cash: 0, payment_onside: 0 },
    },
    new_values: {
      supervisor_name: 'Meera Nair',
      operator_id: null,
      dispatch_plan_id: PLAN_ID,
      return_count: 1,
      wastage_count: 2,
      returns: [returnLine(MATERIAL.MARINADE, 8, 1.5)],
      wastage: [wastageLine(MATERIAL.CHICKEN, 11, 2.5), wastageLine(MATERIAL.CHILLI, 1.5, 0.2)],
      additional: { cash: 450, payment_onside: 0 },
    },
    ip_address: '106.51.72.204',
    user_agent: UA_ANDROID,
    session_id: null,
    created_at: hoursAgo(14),
  },

  /* ---------------- F2 — closing confirmed ---------------- */
  {
    __demo: true,
    id: 'demo-evt-0207',
    actor_user_id: SUPERVISOR_CK2.id,
    actor_role: 'supervisor',
    actor: SUPERVISOR_CK2,
    cloud_kitchen_id: KITCHEN.CK2.id,
    cloud_kitchen: KITCHEN.CK2,
    // Faithful to the real function, which sets neither of these — see the
    // note in AuditDispatchCheckout.jsx. A confirmed closing therefore cannot
    // currently be tied back to the draft saves it came from, or filtered by
    // outlet.
    outlet_id: null,
    outlet: null,
    category: 'checkout',
    action: 'checkout_confirmed',
    entity_type: 'checkout_form',
    entity_id: CLOSING_FORM_ID,
    correlation_id: null,
    reversed_event_id: null,
    severity: 'review',
    old_values: { status: 'submitted', checkout_form_id: CLOSING_FORM_ID },
    new_values: {
      status: 'confirmed',
      stock_in_id: 'demo-stockin-0207',
      total_returned_qty: 1.5,
      confirmed_at: hoursAgo(13),
    },
    ip_address: '106.51.72.204',
    user_agent: UA_ANDROID,
    session_id: null,
    created_at: hoursAgo(13),
  }
)

/** Events this subsection lists. Excludes rows that exist only for linkage. */
export const demoSubsectionEvents = () => DEMO_AUDIT_EVENTS.filter((event) => !event.__demoOutOfScope)

/** Correlation siblings for a demo event, including out-of-subsection legs. */
export const demoCorrelatedEvents = (correlationId, excludeEventId) =>
  DEMO_AUDIT_EVENTS.filter(
    (event) => event.correlation_id === correlationId && event.id !== excludeEventId
  )
