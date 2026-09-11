-- =====================================================================
-- The "recipe" feature is a service kit, and is renamed to say so
--
-- WHAT THIS TABLE ACTUALLY HOLDS. `recipes` never described how a product
-- is made. It holds what an outlet needs *alongside* one unit of a finished
-- product in order to serve it: the butter it is cooked in, the chutney and
-- onions that go out on the plate. Adding one Peri Peri Soya Chaap to a
-- dispatch plan auto-fills those companion materials at their per-unit
-- quantity. That is a service kit — a packing rule — not a bill of
-- materials, and calling it a recipe made three different people read it as
-- one.
--
-- WHY IT MATTERS NOW. A real BOM is coming: finished and semi-finished
-- materials will get a component list with the exact quantities needed to
-- MAKE them, so their cost can be rolled up from raw material prices that
-- change with every vendor invoice. That feature wants the word "recipe",
-- because that is what the kitchen calls it. If the old feature keeps the
-- name, the two become impossible to tell apart in the schema, in the admin
-- sidebar, and in conversation. So the old feature moves out of the way
-- first, before the new one is built and before either table has enough
-- rows to make a rename expensive (at the time of writing: 1 kit, 5 items).
--
-- THE SHAPE DOES NOT CHANGE. Every column keeps its type, its default and
-- its data. This migration renames tables, columns, constraints, indexes,
-- functions, triggers, policies and comments, and nothing else. No rows are
-- read or written. The two type-safety triggers are recreated rather than
-- renamed, because their bodies name a column that this migration renames
-- (`ingredient_material_id` -> `material_id`) and PL/pgSQL resolves that at
-- run time — a renamed-but-not-rebodied function would fail on the next
-- insert, not now.
--
-- NAMES, OLD -> NEW
--
--   recipes                          -> service_kits
--     recipe_name                    -> kit_name
--   recipe_ingredients               -> service_kit_items
--     recipe_id                      -> service_kit_id
--     ingredient_material_id         -> material_id
--
-- WHAT ELSE HAS TO MOVE WITH IT. The frontend embeds these tables by
-- foreign-key constraint name (`raw_materials!recipes_finished_product_fk`),
-- so the constraint renames below are load-bearing for PostgREST, not
-- cosmetic — the admin screen 404s on the embed if the app ships without
-- them or this runs without the app. Deploy the two together.
--
-- THE ADMIN URL CHANGES TOO: /admin/operations/recipes becomes
-- /admin/operations/service-kits. Old bookmarks fall back to the admin
-- default section rather than erroring (see resolveAdminSection).
--
-- NOT APPLIED AUTOMATICALLY. Run this against the database.
-- =====================================================================

begin;

-- 1) Tables -----------------------------------------------------------

alter table public.recipes            rename to service_kits;
alter table public.recipe_ingredients rename to service_kit_items;


-- 2) Columns ----------------------------------------------------------

alter table public.service_kits      rename column recipe_name            to kit_name;
alter table public.service_kit_items rename column recipe_id              to service_kit_id;
alter table public.service_kit_items rename column ingredient_material_id to material_id;


-- 3) Constraints ------------------------------------------------------
-- The FK names are what PostgREST uses to disambiguate the two joins from
-- service_kit_items to raw_materials, so the frontend selects reference
-- them verbatim.

alter table public.service_kits
  rename constraint recipes_finished_product_fk to service_kits_finished_product_fk;

alter table public.service_kit_items
  rename constraint recipe_ingredients_recipe_fk to service_kit_items_kit_fk;

alter table public.service_kit_items
  rename constraint recipe_ingredients_material_fk to service_kit_items_material_fk;

alter table public.service_kit_items
  rename constraint ck_recipe_ingredients_qty_positive to ck_service_kit_items_qty_positive;

alter table public.service_kit_items
  rename constraint ck_recipe_ingredients_wastage_non_negative
                 to ck_service_kit_items_wastage_non_negative;


-- 4) Indexes ----------------------------------------------------------
-- Primary-key indexes keep the old table's name through a table rename and
-- have to be moved by hand.

alter index public.recipes_pkey            rename to service_kits_pkey;
alter index public.recipe_ingredients_pkey rename to service_kit_items_pkey;

alter index public.uq_recipes_finished_active rename to uq_service_kits_finished_active;
alter index public.ix_recipes_finished_product rename to ix_service_kits_finished_product;

alter index public.uq_recipe_ingredients_recipe_material
  rename to uq_service_kit_items_kit_material;
alter index public.ix_recipe_ingredients_recipe
  rename to ix_service_kit_items_kit;


-- 5) Type-safety triggers ---------------------------------------------
-- Same two rules as before, restated against the new names: the head of a
-- kit is a finished product, and the things packed with it are raw or
-- semi-finished materials. Recreated, not renamed — see the header.

drop trigger if exists trg_recipes_head_type on public.service_kits;
drop trigger if exists trg_recipe_ingredient_type on public.service_kit_items;

drop function if exists public.enforce_recipe_head_is_finished();
drop function if exists public.enforce_recipe_ingredient_type();

create or replace function public.enforce_service_kit_head_is_finished()
returns trigger
language plpgsql
as $$
declare
  v_type text;
begin
  select material_type into v_type
  from public.raw_materials
  where id = new.finished_product_id;

  if v_type is distinct from 'finished' then
    raise exception 'service_kits.finished_product_id must reference raw_materials.material_type = finished';
  end if;

  return new;
end;
$$;

create trigger trg_service_kits_head_type
before insert or update of finished_product_id on public.service_kits
for each row execute function public.enforce_service_kit_head_is_finished();

create or replace function public.enforce_service_kit_item_type()
returns trigger
language plpgsql
as $$
declare
  v_type text;
begin
  select material_type into v_type
  from public.raw_materials
  where id = new.material_id;

  if v_type not in ('raw_material', 'semi_finished') then
    raise exception 'service_kit_items.material_id must be raw_material or semi_finished';
  end if;

  return new;
end;
$$;

create trigger trg_service_kit_item_type
before insert or update of material_id on public.service_kit_items
for each row execute function public.enforce_service_kit_item_type();


-- 6) Row-level security policies --------------------------------------
-- Unchanged in effect: any active app user may read, only an active admin
-- may write. Renamed so the policy list does not still say "recipe".

alter policy recipes_select_for_app_users on public.service_kits
  rename to service_kits_select_for_app_users;
alter policy recipes_insert_admin_only on public.service_kits
  rename to service_kits_insert_admin_only;
alter policy recipes_update_admin_only on public.service_kits
  rename to service_kits_update_admin_only;
alter policy recipes_delete_admin_only on public.service_kits
  rename to service_kits_delete_admin_only;

alter policy recipe_ingredients_select_for_app_users on public.service_kit_items
  rename to service_kit_items_select_for_app_users;
alter policy recipe_ingredients_insert_admin_only on public.service_kit_items
  rename to service_kit_items_insert_admin_only;
alter policy recipe_ingredients_update_admin_only on public.service_kit_items
  rename to service_kit_items_update_admin_only;
alter policy recipe_ingredients_delete_admin_only on public.service_kit_items
  rename to service_kit_items_delete_admin_only;


-- 7) Comments ---------------------------------------------------------

comment on table public.service_kits is
  'What an outlet needs alongside one unit of a finished product to serve it — companion materials and cooking consumables, auto-filled into dispatch plans. Not a bill of materials: it does not describe how the product is made.';
comment on column public.service_kits.finished_product_id is
  'References raw_materials where material_type = finished';
comment on column public.service_kits.kit_name is
  'Display name for the kit, e.g. "Peri Peri Kabab Service Kit"';
comment on column public.service_kits.version is
  'Kit version number for tracking changes over time';
comment on column public.service_kits.is_active is
  'Only one active kit per finished product allowed (enforced by uq_service_kits_finished_active)';

comment on table public.service_kit_items is
  'The materials packed with each finished product, at their quantity per unit sold';
comment on column public.service_kit_items.material_id is
  'The companion material — raw_material or semi_finished, enforced by trg_service_kit_item_type';
comment on column public.service_kit_items.quantity_per_unit is
  'Amount of this material needed per 1 unit of the finished product';
comment on column public.service_kit_items.wastage_percent is
  'Additional percentage to account for wastage (e.g. 5 means 5% extra)';
comment on column public.service_kit_items.sort_order is
  'Display order for items in the admin UI';

commit;
