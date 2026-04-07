# Typography System - Quick Reference

A complete CSS-variable-based typography system for consistent, responsive typography.

## 🎯 Quick Start

### Use semantic classes (not inline styles)
```html
<!-- Headings -->
<h1 class="heading-xl">Page Title</h1>
<h2 class="heading-lg">Section</h2>
<h3 class="heading-md">Subsection</h3>

<!-- Body Text -->
<p class="text-body">Default content text</p>
<p class="text-body-lg">Emphasized text</p>
<p class="text-body-sm">Small supporting text</p>
<p class="text-muted">Secondary muted text</p>

<!-- Metadata -->
<p class="eyebrow">Our Capabilities</p>
<p class="meta">By Author • Date</p>

<!-- Long-form -->
<article class="prose">
  <h1>Article Title</h1>
  <p>Content with automatic margins...</p>
</article>
```

## 📏 Class Reference

### Display (Hero Sections)
| Class | Size (Desktop) | Size (Mobile) |
|-------|---|---|
| `.display-xl` | 64px | 36px |
| `.display-lg` | 56px | 30px |
| `.display-md` | 48px | 24px |

### Headings (H1-H5)
| HTML | CSS Class | Size (Desktop) | Size (Mobile) |
|------|-----------|---|---|
| `<h1>` | `.heading-xl` | 44px | 26px |
| `<h2>` | `.heading-lg` | 36px | 22px |
| `<h3>` | `.heading-md` | 30px | 18px |
| `<h4>` | `.heading-sm` | 24px | 16px |
| `<h5>` | `.heading-xs` | 20px | 15px |

### Body Text
| Class | Size | Usage |
|-------|------|-------|
| `.text-body-lg` | 18→15px | Emphasized body (intros) |
| `.text-body` / `.body-md` | 16→15px | **Default body text** |
| `.text-body-sm` | 15→14px | Supporting text |
| `.text-body-xs` | 14→13px | UI labels, badges |

### Semantic Classes
| Class | Purpose | Style |
|-------|---------|-------|
| `.eyebrow` / `.label` | Small caps headers | 13px, uppercase, semibold |
| `.intro` | Introduction paragraphs | 18px, relaxed line-height |
| `.subheading` | Section subtitle | 18px, semibold |
| `.meta` / `.byline` | Author/date info | 15px, medium, widest spacing |
| `.text-small` / `.small` | General small text | 13px, regular |
| `.text-caption` | Caption labels | 13px, uppercase, medium |
| `.text-tiny` | Minimal text | 12px, medium, wide spacing |
| `.text-muted` | Secondary text | 16px, muted color |
| `.text-muted-sm` | Small muted text | 15px, muted color |

### Text Variants
```html
<p class="text-bold">Bold 700</p>
<p class="text-semibold">Semibold 600</p>
<p class="text-medium">Medium 500</p>
<p class="text-light">Light 400</p>

<p class="text-uppercase">UPPERCASE TEXT</p>
<p class="text-capitalize">Capitalized Text</p>
<p class="text-lowercase">lowercase text</p>

<p class="text-underline">Underlined</p>
<p class="text-line-through">Struck through</p>
<a href="#" class="text-link">Styled Link</a>

<!-- Truncation -->
<p class="text-no-wrap">Single line with ellipsis...</p>
<p class="text-truncate-2">Two-line truncate with\nellipsis...</p>
<p class="text-truncate-3">Three-line truncate\nwith ellipsis...</p>
```

### Accessibility
```html
<p class="text-high-contrast">High contrast content</p>

<!-- For dark backgrounds -->
<p class="text-on-dark">White text</p>
<p class="text-on-dark-secondary">85% white</p>
<p class="text-on-dark-muted">65% white</p>

<!-- Links with focus states -->
<a href="#" class="text-link">Accessible link</a>
```

### Font Families
```html
<code class="font-mono">Monospace code</code>
<p class="font-serif">Serif text</p>
<p class="font-sans">Sans-serif (default)</p>
```

## 🧬 CSS Variables (for custom styles)

### Font Sizes
```css
--font-size-display-xl/lg/md
--font-size-heading-xl/lg/md/sm/xs
--font-size-body-lg/md/sm/xs
--font-size-caption
--font-size-tiny
```

### Font Properties
```css
--font-primary        /* default sans-serif */
--font-mono           /* monospace */
--font-serif          /* serif */

--font-weight-light (300)
--font-weight-regular (400)
--font-weight-medium (500)
--font-weight-semibold (600)
--font-weight-bold (700)
--font-weight-extrabold (800)
--font-weight-black (850)
```

### Line Heights
```css
--line-height-tight (1.1)      /* compact */
--line-height-snug (1.3)       /* comfortable */
--line-height-normal (1.5)     /* standard */
--line-height-relaxed (1.7)    /* spacious */
--line-height-loose (2)        /* very spacious */
```

### Letter Spacing
```css
--letter-spacing-tight (-0.02em)
--letter-spacing-normal (0)
--letter-spacing-wide (0.025em)
--letter-spacing-wider (0.05em)
--letter-spacing-widest (0.1em)
--letter-spacing-caps (0.15em)
```

## 📱 Responsive Breakpoints

Font sizes automatically scale at these breakpoints:

- **1200px+**: Desktop (full size)
- **900px-1200px**: Tablet (~15% reduction)
- **640px-900px**: Large mobile (~30% reduction)
- **480px-640px**: Small mobile (~40% reduction)
- **<360px**: Tiny devices (minimal)

No media queries needed in components - everything is handled by `:root` variables!

## 💡 Best Practices

✅ **Do:**
- Use semantic classes: `class="heading-lg"`
- Apply to all page content
- Use `.prose` for articles/long-form
- Reference CSS variables in custom components
- Test on mobile (automatic scaling)

❌ **Don't:**
- Use inline `style` attributes for typography
- Create custom font sizes (use existing system)
- Break heading hierarchy (h1 → h2 → h3)
- Use `px` in custom components (use `var()`)

## 🔧 Custom Component Example

```css
/* Custom card component */
.product-card h3 {
  font-size: var(--font-size-heading-md);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-snug);
  letter-spacing: var(--letter-spacing-tight);
}

.product-card p {
  font-size: var(--font-size-body-sm);
  color: var(--text-muted);
}

/* Automatically responsive via :root media queries! */
```

## 📚 Full Documentation

See `TYPOGRAPHY_SYSTEM.md` for complete documentation including:
- Implementation examples
- Dark mode support
- Reduced motion accessibility
- Full CSS variable reference
- Maintenance guidelines

## 🎨 What's Included

- **60+ semantic classes**
- **7 font weights** (light to black)
- **5 line height options** (tight to loose)
- **6 letter spacing levels** (tight to caps)
- **Responsive scaling** across 5 breakpoints
- **Dark mode** variable support
- **Accessibility** (WCAG contrast, focus states, reduced motion)
- **Zero dependencies** (pure CSS, no npm packages)

---

**System Location**: `src/app/globals.css` (lines 1-700+)

**Need help?** Check `TYPOGRAPHY_SYSTEM.md` or review the CSS variables comments in `globals.css`
