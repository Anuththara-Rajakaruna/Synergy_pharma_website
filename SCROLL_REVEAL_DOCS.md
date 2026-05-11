# ScrollReveal Component Documentation

A reusable, performant scroll animation component for Next.js built with React, Tailwind CSS, and Framer Motion.

## Features

✨ **Smooth Animations**
- Fade-in + zoom-in effect (opacity: 0→1, scale: 0.9→1)
- Customizable duration (default: 0.6s) and delay
- Ease-out timing function for natural motion
- Animation triggers only once when element enters viewport

🎯 **Easy to Use**
- Drop-in wrapper components
- Three variations for different use cases
- Works seamlessly with Tailwind CSS
- TypeScript support

📱 **Performance Optimized**
- Uses Intersection Observer under the hood (via Framer Motion)
- Viewport margin for early trigger (50px below viewport)
- No animations if user prefers reduced motion (future-ready)

## Installation

The component uses [Framer Motion](https://www.framer.com/motion/) which is already included in the project dependencies.

```bash
npm install framer-motion  # Already installed
```

## Components

### 1. **ScrollReveal** (Single Item)

The basic wrapper for animating a single element.

```tsx
import { ScrollReveal } from "@/components/scroll-reveal";

export function MyComponent() {
  return (
    <ScrollReveal>
      <div className="p-8 bg-blue-100 rounded-lg">
        <h3>I animate when I enter the viewport!</h3>
      </div>
    </ScrollReveal>
  );
}
```

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | — | Content to animate |
| `delay` | `number` | `0` | Delay before animation starts (seconds) |
| `duration` | `number` | `0.6` | Animation duration (seconds) |
| `className` | `string` | `""` | Tailwind/custom CSS classes |

**Example with Custom Duration:**

```tsx
<ScrollReveal duration={0.8} delay={0.2}>
  <div className="p-6 bg-green-100 rounded-lg">
    Content animates slowly with a delay
  </div>
</ScrollReveal>
```

---

### 2. **ScrollRevealContainer + ScrollRevealItem** (Staggered List)

Use these together to create a staggered cascade effect for multiple items.

```tsx
import { ScrollRevealContainer, ScrollRevealItem } from "@/components/scroll-reveal";

export function CardList() {
  const items = [
    { title: "Item 1" },
    { title: "Item 2" },
    { title: "Item 3" },
  ];

  return (
    <ScrollRevealContainer staggerDelay={0.15}>
      {items.map((item, index) => (
        <ScrollRevealItem key={index}>
          <div className="p-6 bg-linear-to-r from-teal-100 to-cyan-100 rounded-lg mb-4">
            {item.title}
          </div>
        </ScrollRevealItem>
      ))}
    </ScrollRevealContainer>
  );
}
```

**ScrollRevealContainer Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | — | Child elements (typically ScrollRevealItem) |
| `staggerDelay` | `number` | `0.1` | Delay between item animations (seconds) |
| `className` | `string` | `""` | Tailwind/custom CSS classes |

**ScrollRevealItem Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | — | Content to animate |
| `className` | `string` | `""` | Tailwind/custom CSS classes |

---

## Usage Examples

### Grid of Cards

```tsx
<ScrollRevealContainer staggerDelay={0.12} className="grid grid-cols-1 md:grid-cols-3 gap-6">
  {cards.map((card, i) => (
    <ScrollRevealItem key={i}>
      <div className="p-6 bg-white rounded-lg shadow-md">
        <h3 className="font-bold">{card.title}</h3>
        <p>{card.description}</p>
      </div>
    </ScrollRevealItem>
  ))}
</ScrollRevealContainer>
```

### List of Items

```tsx
<ScrollRevealContainer staggerDelay={0.1}>
  {items.map((item) => (
    <ScrollRevealItem key={item.id} className="mb-4">
      <div className="p-4 bg-blue-50 rounded-lg border-l-4 border-blue-500">
        {item.content}
      </div>
    </ScrollRevealItem>
  ))}
</ScrollRevealContainer>
```

### Mixed Content

```tsx
<ScrollReveal className="mb-8">
  <h2 className="text-3xl font-bold mb-4">Section Title</h2>
</ScrollReveal>

<ScrollRevealContainer staggerDelay={0.15}>
  {subsections.map((sub) => (
    <ScrollRevealItem key={sub.id}>
      <div className="mb-6 p-6 bg-gray-100 rounded-lg">
        {sub.content}
      </div>
    </ScrollRevealItem>
  ))}
</ScrollRevealContainer>
```

---

## Animation Details

### Initial State
```
opacity: 0
scale: 0.9 (slightly zoomed out)
```

### Target State
```
opacity: 1
scale: 1
```

### Timing
- **Default Duration:** 0.6 seconds
- **Easing:** `easeOut` (natural deceleration)
- **Viewport Trigger:** Element enters viewport with 50px margin below
- **Trigger Frequency:** Once (only triggers on first entrance)

### Customization Example

```tsx
// Fast animation
<ScrollReveal duration={0.4}>
  <div>Quick fade-in</div>
</ScrollReveal>

// Slow, staggered items
<ScrollRevealContainer staggerDelay={0.2}>
  {items.map((item) => (
    <ScrollRevealItem key={item.id}>
      <div>{item.name}</div>
    </ScrollRevealItem>
  ))}
</ScrollRevealContainer>
```

---

## Performance Notes

✅ **Optimized for Performance**
- Uses Intersection Observer API (via Framer Motion)
- Animations only run when visible
- Lightweight - no external libraries beyond Framer Motion
- Works with Next.js image optimization
- SSR/SSG compatible

⚠️ **Best Practices**
- Use for important visual elements (cards, sections, highlights)
- Keep stagger delays < 0.3s for smooth cascades
- Combine with Tailwind's responsive classes for mobile optimization
- Test on actual devices for animation smoothness

---

## Browser Support

Works in all modern browsers that support:
- ES6+
- CSS Transforms
- `IntersectionObserver` API

**Fallback:** Framer Motion automatically handles unsupported browsers gracefully.

---

## Integration with Existing Components

### Using with Next.js Image

```tsx
<ScrollReveal>
  <Image
    src="/hero.jpg"
    alt="Hero"
    width={400}
    height={300}
    className="rounded-lg"
  />
</ScrollReveal>
```

### Using with Forms

```tsx
<ScrollRevealContainer staggerDelay={0.1}>
  <ScrollRevealItem>
    <input type="text" placeholder="Name" className="w-full p-2 mb-4" />
  </ScrollRevealItem>
  <ScrollRevealItem>
    <input type="email" placeholder="Email" className="w-full p-2 mb-4" />
  </ScrollRevealItem>
  <ScrollRevealItem>
    <button className="px-6 py-2 bg-blue-600 text-white rounded">
      Submit
    </button>
  </ScrollRevealItem>
</ScrollRevealContainer>
```

---

## Troubleshooting

### Animation not triggering?

1. **Check viewport:** Element must enter viewport with margin
2. **Reduce margin:** Adjust calculation if element is far below fold
3. **Mobile issue:** Ensure `once: true` is working (it is by default)

### Animation jittery on mobile?

1. Use `will-change: transform` in parent (handled by Framer Motion)
2. Reduce `staggerDelay` for faster cascade
3. Test on actual device (not just browser DevTools)

### Animation too fast/slow?

```tsx
// Adjust duration prop
<ScrollReveal duration={1.0}>  {/* 1 second */}
  <div>Slower animation</div>
</ScrollReveal>
```

---

## License

Same as the Synergy project (ISC)

## Credits

Built with [Framer Motion](https://www.framer.com/motion/) - powerful motion library for React.
