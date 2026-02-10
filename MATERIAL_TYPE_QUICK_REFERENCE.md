# Material Type Quick Reference Card

## 🎯 Quick Overview

| Material Type | Code Format | Category Options | Vendor Required? | Brand Field? |
|--------------|-------------|------------------|------------------|--------------|
| **Raw Material** | `RM-{CAT}-###` | Meat, Grains, Vegetables, Oils, Spices, Dairy, Packaging, Sanitary, Misc | ✅ Yes | ⚪ Optional |
| **Semi-Finished** | `SF-{BRAND}-###` | Boom Pizza, Nippu Kodi, El Chaapo | ❌ No | ❌ No |
| **Finished** | `FF-{BRAND}-###` | Boom Pizza, Nippu Kodi, El Chaapo | ❌ No | ❌ No |

## 📋 Code Prefixes

| Prefix | Meaning | Example |
|--------|---------|---------|
| `RM` | Raw Material | `RM-MEAT-001` |
| `SF` | Semi-Finished | `SF-BM-001` |
| `FF` | Finished | `FF-NK-001` |

## 🏷️ Brand Short Codes

| Brand Name | Short Code | Used In |
|-----------|------------|---------|
| Boom Pizza | `BM` | SF-BM-###, FF-BM-### |
| Nippu Kodi | `NK` | SF-NK-###, FF-NK-### |
| El Chaapo | `EC` | SF-EC-###, FF-EC-### |

## 🗂️ Raw Material Categories

| Category | Short Code | Example Code |
|----------|------------|--------------|
| Meat | `MEAT` | RM-MEAT-001 |
| Grains | `GRNS` | RM-GRNS-001 |
| Vegetables | `VEGT` | RM-VEGT-001 |
| Oils | `OIL` | RM-OIL-001 |
| Spices | `SPCE` | RM-SPCE-001 |
| Dairy | `DARY` | RM-DARY-001 |
| Packaging | `PKG` | RM-PKG-001 |
| Sanitary | `SAN` | RM-SAN-001 |
| Misc | `MISC` | RM-MISC-001 |

## 🎨 UI Color Codes

| Type | Badge Color | CSS Class |
|------|-------------|-----------|
| Raw Material | 🔵 Blue | `bg-blue-500/20 text-blue-400` |
| Semi-Finished | 🟡 Yellow | `bg-yellow-500/20 text-yellow-400` |
| Finished | 🟢 Green | `bg-green-500/20 text-green-400` |

## ✅ Validation Rules

### Raw Material
```javascript
required: ['material_type', 'name', 'unit', 'category', 'code', 'vendor_id']
optional: ['brand', 'description', 'low_stock_threshold']
```

### Semi-Finished
```javascript
required: ['material_type', 'name', 'unit', 'category', 'code']
optional: ['description', 'low_stock_threshold']
not_applicable: ['vendor_id', 'brand']
```

### Finished
```javascript
required: ['material_type', 'name', 'unit', 'category', 'code']
optional: ['description', 'low_stock_threshold']
not_applicable: ['vendor_id', 'brand']
```

## 🔧 Database Schema

```sql
ALTER TABLE raw_materials
ADD COLUMN material_type TEXT NOT NULL DEFAULT 'raw_material'
CHECK (material_type IN ('raw_material', 'semi_finished', 'finished'));

CREATE INDEX idx_raw_materials_material_type 
ON raw_materials(material_type);
```

## 📝 Form Field Order

1. **Material Type** (dropdown) - Required, First field
2. **Material Name** (text) - Required
3. **Unit of Measure** (dropdown) - Required
4. **Category** (dropdown) - Required, Enabled after Type selection
5. **Brand** (text) - Optional, Only for Raw Materials
6. **Material Code** (read-only) - Auto-generated
7. **Vendor** (dropdown) - Required, Only for Raw Materials
8. **Low Stock Threshold** (number) - Optional
9. **Description** (textarea) - Optional

## 🚀 API Endpoints (No Changes Required)

All existing endpoints work as-is:
- `GET /raw_materials` - Returns all materials with new `material_type` field
- `POST /raw_materials` - Accepts new `material_type` field
- `PUT /raw_materials/:id` - Updates including `material_type`
- `DELETE /raw_materials/:id` - Works as before

## 🔍 SQL Queries

### Get all raw materials
```sql
SELECT * FROM raw_materials 
WHERE material_type = 'raw_material' 
AND deleted_at IS NULL;
```

### Get all semi-finished materials
```sql
SELECT * FROM raw_materials 
WHERE material_type = 'semi_finished' 
AND deleted_at IS NULL;
```

### Get all finished materials
```sql
SELECT * FROM raw_materials 
WHERE material_type = 'finished' 
AND deleted_at IS NULL;
```

### Get materials by brand (semi-finished/finished)
```sql
SELECT * FROM raw_materials 
WHERE material_type IN ('semi_finished', 'finished')
AND category = 'Boom Pizza'
AND deleted_at IS NULL;
```

## 🐛 Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Category dropdown disabled | Select Material Type first |
| Vendor field not showing | Ensure Material Type = 'raw_material' |
| Code not generating | Select both Type and Category |
| Cannot save material | Check all required fields for selected type |
| Migration fails | Check if column already exists |

## 📱 Testing Checklist

- [ ] Create raw material with vendor
- [ ] Create semi-finished (Boom Pizza)
- [ ] Create semi-finished (Nippu Kodi)
- [ ] Create semi-finished (El Chaapo)
- [ ] Create finished (Boom Pizza)
- [ ] Create finished (Nippu Kodi)
- [ ] Create finished (El Chaapo)
- [ ] Edit existing raw material
- [ ] Verify type badges in table
- [ ] Test search and filter
- [ ] Verify code auto-generation
- [ ] Check validation errors

## 📞 Support Contacts

- **Database Issues**: Check migration guide
- **Frontend Issues**: Check Materials.jsx component
- **Business Logic**: Refer to PRD document

## 🔗 Related Documentation

- Full Migration Guide: `/migrations/MATERIAL_TYPE_MIGRATION_GUIDE.md`
- Implementation Summary: `/MATERIAL_TYPE_IMPLEMENTATION_SUMMARY.md`
- Examples: `/MATERIAL_TYPE_EXAMPLES.md`
- Database Schema: `/docs/Database Schema.md`

---

**Last Updated**: 2026-02-10  
**Version**: 1.0
