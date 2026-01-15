-- =====================================================
-- Migration: Update users table for key-based login
-- Run this if you already have the users table createdd
-- =====================================================

-- Step 1: Add login_key column
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS login_key TEXT;

-- Step 2: Make email nullable (remove NOT NULL constraint)
-- First, we need to drop the existing NOT NULL constraint
-- Note: This will fail if there are existing non-admin users with emails
-- You may need to handle existing data first

-- For existing tables, we need to:
-- 1. Remove the NOT NULL constraint from email
ALTER TABLE users 
ALTER COLUMN email DROP NOT NULL;

-- 2. Add unique constraint to login_key
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_key_unique ON users(login_key) 
WHERE login_key IS NOT NULL;

-- 3. Add the check constraint for login validation
ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_login_constraint;

ALTER TABLE users
ADD CONSTRAINT users_login_constraint CHECK (
  (role = 'admin' AND email IS NOT NULL AND login_key IS NULL) OR
  (role != 'admin' AND login_key IS NOT NULL AND email IS NULL)
);

-- Step 4: Create index for login_key lookups
CREATE INDEX IF NOT EXISTS idx_users_login_key ON users(login_key);

-- Note: After running this migration, you'll need to:
-- 1. Update existing admin users to ensure they have emails and no login_key
-- 2. Update existing non-admin users to have login_key and remove their emails
-- 3. Generate login keys for non-admin users
