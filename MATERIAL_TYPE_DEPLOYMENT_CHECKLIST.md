# Material Type Feature - Deployment Checklist

## Pre-Deployment Checklist

### 1. Code Review ✅
- [x] Database migration script reviewed
- [x] Frontend component changes reviewed
- [x] No linter errors
- [x] Code follows project conventions
- [x] All constants properly defined

### 2. Documentation ✅
- [x] Migration guide created
- [x] Implementation summary created
- [x] Examples document created
- [x] Quick reference card created
- [x] Deployment checklist created

### 3. Testing Preparation
- [ ] Test database environment prepared
- [ ] Test user accounts ready
- [ ] Sample data prepared for testing
- [ ] Browser testing environment ready

## Deployment Steps

### Phase 1: Database Migration (15 minutes)

#### Step 1.1: Backup Database
```bash
# Create backup before migration
pg_dump -h your-supabase-host -U postgres -d postgres > backup_$(date +%Y%m%d_%H%M%S).sql

# Or via Supabase Dashboard:
# Settings > Database > Backups > Create Backup
```
**Status**: [ ] Complete

#### Step 1.2: Review Migration Script
```bash
# Review the migration file
cat migrations/add-material-type-column.sql
```
**Status**: [ ] Complete

#### Step 1.3: Execute Migration
```sql
-- Via Supabase SQL Editor:
-- 1. Go to SQL Editor
-- 2. Copy contents of migrations/add-material-type-column.sql
-- 3. Click "Run"
-- 4. Verify "Success. No rows returned"
```
**Status**: [ ] Complete

#### Step 1.4: Verify Migration
```sql
-- Run these verification queries:

-- 1. Check column exists
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'raw_materials' AND column_name = 'material_type';

-- 2. Check all records have material_type
SELECT material_type, COUNT(*) as count
FROM raw_materials
WHERE deleted_at IS NULL
GROUP BY material_type;

-- 3. Verify index created
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'raw_materials' AND indexname = 'idx_raw_materials_material_type';

-- Expected Results:
-- Query 1: Should show material_type column with TEXT type, NOT NULL, default 'raw_material'
-- Query 2: Should show all records with material_type = 'raw_material'
-- Query 3: Should show the index definition
```
**Status**: [ ] Complete

### Phase 2: Frontend Deployment (30 minutes)

#### Step 2.1: Build Frontend
```bash
cd frontend
npm install  # Ensure all dependencies are installed
npm run build  # Create production build
```
**Status**: [ ] Complete

#### Step 2.2: Test Build Locally
```bash
npm run preview  # Test production build locally
# Open browser and test the Materials page
```
**Status**: [ ] Complete

#### Step 2.3: Deploy to Production
```bash
# Deploy based on your hosting platform:

# Vercel:
vercel --prod

# Netlify:
netlify deploy --prod

# Or manual deployment:
# Upload contents of frontend/dist/ to your hosting
```
**Status**: [ ] Complete

#### Step 2.4: Verify Deployment
- [ ] Navigate to Materials page
- [ ] Check if Material Type dropdown appears
- [ ] Verify no console errors
- [ ] Check if table displays correctly
**Status**: [ ] Complete

### Phase 3: Functional Testing (45 minutes)

#### Test Case 1: Create Raw Material
- [ ] Click "Add New Material"
- [ ] Select Material Type: "Raw Material"
- [ ] Enter Name: "Test Raw Material"
- [ ] Select Unit: "kg"
- [ ] Select Category: "Meat" (should enable after type selection)
- [ ] Enter Brand: "Test Brand"
- [ ] Select Vendor: (any vendor)
- [ ] Verify Code auto-generates: RM-MEAT-XXX
- [ ] Set Low Stock Threshold: 10
- [ ] Click Continue
- [ ] Review confirmation modal
- [ ] Click "Confirm & Create Material"
- [ ] Verify success message
- [ ] Verify material appears in table with Blue badge
**Status**: [ ] Complete

#### Test Case 2: Create Semi-Finished Material (Boom Pizza)
- [ ] Click "Add New Material"
- [ ] Select Material Type: "Semi-Finished"
- [ ] Enter Name: "Test Semi-Finished Pizza"
- [ ] Select Unit: "nos"
- [ ] Select Category: "Boom Pizza"
- [ ] Verify Vendor field is NOT visible
- [ ] Verify Brand field is NOT visible
- [ ] Verify Code auto-generates: SF-BM-XXX
- [ ] Click Continue
- [ ] Verify confirmation shows no vendor
- [ ] Click "Confirm & Create Material"
- [ ] Verify material appears with Yellow badge
**Status**: [ ] Complete

#### Test Case 3: Create Semi-Finished Material (Nippu Kodi)
- [ ] Create with Category: "Nippu Kodi"
- [ ] Verify Code: SF-NK-XXX
- [ ] Verify Yellow badge
**Status**: [ ] Complete

#### Test Case 4: Create Semi-Finished Material (El Chaapo)
- [ ] Create with Category: "El Chaapo"
- [ ] Verify Code: SF-EC-XXX
- [ ] Verify Yellow badge
**Status**: [ ] Complete

#### Test Case 5: Create Finished Material (Boom Pizza)
- [ ] Select Material Type: "Finished"
- [ ] Select Category: "Boom Pizza"
- [ ] Verify Code: FF-BM-XXX
- [ ] Verify Green badge
**Status**: [ ] Complete

#### Test Case 6: Create Finished Material (Nippu Kodi)
- [ ] Create with Category: "Nippu Kodi"
- [ ] Verify Code: FF-NK-XXX
- [ ] Verify Green badge
**Status**: [ ] Complete

#### Test Case 7: Create Finished Material (El Chaapo)
- [ ] Create with Category: "El Chaapo"
- [ ] Verify Code: FF-EC-XXX
- [ ] Verify Green badge
**Status**: [ ] Complete

#### Test Case 8: Edit Existing Raw Material
- [ ] Click Edit on an existing raw material
- [ ] Verify Material Type field is disabled
- [ ] Verify Category field is disabled
- [ ] Verify Code field is disabled
- [ ] Change Name
- [ ] Change Low Stock Threshold
- [ ] Click "Update Material"
- [ ] Verify changes saved
**Status**: [ ] Complete

#### Test Case 9: Validation Tests
- [ ] Try to create material without selecting Type
- [ ] Verify error: "Material type is required"
- [ ] Select Type but not Category
- [ ] Verify Category dropdown is disabled with message
- [ ] Select Raw Material type without Vendor
- [ ] Verify error: "Vendor is required for raw materials"
**Status**: [ ] Complete

#### Test Case 10: Table Display
- [ ] Verify Type column appears first
- [ ] Verify color badges display correctly
- [ ] Verify all materials show correct type
- [ ] Test search functionality
- [ ] Test category filter
- [ ] Test pagination
**Status**: [ ] Complete

### Phase 4: Integration Testing (30 minutes)

#### Test Case 11: Stock-In with New Materials
- [ ] Go to Stock-In page
- [ ] Create new stock-in entry
- [ ] Add a raw material
- [ ] Add a semi-finished material
- [ ] Add a finished material
- [ ] Verify all materials appear in dropdown
- [ ] Complete stock-in
- [ ] Verify inventory updated
**Status**: [ ] Complete

#### Test Case 12: Allocation with New Materials
- [ ] Go to Allocations page
- [ ] Create new allocation
- [ ] Try to allocate raw materials
- [ ] Try to allocate semi-finished materials
- [ ] Try to allocate finished materials
- [ ] Verify all work correctly
**Status**: [ ] Complete

#### Test Case 13: Inventory Display
- [ ] Go to Inventory page
- [ ] Verify all material types display
- [ ] Check if material codes display correctly
- [ ] Verify filtering works
**Status**: [ ] Complete

### Phase 5: User Acceptance Testing (1 hour)

#### UAT Checklist
- [ ] Purchase Manager can create raw materials
- [ ] Purchase Manager can create semi-finished materials
- [ ] Purchase Manager can create finished materials
- [ ] Supervisor can view all material types
- [ ] Material codes generate correctly
- [ ] Form validation works as expected
- [ ] Existing materials still work
- [ ] No data loss occurred
- [ ] Performance is acceptable
- [ ] UI is intuitive and clear
**Status**: [ ] Complete

## Post-Deployment Checklist

### 1. Monitoring (First 24 hours)
- [ ] Monitor error logs for any issues
- [ ] Check database performance
- [ ] Monitor API response times
- [ ] Watch for user-reported issues

### 2. User Training
- [ ] Train Purchase Managers on new feature
- [ ] Explain material type differences
- [ ] Demonstrate form workflow
- [ ] Share documentation links

### 3. Documentation Updates
- [ ] Update user manual
- [ ] Update training materials
- [ ] Update API documentation (if applicable)
- [ ] Share quick reference card

### 4. Backup Verification
- [ ] Verify backup was created successfully
- [ ] Test backup restoration (in test environment)
- [ ] Document backup location and timestamp

## Rollback Plan

### If Issues Occur:

#### Minor Issues (UI bugs, validation issues)
1. Fix in code
2. Deploy hotfix
3. No database rollback needed

#### Major Issues (Data corruption, system failure)
1. **Immediate Actions:**
   ```bash
   # Stop accepting new material creations
   # Investigate issue
   ```

2. **Database Rollback:**
   ```sql
   -- Remove index
   DROP INDEX IF EXISTS idx_raw_materials_material_type;
   
   -- Remove column
   ALTER TABLE raw_materials DROP COLUMN IF EXISTS material_type;
   ```

3. **Frontend Rollback:**
   ```bash
   # Revert to previous deployment
   git revert <commit-hash>
   npm run build
   # Deploy previous version
   ```

4. **Restore from Backup:**
   ```bash
   # If needed, restore entire database
   psql -h your-host -U postgres -d postgres < backup_file.sql
   ```

## Success Criteria

### Deployment is successful if:
- ✅ All test cases pass
- ✅ No errors in production logs
- ✅ Existing functionality works
- ✅ New materials can be created
- ✅ Material codes generate correctly
- ✅ Users can navigate the new UI
- ✅ Performance is acceptable
- ✅ No data loss or corruption

## Sign-Off

### Technical Sign-Off
- [ ] Database Administrator: _________________ Date: _______
- [ ] Backend Developer: _________________ Date: _______
- [ ] Frontend Developer: _________________ Date: _______

### Business Sign-Off
- [ ] Product Owner: _________________ Date: _______
- [ ] Purchase Manager (UAT): _________________ Date: _______
- [ ] Operations Manager: _________________ Date: _______

## Contact Information

### Support Contacts
- **Technical Issues**: [Your Tech Lead]
- **Business Questions**: [Product Owner]
- **Emergency**: [On-Call Engineer]

### Documentation Links
- Migration Guide: `/migrations/MATERIAL_TYPE_MIGRATION_GUIDE.md`
- Quick Reference: `/MATERIAL_TYPE_QUICK_REFERENCE.md`
- Examples: `/MATERIAL_TYPE_EXAMPLES.md`
- Implementation Summary: `/MATERIAL_TYPE_IMPLEMENTATION_SUMMARY.md`

---

**Deployment Date**: _______________  
**Deployed By**: _______________  
**Version**: 1.0  
**Status**: [ ] Successful [ ] Failed [ ] Rolled Back
