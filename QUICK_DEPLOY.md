# Quick Deploy - Inventory Sync

## 🚀 3-Step Deployment

### 1️⃣ Database (5 min)
```bash
# In Supabase SQL Editor, run:
migrations/sync-inventory-from-batches-trigger.sql

# Verify:
SELECT * FROM pg_trigger WHERE tgname = 'trigger_sync_inventory_quantity';
```

### 2️⃣ Edge Function (2 min)
```bash
supabase functions deploy adjust-inventory

# Verify:
supabase functions list | grep adjust-inventory
```

### 3️⃣ Frontend (5 min)
```bash
cd frontend
npm run build
# Deploy dist/ to your hosting
```

## ✅ Quick Test

```bash
# Test the edge function works:
curl -X POST \
  'https://YOUR-PROJECT.supabase.co/functions/v1/adjust-inventory' \
  -H 'Authorization: Bearer YOUR_JWT' \
  -H 'Content-Type: application/json' \
  -d '{
    "cloud_kitchen_id": "uuid",
    "raw_material_id": "uuid", 
    "new_quantity": 100,
    "reason": "Test"
  }'
```

## 🔍 Verify Everything Synced

```sql
-- Should return 0 rows:
SELECT 
  rm.name,
  i.quantity AS inv,
  COALESCE(SUM(b.quantity_remaining), 0) AS batches
FROM inventory i
JOIN raw_materials rm ON i.raw_material_id = rm.id
LEFT JOIN stock_in_batches b ON i.cloud_kitchen_id = b.cloud_kitchen_id 
  AND i.raw_material_id = b.raw_material_id
GROUP BY i.id, rm.name, i.quantity
HAVING ABS(i.quantity - COALESCE(SUM(b.quantity_remaining), 0)) > 0.001;
```

## 🎯 What Changed

| File | Change |
|------|--------|
| `StockIn.jsx` | ❌ Removed inventory.quantity updates |
| `StockOut.jsx` | ❌ Removed inventory.quantity updates |
| `Inventory.jsx` | ✅ Now calls edge function |
| Database | ✅ Trigger auto-syncs inventory |

## 📚 Full Docs

- **Deployment Guide:** `INVENTORY_SYNC_DEPLOYMENT.md`
- **Summary:** `INVENTORY_SYNC_SUMMARY.md`
- **Edge Function:** `supabase/functions/adjust-inventory/README.md`

## 🆘 Rollback

```sql
-- Remove trigger:
DROP TRIGGER IF EXISTS trigger_sync_inventory_quantity ON stock_in_batches;
DROP FUNCTION IF EXISTS sync_inventory_quantity_from_batches();
```

```bash
# Undeploy function:
supabase functions delete adjust-inventory

# Revert frontend:
git revert <commit-hash>
```

---

**Time to deploy:** ~15 minutes  
**Risk level:** Low (trigger is read-only on inventory, only writes via batches)  
**Rollback time:** ~5 minutes
