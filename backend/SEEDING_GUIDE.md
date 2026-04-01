# Raw Materials Seeding Guide

## Quick Start

1. **Install dependencies** (first time only):
   ```bash
   npm install
   ```

2. **Prepare your CSV file**:
   - Edit `backend/materials.csv` with your materials data
   - Or replace it with your own CSV file

3. **Run the seed script**:
   ```bash
   npm run seed-materials
   ```

## CSV File Format

The CSV should have these columns (tab or comma separated):

| Column | Required | Description | Example Values |
|--------|----------|-------------|----------------|
| `name` | ✅ Yes | Material name | `Amul Butter`, `Chicken Breast` |
| `unit` | ✅ Yes | Unit of measurement | `kg`, `gm`, `liter`, `nos`, `packets`, `btl` |
| `description` | No | Material description | `Premium quality butter` |
| `material_type` | ✅ Yes | Material type | `raw_material`, `semi_finished`, `finished`, `non_food` |
| `category` | ✅ Yes | Material category | For raw: see categories below. For SF/FF/NF: auto-assigned |
| `low_stock_threshold` | No | Alert threshold | `45.000`, `12.500` |
| `is_active` | No | Active status | `TRUE` or `FALSE` (default: TRUE) |
| `brand` | No | Brand name | Optional for all material types |
| `vendor` | Conditional | Vendor name | Required for raw materials only |
| `brand_codes` | No | Brand mapping | `all`, `bp,nk,ec`, `["bp"]` |

### Valid Categories for Raw Materials

Must be one of these (case-sensitive):
- `Baking Essentials`
- `Condiments & Toppings`
- `Dairy & Dairy Product`
- `Dry Fruits & Nuts`
- `Edible Oils & Fats`
- `Food Grains & Grain Products`
- `Fruits & Vegetables`
- `Herbs & Spices`
- `Indian Breads & Breads`
- `Meat & Poultry & Cold Cuts`
- `Packaged Deserts & Sweets`
- `Packaged Water & Bevereges`
- `Pulses & Lentils`
- `Sauces & Seasoning`
- `Inedible & Packaging`

### Categories for Semi-Finished/Finished/Non-Food

- Semi-finished materials: Category auto-assigned as `SemiFinished`
- Finished materials: Category auto-assigned as `Finished`
- Non-food materials: Category auto-assigned as `Inedible & Packaging`

### Valid Units

Must be one of these:
- `nos` (numbers/pieces)
- `kg` (kilograms)
- `gm` (grams)
- `liter` (liters)
- `packets` (packets)
- `btl` (bottles)

## Example CSV

```csv
name	unit	description	category	low_stock_threshold	is_active	brand	vendor	material_type	brand_codes
Amul Butter	kg	Premium quality butter	Dairy & Dairy Product	45.000	TRUE	Amul	Hyperpure	raw_material	all
Amul Fresh Cream	kg	Fresh dairy cream	Dairy & Dairy Product	30.000	TRUE	Amul	Hyperpure	raw_material	all
Chicken Breast Boneless	kg	Fresh boneless chicken breast	Meat & Poultry & Cold Cuts	12.000	TRUE	Local	Fresko Choice	raw_material	all
Basmati Rice	kg	Premium basmati rice	Food Grains & Grain Products	50.000	TRUE	India Gate	Hyperpure	raw_material	all
Red Chilli Powder	kg	Kashmiri red chilli powder	Herbs & Spices	22.000	TRUE	Eastern	Hyperpure	raw_material	all
Poolish	gm	Pre-fermented pizza dough	SemiFinished	8	TRUE	Boom Pizza	NULL	semi_finished	bp
Peri Peri Soya Chaap	nos	Grilled soya chaap	Finished	20	TRUE	El Chaapo	NULL	finished	ec
```

## What the Script Does

1. **Reads CSV**: Parses your materials.csv file
2. **Generates Codes**: Auto-generates material codes like:
   - `RM-DRYP-001` for first Dairy & Dairy Product item
   - `RM-MTPC-042` for 42nd Meat & Poultry & Cold Cuts item
   - `RM-HBSP-015` for 15th Herbs & Spices item
   - `SF-001` for first semi-finished item
   - `FF-001` for first finished item
   - `NF-001` for first non-food item
3. **Inserts Materials**: Adds each material to the `raw_materials` table
4. **Creates Inventory**: The database trigger automatically creates inventory entries for all active cloud kitchens

## Output Example

```
Starting raw materials seeding...

Found 12 materials to seed

✅ [1/12] Amul Butter (RM-DRYP-001)
✅ [2/12] Amul Fresh Cream (RM-DRYP-002)
✅ [3/12] Chicken Breast Boneless (RM-MTPC-001)
✅ [4/12] Basmati Rice (RM-FDGP-001)
...

============================================================
Seeding complete!
✅ Success: 12
❌ Failed: 0
📊 Total: 12
============================================================

📦 Inventory entries were automatically created by the trigger
   for all active cloud kitchens.
```

## Troubleshooting

### Error: "Missing Supabase credentials"
Make sure your `.env` file in the project root has:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Error: "ENOENT: no such file"
Make sure `materials.csv` exists in the `backend/` folder.

### Error: "duplicate key value violates unique constraint"
A material with that code or name might already exist. Check your database.

### Invalid Category Error
Make sure the category in your CSV exactly matches one of the valid categories (case-sensitive). For raw materials, use the full category names with ampersands and spaces as shown above. For semi_finished/finished, the category is auto-assigned.

## Adding More Materials Later

You can run the script multiple times. It will:
- Skip materials that already exist (based on unique constraints)
- Generate the next available code number for each category
- Only add new materials

## Notes

- Material codes are automatically generated and incremented per category
- The `code` column in your CSV is ignored (auto-generated)
- Inventory entries for all active cloud kitchens are created automatically
- The script uses the service role key for admin access
- Decimal values like `45.000` in `low_stock_threshold` are handled correctly
