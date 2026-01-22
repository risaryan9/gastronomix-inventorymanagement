-- ============================================================================
-- DATABASE MIGRATION SCRIPT
-- Drops all existing tables and creates new schema with FIFO inventory logic
-- ============================================================================

-- ============================================================================
-- STEP 1: DROP ALL EXISTING TABLES (in correct order to handle dependencies)
-- ============================================================================

DROP TABLE IF EXISTS public.allocation_items CASCADE;
DROP TABLE IF EXISTS public.allocations CASCADE;
DROP TABLE IF EXISTS public.stock_in_items CASCADE;
DROP TABLE IF EXISTS public.stock_in CASCADE;
DROP TABLE IF EXISTS public.material_costs CASCADE;
DROP TABLE IF EXISTS public.inventory CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.outlets CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.raw_materials CASCADE;
DROP TABLE IF EXISTS public.cloud_kitchens CASCADE;

-- ============================================================================
-- STEP 2: CREATE BASE TABLES (no foreign key dependencies)
-- ============================================================================

-- Cloud Kitchens Table (unchanged)
CREATE TABLE public.cloud_kitchens (
    id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    address TEXT NULL,
    is_active BOOLEAN NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT cloud_kitchens_pkey PRIMARY KEY (id),
    CONSTRAINT cloud_kitchens_code_key UNIQUE (code)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_cloud_kitchens_code 
    ON public.cloud_kitchens USING btree (code) TABLESPACE pg_default;

-- Raw Materials Table (added low_stock_threshold)
CREATE TABLE public.raw_materials (
    id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    unit TEXT NOT NULL,
    description TEXT NULL,
    category TEXT NULL,
    low_stock_threshold NUMERIC(10, 3) NULL DEFAULT 0,
    is_active BOOLEAN NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT raw_materials_pkey PRIMARY KEY (id),
    CONSTRAINT raw_materials_code_key UNIQUE (code)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_raw_materials_category 
    ON public.raw_materials USING btree (category) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_raw_materials_code 
    ON public.raw_materials USING btree (code) TABLESPACE pg_default;

-- ============================================================================
-- STEP 3: CREATE DEPENDENT TABLES
-- ============================================================================

-- Users Table (unchanged)
CREATE TABLE public.users (
    id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    email TEXT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL,
    cloud_kitchen_id UUID NULL,
    is_active BOOLEAN NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    login_key TEXT NULL,
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_cloud_kitchen_id_fkey FOREIGN KEY (cloud_kitchen_id) 
        REFERENCES cloud_kitchens (id),
    CONSTRAINT users_login_constraint CHECK (
        (
            (role = 'admin'::text) 
            AND (email IS NOT NULL) 
            AND (login_key IS NULL)
        ) OR (
            (role <> 'admin'::text) 
            AND (login_key IS NOT NULL) 
            AND (email IS NULL)
        )
    ),
    CONSTRAINT users_role_check CHECK (
        role = ANY (ARRAY[
            'supervisor'::text,
            'purchase_manager'::text,
            'admin'::text
        ])
    )
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_users_cloud_kitchen_id 
    ON public.users USING btree (cloud_kitchen_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_users_role 
    ON public.users USING btree (role) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_users_email 
    ON public.users USING btree (email) TABLESPACE pg_default;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_key_unique 
    ON public.users USING btree (login_key) TABLESPACE pg_default
    WHERE (login_key IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_users_login_key 
    ON public.users USING btree (login_key) TABLESPACE pg_default;

-- Outlets Table (unchanged)
CREATE TABLE public.outlets (
    id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    cloud_kitchen_id UUID NOT NULL,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    address TEXT NULL,
    contact_person TEXT NULL,
    contact_phone TEXT NULL,
    is_active BOOLEAN NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT outlets_pkey PRIMARY KEY (id),
    CONSTRAINT outlets_cloud_kitchen_id_code_key UNIQUE (cloud_kitchen_id, code),
    CONSTRAINT outlets_cloud_kitchen_id_fkey FOREIGN KEY (cloud_kitchen_id) 
        REFERENCES cloud_kitchens (id) ON DELETE CASCADE
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_outlets_cloud_kitchen_id 
    ON public.outlets USING btree (cloud_kitchen_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_outlets_code 
    ON public.outlets USING btree (code) TABLESPACE pg_default;

-- Audit Logs Table (unchanged)
CREATE TABLE public.audit_logs (
    id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    user_id UUID NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    old_values JSONB NULL,
    new_values JSONB NULL,
    ip_address INET NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE NULL DEFAULT NOW(),
    CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
    CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) 
        REFERENCES users (id)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id 
    ON public.audit_logs USING btree (user_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type 
    ON public.audit_logs USING btree (entity_type, entity_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at 
    ON public.audit_logs USING btree (created_at) TABLESPACE pg_default;

-- Inventory Table (modified - removed low_stock_threshold, cache table)
CREATE TABLE public.inventory (
    id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    cloud_kitchen_id UUID NOT NULL,
    raw_material_id UUID NOT NULL,
    quantity NUMERIC(10, 3) NOT NULL DEFAULT 0,
    last_updated_at TIMESTAMP WITH TIME ZONE NULL DEFAULT NOW(),
    updated_by UUID NULL,
    CONSTRAINT inventory_pkey PRIMARY KEY (id),
    CONSTRAINT inventory_cloud_kitchen_id_raw_material_id_key UNIQUE (cloud_kitchen_id, raw_material_id),
    CONSTRAINT inventory_cloud_kitchen_id_fkey FOREIGN KEY (cloud_kitchen_id) 
        REFERENCES cloud_kitchens (id) ON DELETE CASCADE,
    CONSTRAINT inventory_raw_material_id_fkey FOREIGN KEY (raw_material_id) 
        REFERENCES raw_materials (id) ON DELETE CASCADE,
    CONSTRAINT inventory_updated_by_fkey FOREIGN KEY (updated_by) 
        REFERENCES users (id),
    CONSTRAINT inventory_quantity_check CHECK (quantity >= 0::numeric)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_inventory_cloud_kitchen_id 
    ON public.inventory USING btree (cloud_kitchen_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_inventory_raw_material_id 
    ON public.inventory USING btree (raw_material_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_inventory_low_stock 
    ON public.inventory USING btree (cloud_kitchen_id, quantity) TABLESPACE pg_default;

-- ============================================================================
-- STEP 4: CREATE ALLOCATION REQUEST TABLES (renamed from allocations)
-- ============================================================================

-- Allocation Requests Table (renamed from allocations, added is_packed)
CREATE TABLE public.allocation_requests (
    id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    outlet_id UUID NOT NULL,
    cloud_kitchen_id UUID NOT NULL,
    requested_by UUID NOT NULL,
    request_date DATE NOT NULL DEFAULT CURRENT_DATE,
    is_packed BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE NULL DEFAULT NOW(),
    CONSTRAINT allocation_requests_pkey PRIMARY KEY (id),
    CONSTRAINT allocation_requests_requested_by_fkey FOREIGN KEY (requested_by) 
        REFERENCES users (id),
    CONSTRAINT allocation_requests_cloud_kitchen_id_fkey FOREIGN KEY (cloud_kitchen_id) 
        REFERENCES cloud_kitchens (id) ON DELETE CASCADE,
    CONSTRAINT allocation_requests_outlet_id_fkey FOREIGN KEY (outlet_id) 
        REFERENCES outlets (id) ON DELETE CASCADE
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_allocation_requests_outlet_id 
    ON public.allocation_requests USING btree (outlet_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_allocation_requests_cloud_kitchen_id 
    ON public.allocation_requests USING btree (cloud_kitchen_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_allocation_requests_request_date 
    ON public.allocation_requests USING btree (request_date) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_allocation_requests_is_packed 
    ON public.allocation_requests USING btree (is_packed) TABLESPACE pg_default;

-- Allocation Request Items Table (renamed from allocation_items)
CREATE TABLE public.allocation_request_items (
    id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    allocation_request_id UUID NOT NULL,
    raw_material_id UUID NOT NULL,
    quantity NUMERIC(10, 3) NOT NULL,
    CONSTRAINT allocation_request_items_pkey PRIMARY KEY (id),
    CONSTRAINT allocation_request_items_request_material_key UNIQUE (allocation_request_id, raw_material_id),
    CONSTRAINT allocation_request_items_request_id_fkey FOREIGN KEY (allocation_request_id) 
        REFERENCES allocation_requests (id) ON DELETE CASCADE,
    CONSTRAINT allocation_request_items_raw_material_id_fkey FOREIGN KEY (raw_material_id) 
        REFERENCES raw_materials (id) ON DELETE CASCADE,
    CONSTRAINT allocation_request_items_quantity_check CHECK (quantity > 0::numeric)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_allocation_request_items_request_id 
    ON public.allocation_request_items USING btree (allocation_request_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_allocation_request_items_raw_material_id 
    ON public.allocation_request_items USING btree (raw_material_id) TABLESPACE pg_default;

-- ============================================================================
-- STEP 5: CREATE STOCK IN TABLES (FIFO batches)
-- ============================================================================

-- Stock In Table (header/parent record for purchases)
CREATE TABLE public.stock_in (
    id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    cloud_kitchen_id UUID NOT NULL,
    received_by UUID NOT NULL,
    receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
    supplier_name TEXT NULL,
    invoice_number TEXT NULL,
    total_cost NUMERIC(10, 2) NULL,
    notes TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE NULL DEFAULT NOW(),
    CONSTRAINT stock_in_pkey PRIMARY KEY (id),
    CONSTRAINT stock_in_cloud_kitchen_id_fkey FOREIGN KEY (cloud_kitchen_id) 
        REFERENCES cloud_kitchens (id) ON DELETE CASCADE,
    CONSTRAINT stock_in_received_by_fkey FOREIGN KEY (received_by) 
        REFERENCES users (id)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_stock_in_cloud_kitchen_id 
    ON public.stock_in USING btree (cloud_kitchen_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_stock_in_receipt_date 
    ON public.stock_in USING btree (receipt_date) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_stock_in_received_by 
    ON public.stock_in USING btree (received_by) TABLESPACE pg_default;

-- Stock In Batches Table (FIFO tracking - replaces material_costs)
CREATE TABLE public.stock_in_batches (
    id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    stock_in_id UUID NOT NULL,
    raw_material_id UUID NOT NULL,
    cloud_kitchen_id UUID NOT NULL,
    quantity_purchased NUMERIC(10, 3) NOT NULL,
    quantity_remaining NUMERIC(10, 3) NOT NULL,
    unit_cost NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NULL DEFAULT NOW(),
    CONSTRAINT stock_in_batches_pkey PRIMARY KEY (id),
    CONSTRAINT stock_in_batches_stock_in_id_fkey FOREIGN KEY (stock_in_id) 
        REFERENCES stock_in (id) ON DELETE CASCADE,
    CONSTRAINT stock_in_batches_raw_material_id_fkey FOREIGN KEY (raw_material_id) 
        REFERENCES raw_materials (id) ON DELETE CASCADE,
    CONSTRAINT stock_in_batches_cloud_kitchen_id_fkey FOREIGN KEY (cloud_kitchen_id) 
        REFERENCES cloud_kitchens (id) ON DELETE CASCADE,
    CONSTRAINT stock_in_batches_quantity_purchased_check CHECK (quantity_purchased > 0::numeric),
    CONSTRAINT stock_in_batches_quantity_remaining_check CHECK (quantity_remaining >= 0::numeric),
    CONSTRAINT stock_in_batches_remaining_lte_purchased_check CHECK (quantity_remaining <= quantity_purchased)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_stock_in_batches_stock_in_id 
    ON public.stock_in_batches USING btree (stock_in_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_stock_in_batches_raw_material_id 
    ON public.stock_in_batches USING btree (raw_material_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_stock_in_batches_cloud_kitchen_id 
    ON public.stock_in_batches USING btree (cloud_kitchen_id) TABLESPACE pg_default;
-- Critical index for FIFO queries
CREATE INDEX IF NOT EXISTS idx_stock_in_batches_fifo_lookup 
    ON public.stock_in_batches USING btree (raw_material_id, cloud_kitchen_id, created_at) 
    TABLESPACE pg_default
    WHERE (quantity_remaining > 0::numeric);

-- ============================================================================
-- STEP 6: CREATE STOCK OUT TABLES (actual allocations)
-- ============================================================================

-- Stock Out Table (actual allocation that decrements inventory)
CREATE TABLE public.stock_out (
    id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    allocation_request_id UUID NOT NULL,
    outlet_id UUID NOT NULL,
    cloud_kitchen_id UUID NOT NULL,
    allocated_by UUID NOT NULL,
    allocation_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE NULL DEFAULT NOW(),
    CONSTRAINT stock_out_pkey PRIMARY KEY (id),
    CONSTRAINT stock_out_allocation_request_id_fkey FOREIGN KEY (allocation_request_id) 
        REFERENCES allocation_requests (id) ON DELETE CASCADE,
    CONSTRAINT stock_out_outlet_id_fkey FOREIGN KEY (outlet_id) 
        REFERENCES outlets (id) ON DELETE CASCADE,
    CONSTRAINT stock_out_cloud_kitchen_id_fkey FOREIGN KEY (cloud_kitchen_id) 
        REFERENCES cloud_kitchens (id) ON DELETE CASCADE,
    CONSTRAINT stock_out_allocated_by_fkey FOREIGN KEY (allocated_by) 
        REFERENCES users (id)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_stock_out_allocation_request_id 
    ON public.stock_out USING btree (allocation_request_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_stock_out_outlet_id 
    ON public.stock_out USING btree (outlet_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_stock_out_cloud_kitchen_id 
    ON public.stock_out USING btree (cloud_kitchen_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_stock_out_allocation_date 
    ON public.stock_out USING btree (allocation_date) TABLESPACE pg_default;

-- Stock Out Items Table (details of what was allocated)
CREATE TABLE public.stock_out_items (
    id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    stock_out_id UUID NOT NULL,
    raw_material_id UUID NOT NULL,
    quantity NUMERIC(10, 3) NOT NULL,
    CONSTRAINT stock_out_items_pkey PRIMARY KEY (id),
    CONSTRAINT stock_out_items_stock_out_id_material_key UNIQUE (stock_out_id, raw_material_id),
    CONSTRAINT stock_out_items_stock_out_id_fkey FOREIGN KEY (stock_out_id) 
        REFERENCES stock_out (id) ON DELETE CASCADE,
    CONSTRAINT stock_out_items_raw_material_id_fkey FOREIGN KEY (raw_material_id) 
        REFERENCES raw_materials (id) ON DELETE CASCADE,
    CONSTRAINT stock_out_items_quantity_check CHECK (quantity > 0::numeric)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_stock_out_items_stock_out_id 
    ON public.stock_out_items USING btree (stock_out_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_stock_out_items_raw_material_id 
    ON public.stock_out_items USING btree (raw_material_id) TABLESPACE pg_default;

-- ============================================================================
-- STEP 7: ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE public.cloud_kitchens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocation_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_in ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_in_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_out ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_out_items ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- POLICIES FOR CLOUD_KITCHENS
-- ============================================================================

-- Admin: full access
CREATE POLICY "Admin full access to cloud_kitchens" ON public.cloud_kitchens
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Purchase Manager & Supervisor: read their own kitchen
CREATE POLICY "Users read own cloud_kitchen" ON public.cloud_kitchens
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.cloud_kitchen_id = cloud_kitchens.id
        )
    );

-- ============================================================================
-- POLICIES FOR RAW_MATERIALS
-- ============================================================================

-- Admin: full access
CREATE POLICY "Admin full access to raw_materials" ON public.raw_materials
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Purchase Manager: read and create
CREATE POLICY "Purchase Manager read raw_materials" ON public.raw_materials
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'purchase_manager'
        )
    );

CREATE POLICY "Purchase Manager create raw_materials" ON public.raw_materials
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'purchase_manager'
        )
    );

-- Supervisor: read only
CREATE POLICY "Supervisor read raw_materials" ON public.raw_materials
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'supervisor'
        )
    );

-- ============================================================================
-- POLICIES FOR USERS
-- ============================================================================

-- Admin: full access
CREATE POLICY "Admin full access to users" ON public.users
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Users can read their own record
CREATE POLICY "Users read own record" ON public.users
    FOR SELECT
    TO authenticated
    USING (id = auth.uid());

-- ============================================================================
-- POLICIES FOR OUTLETS
-- ============================================================================

-- Admin: full access
CREATE POLICY "Admin full access to outlets" ON public.outlets
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Purchase Manager & Supervisor: read outlets in their kitchen
CREATE POLICY "Users read outlets in own kitchen" ON public.outlets
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.cloud_kitchen_id = outlets.cloud_kitchen_id
        )
    );

-- ============================================================================
-- POLICIES FOR AUDIT_LOGS
-- ============================================================================

-- Admin: full access
CREATE POLICY "Admin full access to audit_logs" ON public.audit_logs
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Users can read logs related to their kitchen
CREATE POLICY "Users read audit_logs for own kitchen" ON public.audit_logs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.cloud_kitchen_id IS NOT NULL
        )
    );

-- ============================================================================
-- POLICIES FOR INVENTORY
-- ============================================================================

-- Admin: full access
CREATE POLICY "Admin full access to inventory" ON public.inventory
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Purchase Manager: full access to their kitchen's inventory
CREATE POLICY "Purchase Manager full access to own kitchen inventory" ON public.inventory
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'purchase_manager'
            AND users.cloud_kitchen_id = inventory.cloud_kitchen_id
        )
    );

-- Supervisor: NO ACCESS (as per new logic)

-- ============================================================================
-- POLICIES FOR ALLOCATION_REQUESTS
-- ============================================================================

-- Admin: full access
CREATE POLICY "Admin full access to allocation_requests" ON public.allocation_requests
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Supervisor: create and read requests for their kitchen
CREATE POLICY "Supervisor create allocation_requests" ON public.allocation_requests
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'supervisor'
            AND users.cloud_kitchen_id = allocation_requests.cloud_kitchen_id
        )
    );

CREATE POLICY "Supervisor read allocation_requests" ON public.allocation_requests
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'supervisor'
            AND users.cloud_kitchen_id = allocation_requests.cloud_kitchen_id
        )
    );

-- Purchase Manager: read and update requests for their kitchen
CREATE POLICY "Purchase Manager read allocation_requests" ON public.allocation_requests
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'purchase_manager'
            AND users.cloud_kitchen_id = allocation_requests.cloud_kitchen_id
        )
    );

CREATE POLICY "Purchase Manager update allocation_requests" ON public.allocation_requests
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'purchase_manager'
            AND users.cloud_kitchen_id = allocation_requests.cloud_kitchen_id
        )
    );

-- ============================================================================
-- POLICIES FOR ALLOCATION_REQUEST_ITEMS
-- ============================================================================

-- Admin: full access
CREATE POLICY "Admin full access to allocation_request_items" ON public.allocation_request_items
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Supervisor: create and read items for their requests
CREATE POLICY "Supervisor manage allocation_request_items" ON public.allocation_request_items
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            JOIN public.allocation_requests ON allocation_requests.id = allocation_request_items.allocation_request_id
            WHERE users.id = auth.uid() 
            AND users.role = 'supervisor'
            AND users.cloud_kitchen_id = allocation_requests.cloud_kitchen_id
        )
    );

-- Purchase Manager: read and update items for their kitchen's requests
CREATE POLICY "Purchase Manager manage allocation_request_items" ON public.allocation_request_items
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            JOIN public.allocation_requests ON allocation_requests.id = allocation_request_items.allocation_request_id
            WHERE users.id = auth.uid() 
            AND users.role = 'purchase_manager'
            AND users.cloud_kitchen_id = allocation_requests.cloud_kitchen_id
        )
    );

-- ============================================================================
-- POLICIES FOR STOCK_IN
-- ============================================================================

-- Admin: full access
CREATE POLICY "Admin full access to stock_in" ON public.stock_in
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Purchase Manager: full access for their kitchen
CREATE POLICY "Purchase Manager full access to stock_in" ON public.stock_in
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'purchase_manager'
            AND users.cloud_kitchen_id = stock_in.cloud_kitchen_id
        )
    );

-- ============================================================================
-- POLICIES FOR STOCK_IN_BATCHES
-- ============================================================================

-- Admin: full access
CREATE POLICY "Admin full access to stock_in_batches" ON public.stock_in_batches
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Purchase Manager: full access for their kitchen
CREATE POLICY "Purchase Manager full access to stock_in_batches" ON public.stock_in_batches
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'purchase_manager'
            AND users.cloud_kitchen_id = stock_in_batches.cloud_kitchen_id
        )
    );

-- ============================================================================
-- POLICIES FOR STOCK_OUT
-- ============================================================================

-- Admin: full access
CREATE POLICY "Admin full access to stock_out" ON public.stock_out
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Purchase Manager: create and read for their kitchen
CREATE POLICY "Purchase Manager manage stock_out" ON public.stock_out
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'purchase_manager'
            AND users.cloud_kitchen_id = stock_out.cloud_kitchen_id
        )
    );

-- Supervisor: read only for their kitchen
CREATE POLICY "Supervisor read stock_out" ON public.stock_out
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'supervisor'
            AND users.cloud_kitchen_id = stock_out.cloud_kitchen_id
        )
    );

-- ============================================================================
-- POLICIES FOR STOCK_OUT_ITEMS
-- ============================================================================

-- Admin: full access
CREATE POLICY "Admin full access to stock_out_items" ON public.stock_out_items
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Purchase Manager: manage items for their kitchen's stock outs
CREATE POLICY "Purchase Manager manage stock_out_items" ON public.stock_out_items
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            JOIN public.stock_out ON stock_out.id = stock_out_items.stock_out_id
            WHERE users.id = auth.uid() 
            AND users.role = 'purchase_manager'
            AND users.cloud_kitchen_id = stock_out.cloud_kitchen_id
        )
    );

-- Supervisor: read only for their kitchen
CREATE POLICY "Supervisor read stock_out_items" ON public.stock_out_items
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users 
            JOIN public.stock_out ON stock_out.id = stock_out_items.stock_out_id
            WHERE users.id = auth.uid() 
            AND users.role = 'supervisor'
            AND users.cloud_kitchen_id = stock_out.cloud_kitchen_id
        )
    );

-- ============================================================================
-- STEP 8: CREATE TRIGGER FOR AUTO-POPULATING INVENTORY
-- ============================================================================

-- Function to auto-create inventory entries when new raw material is added
CREATE OR REPLACE FUNCTION public.create_inventory_for_new_material()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert inventory records for all cloud kitchens
    INSERT INTO public.inventory (cloud_kitchen_id, raw_material_id, quantity, updated_by)
    SELECT 
        ck.id,
        NEW.id,
        0,
        NULL
    FROM public.cloud_kitchens ck
    WHERE ck.is_active = TRUE;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create inventory when raw material is added
CREATE TRIGGER trigger_create_inventory_for_new_material
    AFTER INSERT ON public.raw_materials
    FOR EACH ROW
    EXECUTE FUNCTION public.create_inventory_for_new_material();

-- Function to auto-create inventory entry when new cloud kitchen is added
CREATE OR REPLACE FUNCTION public.create_inventory_for_new_kitchen()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert inventory records for all raw materials
    INSERT INTO public.inventory (cloud_kitchen_id, raw_material_id, quantity, updated_by)
    SELECT 
        NEW.id,
        rm.id,
        0,
        NULL
    FROM public.raw_materials rm
    WHERE rm.is_active = TRUE;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create inventory when cloud kitchen is added
CREATE TRIGGER trigger_create_inventory_for_new_kitchen
    AFTER INSERT ON public.cloud_kitchens
    FOR EACH ROW
    EXECUTE FUNCTION public.create_inventory_for_new_kitchen();

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Summary of changes:
-- 1. Dropped all old tables (allocations, allocation_items, stock_in_items, material_costs)
-- 2. Renamed allocations -> allocation_requests (added is_packed column)
-- 3. Renamed allocation_items -> allocation_request_items
-- 4. Modified raw_materials (added low_stock_threshold)
-- 5. Modified inventory (removed low_stock_threshold, auto-populate on new material/kitchen)
-- 6. Created stock_in_batches table for FIFO tracking
-- 7. Created stock_out and stock_out_items tables for actual allocations
-- 8. Updated all policies according to new role logic:
--    - Supervisor: Can only create allocation requests, no inventory access
--    - Purchase Manager: Full inventory access, can approve/modify requests, create stock in/out
--    - Admin: Full access to everything
-- 9. Added triggers to auto-populate inventory table
