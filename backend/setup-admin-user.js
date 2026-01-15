/**
 * Script to create admin user in Supabase Auth
 * Run this once to set up the admin user
 * 
 * Usage: node setup-admin-user.js
 * 
 * Make sure you have SUPABASE_SERVICE_ROLE_KEY in your .env file
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { readFileSync } from 'fs'

// Load environment variables from root .env
const envContent = readFileSync('.env', 'utf-8')
const envVars = {}
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=')
  if (key && valueParts.length > 0) {
    envVars[key.trim()] = valueParts.join('=').trim()
  }
})

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = envVars.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const adminEmail = envVars.ADMIN_EMAIL || process.env.ADMIN_EMAIL
const adminPassword = envVars.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD
const adminUserId = envVars.ADMIN_USER_ID || process.env.ADMIN_USER_ID

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: Missing Supabase credentials in .env file')
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

if (!adminEmail || !adminPassword || !adminUserId) {
  console.error('Error: Missing admin credentials in .env file')
  console.error('Required: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_USER_ID')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function setupAdminUser() {
  try {
    console.log('Setting up admin user...')
    console.log(`Email: ${adminEmail}`)
    console.log(`User ID: ${adminUserId}`)

    // Check if user already exists in auth
    const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers()
    
    if (listError) {
      console.error('Error listing users:', listError)
      throw listError
    }

    const existingUser = existingUsers.users.find(u => u.email === adminEmail)

    if (existingUser) {
      console.log('Admin user already exists in Supabase Auth')
      
      // Update password if needed
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        existingUser.id,
        { password: adminPassword }
      )
      
      if (updateError) {
        console.error('Error updating password:', updateError)
        throw updateError
      }
      
      console.log('Admin password updated')
      
      // Verify the user ID matches
      if (existingUser.id !== adminUserId) {
        console.warn(`Warning: Auth user ID (${existingUser.id}) doesn't match expected ID (${adminUserId})`)
        console.warn('You may need to update the users table or create a new user')
      } else {
        console.log('User ID matches - setup complete!')
      }
    } else {
      // Create new admin user
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: adminEmail,
        password: adminPassword,
        email_confirm: true, // Auto-confirm email
        user_metadata: {
          full_name: 'Admin User',
          role: 'admin'
        }
      })

      if (createError) {
        console.error('Error creating admin user:', createError)
        throw createError
      }

      console.log('Admin user created in Supabase Auth')
      console.log(`Auth User ID: ${newUser.user.id}`)
      
      // Update the users table to link the auth user
      const { error: updateError } = await supabase
        .from('users')
        .update({ id: newUser.user.id })
        .eq('id', adminUserId)

      if (updateError) {
        console.warn('Warning: Could not update users table:', updateError.message)
        console.warn('You may need to manually update the users table ID to:', newUser.user.id)
      } else {
        console.log('Users table updated with auth user ID')
      }
    }

    console.log('\n✅ Admin user setup complete!')
    console.log(`You can now login with:`)
    console.log(`  Email: ${adminEmail}`)
    console.log(`  Password: ${adminPassword}`)

  } catch (error) {
    console.error('Setup failed:', error)
    process.exit(1)
  }
}

setupAdminUser()
