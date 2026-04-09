# ScrollReveal Component - Quick Start Guide

## 📁 Files Created

```
src/components/
  ├── scroll-reveal.tsx                    # Core component (3 exports)
  ├── scroll-reveal-examples.tsx           # 6 usage examples
  └── advanced-scroll-reveal-example.tsx   # Full-page demo

src/app/
  └── scroll-reveal-demo/
      └── page.tsx                         # Demo page (view at /scroll-reveal-demo)

SCROLL_REVEAL_DOCS.md                      # Comprehensive documentation
```

## 🚀 Quick Start (3 Steps)

### Step 1: Import the Component
```tsx
import { ScrollReveal, ScrollRevealContainer, ScrollRevealItem } from "@/components/scroll-reveal";
```

### Step 2: Choose Your Pattern

**Pattern A: Single Item**
```tsx
<ScrollReveal>
  <div className="p-8 bg-blue-100 rounded-lg">
    Content animates when visible
  </div>
</ScrollReveal>
```

**Pattern B: Staggered Items (Recommended for Lists)**
```tsx
<ScrollRevealContainer staggerDelay={0.1}>
  {items.map((item) => (
    <ScrollRevealItem key={item.id}>
      <div>{item.content}</div>
    </ScrollRevealItem>
  ))}
</ScrollRevealContainer>
```

### Step 3: Customize (Optional)
```tsx
// Custom duration and delay
<ScrollReveal duration={0.8} delay={0.2}>
  <div>Slower animation with delay</div>
</ScrollReveal>

// Custom stagger timing
<ScrollRevealContainer staggerDelay={0.15}>
  {/* items */}
</ScrollRevealContainer>
```

## 🎨 What It Does

✅ **Initial state:** Element is invisible (opacity: 0, scale: 0.9)
✅ **On scroll:** Triggers when element enters viewport
✅ **Animation:** Smooth fade-in + zoom-in (0.6s by default, ease-out)
✅ **Once:** Animation only happens the first time

## 📋 Component API

### ScrollReveal Props
| Prop | Type | Default | Example |
|------|------|---------|---------|
| `children` | ReactNode | — | `<div>Content</div>` |
| `duration` | number | `0.6` | `duration={0.8}` |
| `delay` | number | `0` | `delay={0.2}` |
| `className` | string | `""` | `className="mb-4"` |

### ScrollRevealContainer Props
| Prop | Type | Default | Example |
|------|------|---------|---------|
| `children` | ReactNode | — | `<ScrollRevealItem>...</ScrollRevealItem>` |
| `staggerDelay` | number | `0.1` | `staggerDelay={0.15}` |
| `className` | string | `""` | `className="grid grid-cols-3"` |

### ScrollRevealItem Props
| Prop | Type | Default | Example |
|------|------|---------|---------|
| `children` | ReactNode | — | `<div>Item</div>` |
| `className` | string | `""` | `className="mb-4"` |

## 💡 Common Patterns

### Cards Grid
```tsx
<ScrollRevealContainer staggerDelay={0.12} className="grid grid-cols-1 md:grid-cols-3 gap-6">
  {cards.map((card) => (
    <ScrollRevealItem key={card.id}>
      <Card data={card} />
    </ScrollRevealItem>
  ))}
</ScrollRevealContainer>
```

### List Items
```tsx
<ScrollRevealContainer staggerDelay={0.1}>
  {items.map((item) => (
    <ScrollRevealItem key={item.id} className="mb-4">
      <ListItem data={item} />
    </ScrollRevealItem>
  ))}
</ScrollRevealContainer>
```

### Section with Title + Content
```tsx
<>
  <ScrollReveal className="mb-8">
    <h2 className="text-3xl font-bold">Section Title</h2>
  </ScrollReveal>
  
  <ScrollRevealContainer staggerDelay={0.15}>
    {contents.map((content) => (
      <ScrollRevealItem key={content.id}>
        <Content data={content} />
      </ScrollRevealItem>
    ))}
  </ScrollRevealContainer>
</>
```

## 🔍 Try the Demo

Visit: **http://localhost:3000/scroll-reveal-demo**

The demo showcases:
- ✅ Hero section with staggered title, subtitle, and button
- ✅ 6-card grid with smooth animations
- ✅ Statistics counter section
- ✅ Testimonials with ratings
- ✅ Call-to-action section with buttons

**Scroll down** to see the animations trigger!

## 📚 Full Documentation

See [SCROLL_REVEAL_DOCS.md](./SCROLL_REVEAL_DOCS.md) for:
- Detailed component usage
- Animation specifications
- Performance notes
- Troubleshooting
- Browser support

## 🛠️ How to Use in Your Pages

### Example: Integrate into About Page

```tsx
// src/app/about/page.tsx
import { ScrollRevealContainer, ScrollRevealItem } from "@/components/scroll-reveal";

export default function AboutPage() {
  return (
    <section>
      <ScrollRevealContainer staggerDelay={0.1}>
        {aboutCards.map((card) => (
          <ScrollRevealItem key={card.title}>
            <div className="p-6 bg-white rounded-lg">
              <h3>{card.title}</h3>
              <p>{card.description}</p>
            </div>
          </ScrollRevealItem>
        ))}
      </ScrollRevealContainer>
    </section>
  );
}
```

## ⚡ Performance Tips

1. **Use Container + Item for lists:** Better for staggering multiple items
2. **Keep stagger < 0.3s:** Maintains smooth flow
3. **Combine with Tailwind classes:** No additional CSS needed
4. **Works with Next.js Image:** Compatible with image optimization

## 🐛 Troubleshooting

**Animation not showing?**
- Ensure element is not already visible on page load
- Check that element height/width allows viewport detection
- Try scrolling down below the fold

**Animation too fast/slow?**
```tsx
<ScrollReveal duration={1.0}>  {/* Increase duration */}
  <div>Content</div>
</ScrollReveal>
```

**Need different animation timing?**
```tsx
<ScrollRevealContainer staggerDelay={0.2}>  {/* Increase stagger */}
  {items.map((item) => (
    <ScrollRevealItem key={item.id}>
      {item.name}
    </ScrollRevealItem>
  ))}
</ScrollRevealContainer>
```

## 🎯 Next Steps

1. ✅ Review the demo page: http://localhost:3000/scroll-reveal-demo
2. ✅ Copy patterns from examples to your pages
3. ✅ Customize duration/delay/stagger to match your design
4. ✅ Use in teams with consistent animations across site

## 📞 Questions?

All components have TypeScript types and JSDoc comments for IDE autocomplete support.

---

**Built with:** React 19 + Next.js 16 + Framer Motion 12 + Tailwind CSS 4
