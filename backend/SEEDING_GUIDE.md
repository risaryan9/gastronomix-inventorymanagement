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
| `unit` | ✅ Yes | Unit of measurement | `kg`, `liter`, `nos`, `packets`, `btl` |
| `description` | No | Material description | `Premium quality butter` |
| `category` | ✅ Yes | Material category | `Dairy`, `Meat`, `Spices`, etc. |
| `low_stock_threshold` | No | Alert threshold | `45.000`, `12.500` |
| `is_active` | No | Active status | `TRUE` or `FALSE` (default: TRUE) |
| `brand` | No | Brand name | `Amul`, `Eastern` |
| `vendor` | No | Vendor name | `Hyperpure`, `Fresko Choice` |

### Valid Categories

Must be one of these (case-sensitive):
- `Meat`
- `Grains`
- `Vegetables`
- `Oils`
- `Spices`
- `Dairy`
- `Packaging`
- `Sanitary`
- `Misc`

### Valid Units

Must be one of these:
- `nos` (numbers/pieces)
- `kg` (kilograms)
- `liter` (liters)
- `packets` (packets)
- `btl` (bottles)

## Example CSV

```csv
name	unit	description	category	low_stock_threshold	is_active	brand	vendor
Amul Butter	kg	Premium quality butter	Dairy	45.000	TRUE	Amul	Hyperpure
Amul Fresh Cream	kg	Fresh dairy cream	Dairy	30.000	TRUE	Amul	Hyperpure
Chicken Breast Boneless	kg	Fresh boneless chicken breast	Meat	12.000	TRUE	Local	Fresko Choice
Basmati Rice	kg	Premium basmati rice	Grains	50.000	TRUE	India Gate	Hyperpure
Red Chilli Powder	kg	Kashmiri red chilli powder	Spices	22.000	TRUE	Eastern	Hyperpure
```

## What the Script Does

1. **Reads CSV**: Parses your materials.csv file
2. **Generates Codes**: Auto-generates material codes like:
   - `RM-DARY-001` for first Dairy item
   - `RM-MEAT-042` for 42nd Meat item
   - `RM-SPCE-015` for 15th Spices item
3. **Inserts Materials**: Adds each material to the `raw_materials` table
4. **Creates Inventory**: The database trigger automatically creates inventory entries for all active cloud kitchens

## Output Example

```
Starting raw materials seeding...

Found 12 materials to seed

✅ [1/12] Amul Butter (RM-DARY-001)
✅ [2/12] Amul Fresh Cream (RM-DARY-002)
✅ [3/12] Chicken Breast Boneless (RM-MEAT-001)
✅ [4/12] Basmati Rice (RM-GRNS-001)
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
Make sure the category in your CSV exactly matches one of the valid categories (case-sensitive).

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
