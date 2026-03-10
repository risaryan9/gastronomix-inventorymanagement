/**
 * Script to seed raw materials from CSV file
 * 
 * Usage: 
 *   1. Place your materials_new.csv in the backend/ folder
 *   2. Run: node backend/seed-raw-materials.js
 * 
 * CSV brand_codes: use "all" for all brands (bp,nk,ec), or comma-separated e.g. "nk,ec", or array style ["bp"]
 * The trigger will automatically create inventory entries for all active cloud kitchens
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
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
  'Meat': 'MEAT',
  'Grains': 'GRNS',
  'Vegetables': 'VEGT',
  'Oils': 'OIL',
  'Spices': 'SPCE',
  'Dairy': 'DARY',
  'Packaging': 'PKG',
  'Sanitary': 'SAN',
  'Misc': 'MISC',
  'Breads': 'BRED'
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
  // Array-style: ["ec"] or ["nk","ec"] or [""ec""]
  if (raw.startsWith('[')) {
    const inner = raw.replace(/^\[|\]$/g, '').replace(/""/g, '"')
    const codes = inner
      .split(',')
      .map(s => s.replace(/^["']|["']$/g, '').trim().toLowerCase())
      .filter(Boolean)
    const valid = codes.filter(c => ALLOWED_BRAND_CODES.includes(c))
    return valid.length === 0 ? null : valid
  }
  // Comma-separated
  const codes = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const valid = codes.filter(c => ALLOWED_BRAND_CODES.includes(c))
  return valid.length === 0 ? null : valid
}

/**
 * Generate material code based on category
 * Format: RM-{CATEGORY_SHORT}-{NUMBER}
 * Example: RM-MEAT-001, RM-DARY-042
 */
async function generateMaterialCode(category) {
  const short = CATEGORY_CODES[category] || 'MISC'
  
  try {
    // Get existing materials with the same category to find the next number
    const { data: categoryMaterials, error } = await supabase
      .from('raw_materials')
      .select('code')
      .like('code', `RM-${short}-%`)
    
    if (error) {
      console.warn(`Warning: Could not fetch existing codes for ${category}:`, error.message)
      return `RM-${short}-001`
    }
    
    // Extract numbers from existing codes
    const codePattern = new RegExp(`^RM-${short}-(\\d+)$`)
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
    
    return `RM-${short}-${formattedNumber}`
  } catch (err) {
    console.warn(`Warning: Error generating code for ${category}:`, err.message)
    return `RM-${short}-001`
  }
}

/**
 * Seed raw materials from CSV file
 */
async function seedMaterials() {
  try {
    console.log('Starting raw materials seeding...\n')
    
    // Read and parse CSV
    const csvPath = join(__dirname, 'materials_new.csv')
    const csvContent = readFileSync(csvPath, 'utf-8')
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true
    })
    
    console.log(`Found ${records.length} materials to seed\n`)
    
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
    let errorCount = 0
    
    // Process each material
    for (let i = 0; i < records.length; i++) {
      const row = records[i]
      
      try {
        // Generate material code
        const categoryRaw = row.category != null ? String(row.category).trim() : ''
        const category = (categoryRaw === '' || categoryRaw.toUpperCase() === 'NULL') ? 'Misc' : categoryRaw
        const code = await generateMaterialCode(category)
        
        // Parse low_stock_threshold - keep the exact decimal value (e.g., 45.000)
        // PostgreSQL numeric(10, 3) will preserve the 3 decimal places
        const lowStockThreshold = row.low_stock_threshold 
          ? parseFloat(row.low_stock_threshold) 
          : 0
        
        // Map vendor name to vendor_id
        const vendorName = row.vendor ? row.vendor.trim() : null
        const vendorId = vendorName ? vendorMap.get(vendorName.toLowerCase()) : null
        if (vendorName && !vendorId) {
          console.warn(`   ⚠ Vendor "${vendorName}" not found - material will have no vendor`)
        }

        // Handle material_type column (raw_material / semi_finished / finished)
        const rawMaterialType = (row.material_type || '').trim().toLowerCase()
        let materialType
        if (!rawMaterialType) {
          // Default when column is missing or empty (matches existing behavior)
          materialType = 'raw_material'
        } else if (['raw_material', 'semi_finished', 'finished'].includes(rawMaterialType)) {
          materialType = rawMaterialType
        } else if (rawMaterialType === 'raw') {
          materialType = 'raw_material'
        } else if (rawMaterialType === 'semi-finished' || rawMaterialType === 'semi finished') {
          materialType = 'semi_finished'
        } else {
          console.warn(
            `   ⚠ Invalid material_type "${row.material_type}" for "${row.name}", defaulting to 'raw_material'`
          )
          materialType = 'raw_material'
        }

        // Parse brand_codes: optional CSV column, comma-separated e.g. "nk,ec" or "bp"
        const brandCodes = parseBrandCodes(row.brand_codes)
        
        // Prepare material data; trigger creates inventory for new material
        const materialData = {
          name: row.name.trim(),
          code,
          unit: row.unit.trim(),
          description: row.description ? row.description.trim() : null,
          category,
          low_stock_threshold: lowStockThreshold, // Will be stored as 45.000 in numeric(10,3)
          is_active: row.is_active === 'TRUE' || row.is_active === 'true' || row.is_active === '1',
          brand: row.brand ? row.brand.trim() : null,
          vendor_id: vendorId,
          material_type: materialType,
          brand_codes: brandCodes
        }
        
        // Insert material
        const { error } = await supabase
          .from('raw_materials')
          .insert(materialData)
        
        if (error) {
          console.error(`❌ [${i + 1}/${records.length}] Failed: ${row.name}`)
          console.error(`   Error: ${error.message}`)
          errorCount++
        } else {
          console.log(`✅ [${i + 1}/${records.length}] ${row.name} (${code})`)
          successCount++
        }
      } catch (err) {
        console.error(`❌ [${i + 1}/${records.length}] Failed: ${row.name}`)
        console.error(`   Error: ${err.message}`)
        errorCount++
      }
    }
    
    console.log('\n' + '='.repeat(60))
    console.log('Seeding complete!')
    console.log(`✅ Success: ${successCount}`)
    console.log(`❌ Failed: ${errorCount}`)
    console.log(`📊 Total: ${records.length}`)
    console.log('='.repeat(60))
    console.log('\n📦 Inventory entries were automatically created by the trigger')
    console.log('   for all active cloud kitchens.\n')
    
  } catch (error) {
    console.error('Fatal error:', error.message)
    
    if (error.code === 'ENOENT') {
      console.error('\nMake sure materials_new.csv exists in the backend/ folder')
    }
    
    process.exit(1)
  }
}

// Run the seeding
seedMaterials()
