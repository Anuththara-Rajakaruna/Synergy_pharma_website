# Synergy Website - Design System

## 1. TYPOGRAPHY SYSTEM

### Primary Font Family
- **Font**: Inter
- **Fallback**: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif
- **Use Case**: All text, headings, UI elements
- **Characteristics**: Modern, clean, highly readable, excellent for pharmaceutical/tech brands

### Font Weights
- **Regular (400)**: Body text, paragraphs, descriptions
- **Medium (500)**: Less common, used for emphasis in body text
- **Semibold (600)**: UI elements, table headers
- **Bold (700)**: Subheadings, strong emphasis
- **Extrabold (800)**: Section headings, card titles
- **Black (850)**: Page headings, hero titles

### Typography Scale

#### Heading 1 (H1)
- **Font Size**: clamp(2.15rem, 5vw, 4.05rem)
- **Weight**: 850 (Black)
- **Line Height**: 0.98
- **Letter Spacing**: -0.03em
- **Color**: --text-dark (#0f1419)
- **Use Case**: Page titles, hero sections
- **Margin**: 0

#### Heading 2 (H2)
- **Font Size**: clamp(1.65rem, 2.5vw, 2.35rem)
- **Weight**: 800 (Extrabold)
- **Line Height**: 1.15
- **Letter Spacing**: -0.02em
- **Color**: --text-dark
- **Use Case**: Section titles, major headings
- **Margin Bottom**: 1rem (--space-lg)

#### Heading 3 (H3)
- **Font Size**: clamp(1.15rem, 1.5vw, 1.5rem)
- **Weight**: 800 (Extrabold)
- **Line Height**: 1.3
- **Letter Spacing**: -0.01em
- **Color**: --text-dark
- **Use Case**: Card titles, subsection headings
- **Margin Bottom**: 0.5rem (--space-sm)

#### Heading 4 (H4)
- **Font Size**: clamp(1rem, 1.2vw, 1.25rem)
- **Weight**: 700 (Bold)
- **Line Height**: 1.3
- **Color**: --text-dark
- **Use Case**: Feature titles, emphasis text
- **Margin Bottom**: 0.5rem (--space-sm)

#### Heading 5 (H5)
- **Font Size**: 0.95rem
- **Weight**: 700 (Bold)
- **Line Height**: 1.4
- **Color**: --text-dark
- **Use Case**: Labels, small titles
- **Margin Bottom**: 0.5rem (--space-sm)

#### Paragraph (Body Text)
- **Font Size**: 0.95rem
- **Weight**: 400 (Regular)
- **Line Height**: 1.65
- **Color**: --text-muted (#4d5f75)
- **Use Case**: Main body copy, descriptions
- **Margin Bottom**: 1rem (--space-md)

#### Eyebrow / Label
- **Font Size**: clamp(0.65rem, 0.8vw, 0.8rem)
- **Weight**: 800 (Extrabold)
- **Letter Spacing**: 0.18em
- **Text Transform**: uppercase
- **Color**: --text-muted
- **Use Case**: Section labels, overline text
- **Margin Bottom**: 1.5rem (--space-lg)

---

## 2. COLOR PALETTE

### Primary Colors
| Name | Hex | RGB | Use Case |
|------|-----|-----|----------|
| **Primary** | #055f7c | 5, 95, 124 | Buttons, links, interactive elements |
| **Primary Light** | #4a99b3 | 74, 153, 179 | Hover states, light backgrounds |
| **Primary Dark** | #033d52 | 3, 61, 82 | Text emphasis, dark mode adjustments |

### Accent & Secondary
| Name | Hex | RGB | Use Case |
|------|-----|-----|----------|
| **Accent** | #055cbe | 5, 92, 190 | CTA buttons, important actions |
| **Accent Light** | #3b7dd9 | 59, 125, 217 | Accent hover states |

### Text Colors
| Name | Hex | RGB | Use Case |
|------|-----|-----|----------|
| **Text Dark** | #0f1419 | 15, 20, 25 | Primary text, headings |
| **Text Muted** | #4d5f75 | 77, 95, 117 | Secondary text, body copy |
| **Text Light** | #7a8a9d | 122, 138, 157 | Disabled, tertiary text |
| **Text White** | #ffffff | 255, 255, 255 | Light backgrounds |
| **Text White 85%** | rgba(255, 255, 255, 0.85) | - | Slightly translucent white |
| **Text White 65%** | rgba(255, 255, 255, 0.65) | - | Very translucent white |

### Background & Surface Colors
| Name | Hex | Use Case |
|------|-----|----------|
| **BG Light** | #e9f1f6 | Page background, alternate sections |
| **BG Card** | #f7fbfd | Card backgrounds, elevated surfaces |
| **Border Light** | #cfdbe7 | Dividers, borders |

### Dark Mode Colors
- Dark mode uses same structure but inverted values
- Ensures accessibility and contrast in both modes

---

## 3. SPACING SYSTEM

### Grid Base: 8px (Multiples of 8)
All spacing follows an 8px modular grid for consistency.

| Variable | Size | Multiples | Use Case |
|----------|------|-----------|----------|
| --space-xs | 0.25rem | 4px | Micro spacing, text adjustments |
| --space-sm | 0.5rem | 8px | Small gaps, component padding |
| --space-md | 1rem | 16px | Standard spacing, button padding |
| --space-lg | 1.5rem | 24px | Section spacing, card gaps |
| --space-xl | 2rem | 32px | Medium spacing, component padding |
| --space-2xl | 2.5rem | 40px | Large component spacing |
| --space-3xl | 3rem | 48px | Section padding |
| --space-4xl | 4rem | 64px | Hero section padding |
| --space-5xl | 5rem | 80px | Large section padding (8rem = 128px) |

### Spacing Usage Guidelines
- **Padding**: Inside components (buttons, cards, containers)
- **Margins**: Between components and sections
- **Gaps**: Grid/flexbox spacing
- **Consistent rhythm**: Use same spacing for visual harmony

---

## 4. BORDER RADIUS

### Radius Scale
| Variable | Size | Use Case |
|----------|------|----------|
| --radius-sm | 0.5rem | 8px | Small UI elements, input borders |
| --radius-md | 1rem | 16px | Buttons, small cards |
| --radius-lg | 1.5rem | 24px | Cards, larger components |
| --radius-xl | 1.75rem | 28px | Full-width cards, premium components |
| --radius-full | 9999px | infinite | Pills, circles, badges |

### Modern Design Approach
- **Subtle**: Use --radius-sm/md for clean look
- **Premium**: Use --radius-lg/xl for glassmorphism cards
- **Badges/Pills**: Use --radius-full for infinite curves

---

## 5. SHADOW SYSTEM

### Elevation System (Premium Glass-morphism)
| Variable | Value | Elevation | Use Case |
|----------|-------|-----------|----------|
| **--shadow-sm** | 0 2px 8px rgba(15, 20, 25, 0.08) | 1 | Subtle elevation, hover state |
| **--shadow-md** | 0 8px 24px rgba(15, 20, 25, 0.12) | 2 | Default card shadow |
| **--shadow-lg** | 0 12px 40px rgba(15, 20, 25, 0.18) | 3 | Elevated cards, modals |
| **--shadow-xl** | 0 20px 50px rgba(15, 20, 25, 0.25) | 4 | Maximum elevation, premium effect |

### Shadow Usage
- **Default**: --shadow-md for cards, containers
- **Hover**: Increase to --shadow-lg or --shadow-xl
- **Inset**: Use inset shadows for depth on glassmorphism

---

## 6. TRANSITIONS & ANIMATIONS

### Transition Speeds
| Variable | Duration | Use Case |
|----------|----------|----------|
| --transition-fast | 0.2s ease | Quick feedback (hover color change) |
| --transition-base | 0.3s ease | Standard transition (elevation, size) |
| --transition-slow | 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) | Bouncy entrance animation |

### Animation Easing
- **ease**: Standard, natural feeling
- **cubic-bezier(0.34, 1.56, 0.64, 1)**: Bouncy, premium feel
- **ease-in-out**: Smooth acceleration/deceleration

---

## 7. COMPONENT STYLES

### Buttons
- **Padding**: var(--space-md) var(--space-lg) (16px 24px)
- **Border Radius**: var(--radius-md) (16px)
- **Font Size**: 0.75rem
- **Font Weight**: Bold (700)
- **Letter Spacing**: 0.12em
- **Text Transform**: uppercase
- **Transition**: all var(--transition-base)
- **Shadow**: var(--shadow-md)
- **Hover**: Increase shadow to --shadow-lg, lift -2px

### Cards
- **Border Radius**: var(--radius-xl) (28px)
- **Padding**: var(--space-xl) (32px)
- **Background**: rgba(255, 255, 255, 0.25) (glassmorphism)
- **Backdrop Filter**: blur(20px) saturate(180%)
- **Border**: 1px solid rgba(255, 255, 255, 0.35)
- **Shadow**: var(--shadow-md)
- **Hover**: 
  - Transform: translateY(-12px)
  - Background: rgba(255, 255, 255, 0.35)
  - Shadow: var(--shadow-xl)
  - Border Color: rgba(255, 255, 255, 0.5)

### Input Fields
- **Border Radius**: var(--radius-md) (16px)
- **Padding**: var(--space-md) var(--space-lg)
- **Border**: 1px solid var(--border-light)
- **Font**: Inherit from body text
- **Focus**: 
  - Border: var(--primary)
  - Shadow: 0 0 0 3px rgba(5, 95, 124, 0.1)

### Links
- **Color**: var(--primary)
- **Text Decoration**: none
- **Transition**: color var(--transition-fast)
- **Hover**: color: var(--primary-light)

### Navigation
- **Font Size**: 0.78rem
- **Font Weight**: 800 (Extrabold)
- **Letter Spacing**: 0.14em
- **Text Transform**: uppercase
- **Color**: var(--text-muted)
- **Hover**: color: var(--primary)
- **Active**: color: var(--primary), underline indicator

---

## 8. RESPONSIVE DESIGN

### Mobile-First Approach
- Base styles for mobile
- Breakpoints for tablet and desktop
- Use `clamp()` for fluid typography and sizing

### Common Breakpoints
- **Mobile**: < 640px
- **Tablet**: 640px - 900px
- **Desktop**: > 900px

### Responsive Typography Strategy
Using `clamp()` for responsive scaling:
```css
font-size: clamp(minSize, preferredSize, maxSize);
/* Example: clamp(0.95rem, 1.2vw, 1.05rem) */
```

---

## 9. ACCESSIBILITY & CONTRAST

### Color Contrast Ratios
- **Text on Background**: Minimum 4.5:1 (WCAG AA)
- **Large Text**: Minimum 3:1
- **UI Components**: Minimum 3:1

### Best Practices
- Never rely on color alone for information
- Use text labels with icons
- Ensure focus states are visible
- Test with color blindness simulators

---

## 10. DARK MODE GUIDELINES

### Dark Mode Implementation
- Uses `html[data-theme="dark"]` selector
- Inverts colors while maintaining contrast
- Same structure, different values

### Dark Mode Colors
- Primary Light becomes softer/lighter
- Text White becomes light blue/white
- Backgrounds become very dark blue/black
- Ensure 4.5:1 contrast ratio maintained

---

## Implementation Checklist

- ✅ CSS Custom Properties established
- ✅ Typography scale defined (H1-H5, body, eyebrow)
- ✅ Color palette documented
- ✅ Spacing system (8px grid) implemented
- ✅ Border radius scale defined
- ✅ Shadow system created
- ✅ Transitions & animations specified
- ⏳ Component styles to be applied across all pages
- ⏳ Test responsive behavior
- ⏳ Validate WCAG color contrast
- ⏳ Dark mode testing

---

## Usage Examples

### Setting Typography
```css
h1 {
  font-size: clamp(2.15rem, 5vw, 4.05rem);
  font-weight: var(--font-weight-black);
  color: var(--text-dark);
}
```

### Creating a Premium Card
```css
.card {
  border-radius: var(--radius-xl);
  padding: var(--space-xl);
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(20px);
  box-shadow: var(--shadow-md);
  transition: all var(--transition-slow);
}

.card:hover {
  transform: translateY(-12px);
  box-shadow: var(--shadow-xl);
}
```

### Spacing Between Elements
```css
.section {
  padding: var(--space-5xl) 0;
  margin-bottom: var(--space-3xl);
}
```

---

## Maintenance Notes

- Update CSS variables in `:root` for light mode
- Update CSS variables in `html[data-theme="dark"]` for dark mode
- Always use variables instead of hardcoded values
- Test all changes across all pages
- Maintain this document when making design changes
