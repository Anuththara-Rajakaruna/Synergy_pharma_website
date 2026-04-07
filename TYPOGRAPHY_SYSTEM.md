# Typography System Documentation

A comprehensive, reusable typography system built with CSS variables for consistent, scalable typography across the Synergy Pharmaceuticals website.

## Overview

This typography system is designed to:
- Provide semantic, consistent typography across all pages
- Scale responsively from mobile (360px) to desktop (1200px+)
- Maintain accessibility standards and contrast ratios
- Be maintainable and scalable for large projects
- Work exclusively with global CSS variables (no Tailwind config needed)

## CSS Variables

### Font Families

```css
--font-primary    /* Inter and system font stack */
--font-mono       /* Monaco, Courier for code */
--font-serif      /* Georgia for editorial content */
```

### Font Weights

```css
--font-weight-light: 300        /* Thin text */
--font-weight-regular: 400      /* Normal text */
--font-weight-medium: 500       /* Semi-bold */
--font-weight-semibold: 600     /* Bold accents */
--font-weight-bold: 700         /* Headings */
--font-weight-extrabold: 800    /* Display/emphasis */
--font-weight-black: 850        /* Maximum emphasis */
```

### Font Sizes

All font sizes scale automatically via media queries:

#### Display Sizes (for hero sections)
- `--font-size-display-xl`: 64px (desktop) → 36px (mobile)
- `--font-size-display-lg`: 56px (desktop) → 30px (mobile)
- `--font-size-display-md`: 48px (desktop) → 24px (mobile)

#### Heading Sizes (h1 - h5)
- `--font-size-heading-xl`: 44px (desktop) → 26px (mobile)
- `--font-size-heading-lg`: 36px (desktop) → 22px (mobile)
- `--font-size-heading-md`: 30px (desktop) → 18px (mobile)
- `--font-size-heading-sm`: 24px (desktop) → 16px (mobile)
- `--font-size-heading-xs`: 20px (desktop) → 15px (mobile)

#### Body Text Sizes
- `--font-size-body-lg`: 18px (desktop) → 15px (mobile)
- `--font-size-body-md`: 16px (desktop) → 15px (mobile) — **default**
- `--font-size-body-sm`: 15px (desktop) → 14px (mobile)
- `--font-size-body-xs`: 14px (desktop) → 13px (mobile)

#### Utility Sizes
- `--font-size-caption`: 13px (desktop) → 12px (mobile)
- `--font-size-tiny`: 12px (desktop) → 11px (mobile)

### Line Heights (Unitless)

```css
--line-height-tight: 1.1       /* Compact (headings) */
--line-height-snug: 1.3        /* Comfortable (sub-headings) */
--line-height-normal: 1.5      /* Standard (body text) */
--line-height-relaxed: 1.7     /* Spacious (long-form) */
--line-height-loose: 2         /* Very spacious (accessibility) */
```

### Letter Spacing

```css
--letter-spacing-tight: -0.02em      /* Headings (negative) */
--letter-spacing-normal: 0           /* Body text */
--letter-spacing-wide: 0.025em       /* Slight expansion */
--letter-spacing-wider: 0.05em       /* Medium expansion */
--letter-spacing-widest: 0.1em       /* Large expansion */
--letter-spacing-caps: 0.15em        /* For all-caps */
```

## Semantic Classes

### Display Classes
Used for hero sections, large headlines:

```html
<h1 class="display-xl">Hero Headline</h1>
<h1 class="display-lg">Large Display</h1>
<h1 class="display-md">Medium Display</h1>
```

### Heading Hierarchy
Semantic heading classes that follow HTML structure:

```html
<!-- Main page heading -->
<h1 class="heading-xl">Main Page Title</h1>

<!-- Section headings -->
<h2 class="heading-lg">Section Title</h2>

<!-- Subsection headings -->
<h3 class="heading-md">Subsection Title</h3>

<!-- Minor headings -->
<h4 class="heading-sm">Minor Heading</h4>
<h5 class="heading-xs">Very Minor Heading</h5>

<!-- Or use standalone classes (no HTML element semantics) -->
<div class="heading-lg">Styled as h2</div>
```

### Body Text Classes

```html
<!-- Large emphasized body text -->
<p class="text-body-lg">Emphasized body text for intros</p>

<!-- Standard body text (default) -->
<p class="text-body">Regular paragraph text</p>

<!-- Alternative naming for body-md -->
<p class="body-md">Same as text-body</p>

<!-- Small supporting text -->
<p class="text-body-sm">Small supporting information</p>

<!-- Extra small text -->
<p class="text-body-xs">Minimal text for UI elements</p>
```

### Semantic Typography Classes

```html
<!-- Eyebrow/label (small caps, uppercase) -->
<p class="eyebrow">Our Capabilities</p>
<p class="label">Featured Product</p>

<!-- Subheading -->
<p class="subheading">Secondary heading without heading tag</p>

<!-- Introduction text (larger, lighter) -->
<p class="intro">Introduction paragraph with emphasis</p>

<!-- Metadata/byline -->
<p class="meta">By John Doe • March 15, 2024</p>
<p class="byline">Published by Synergy Pharmaceuticals</p>

<!-- Muted/secondary text -->
<p class="text-muted">Secondary information in muted color</p>
<p class="text-muted-sm">Small muted text</p>

<!-- Caption text -->
<p class="text-caption">Image Caption Label</p>
<p class="text-small">Small supporting text</p>
```

### Prose for Long-Form Content

```html
<article class="prose">
  <h1>Article Title</h1>
  <p>Article body with automatic margin spacing...</p>
  <h2>Section Heading</h2>
  <p>Section content with proper typography hierarchy.</p>
  <blockquote>A meaningful quote with styling.</blockquote>
  <ul>
    <li>List item one</li>
    <li>List item two</li>
  </ul>
</article>
```

The `.prose` class automatically handles:
- Margin spacing between elements
- Link styling and hover states
- Blockquote styling
- Code block styling
- List formatting

### Text Utility Classes

#### Font Weights
```html
<p class="text-bold">Bold text (700)</p>
<p class="text-semibold">Semibold text (600)</p>
<p class="text-medium">Medium text (500)</p>
<p class="text-light">Light text (400)</p>
```

#### Text Transform
```html
<p class="text-uppercase">THIS IS UPPERCASE</p>
<p class="text-capitalize">This Is Capitalized</p>
<p class="text-lowercase">this is lowercase</p>
```

#### Text Decoration
```html
<p class="text-underline">Underlined text</p>
<p class="text-line-through">Strikethrough text</p>
<a href="#" class="text-link">Styled link</a>
```

#### Text Truncation
```html
<!-- Single line with ellipsis -->
<p class="text-no-wrap">This text will not wrap and ends with...</p>

<!-- Multi-line truncation (2 lines) -->
<p class="text-truncate-2">This will show only 2 lines before truncating...</p>

<!-- Multi-line truncation (3 lines) -->
<p class="text-truncate-3">This will show only 3 lines before truncating...</p>
```

### Accessibility & Contrast

```html
<!-- High contrast text -->
<p class="text-high-contrast">Important information</p>

<!-- Text on dark background -->
<p class="text-on-dark">White text on dark</p>
<p class="text-on-dark-secondary">85% white on dark</p>
<p class="text-on-dark-muted">65% white on dark</p>

<!-- Properly styled links with focus state -->
<a href="#" class="text-link">Accessible Link</a>
```

### Font Family Utilities

```html
<!-- Use monospace font -->
<code class="font-mono">const x = 42;</code>

<!-- Use serif font for editorial -->
<p class="font-serif">Editorial content in serif font</p>

<!-- Explicitly use sans-serif (default) -->
<p class="font-sans">Sans-serif text</p>
```

## Responsive Behavior

Font sizes automatically adjust at these breakpoints:

### Desktop (1200px+)
- Full size as defined in `:root`
- Maximum readability at large screens

### Tablet (900px - 1200px)
- Display sizes reduced ~15%
- Heading sizes reduced ~15%
- Line height increased for readability

### Large Mobile (640px - 900px)
- Display sizes reduced ~30%
- Heading sizes reduced ~30%
- Body text optimized: 16px → 15px
- Line height increased to 1.6+

### Small Mobile (480px - 640px)
- Aggressive reductions for small viewports
- Heading sizes ~40% smaller than desktop
- Consistent 14-15px body text
- Line height: 1.6-1.85 for readability
- Caption sizes: 12px (from 13px)

### Tiny Screens (< 360px)
- Minimal sizes optimized for tiny devices
- Display sizes: ~32px max
- Heading sizes maintained for hierarchy
- Body text: 14px minimum

## Implementation Examples

### Basic Page Structure

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="globals.css">
</head>
<body>
  <!-- Hero section with display text -->
  <header>
    <p class="eyebrow">Our Story</p>
    <h1 class="display-lg">Manufacturing Excellence</h1>
    <p class="intro">Leading pharmaceutical innovation since 1995</p>
  </header>

  <!-- Main content -->
  <main>
    <!-- Section -->
    <section>
      <h2 class="heading-lg">Our Capabilities</h2>
      <p class="text-body">
        Synergy Pharmaceuticals operates world-class manufacturing facilities...
      </p>

      <!-- Feature cards -->
      <div class="card">
        <h3 class="heading-md">WHO-GMP Certified</h3>
        <p class="text-body-sm">Every facility engineered to exceed WHO-GMP standards</p>
      </div>
    </section>

    <!-- Long-form content -->
    <article class="prose">
      <h1>Quality Assurance Standards</h1>
      <p>Our quality systems...</p>
      <h2>Testing Procedures</h2>
      <p>We conduct rigorous testing...</p>
      <ul>
        <li>Advanced testing equipment</li>
        <li>Certified laboratory staff</li>
      </ul>
    </article>
  </main>
</body>
</html>
```

### Using CSS Variables in Custom Classes

```css
/* Custom component with typography variables */
.feature-card {
  padding: var(--space-lg);
  border-radius: var(--radius-lg);
}

.feature-card h3 {
  font-size: var(--font-size-heading-md);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-snug);
  letter-spacing: var(--letter-spacing-tight);
  margin-bottom: var(--space-md);
}

.feature-card p {
  font-size: var(--font-size-body-sm);
  line-height: var(--line-height-normal);
  color: var(--text-muted);
}
```

### Responsive Custom Typography

```css
/* Component with responsive typography */
.testimonial {
  padding: var(--space-2xl);
}

.testimonial blockquote {
  font-size: var(--font-size-body-lg);
  line-height: var(--line-height-relaxed);
  font-weight: var(--font-weight-medium);
  margin-bottom: var(--space-lg);
}

.testimonial .author {
  font-size: var(--font-size-body-sm);
  color: var(--text-muted);
}

/* Responsive adjustments automatically applied via :root media queries */
@media (max-width: 640px) {
  .testimonial {
    padding: var(--space-lg);
  }
  /* Font sizes automatically reduce via :root update */
}
```

## Best Practices

### 1. **Use Semantic Classes Over Custom Sizing**
✅ Good:
```html
<h2 class="heading-lg">Section Title</h2>
```

❌ Avoid:
```html
<h2 style="font-size: 2rem; font-weight: bold;">Section Title</h2>
```

### 2. **Maintain Heading Hierarchy**
✅ Good:
```html
<h1 class="heading-xl">Page Title</h1>
<h2 class="heading-lg">Section</h2>
<h3 class="heading-md">Subsection</h3>
```

❌ Avoid:
```html
<h1 class="heading-lg">Page Title</h1>
<h2 class="heading-md">Section</h2>
<h3 class="heading-sm">Subsection</h3>
```

### 3. **Use `.prose` for Long-Form Content**
✅ For articles, blog posts, documentation:
```html
<article class="prose">
  <!-- Automatic spacing and styling -->
</article>
```

### 4. **Leverage CSS Variables in Components**
✅ For custom components, reference variables:
```css
.custom-card h3 {
  font-size: var(--font-size-heading-md);
  font-weight: var(--font-weight-semibold);
}
```

### 5. **Respect Reduced Motion Preferences**
✅ The system automatically respects `prefers-reduced-motion`:
```css
/* Automatically disabled for users with reduced motion preference */
@media (prefers-reduced-motion: reduce) {
  /* Animations disabled */
}
```

### 6. **Test Accessibility**
- Check color contrast (WCAG AA minimum)
- Use heading hierarchy in DOM order
- Ensure proper link styling with focus states
- Test with screen readers

## Maintenance & Scalability

### Adding New Sizes
If custom sizes are needed, add them to the `:root` block:
```css
:root {
  --font-size-custom: 1.75rem;
}

@media (max-width: 900px) {
  :root {
    --font-size-custom: 1.5rem;
  }
}
```

### Creating Variants
For component-specific typography:
```css
.button {
  font-size: var(--font-size-body-sm);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--letter-spacing-wider);
}

.badge {
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--letter-spacing-caps);
}
```

### Dark Mode Support
The system includes dark mode typography via `html[data-theme="dark"]`:
```css
html[data-theme="dark"] {
  --text-dark: #e8f2f8;
  --text-muted: #b1c1cd;
  /* Text automatically adjusts for dark backgrounds */
}
```

## CSS Variable Reference

All variables are defined in `src/app/globals.css` `:root` block and update automatically via media queries.

### Accessing Variables in Code

```jsx
// React/Next.js example
export function CustomComponent() {
  return (
    <div style={{
      fontSize: 'var(--font-size-body-lg)',
      fontWeight: 'var(--font-weight-semibold)',
    }}>
      Styled with typography variables
    </div>
  );
}
```

## Browser Support

- All modern browsers (Chrome, Firefox, Safari, Edge)
- CSS variables supported in all modern browsers
- Fallback: ensure default styles apply if variables fail to load

## Summary

This typography system provides:
- ✅ 60+ predefined semantic classes
- ✅ Automatic responsive scaling across 5 breakpoints
- ✅ Accessibility-first design
- ✅ Dark mode support
- ✅ Reduced motion support
- ✅ 100% CSS variable based (maintainable)
- ✅ Zero dependencies (no Tailwind config needed)
- ✅ Highly scalable for large projects

For questions or updates, reference `globals.css` `:root` section and typography documentation at the top of the file.
