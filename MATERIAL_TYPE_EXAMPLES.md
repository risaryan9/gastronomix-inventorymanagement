# Material Type Examples

## Example 1: Creating a Raw Material

### Form Input:
```
Material Type: Raw Material
Material Name: Basmati Rice Premium
Unit: kg
Category: Grains
Brand: India Gate
Vendor: ABC Suppliers
Low Stock Threshold: 50.000
Description: Premium quality basmati rice for biryani
```

### Auto-Generated Code:
```
RM-GRNS-005
```

### Database Record:
```json
{
  "id": "uuid-here",
  "name": "Basmati Rice Premium",
  "code": "RM-GRNS-005",
  "unit": "kg",
  "category": "Grains",
  "brand": "India Gate",
  "vendor_id": "vendor-uuid",
  "material_type": "raw_material",
  "low_stock_threshold": 50.000,
  "description": "Premium quality basmati rice for biryani"
}
```

---

## Example 2: Creating a Semi-Finished Material (Boom Pizza)

### Form Input:
```
Material Type: Semi-Finished
Material Name: Pizza Dough Balls (Ready to Roll)
Unit: nos
Category: Boom Pizza
Vendor: [NOT VISIBLE - Not required]
Brand: [NOT VISIBLE - Not required]
Low Stock Threshold: 100.000
Description: Pre-prepared pizza dough balls, ready to roll and top
```

### Auto-Generated Code:
```
SF-BM-001
```

### Database Record:
```json
{
  "id": "uuid-here",
  "name": "Pizza Dough Balls (Ready to Roll)",
  "code": "SF-BM-001",
  "unit": "nos",
  "category": "Boom Pizza",
  "brand": null,
  "vendor_id": null,
  "material_type": "semi_finished",
  "low_stock_threshold": 100.000,
  "description": "Pre-prepared pizza dough balls, ready to roll and top"
}
```

---

## Example 3: Creating a Semi-Finished Material (Nippu Kodi)

### Form Input:
```
Material Type: Semi-Finished
Material Name: Marinated Chicken Wings
Unit: kg
Category: Nippu Kodi
Vendor: [NOT VISIBLE]
Brand: [NOT VISIBLE]
Low Stock Threshold: 15.000
Description: Chicken wings marinated with Nippu Kodi special spice mix
```

### Auto-Generated Code:
```
SF-NK-001
```

### Database Record:
```json
{
  "id": "uuid-here",
  "name": "Marinated Chicken Wings",
  "code": "SF-NK-001",
  "unit": "kg",
  "category": "Nippu Kodi",
  "brand": null,
  "vendor_id": null,
  "material_type": "semi_finished",
  "low_stock_threshold": 15.000,
  "description": "Chicken wings marinated with Nippu Kodi special spice mix"
}
```

---

## Example 4: Creating a Finished Material (El Chaapo)

### Form Input:
```
Material Type: Finished
Material Name: Chicken Burrito Bowl (Ready to Serve)
Unit: nos
Category: El Chaapo
Vendor: [NOT VISIBLE]
Brand: [NOT VISIBLE]
Low Stock Threshold: 20.000
Description: Complete burrito bowl with rice, beans, chicken, and toppings
```

### Auto-Generated Code:
```
FF-EC-001
```

### Database Record:
```json
{
  "id": "uuid-here",
  "name": "Chicken Burrito Bowl (Ready to Serve)",
  "code": "FF-EC-001",
  "unit": "nos",
  "category": "El Chaapo",
  "brand": null,
  "vendor_id": null,
  "material_type": "finished",
  "low_stock_threshold": 20.000,
  "description": "Complete burrito bowl with rice, beans, chicken, and toppings"
}
```

---

## Material Code Sequences

### Raw Materials by Category
```
RM-MEAT-001, RM-MEAT-002, RM-MEAT-003...
RM-GRNS-001, RM-GRNS-002, RM-GRNS-003...
RM-SPCE-001, RM-SPCE-002, RM-SPCE-003...
RM-DARY-001, RM-DARY-002, RM-DARY-003...
RM-VEGT-001, RM-VEGT-002, RM-VEGT-003...
RM-OIL-001, RM-OIL-002, RM-OIL-003...
RM-PKG-001, RM-PKG-002, RM-PKG-003...
RM-SAN-001, RM-SAN-002, RM-SAN-003...
RM-MISC-001, RM-MISC-002, RM-MISC-003...
```

### Semi-Finished Materials by Brand
```
SF-BM-001, SF-BM-002, SF-BM-003... (Boom Pizza)
SF-NK-001, SF-NK-002, SF-NK-003... (Nippu Kodi)
SF-EC-001, SF-EC-002, SF-EC-003... (El Chaapo)
```

### Finished Materials by Brand
```
FF-BM-001, FF-BM-002, FF-BM-003... (Boom Pizza)
FF-NK-001, FF-NK-002, FF-NK-003... (Nippu Kodi)
FF-EC-001, FF-EC-002, FF-EC-003... (El Chaapo)
```

---

## Complete Material Catalog Example

### Raw Materials (Purchased from Vendors)
| Code | Name | Type | Category | Brand | Vendor |
|------|------|------|----------|-------|--------|
| RM-MEAT-001 | Chicken Breast | Raw | Meat | Local | Poultry Supplier |
| RM-GRNS-001 | Basmati Rice | Raw | Grains | India Gate | ABC Suppliers |
| RM-SPCE-001 | Red Chilli Powder | Raw | Spices | East Made | Spice Traders |
| RM-DARY-001 | Mozzarella Cheese | Raw | Dairy | Amul | Dairy Depot |

### Semi-Finished Materials (Prepared In-House)
| Code | Name | Type | Category | Description |
|------|------|------|----------|-------------|
| SF-BM-001 | Pizza Dough Balls | Semi-Finished | Boom Pizza | Ready-to-roll pizza dough |
| SF-BM-002 | Pizza Sauce Base | Semi-Finished | Boom Pizza | Prepared tomato sauce with herbs |
| SF-NK-001 | Marinated Chicken Wings | Semi-Finished | Nippu Kodi | Wings in special marinade |
| SF-NK-002 | Spice Mix Blend | Semi-Finished | Nippu Kodi | House special spice blend |
| SF-EC-001 | Taco Shells | Semi-Finished | El Chaapo | Fried taco shells ready to fill |
| SF-EC-002 | Salsa Verde | Semi-Finished | El Chaapo | House-made green salsa |

### Finished Materials (Ready to Serve)
| Code | Name | Type | Category | Description |
|------|------|------|----------|-------------|
| FF-BM-001 | Margherita Pizza | Finished | Boom Pizza | Complete pizza ready to serve |
| FF-BM-002 | Pepperoni Pizza | Finished | Boom Pizza | Complete pizza ready to serve |
| FF-NK-001 | Spicy Wings Platter | Finished | Nippu Kodi | Cooked wings with sides |
| FF-NK-002 | Chicken Biryani | Finished | Nippu Kodi | Complete biryani ready to serve |
| FF-EC-001 | Chicken Burrito | Finished | El Chaapo | Wrapped burrito ready to serve |
| FF-EC-002 | Beef Tacos (3pc) | Finished | El Chaapo | Assembled tacos ready to serve |

---

## Use Case Scenarios

### Scenario 1: Stock-In for Raw Materials
```
Purchase Manager receives delivery from vendor:
- 50 kg Chicken Breast (RM-MEAT-001)
- 100 kg Basmati Rice (RM-GRNS-001)
- 25 kg Mozzarella Cheese (RM-DARY-001)

Action: Create Stock-In entry with these raw materials
Result: Inventory updated for the cloud kitchen
```

### Scenario 2: Production of Semi-Finished Materials
```
Cloud Kitchen prepares semi-finished items:
- Uses 20 kg flour, 5 liters water, 1 kg yeast
- Produces 200 Pizza Dough Balls (SF-BM-001)

Action: Create Stock-Out for raw materials, Stock-In for semi-finished
Result: Raw material inventory decreases, semi-finished inventory increases
```

### Scenario 3: Production of Finished Materials
```
Cloud Kitchen prepares finished items:
- Uses 10 Pizza Dough Balls (SF-BM-001)
- Uses 2 kg Mozzarella Cheese (RM-DARY-001)
- Uses 1 liter Pizza Sauce (SF-BM-002)
- Produces 10 Margherita Pizzas (FF-BM-001)

Action: Create Stock-Out for ingredients, Stock-In for finished products
Result: Ingredient inventory decreases, finished product inventory increases
```

### Scenario 4: Allocation to Outlet
```
Outlet requests finished products:
- 20 Margherita Pizzas (FF-BM-001)
- 15 Spicy Wings Platters (FF-NK-001)
- 30 Chicken Burritos (FF-EC-001)

Action: Create Allocation with finished materials
Result: Cloud kitchen inventory decreases, outlet receives products
```

---

## Benefits of Material Type System

### 1. Clear Inventory Tracking
- Separate tracking of purchased vs. prepared materials
- Better understanding of production pipeline
- Accurate cost calculation at each stage

### 2. Improved Reporting
- Track raw material consumption
- Monitor semi-finished production efficiency
- Analyze finished product output

### 3. Better Planning
- Know when to purchase raw materials
- Plan production schedules for semi-finished items
- Forecast finished product availability

### 4. Cost Management
- Calculate true cost of semi-finished materials
- Understand profitability of finished products
- Identify cost-saving opportunities

### 5. Quality Control
- Track which raw materials go into which products
- Monitor semi-finished material shelf life
- Ensure finished product consistency

---

## Migration Impact

### Existing Materials (Before Migration)
All existing materials in the database will be:
- Automatically set to `material_type = 'raw_material'`
- Keep their existing codes (RM-*)
- Retain all other data (vendor, brand, etc.)
- Continue to work exactly as before

### New Materials (After Migration)
Users can now create:
- Raw Materials (as before)
- Semi-Finished Materials (new capability)
- Finished Materials (new capability)

**No disruption to existing operations!**
