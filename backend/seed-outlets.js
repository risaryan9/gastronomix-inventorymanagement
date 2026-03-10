/**
 * Script to seed outlets from CSV file
 *
 * Usage:
 *   1. Place outlets.csv in the backend/ folder
 *   2. Run: node backend/seed-outlets.js
 *
 * CSV columns: name, outlet_code, cloud_kitchen_code, is_active
 * Cloud kitchens are looked up by code (e.g. CK1, CK2); the script resolves
 * cloud_kitchen_id and inserts into outlets. Uses upsert so re-running updates existing rows.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { parse } from 'csv-parse/sync'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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

async function seedOutlets() {
  try {
    console.log('Starting outlets seeding...\n')

    const csvPath = join(__dirname, 'outlets.csv')
    const csvContent = readFileSync(csvPath, 'utf-8')
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    })

    console.log(`Found ${records.length} outlets to seed\n`)

    const { data: cloudKitchens, error: ckError } = await supabase
      .from('cloud_kitchens')
      .select('id, code')

    if (ckError) {
      console.error('Error fetching cloud kitchens:', ckError.message)
      throw new Error('Could not fetch cloud_kitchens. Make sure the table exists and is seeded.')
    }

    const cloudKitchenByCode = new Map((cloudKitchens || []).map(ck => [ck.code.trim(), ck.id]))
    console.log(`Loaded ${cloudKitchenByCode.size} cloud kitchens: ${(cloudKitchens || []).map(c => c.code).join(', ')}\n`)

    let successCount = 0
    let errorCount = 0

    for (let i = 0; i < records.length; i++) {
      const row = records[i]
      const name = row.name ? row.name.trim() : ''
      const outletCode = row.outlet_code ? row.outlet_code.trim() : ''
      const cloudKitchenCode = row.cloud_kitchen_code ? row.cloud_kitchen_code.trim() : ''
      const isActive = row.is_active === 'TRUE' || row.is_active === 'true' || row.is_active === '1'

      if (!name || !outletCode || !cloudKitchenCode) {
        console.error(`❌ [${i + 1}/${records.length}] Skipped: missing name, outlet_code, or cloud_kitchen_code`)
        errorCount++
        continue
      }

      const cloudKitchenId = cloudKitchenByCode.get(cloudKitchenCode)
      if (!cloudKitchenId) {
        console.error(`❌ [${i + 1}/${records.length}] ${name} (${outletCode}): cloud_kitchen_code "${cloudKitchenCode}" not found`)
        errorCount++
        continue
      }

      const payload = {
        cloud_kitchen_id: cloudKitchenId,
        name,
        code: outletCode,
        is_active: isActive
      }

      const { error } = await supabase
        .from('outlets')
        .upsert(payload, {
          onConflict: 'cloud_kitchen_id,code',
          ignoreDuplicates: false
        })

      if (error) {
        console.error(`❌ [${i + 1}/${records.length}] ${name} (${outletCode})`)
        console.error(`   Error: ${error.message}`)
        errorCount++
      } else {
        console.log(`✅ [${i + 1}/${records.length}] ${name} (${outletCode}) → ${cloudKitchenCode}`)
        successCount++
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('Seeding complete!')
    console.log(`✅ Success: ${successCount}`)
    console.log(`❌ Failed: ${errorCount}`)
    console.log(`📊 Total: ${records.length}`)
    console.log('='.repeat(60))
  } catch (error) {
    console.error('Fatal error:', error.message)
    if (error.code === 'ENOENT') {
      console.error('\nMake sure outlets.csv exists in the backend/ folder')
    }
    process.exit(1)
  }
}

seedOutlets()
