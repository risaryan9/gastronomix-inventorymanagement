# Quick Start: Seed Raw Materials

## 3 Simple Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Add Your Data
Put your materials in `backend/materials.csv` (already has sample data)

### 3. Run the Script
```bash
npm run seed-materials
```

Done! ✅

---

## What You Get

- ✅ Materials inserted into database
- ✅ Material codes auto-generated (RM-HBSP-001, RM-MTPC-042, SF-001, FF-001, NF-001, etc.)
- ✅ Inventory entries created for all cloud kitchens (automatic via trigger)
- ✅ Progress shown for each material

---

## Your CSV Format

```
name	unit	description	category	low_stock_threshold	is_active	brand	vendor	material_type	brand_codes
Amul Butter	kg	Premium quality butter	Dairy & Dairy Product	45.000	TRUE	Amul	Hyperpure	raw_material	all
```

Required columns: `name`, `unit`, `category`, `material_type`

Valid categories for raw materials: `Baking Essentials`, `Condiments & Toppings`, `Dairy & Dairy Product`, `Dry Fruits & Nuts`, `Edible Oils & Fats`, `Food Grains & Grain Products`, `Fruits & Vegetables`, `Herbs & Spices`, `Meat & Poultry & Cold Cuts`, `Pulses & Lentils`, `Sauces & Seasoning`, `Inedible & Packaging`

For semi_finished/finished/non_food: category is auto-assigned (`SemiFinished`, `Finished`, or `Inedible & Packaging`)

Valid units: `nos`, `kg`, `gm`, `liter`, `packets`, `btl`

---

📖 See `SEEDING_GUIDE.md` for full details
