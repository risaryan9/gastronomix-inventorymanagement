/**
 * Script to seed raw materials from CSV file
 * 
 * Usage: 
 *   1. Place your materials_new.csv in the backend/ folder
 *   2. Run: node backend/seed-raw-materials.js
 * 
 * CSV format:
 * - For raw_material: category must be one of the allowed raw categories (Baking Essentials, Herbs & Spices, etc.)
 * - For semi_finished/finished/non_food: category is auto-assigned (SemiFinished/Finished/Inedible & Packaging)
 * - brand_codes: use "all" for all brands (bp,nk,ec), or comma-separated e.g. "nk,ec", or array style ["bp"]
 * The trigger will automatically create inventory entries for all active cloud kitchens
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'fs'
import { parse } from 'csv-parse/sync'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Get current directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables from root .env
const envPath = join(__dirname, '..', '.env')
const envContent = readFileSync(envPath, 'utf-8')
const envVars = {}
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=')
  if (key && valueParts.length > 0) {
    envVars[key.trim()] = valueParts.join('=').trim()
  }
})

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = envVars.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: Missing Supabase credentials in .env file')
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

// Category short codes for auto-generating material codes
const CATEGORY_CODES = {
  'Baking Essentials': 'BKE',
  'Condiments & Toppings': 'CDTP',
  'Dairy & Dairy Product': 'DRYP',
  'Dry Fruits & Nuts': 'DRFN',
  'Edible Oils & Fats': 'EDOF',
  'Food Grains & Grain Products': 'FDGP',
  'Fruits & Vegetables': 'FRVG',
  'Herbs & Spices': 'HBSP',
  'Indian Breads & Breads': 'IBRD',
  'Meat & Poultry & Cold Cuts': 'MTPC',
  'Packaged Deserts & Sweets': 'PDST',
  'Packaged Water & Bevereges': 'PWBV',
  'Pulses & Lentils': 'PLSL',
  'Sauces & Seasoning': 'SCSN',
  'Inedible & Packaging': 'INPK',
  'SemiFinished': 'SF',
  'Finished': 'FF'
}

/** Allowed brand_codes (must match DB check constraint) */
const ALLOWED_BRAND_CODES = ['bp', 'nk', 'ec']

/**
 * Parse brand_codes from CSV cell.
 * - "all" (case-insensitive) → all allowed codes ['bp','nk','ec']
 * - Comma-separated e.g. "nk,ec" or "bp"
 * - Array-style e.g. ["ec"] or ["nk","ec"] (with or without escaped quotes)
 * Returns null if empty/invalid; otherwise array of allowed codes.
 */
function parseBrandCodes(value) {
  if (value == null || String(value).trim() === '') return null
  const raw = String(value).trim()
  const lower = raw.toLowerCase()
  if (lower === 'all') return [...ALLOWED_BRAND_CODES]
  if (lower === 'null' || lower === 'none' || lower === 'n/a' || lower === '-') return null

  // Accept multiple CSV styles:
  // - "nk,ec"
  // - ["ec"] / [""ec""]
  // - ["ec"],["nk"] (multiple bracket groups)
  const normalized = lower.replace(/""/g, '"').replace(/[\[\]"']/g, ' ')
  const matches = normalized.match(/\b(bp|nk|ec)\b/g) || []
  const uniqueValid = [...new Set(matches.filter(c => ALLOWED_BRAND_CODES.includes(c)))]
  return uniqueValid.length === 0 ? null : uniqueValid
}

const RAW_CATEGORIES = new Set([
  'Baking Essentials',
  'Condiments & Toppings',
  'Dairy & Dairy Product',
  'Dry Fruits & Nuts',
  'Edible Oils & Fats',
  'Food Grains & Grain Products',
  'Fruits & Vegetables',
  'Herbs & Spices',
  'Indian Breads & Breads',
  'Meat & Poultry & Cold Cuts',
  'Packaged Deserts & Sweets',
  'Packaged Water & Bevereges',
  'Pulses & Lentils',
  'Sauces & Seasoning',
  'Inedible & Packaging'
])

const BRAND_NAME_TO_SHORT = { 'Boom Pizza': 'BM', 'Nippu Kodi': 'NK', 'El Chaapo': 'EC' }
const BRAND_CODE_TO_NAME = { bp: 'Boom Pizza', nk: 'Nippu Kodi', ec: 'El Chaapo' }

function parseMaterialType(value) {
  const raw = (value || '').trim().toLowerCase()
  if (!raw) return 'raw_material'
  if (['raw_material', 'semi_finished', 'finished', 'non_food'].includes(raw)) return raw
  if (raw === 'raw') return 'raw_material'
  if (raw === 'semi-finished' || raw === 'semi finished') return 'semi_finished'
  if (raw === 'non-food' || raw === 'non food' || raw === 'nonfood') return 'non_food'
  return 'raw_material'
}

function parseBoolean(value, defaultValue = true) {
  if (value == null || String(value).trim() === '') return defaultValue
  const raw = String(value).trim().toLowerCase()
  return ['true', '1', 'yes', 'y'].includes(raw)
}

function resolveCsvPath() {
  const argPath = process.argv[2] ? process.argv[2].trim() : ''
  if (argPath) {
    return argPath.startsWith('/') ? argPath : join(__dirname, argPath)
  }
  const candidates = [
    join(__dirname, 'materialscomplete.csv'),
    join(__dirname, 'materials.csv - Row materials for bulk upload.csv'),
    join(__dirname, 'materials_new.csv'),
    join(__dirname, 'materials.csv')
  ]
  return candidates.find(p => existsSync(p))
}

/**
 * Generate material code based on material type and category
 * - Raw materials: RM-{CATEGORY_SHORT}-{NUMBER} (e.g., RM-HBSP-001)
 * - Semi-finished: SF-{NUMBER} (e.g., SF-001)
 * - Finished: FF-{NUMBER} (e.g., FF-001)
 * - Non-food: NF-{NUMBER} (e.g., NF-001)
 */
async function generateMaterialCode(materialType, category) {
  let prefix = ''
  let short = ''
  
  if (materialType === 'raw_material') {
    prefix = 'RM'
    short = CATEGORY_CODES[category] || 'MISC'
  } else if (materialType === 'semi_finished') {
    prefix = 'SF'
    short = ''
  } else if (materialType === 'finished') {
    prefix = 'FF'
    short = ''
  } else if (materialType === 'non_food') {
    prefix = 'NF'
    short = ''
  } else {
    return 'UNKNOWN-001'
  }
  
  try {
    // Get existing materials with the same material type
    const query = supabase
      .from('raw_materials')
      .select('code')
      .eq('material_type', materialType)
    
    // For raw materials, filter by category
    if (materialType === 'raw_material') {
      query.eq('category', category)
    }
    
    const { data: categoryMaterials, error } = await query
    
    if (error) {
      console.warn(`Warning: Could not fetch existing codes for ${materialType}/${category}:`, error.message)
      if (materialType === 'raw_material') {
        return `${prefix}-${short}-001`
      } else {
        return `${prefix}-001`
      }
    }
    
    // Extract numbers from existing codes
    let codePattern
    if (materialType === 'raw_material') {
      codePattern = new RegExp(`^${prefix}-${short}-(\\d+)$`)
    } else {
      codePattern = new RegExp(`^${prefix}-(\\d+)$`)
    }
    
    const existingNumbers = (categoryMaterials || [])
      .map(m => {
        const match = m.code.match(codePattern)
        return match ? parseInt(match[1]) : 0
      })
      .filter(num => num > 0)
    
    // Get next number
    const nextNumber = existingNumbers.length > 0 
      ? Math.max(...existingNumbers) + 1 
      : 1
    
    // Format with leading zeros (3 digits)
    const formattedNumber = String(nextNumber).padStart(3, '0')
    
    // Return formatted code
    if (materialType === 'raw_material') {
      return `${prefix}-${short}-${formattedNumber}`
    } else {
      return `${prefix}-${formattedNumber}`
    }
  } catch (err) {
    console.warn(`Warning: Error generating code for ${materialType}/${category}:`, err.message)
    if (materialType === 'raw_material') {
      return `${prefix}-${short}-001`
    } else {
      return `${prefix}-001`
    }
  }
}

/**
 * Seed raw materials from CSV file
 */
async function seedMaterials() {
  try {
    console.log('Starting raw materials seeding...\n')
    
    // Read and parse CSV
    const csvPath = resolveCsvPath()
    if (!csvPath) {
      throw new Error('No CSV file found. Expected one of: materials.csv - Row materials for bulk upload.csv, materials_new.csv, or materials.csv')
    }
    const csvContent = readFileSync(csvPath, 'utf-8')
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true
    })
    
    console.log(`CSV: ${csvPath}`)
    console.log(`Found ${records.length} materials to process\n`)
    
    // Fetch vendors to map vendor names to IDs
    const { data: vendorsData, error: vendorsError } = await supabase
      .from('vendors')
      .select('id, name')
      .eq('is_active', true)
    
    if (vendorsError) {
      console.error('Error fetching vendors:', vendorsError.message)
      throw new Error('Could not fetch vendors. Make sure the vendors table exists and is seeded.')
    }
    
    const vendorMap = new Map((vendorsData || []).map(v => [v.name.trim().toLowerCase(), v.id]))
    console.log(`Loaded ${vendorMap.size} vendors for mapping\n`)
    
    let successCount = 0
    let updateCount = 0
    let errorCount = 0
    
    // Process each material
    for (let i = 0; i < records.length; i++) {
      const row = records[i]
      
      try {
        const materialType = parseMaterialType(row.material_type)
        const name = row.name ? row.name.trim() : ''
        if (!name) throw new Error('Missing required field: name')
        if (!row.unit || !String(row.unit).trim()) throw new Error('Missing required field: unit')

        // Parse brand_codes
        const brandCodes = parseBrandCodes(row.brand_codes)

        // Determine category and brand based on material type
        let category
        let brand = row.brand ? row.brand.trim() : null
        
        if (materialType === 'raw_material') {
          const categoryRaw = row.category != null ? String(row.category).trim() : ''
          category = (categoryRaw === '' || categoryRaw.toUpperCase() === 'NULL') ? 'Inedible & Packaging' : categoryRaw
          if (!RAW_CATEGORIES.has(category)) {
            throw new Error(`Invalid raw category "${category}"`)
          }
        } else if (materialType === 'semi_finished') {
          category = 'SemiFinished'
          if (!brand && brandCodes && brandCodes.length > 0) brand = BRAND_CODE_TO_NAME[brandCodes[0]] || null
        } else if (materialType === 'finished') {
          category = 'Finished'
          if (!brand && brandCodes && brandCodes.length > 0) brand = BRAND_CODE_TO_NAME[brandCodes[0]] || null
        } else if (materialType === 'non_food') {
          category = 'Inedible & Packaging'
          if (!brand && brandCodes && brandCodes.length > 0) brand = BRAND_CODE_TO_NAME[brandCodes[0]] || null
        }

        // Idempotent behavior:
        // 1) Try to find existing material by (name + material_type)
        // 2) If found -> update in place (keep existing code)
        // 3) Else -> generate next code and insert
        const { data: existingMaterial, error: existingErr } = await supabase
          .from('raw_materials')
          .select('id, code')
          .eq('name', name)
          .eq('material_type', materialType)
          .is('deleted_at', null)
          .limit(1)
          .maybeSingle()
        if (existingErr) throw existingErr
        
        // Parse low_stock_threshold
        const lowStockThreshold = row.low_stock_threshold 
          ? parseFloat(row.low_stock_threshold) 
          : 0
        
        // Map vendor name to vendor_id
        const vendorName = row.vendor ? row.vendor.trim() : null
        const vendorId = vendorName ? vendorMap.get(vendorName.toLowerCase()) : null
        if (vendorName && !vendorId) {
          console.warn(`   ⚠ Vendor "${vendorName}" not found - material will have no vendor`)
        }
        
        const finalCode = existingMaterial?.code || await generateMaterialCode(materialType, category)

        // Prepare material data; trigger creates inventory only for new insert
        const materialData = {
          name,
          code: finalCode,
          unit: row.unit.trim(),
          description: row.description ? row.description.trim() : null,
          category,
          low_stock_threshold: lowStockThreshold,
          is_active: parseBoolean(row.is_active, true),
          brand: brand,
          vendor_id: vendorId,
          material_type: materialType,
          brand_codes: brandCodes
        }
        
        let error = null
        if (existingMaterial?.id) {
          const result = await supabase
            .from('raw_materials')
            .update({
              ...materialData,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingMaterial.id)
          error = result.error
        } else {
          const result = await supabase
            .from('raw_materials')
            .insert(materialData)
          error = result.error
        }
        
        if (error) {
          console.error(`❌ [${i + 1}/${records.length}] Failed: ${name}`)
          console.error(`   Error: ${error.message}`)
          errorCount++
        } else if (existingMaterial?.id) {
          console.log(`🔄 [${i + 1}/${records.length}] Updated: ${name} (${finalCode})`)
          updateCount++
        } else {
          console.log(`✅ [${i + 1}/${records.length}] Inserted: ${name} (${finalCode})`)
          successCount++
        }
      } catch (err) {
        console.error(`❌ [${i + 1}/${records.length}] Failed: ${row.name}`)
        console.error(`   Error: ${err.message}`)
        errorCount++
      }
    }
    
    console.log('\n' + '='.repeat(60))
    console.log('Sync complete!')
    console.log(`✅ Inserted: ${successCount}`)
    console.log(`🔄 Updated: ${updateCount}`)
    console.log(`❌ Failed: ${errorCount}`)
    console.log(`📊 Total: ${records.length}`)
    console.log('='.repeat(60))
    console.log('\n📦 Inventory entries were automatically created by the trigger')
    console.log('   for all active cloud kitchens.\n')
    
  } catch (error) {
    console.error('Fatal error:', error.message)
    
    if (error.code === 'ENOENT') {
      console.error('\nMake sure the CSV exists in backend/ or pass a file path argument')
    }
    
    process.exit(1)
  }
}

// Run the seeding
seedMaterials()
