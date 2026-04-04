-- Migration: Add recipes and recipe_ingredients tables
-- Enables finished products to have recipes that automatically expand into raw/semi-finished ingredients in dispatch plans
-- =====================================================================

-- 1) Master table: one recipe per finished product (global scope)
create table if not exists public.recipes (
  id uuid primary key default extensions.uuid_generate_v4(),
  finished_product_id uuid not null,
  recipe_name text,
  version int not null default 1,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint recipes_finished_product_fk
    foreign key (finished_product_id)
    references public.raw_materials(id)
    on delete restrict
);

-- Ensure only one active recipe per finished product
create unique index if not exists uq_recipes_finished_active
  on public.recipes (finished_product_id)
  where is_active = true;

create index if not exists ix_recipes_finished_product
  on public.recipes (finished_product_id);

comment on table public.recipes is 
  'Master recipe table linking finished products to their ingredient compositions';
comment on column public.recipes.finished_product_id is 
  'References raw_materials where material_type = finished';
comment on column public.recipes.version is 
  'Recipe version number for tracking changes over time';
comment on column public.recipes.is_active is 
  'Only one active recipe per finished product allowed (enforced by unique index)';


-- 2) Child table: ingredients per recipe
create table if not exists public.recipe_ingredients (
  id uuid primary key default extensions.uuid_generate_v4(),
  recipe_id uuid not null,
  ingredient_material_id uuid not null,
  quantity_per_unit numeric(12,3) not null,
  wastage_percent numeric(5,2) not null default 0,
  sort_order int not null default 1,
  is_optional boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint recipe_ingredients_recipe_fk
    foreign key (recipe_id)
    references public.recipes(id)
    on delete cascade,

  constraint recipe_ingredients_material_fk
    foreign key (ingredient_material_id)
    references public.raw_materials(id)
    on delete restrict,

  constraint ck_recipe_ingredients_qty_positive
    check (quantity_per_unit > 0),

  constraint ck_recipe_ingredients_wastage_non_negative
    check (wastage_percent >= 0)
);

-- Prevent duplicate ingredient rows inside same recipe
create unique index if not exists uq_recipe_ingredients_recipe_material
  on public.recipe_ingredients (recipe_id, ingredient_material_id);

create index if not exists ix_recipe_ingredients_recipe
  on public.recipe_ingredients (recipe_id);

comment on table public.recipe_ingredients is 
  'Ingredient list for each recipe with quantities per unit of finished product';
comment on column public.recipe_ingredients.quantity_per_unit is 
  'Amount of ingredient needed per 1 unit of finished product';
comment on column public.recipe_ingredients.wastage_percent is 
  'Additional percentage to account for wastage (e.g., 5 means 5% extra)';
comment on column public.recipe_ingredients.sort_order is 
  'Display order for ingredients in admin UI';


-- 3) Type-safety triggers
-- Recipe head must be a finished product
create or replace function public.enforce_recipe_head_is_finished()
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
    raise exception 'recipes.finished_product_id must reference raw_materials.material_type = finished';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_recipes_head_type on public.recipes;
create trigger trg_recipes_head_type
before insert or update of finished_product_id on public.recipes
for each row execute function public.enforce_recipe_head_is_finished();


-- Ingredient must be raw_material or semi_finished (not finished)
create or replace function public.enforce_recipe_ingredient_type()
returns trigger
language plpgsql
as $$
declare
  v_type text;
begin
  select material_type into v_type
  from public.raw_materials
  where id = new.ingredient_material_id;

  if v_type not in ('raw_material', 'semi_finished') then
    raise exception 'recipe_ingredients.ingredient_material_id must be raw_material or semi_finished';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_recipe_ingredient_type on public.recipe_ingredients;
create trigger trg_recipe_ingredient_type
before insert or update of ingredient_material_id on public.recipe_ingredients
for each row execute function public.enforce_recipe_ingredient_type();
