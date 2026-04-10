import { ScrollReveal, ScrollRevealContainer, ScrollRevealItem } from "@/components/scroll-reveal";

/**
 * ScrollReveal Examples - Shows different usage patterns
 * 
 * This file demonstrates how to use the ScrollReveal components
 * in various scenarios throughout your Next.js application.
 */

// === EXAMPLE 1: Basic Single Item ===
export function BasicScrollRevealExample() {
  return (
    <ScrollReveal>
      <div className="p-8 bg-blue-100 rounded-lg">
        <h3 className="text-xl font-bold">I appear with fade-in + zoom</h3>
        <p>This element animates when it enters the viewport.</p>
      </div>
    </ScrollReveal>
  );
}

// === EXAMPLE 2: Multiple Items with Stagger ===
export function StaggeredScrollRevealExample() {
  const items = [
    { title: "Item 1", description: "First item in the list" },
    { title: "Item 2", description: "Second item in the list" },
    { title: "Item 3", description: "Third item in the list" },
  ];

  return (
    <ScrollRevealContainer staggerDelay={0.15}>
      {items.map((item, index) => (
        <ScrollRevealItem key={index}>
          <div className="p-6 mb-4 bg-gradient-to-r from-teal-100 to-cyan-100 rounded-lg">
            <h4 className="font-bold text-lg">{item.title}</h4>
            <p className="text-gray-700">{item.description}</p>
          </div>
        </ScrollRevealItem>
      ))}
    </ScrollRevealContainer>
  );
}

// === EXAMPLE 3: Card Grid with Stagger ===
export function CardGridExample() {
  const cards = [
    { icon: "🎯", title: "Focus", color: "from-blue-100 to-blue-200" },
    { icon: "⚡", title: "Speed", color: "from-purple-100 to-purple-200" },
    { icon: "🔒", title: "Security", color: "from-green-100 to-green-200" },
    { icon: "📊", title: "Analytics", color: "from-orange-100 to-orange-200" },
  ];

  return (
    <ScrollRevealContainer
      staggerDelay={0.12}
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
    >
      {cards.map((card, index) => (
        <ScrollRevealItem key={index}>
          <div
            className={`p-8 bg-gradient-to-br ${card.color} rounded-xl shadow-md hover:shadow-lg transition-shadow`}
          >
            <div className="text-4xl mb-3">{card.icon}</div>
            <h3 className="font-bold text-lg">{card.title}</h3>
          </div>
        </ScrollRevealItem>
      ))}
    </ScrollRevealContainer>
  );
}

// === EXAMPLE 4: Custom Duration and Delay ===
export function CustomAnimationExample() {
  return (
    <div className="space-y-8">
      <ScrollReveal duration={0.5}>
        <div className="p-6 bg-indigo-100 rounded-lg">
          <h3 className="font-bold">Fast Animation (0.5s)</h3>
          <p>Animates quickly when visible</p>
        </div>
      </ScrollReveal>

      <ScrollReveal duration={0.8} delay={0.2}>
        <div className="p-6 bg-rose-100 rounded-lg">
          <h3 className="font-bold">Slow Animation (0.8s) with Delay</h3>
          <p>Takes longer to animate with a slight delay</p>
        </div>
      </ScrollReveal>
    </div>
  );
}

// === EXAMPLE 5: Integration with Tailwind Classes ===
export function TailwindIntegrationExample() {
  return (
    <ScrollRevealContainer staggerDelay={0.1}>
      <ScrollRevealItem className="mb-6">
        <div className="max-w-2xl p-8 bg-white rounded-2xl border-2 border-gray-200 shadow-lg hover:shadow-xl transition-shadow">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Feature Highlight
          </h2>
          <p className="text-gray-600 leading-relaxed">
            Using ScrollReveal with Tailwind CSS for fully styled components
          </p>
        </div>
      </ScrollRevealItem>

      <ScrollRevealItem className="mb-6">
        <div className="max-w-2xl p-8 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border-2 border-blue-200">
          <h3 className="text-lg font-semibold text-blue-900 mb-2">
            Feature Two
          </h3>
          <p className="text-blue-700">Another animated element</p>
        </div>
      </ScrollRevealItem>

      <ScrollRevealItem>
        <div className="max-w-2xl p-8 bg-gradient-to-r from-green-50 to-teal-50 rounded-2xl border-2 border-green-200">
          <h3 className="text-lg font-semibold text-green-900 mb-2">
            Feature Three
          </h3>
          <p className="text-green-700">Last animated element</p>
        </div>
      </ScrollRevealItem>
    </ScrollRevealContainer>
  );
}

// === EXAMPLE 6: Hero Section with ScrollReveal ===
export function HeroSectionExample() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
      <ScrollRevealContainer className="text-center text-white px-4">
        <ScrollRevealItem className="mb-6">
          <h1 className="text-5xl md:text-6xl font-bold mb-4">
            Welcome to ScrollReveal
          </h1>
        </ScrollRevealItem>

        <ScrollRevealItem className="mb-6">
          <p className="text-xl md:text-2xl text-gray-300 max-w-2xl mx-auto">
            Create beautiful scroll animations with this reusable component
          </p>
        </ScrollRevealItem>

        <ScrollRevealItem>
          <button className="px-8 py-4 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold text-lg transition-colors">
            Get Started
          </button>
        </ScrollRevealItem>
      </ScrollRevealContainer>
    </div>
  );
}
