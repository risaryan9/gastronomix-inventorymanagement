# Material Type Migration Guide

## Overview

This migration introduces a new `material_type` column to the `raw_materials` table, enabling the system to support three types of materials:

1. **Raw Material** - Materials purchased from external vendors
2. **Semi-Finished** - Intermediate products prepared in-house
3. **Finished** - Final products ready for sale/distribution

## Database Changes

### New Column: `material_type`

- **Type**: `TEXT`
- **Constraint**: `CHECK (material_type IN ('raw_material', 'semi_finished', 'finished'))`
- **Default**: `'raw_material'`
- **Required**: `NOT NULL`

### Migration File

**File**: `add-material-type-column.sql`

This migration:
1. Adds the `material_type` column with appropriate constraints
2. Initializes all existing rows to `'raw_material'`
3. Creates an index on `material_type` for better query performance
4. Adds comments to document the new schema

## Material Code Patterns

### Raw Materials
- **Format**: `RM-{CATEGORY}-{NUMBER}`
- **Example**: `RM-MEAT-001`, `RM-SPCE-012`
- **Categories**: Meat, Grains, Vegetables, Oils, Spices, Dairy, Packaging, Sanitary, Misc

### Semi-Finished Materials
- **Format**: `SF-{BRAND}-{NUMBER}`
- **Examples**: 
  - `SF-BM-001` (Boom Pizza)
  - `SF-NK-001` (Nippu Kodi)
  - `SF-EC-001` (El Chaapo)
- **Brands/Categories**: Boom Pizza (BM), Nippu Kodi (NK), El Chaapo (EC)

### Finished Materials
- **Format**: `FF-{BRAND}-{NUMBER}`
- **Examples**: 
  - `FF-BM-001` (Boom Pizza)
  - `FF-NK-001` (Nippu Kodi)
  - `FF-EC-001` (El Chaapo)
- **Brands/Categories**: Boom Pizza (BM), Nippu Kodi (NK), El Chaapo (EC)

## Frontend Changes

### Material Form Flow

1. **Select Material Type** (Required, First Step)
   - User must select one of: Raw Material, Semi-Finished, or Finished
   - This selection determines available categories and required fields

2. **Select Category** (Enabled after Type selection)
   - For Raw Materials: Traditional categories (Meat, Grains, etc.)
   - For Semi-Finished/Finished: Brand categories (Boom Pizza, Nippu Kodi, El Chaapo)

3. **Auto-Generated Code**
   - Code is automatically generated based on material type and category
   - Format follows the patterns described above

4. **Conditional Fields**
   - **Vendor**: Required ONLY for Raw Materials
   - **Brand**: Optional ONLY for Raw Materials
   - Semi-Finished and Finished materials do NOT require vendor or brand

### UI Updates

- Added Material Type dropdown (first field in form)
- Category dropdown is disabled until Material Type is selected
- Vendor and Brand fields only appear for Raw Materials
- Table now displays Material Type with color-coded badges:
  - Blue: Raw Material
  - Yellow: Semi-Finished
  - Green: Finished

## Running the Migration

### Step 1: Backup Database
```bash
# Create a backup before running migration
pg_dump your_database > backup_before_material_type_migration.sql
```

### Step 2: Run Migration
```bash
# Connect to your Supabase database or PostgreSQL instance
psql -h your-host -U your-user -d your-database -f migrations/add-material-type-column.sql
```

Or via Supabase Dashboard:
1. Go to SQL Editor
2. Copy contents of `add-material-type-column.sql`
3. Execute the script

### Step 3: Verify Migration
```sql
-- Check if column was added
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'raw_materials' AND column_name = 'material_type';

-- Verify all existing records are set to 'raw_material'
SELECT material_type, COUNT(*) as count
FROM raw_materials
WHERE deleted_at IS NULL
GROUP BY material_type;

-- Check index was created
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'raw_materials' AND indexname = 'idx_raw_materials_material_type';
```

### Step 4: Deploy Frontend Changes
```bash
cd frontend
npm install  # If any new dependencies were added
npm run build
# Deploy to your hosting platform
```

## Testing Checklist

### Database Testing
- [ ] Migration runs without errors
- [ ] All existing materials have `material_type = 'raw_material'`
- [ ] Index `idx_raw_materials_material_type` exists
- [ ] CHECK constraint prevents invalid material types

### Frontend Testing - Raw Materials
- [ ] Can create new raw material
- [ ] Material type defaults to empty (must be selected)
- [ ] Category dropdown is disabled until type is selected
- [ ] Selecting "Raw Material" shows traditional categories
- [ ] Vendor field is visible and required
- [ ] Brand field is visible and optional
- [ ] Code is auto-generated with RM- prefix
- [ ] Can save raw material successfully

### Frontend Testing - Semi-Finished Materials
- [ ] Can create new semi-finished material
- [ ] Selecting "Semi-Finished" shows brand categories
- [ ] Vendor field is NOT visible
- [ ] Brand field is NOT visible
- [ ] Code is auto-generated with SF- prefix
- [ ] Can save semi-finished material successfully

### Frontend Testing - Finished Materials
- [ ] Can create new finished material
- [ ] Selecting "Finished" shows brand categories
- [ ] Vendor field is NOT visible
- [ ] Brand field is NOT visible
- [ ] Code is auto-generated with FF- prefix
- [ ] Can save finished material successfully

### Frontend Testing - General
- [ ] Material type column appears in table
- [ ] Type badges display correct colors
- [ ] Can edit existing raw materials
- [ ] Material type cannot be changed when editing
- [ ] Category cannot be changed when editing
- [ ] Search and filter work correctly
- [ ] Pagination works correctly

## Rollback Instructions

If you need to rollback this migration:

```sql
-- Remove the index
DROP INDEX IF EXISTS idx_raw_materials_material_type;

-- Remove the column
ALTER TABLE raw_materials DROP COLUMN IF EXISTS material_type;
```

**Warning**: Rolling back will permanently delete the material_type data. Make sure to backup first!

## Data Migration Notes

### Existing Data
- All existing materials are automatically set to `material_type = 'raw_material'`
- No manual data migration is required
- Existing material codes (RM-*) remain unchanged

### Future Considerations
- Consider adding a trigger to validate material code format matches material type
- May want to add a view to separate materials by type for easier querying
- Consider adding material_type filter to the frontend table

## Support

If you encounter any issues:
1. Check the migration logs for errors
2. Verify database constraints are properly applied
3. Check browser console for frontend errors
4. Ensure Supabase RLS policies allow the new column

## Related Files

- **Migration**: `/migrations/add-material-type-column.sql`
- **Frontend Component**: `/frontend/src/pages/purchase-manager/Materials.jsx`
- **Documentation**: This file

## Version History

- **v1.0** (2026-02-10): Initial implementation of material type system
