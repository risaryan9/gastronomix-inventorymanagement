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
- ✅ Material codes auto-generated (RM-DARY-001, RM-MEAT-042, etc.)
- ✅ Inventory entries created for all cloud kitchens (automatic via trigger)
- ✅ Progress shown for each material

---

## Your CSV Format

```
name	unit	description	category	low_stock_threshold	is_active	brand	vendor
Amul Butter	kg	Premium quality butter	Dairy	45.000	TRUE	Amul	Hyperpure
```

Required columns: `name`, `unit`, `category`

Valid categories: `Meat`, `Grains`, `Vegetables`, `Oils`, `Spices`, `Dairy`, `Packaging`, `Sanitary`, `Misc`

Valid units: `nos`, `kg`, `gm`, `liter`, `packets`, `btl`

---

📖 See `SEEDING_GUIDE.md` for full details
