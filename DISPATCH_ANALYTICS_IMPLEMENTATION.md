# Dispatch Plan Analytics & Prepopulation - Implementation Summary

## Overview
Successfully implemented analytics and prepopulation features for the dispatch plan grid to make the dispatch executive's job smarter and more accurate.

## Features Implemented

### 1. Last Week Prepopulation
- **Behavior**: When opening a new dispatch plan, cells are automatically prefilled with quantities from last week's same day locked dispatch plan
- **Logic**: 
  - Calculates last week same weekday (e.g., if today is Tuesday, fetches last Tuesday's data)
  - Only fetches from **locked** dispatch plans
  - Prefills quantities by matching `outlet_id` and `raw_material_id`
  - If no locked plan exists for last week same day, cells remain empty
- **User Experience**: Saves time by providing a starting point based on historical data

### 2. Return Deviation Analytics (Y & LW)
- **Display**: Two deviation percentages shown below each input cell
  - `Y: <value>%` - Yesterday's return percentage
  - `LW: <value>%` - Last week same day's return percentage
- **Calculation Formula**: 
  ```
  Return % = (checkout_form_return_items.returned_quantity / dispatch_plan_items.quantity) × 100
  ```
- **Data Source**: Only **confirmed** checkout forms
- **Fallback**: Shows `-` if:
  - No data exists for that date
  - Denominator (dispatched quantity) is 0 or missing
  - No confirmed checkout form exists

### 3. Color Coding Based on LW Deviation
- **Visual Cues**: Subtle background colors applied to cells based on last week's return percentage
- **Thresholds**:
  - `< 15%`: Green background (`bg-green-50`) - Low returns, good performance
  - `15-30%`: No color (grey/neutral) - Normal range
  - `> 30%`: Red background (`bg-red-50`) - High returns, needs attention
- **Priority**: Highlight color from outlet search takes precedence over deviation color

## Technical Implementation

### Files Modified
- `/home/aryan/Projects/gastronomix-inventorymanagement/frontend/src/pages/DispatchExecutiveDashboard.jsx`

### Key Functions Added

#### `formatPct(value)`
Formats percentage values with 1 decimal place or returns `-` for null/undefined.

#### `getDeviationCellClass(lastWeekPct)`
Returns appropriate Tailwind CSS class based on last week's deviation threshold.

#### `fetchAnalyticsData(todayDate, brandDbName)`
Main analytics function that:
1. Calculates yesterday and last week same day dates
2. Fetches locked dispatch plans for those dates
3. Fetches confirmed checkout forms and return items
4. Builds prefill and deviation maps
5. Handles all edge cases (missing data, zero division, etc.)

### State Management
- Added `deviationMap` state to store Y/LW percentages for each material-outlet combination
- Keyed by `${raw_material_id}:${outlet_id}` for efficient lookups

### Data Flow
```
openPlanModal (new plan)
  ↓
fetchAnalyticsData(today, brand)
  ↓
Query locked plans (yesterday & last week same day)
  ↓
Fetch dispatch_plan_items + confirmed checkout returns
  ↓
Calculate return percentages
  ↓
Build prefillMap & deviationMap
  ↓
Render grid with prepopulated values & analytics
```

### Performance Optimizations
- Batched Supabase queries to minimize round trips
- Client-side calculations with memoized maps
- Restricted queries by cloud_kitchen_id, brand, and specific dates

## Validation Tests Performed
All test scenarios passed successfully:
- ✅ formatPct handles null/undefined correctly
- ✅ Color thresholds apply correctly (<15, 15-30, >30)
- ✅ Date calculations work for yesterday and last week same day
- ✅ Weekday matching works across different days
- ✅ Return percentage calculation handles edge cases
- ✅ Division by zero returns null (displays as `-`)
- ✅ Frontend builds without errors

## User Experience Flow

### Creating New Plan (Tuesday example)
1. Dispatch executive selects brand and clicks "Open/Edit Today's Plan"
2. System fetches last Tuesday's locked plan
3. Grid loads with quantities from last Tuesday prefilled
4. Each cell shows:
   - Input with prefilled quantity (editable)
   - Y: return % from yesterday
   - LW: return % from last Tuesday
   - Subtle color based on LW percentage

### Editing Existing Draft
1. System loads saved quantities from draft
2. Still fetches and displays Y/LW analytics
3. No prefill override (preserves user's saved work)

## Edge Cases Handled
- ✅ No locked plan for last week → cells remain empty
- ✅ No confirmed checkout form → displays `-`
- ✅ Dispatched quantity is 0 → displays `-`
- ✅ New outlets with no history → displays `-`
- ✅ New materials with no history → displays `-`
- ✅ Highlight from search overrides deviation color

## Database Tables Used
- `dispatch_plan` - Locked plans for prefill source
- `dispatch_plan_items` - Quantity data
- `checkout_form` - Confirmed forms only
- `checkout_form_return_items` - Return quantities

## Future Enhancements (Not Implemented)
- Historical trend graphs
- Predictive quantity suggestions using ML
- Configurable deviation thresholds
- Export analytics reports
