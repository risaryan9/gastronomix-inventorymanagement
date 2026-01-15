-- =====================================================
-- Inventory-Related Tables Schema (Reference)
-- allocation_items, material_costs, stock_in
-- =====================================================
-- NOTE:
-- These tables are already created in `supabase-schema.sql`.
-- This file exists as a focused schema reference and is safe to run
-- because it uses IF NOT EXISTS on table/index creation.
-- =====================================================

-- Allocation Items Table
CREATE TABLE IF NOT EXISTS public.allocation_items (
  id uuid not null default extensions.uuid_generate_v4 (),
  allocation_id uuid not null,
  raw_material_id uuid not null,
  quantity numeric(10, 3) not null,
  constraint allocation_items_pkey primary key (id),
  constraint allocation_items_allocation_id_raw_material_id_key unique (allocation_id, raw_material_id),
  constraint allocation_items_allocation_id_fkey foreign KEY (allocation_id) references allocations (id) on delete CASCADE,
  constraint allocation_items_raw_material_id_fkey foreign KEY (raw_material_id) references raw_materials (id) on delete CASCADE,
  constraint allocation_items_quantity_check check ((quantity > (0)::numeric))
) TABLESPACE pg_default;

CREATE INDEX IF not exists idx_allocation_items_allocation_id 
  ON public.allocation_items USING btree (allocation_id) TABLESPACE pg_default;

CREATE INDEX IF not exists idx_allocation_items_raw_material_id 
  ON public.allocation_items USING btree (raw_material_id) TABLESPACE pg_default;


-- Material Costs Table
CREATE TABLE IF NOT EXISTS public.material_costs (
  id uuid not null default extensions.uuid_generate_v4 (),
  raw_material_id uuid not null,
  cost_per_unit numeric(10, 2) not null,
  effective_from timestamp with time zone not null default now(),
  effective_to timestamp with time zone null,
  created_by uuid null,
  created_at timestamp with time zone null default now(),
  constraint material_costs_pkey primary key (id),
  constraint material_costs_created_by_fkey foreign KEY (created_by) references users (id),
  constraint material_costs_raw_material_id_fkey foreign KEY (raw_material_id) references raw_materials (id) on delete CASCADE
) TABLESPACE pg_default;

CREATE INDEX IF not exists idx_material_costs_raw_material_id 
  ON public.material_costs USING btree (raw_material_id) TABLESPACE pg_default;

CREATE INDEX IF not exists idx_material_costs_effective_from 
  ON public.material_costs USING btree (effective_from) TABLESPACE pg_default;


-- Stock In Table
CREATE TABLE IF NOT EXISTS public.stock_in (
  id uuid not null default extensions.uuid_generate_v4 (),
  cloud_kitchen_id uuid not null,
  received_by uuid not null,
  receipt_date date not null default CURRENT_DATE,
  supplier_name text null,
  invoice_number text null,
  total_cost numeric(10, 2) null,
  notes text null,
  created_at timestamp with time zone null default now(),
  constraint stock_in_pkey primary key (id),
  constraint stock_in_cloud_kitchen_id_fkey foreign KEY (cloud_kitchen_id) references cloud_kitchens (id) on delete CASCADE,
  constraint stock_in_received_by_fkey foreign KEY (received_by) references users (id)
) TABLESPACE pg_default;

CREATE INDEX IF not exists idx_stock_in_cloud_kitchen_id 
  ON public.stock_in USING btree (cloud_kitchen_id) TABLESPACE pg_default;

CREATE INDEX IF not exists idx_stock_in_receipt_date 
  ON public.stock_in USING btree (receipt_date) TABLESPACE pg_default;

CREATE INDEX IF not exists idx_stock_in_received_by 
  ON public.stock_in USING btree (received_by) TABLESPACE pg_default;


