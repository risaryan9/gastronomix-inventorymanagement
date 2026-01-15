# Gastronomix Design System

## Overview
This document outlines the complete design system for the Gastronomix corporate website. All design decisions, color codes, typography, spacing, and interaction patterns are documented here for consistency across projects.

---

## 1. Color Palette

### 1.1 Primary Colors (HSL Format)

#### Background Colors
- **Background (Main)**: `hsl(222, 15%, 8%)` - Deep dark blue-gray
- **Card Background**: `hsl(222, 14%, 12%)` - Slightly lighter dark
- **Popover Background**: `hsl(222, 14%, 11%)` - Dark overlay background

#### Foreground Colors
- **Foreground (Text)**: `hsl(0, 0%, 95%)` - Near white
- **Card Foreground**: `hsl(0, 0%, 95%)` - White text on cards
- **Primary**: `hsl(0, 0%, 95%)` - White for primary elements

#### Brand Colors
- **Brand Gold (Accent)**: `hsl(49, 95%, 46%)` - Primary brand gold/yellow
  - Hex equivalent: `#E1BB07`
  - Used for: CTAs, highlights, borders, hover states
- **Brand Dark**: `hsl(222, 15%, 8%)` - Main background
- **Brand Lighter**: `hsl(222, 14%, 15%)` - Lighter dark variant
- **Brand Gray**: `hsl(222, 12%, 18%)` - Muted gray

#### Secondary Colors
- **Secondary**: `hsl(49, 95%, 46%)` - Same as brand gold
- **Muted**: `hsl(222, 12%, 18%)` - Muted background
- **Muted Foreground**: `hsl(0, 0%, 65%)` - Muted text

#### Border & Input Colors
- **Border**: `hsl(222, 10%, 20%)` - Subtle borders
- **Input**: `hsl(222, 12%, 16%)` - Input field background
- **Ring (Focus)**: `hsl(49, 95%, 46%)` - Focus ring color (gold)

#### Semantic Colors
- **Destructive**: `hsl(0, 70%, 45%)` - Error/danger states
- **Destructive Foreground**: `hsl(0, 0%, 100%)` - White text on destructive

#### Sidebar Colors (if applicable)
- **Sidebar Background**: `hsl(222, 14%, 10%)`
- **Sidebar Foreground**: `hsl(0, 0%, 90%)`
- **Sidebar Primary**: `hsl(0, 0%, 95%)`
- **Sidebar Accent**: `hsl(222, 12%, 18%)`
- **Sidebar Border**: `hsl(222, 10%, 20%)`
- **Sidebar Ring**: `hsl(49, 95%, 46%)`

### 1.2 Color Usage Guidelines

- **Gold (#E1BB07)**: Primary accent for CTAs, hover states, active links, borders
- **Dark Background**: Always use the dark theme - no light mode
- **Contrast**: Ensure WCAG AA compliance (4.5:1 for text)
- **Opacity**: Use opacity modifiers for overlays (e.g., `/90`, `/50`, `/30`)

---

## 2. Typography

### 2.1 Font Family
- **Primary Font**: `'Poppins', sans-serif`
- **Font Stack**: `'Poppins', 'sans-serif'`
- **Usage**: All text elements use Poppins

### 2.2 Font Weights
- **Regular**: `400` - Body text
- **Semi-bold**: `600` - Navigation links, emphasized text
- **Bold**: `700` - Headings (h1-h6)
- **Black**: `900` - Buttons, strong emphasis

### 2.3 Typography Scale

#### Headings
- **H1**: `text-4xl sm:text-5xl md:text-7xl lg:text-8xl` - Hero headings
- **H2**: `text-2xl sm:text-3xl md:text-4xl lg:text-5xl` - Section headings
- **H3**: `text-xl sm:text-2xl md:text-3xl` - Subsection headings
- **H4-H6**: Standard scale with responsive sizing

#### Body Text
- **Base**: `text-base` (16px) - Default body text
- **Small**: `text-sm` (14px) - Secondary text, captions
- **Large**: `text-lg` (18px) - Emphasized body text
- **Extra Large**: `text-xl` (20px) - Large buttons, important text

### 2.4 Typography Styles

#### Navigation Links
- Font: `'Poppins', sans-serif`
- Weight: `600` (semi-bold)
- Size: `text-base`
- Tracking: `tracking-wide`
- Style: Underline animation on hover

#### Buttons
- Font: `'Poppins', sans-serif`
- Weight: `900` (black)
- Size: `text-lg` (default), `text-base` (sm), `text-xl` (lg)

#### Body Text
- Font: `'Poppins', sans-serif`
- Weight: `400` (regular)
- Leading: `leading-relaxed` or `leading-tight` for headings

---

## 3. Spacing & Layout

### 3.1 Border Radius
- **Base Radius**: `0.75rem` (12px) - Defined as `--radius`
- **Large**: `var(--radius)` - `0.75rem`
- **Medium**: `calc(var(--radius) - 2px)` - `0.625rem`
- **Small**: `calc(var(--radius) - 4px)` - `0.5rem`
- **Extra Large**: `rounded-2xl` (1rem) - Cards, containers

### 3.2 Container
- **Max Width**: `1400px` (2xl breakpoint)
- **Padding**: `2rem` (32px) default
- **Center**: Always centered

### 3.3 Common Spacing Patterns
- **Section Padding**: `py-6 md:py-9 lg:py-12` or `py-8 md:py-12 lg:py-16`
- **Card Padding**: `p-6 md:p-8`
- **Button Padding**: 
  - Default: `px-5 py-3`
  - Small: `px-4 py-2`
  - Large: `px-8 py-4`

### 3.4 Grid & Flexbox
- Use Tailwind's grid and flex utilities
- Common: `flex items-center justify-between`
- Responsive: Mobile-first approach

---

## 4. Visual Effects & Styling

### 4.1 Glassmorphism
- **Background**: `bg-card/90` or `bg-background/50`
- **Backdrop**: `backdrop-blur-md` or `backdrop-blur-sm`
- **Usage**: Navigation bars, modals, overlays

### 4.2 Shadows
- **Card Shadow**: `shadow-2xl shadow-black/50`
- **Hover Shadow**: Enhanced shadow on hover
- **Button Shadow**: `shadow-[0.1em_0.1em_0_0_rgba(225,187,7,0.3)]`
  - Hover: `shadow-[0.15em_0.15em_0_0_rgba(225,187,7,0.5)]`
  - Active: `shadow-[0.05em_0.05em_0_0_rgba(225,187,7,0.3)]`

### 4.3 Borders
- **Default Border**: `border-2` (2px)
- **Border Color**: `border-border` or `border-accent/30`
- **Hover Border**: `hover:border-accent/50` or `hover:border-accent/30`
- **Special**: `border-3` for buttons (3px border)

### 4.4 Opacity & Overlays
- **Dark Overlay**: `bg-black/60`, `bg-black/40`, `bg-black/30`
- **Gradient Overlays**: `bg-gradient-to-r from-black/60 via-black/40 to-black/30`
- **Card Opacity**: `bg-card/90`, `bg-card/95`

---

## 5. Interactions & Animations

### 5.1 Transitions
- **Default**: `transition-all duration-300`
- **Smooth**: `transition-all duration-300 ease-in-out`
- **Custom**: `--transition-smooth: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`

### 5.2 Hover Effects

#### Buttons
- **Transform**: `hover:translate-x-[-0.05em] hover:translate-y-[-0.05em]`
- **Shadow**: Enhanced shadow on hover
- **Brightness**: `hover:brightness-110` (gold buttons)
- **Active**: `active:translate-x-[0.05em] active:translate-y-[0.05em]`

#### Links
- **Color Change**: `hover:text-accent`
- **Underline Animation**: Scale from 0 to 100% on hover
- **Duration**: `after:transition-transform after:duration-300`

#### Cards/Containers
- **Border**: `hover:border-accent/30` or `hover:border-accent/50`
- **Opacity**: `hover:opacity-50` (for overlays)
- **Scale**: `hover:scale-110` (for logos)

### 5.3 Animations

#### Keyframes
- **Fade In**: `fade-in 0.5s ease-out`
  - From: `opacity: 0, translateY(-10px)`
  - To: `opacity: 1, translateY(0)`
- **Loading Spin**: Custom rotation animation
- **Accordion**: Built-in Radix UI animations

#### Animation Classes
- `animate-fade-in` - Fade in with slight upward movement
- `animate-accordion-down` - Accordion expand
- `animate-accordion-up` - Accordion collapse

### 5.4 Scroll Behavior
- **Smooth Scroll**: `scroll-behavior: smooth` on html element

---

## 6. Component Patterns

### 6.1 Buttons

#### Button Variants
- **Default/Franchise**: Gold background (`#E1BB07`), dark text, 3px border, shadow effect
- **Outline**: Transparent background, gold border, gold text on hover
- **Ghost**: Transparent, border appears on hover
- **Destructive**: Red background for delete/error actions
- **Black**: Dark background, light text

#### Button Sizes
- **Small**: `px-4 py-2 text-base`
- **Default**: `px-5 py-3 text-lg`
- **Large**: `px-8 py-4 text-xl`
- **Icon**: `h-10 w-10`

#### Button Characteristics
- Font weight: `900` (black)
- Border radius: `rounded-xl`
- Border: `border-3` (3px)
- Shadow: Neumorphic-style shadow with gold tint
- Hover: Slight upward translation with enhanced shadow
- Active: Downward translation with reduced shadow

### 6.2 Navigation Links
- **Base Style**: `nav-link` utility class
- **Underline**: Animated underline that scales from left on hover
- **Active State**: `text-accent` (gold color)
- **Hover**: Color changes to gold, underline appears

### 6.3 Cards
- **Background**: `bg-card/90` with `backdrop-blur-md`
- **Border**: `border-2 border-border`
- **Hover**: `hover:border-accent/30`
- **Shadow**: `shadow-2xl shadow-black/50`
- **Border Radius**: `rounded-2xl`
- **Padding**: `p-6 md:p-8`

### 6.4 Forms & Inputs
- **Background**: `bg-input` (dark)
- **Border**: `border-border`
- **Focus Ring**: `ring-2 ring-ring` (gold)
- **Border Radius**: Based on `--radius` variable

---

## 7. Responsive Design

### 7.1 Breakpoints (Tailwind Default)
- **sm**: `640px` - Small tablets
- **md**: `768px` - Tablets
- **lg**: `1024px` - Laptops
- **xl**: `1280px` - Desktops
- **2xl**: `1400px` - Large desktops (container max-width)

### 7.2 Mobile-First Approach
- Base styles for mobile
- Progressive enhancement for larger screens
- Example: `text-4xl sm:text-5xl md:text-7xl lg:text-8xl`

### 7.3 Common Responsive Patterns
- **Padding**: `px-4 md:px-8` or `px-6 md:px-8`
- **Text Size**: Scale up on larger screens
- **Spacing**: `gap-4 md:gap-6 lg:gap-8`
- **Visibility**: `hidden md:flex` or `flex md:hidden`

---

## 8. Scrollbar Styling

### 8.1 Webkit (Chrome, Safari, Edge)
- **Width**: `12px`
- **Track**: Background color
- **Thumb**: Accent color (gold) with rounded corners
- **Hover**: Slightly transparent thumb

### 8.2 Firefox
- **Width**: `thin`
- **Colors**: Accent color for thumb, background for track

---

## 9. Design Principles

### 9.1 Visual Hierarchy
- Bold headings (700 weight) for sections
- Gold accent for important elements
- Contrast through size and color

### 9.2 Consistency
- Always use Poppins font
- Consistent border radius (0.75rem base)
- Uniform spacing scale
- Consistent shadow patterns

### 9.3 Accessibility
- High contrast ratios (WCAG AA)
- Focus states clearly visible (gold ring)
- Smooth transitions (respects reduced motion)
- Semantic HTML structure

### 9.4 Premium Feel
- Dark theme with gold accents
- Glassmorphism effects
- Smooth animations
- Neumorphic button shadows
- High-quality shadows and borders

---

## 10. Utility Classes

### 10.1 Custom Utilities
- `.nav-link` - Navigation link with animated underline
- `.logo-hover` - Logo hover effect (scale)
- `.hide-scrollbar` - Hide scrollbar while maintaining scroll

### 10.2 Common Combinations
- `bg-card/90 backdrop-blur-md` - Glassmorphic card
- `border-2 border-border hover:border-accent/30` - Interactive border
- `shadow-2xl shadow-black/50` - Deep shadow
- `transition-all duration-300` - Smooth transition

---

## 11. Color Reference (Quick Lookup)

### Primary Colors
```
Background:     hsl(222, 15%, 8%)    #14151F
Foreground:     hsl(0, 0%, 95%)       #F2F2F2
Brand Gold:     hsl(49, 95%, 46%)     #E1BB07
Card:           hsl(222, 14%, 12%)    #1A1B24
Border:         hsl(222, 10%, 20%)    #2A2B35
Muted:          hsl(222, 12%, 18%)    #252630
```

### Accent Colors
```
Gold (Primary): #E1BB07
Gold (Hover):   Brightness 110%
Gold (Border):  rgba(225, 187, 7, 0.3)
Gold (Shadow):  rgba(225, 187, 7, 0.3-0.5)
```

---

## 12. Implementation Notes

### 12.1 CSS Variables
All colors are defined as HSL CSS variables in `:root`:
- Use `hsl(var(--variable-name))` format
- Allows easy theme switching (if needed in future)

### 12.2 Tailwind Configuration
- Colors mapped to CSS variables
- Custom font family (Poppins)
- Extended animations and keyframes
- Custom border radius scale

### 12.3 Best Practices
1. Always use design system colors (never hardcode hex)
2. Use Tailwind utilities for spacing
3. Maintain consistent border radius
4. Apply smooth transitions to interactive elements
5. Use glassmorphism for elevated surfaces
6. Follow mobile-first responsive approach

---

## 13. Typography Examples

### Headings
```css
/* Hero Heading */
font-family: 'Poppins', sans-serif;
font-weight: 700;
font-size: 4xl (mobile) → 8xl (desktop)

/* Section Heading */
font-family: 'Poppins', sans-serif;
font-weight: 700;
font-size: 2xl (mobile) → 5xl (desktop)
```

### Body Text
```css
font-family: 'Poppins', sans-serif;
font-weight: 400;
font-size: base (16px)
line-height: relaxed
```

### Navigation
```css
font-family: 'Poppins', sans-serif;
font-weight: 600;
font-size: base (16px)
letter-spacing: wide
```

---

## 14. Component-Specific Guidelines

### 14.1 Navigation Bar
- Glassmorphic: `bg-card/90 backdrop-blur-md`
- Border: `border-2 border-border hover:border-accent/30`
- Shadow: `shadow-2xl shadow-black/50`
- Border radius: `rounded-2xl`
- Fixed position with top margin

### 14.2 Hero Section
- Full viewport height: `h-screen`
- Video background with dark overlay
- Gradient overlays for text readability
- Large, bold typography

### 14.3 Cards
- Elevated appearance with shadows
- Glassmorphic background
- Hover border color change
- Consistent padding and spacing

---

## Summary

This design system emphasizes:
- **Dark, premium aesthetic** with gold accents
- **Consistent typography** (Poppins throughout)
- **Smooth interactions** with hover effects and animations
- **Glassmorphism** for modern, elevated UI elements
- **Mobile-first** responsive design
- **Accessibility** through high contrast and clear focus states

All design decisions should align with these principles to maintain brand consistency and user experience quality.

