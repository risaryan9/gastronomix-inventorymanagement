# Purchase Manager Dashboard - Design Documentation

## Overview

The Purchase Manager Dashboard has been redesigned with a modern, responsive UI while maintaining the existing color scheme, button styles, and typography from the design system.

## Key Features

### 1. Responsive Design

- **Mobile-First Approach**: Fully responsive layout that works on all screen sizes
- **Mobile Menu**: Collapsible sidebar with overlay on mobile devices
- **Flexible Grid Layouts**: Adapts from single column on mobile to multi-column on larger screens
- **Touch-Friendly**: Larger touch targets and spacing for mobile users

### 2. Header Improvements

**Previous:**
- Simple display of user name
- Cloud Kitchen ID shown as UUID

**Current:**
- Welcoming message: "Welcome, [First Name]"
- Cloud Kitchen name fetched from database (instead of UUID)
- Role badge with accent styling
- Responsive layout that stacks on mobile
- Email address displayed on the right

### 3. Sidebar Navigation

**Features:**
- Icons for each navigation item (📊 📦 🧱 📋)
- Active state with accent background and bold text
- Hover effects with subtle background
- Responsive: slides in from left on mobile
- Fixed position on desktop, overlay on mobile
- Logout button at the bottom

**Navigation Items:**
- Overview (📊)
- Stock In (📦)
- Materials (🧱)
- Inventory (📋)

### 4. Page Designs

#### Overview Page
- **Stats Grid**: 4 responsive stat cards showing:
  - Total Materials
  - Stock In (This Month)
  - Low Stock Items
  - Total Value
- **Hover Effects**: Cards lift with shadow on hover
- **Icons**: Large emoji icons for visual appeal
- **Placeholder Section**: Central content area for charts/analytics

#### Stock In Page
- **Header Actions**: "+ Add New Stock In" button
- **Action Buttons**: 
  - View All Stock In Records
  - Export Report
- **Placeholder**: Large centered icon with description

#### Materials Page
- **Search & Filter**: 
  - Search input for materials
  - Category dropdown filter
- **Stats Display**: 3 mini stat cards
- **Header Actions**: "+ Add New Material" button
- **Responsive Grid**: Adapts to screen size

#### Inventory Page
- **Quick Stats**: 3 responsive cards showing:
  - Total Items
  - Low Stock Alerts (in red/destructive color)
  - Total Value
- **Search & Filter**:
  - Search input
  - Stock level filter dropdown
- **Action Buttons**:
  - Export (outline style)
  - Adjust Stock (primary style)

## Design Elements

### Colors
- Maintains existing color scheme from design system
- Uses CSS variables: `accent`, `background`, `card`, `border`, `foreground`, `muted-foreground`
- Destructive color for alerts/warnings

### Typography
- Same font family from design system
- Bold headings (font-bold)
- Responsive text sizes (text-2xl sm:text-3xl)
- Consistent spacing

### Buttons
- Primary: `bg-accent text-background font-bold`
- Outline: `border-2 border-accent text-accent`
- Destructive: `bg-destructive text-destructive-foreground`
- Shadow effects from design system: `shadow-button`, `shadow-button-hover`
- Neubrutalism-style transforms on hover

### Cards
- Border: `border-2 border-border`
- Rounded: `rounded-xl` or `rounded-lg`
- Background: `bg-card`
- Hover effects: `hover:shadow-lg transition-shadow`

### Spacing
- Consistent padding: `p-4 sm:p-6 lg:p-8`
- Gap spacing: `gap-4` or `gap-6`
- Responsive margins

## Responsive Breakpoints

- **Mobile**: < 640px (sm)
  - Sidebar slides in from left
  - Single column layouts
  - Stacked elements
  
- **Tablet**: 640px - 1024px (sm to lg)
  - 2-column grids where appropriate
  - Visible sidebar with toggle

- **Desktop**: > 1024px (lg+)
  - Fixed sidebar always visible
  - Multi-column grids (3-4 columns)
  - Horizontal layouts

## Technical Implementation

### Database Integration
- Fetches cloud kitchen name from `cloud_kitchens` table using Supabase
- Uses `session.cloud_kitchen_id` to query the database
- Displays loading state while fetching data

### State Management
- `session` - User session data
- `cloudKitchenName` - Fetched cloud kitchen name
- `loading` - Loading state for data fetch
- `isSidebarOpen` - Mobile sidebar toggle state

### Routing
- Uses React Router's nested routes
- `<Outlet />` component renders child routes
- `NavLink` for active state detection
- Base path: `/invmanagement/dashboard/purchase_manager/`

### Mobile Navigation
- Hamburger menu icon on mobile
- Slide-in animation with `transform` and `transition`
- Overlay backdrop with `bg-black/50`
- Auto-closes when navigation item is clicked

## Future Enhancements

1. **Real Data Integration**
   - Connect stats to actual database queries
   - Implement data tables
   - Add charts and visualizations

2. **Filtering & Search**
   - Connect search inputs to API
   - Implement advanced filters
   - Add sorting capabilities

3. **Forms**
   - Stock In form
   - Material creation form
   - Inventory adjustment form

4. **Notifications**
   - Low stock alerts
   - Recent activity feed
   - Toast notifications

5. **Export Functionality**
   - PDF reports
   - Excel exports
   - CSV downloads

## Testing Checklist

- ✅ Responsive on mobile (< 640px)
- ✅ Responsive on tablet (640px - 1024px)
- ✅ Responsive on desktop (> 1024px)
- ✅ Mobile menu toggle works
- ✅ Navigation active states work
- ✅ Cloud kitchen name fetched correctly
- ✅ Welcome message shows first name
- ✅ All placeholder pages accessible
- ✅ Logout functionality works
- ✅ No linting errors
- ✅ Hot module replacement working

## Files Modified

1. `src/pages/PurchaseManagerDashboard.jsx` - Main layout with sidebar and header
2. `src/pages/purchase-manager/Overview.jsx` - Stats grid and placeholder
3. `src/pages/purchase-manager/StockIn.jsx` - Stock in management page
4. `src/pages/purchase-manager/Materials.jsx` - Materials catalog page
5. `src/pages/purchase-manager/Inventory.jsx` - Inventory levels page

## Accessibility Considerations

- Semantic HTML elements
- Proper heading hierarchy
- Interactive elements have visible focus states
- Color contrast meets WCAG standards
- Mobile-friendly touch targets (min 44x44px)
- Keyboard navigation support via React Router
