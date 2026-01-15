-- Quick fix: Add INSERT policy for key-based users to create inventory entries
-- Run this in Supabase SQL Editor if you haven't run the full migration yet

DROP POLICY IF EXISTS "Allow key-based users to insert inventory by cloud kitchen" ON inventory;
CREATE POLICY "Allow key-based users to insert inventory by cloud kitchen" 
ON inventory
FOR INSERT
TO public
WITH CHECK (
  -- Allow if cloud_kitchen_id is provided (application ensures correct ID)
  cloud_kitchen_id IS NOT NULL
);
