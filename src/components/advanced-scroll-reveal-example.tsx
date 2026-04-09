"use client";

import { ScrollReveal, ScrollRevealContainer, ScrollRevealItem } from "@/components/scroll-reveal";

/**
 * Advanced ScrollReveal Integration Example
 * Demonstrates how to integrate ScrollReveal with the Synergy website
 * Can be used as a reference for other pages
 */

interface Feature {
  icon: string;
  title: string;
  description: string;
  color: string;
}

export function AdvancedScrollRevealExample() {
  const features: Feature[] = [
    {
      icon: "🏥",
      title: "Healthcare Excellence",
      description: "Leading-edge pharmaceutical solutions for global health",
      color: "from-blue-100 to-blue-200",
    },
    {
      icon: "🔬",
      title: "Research & Development",
      description: "Continuous innovation in drug manufacturing and diagnostics",
      color: "from-purple-100 to-purple-200",
    },
    {
      icon: "📦",
      title: "Global Supply Chain",
      description: "Reliable delivery across 50+ countries worldwide",
      color: "from-green-100 to-green-200",
    },
    {
      icon: "✅",
      title: "Quality Assurance",
      description: "Rigorous GMP compliance and testing standards",
      color: "from-orange-100 to-orange-200",
    },
    {
      icon: "🌍",
      title: "Sustainability",
      description: "Eco-friendly operations with minimal environmental impact",
      color: "from-teal-100 to-teal-200",
    },
    {
      icon: "👥",
      title: "Community Care",
      description: "Committed to improving healthcare accessibility in regions",
      color: "from-rose-100 to-rose-200",
    },
  ];

  const testimonials = [
    {
      name: "Dr. Sarah Johnson",
      role: "Hospital Director",
      quote: "Synergy's pharmaceutical solutions have transformed our patient care",
    },
    {
      name: "Mr. Rajesh Kumar",
      role: "Healthcare Administrator",
      quote: "Reliable, high-quality medicines with exceptional support",
    },
    {
      name: "Dr. Maria Garcia",
      role: "Clinical Researcher",
      quote: "Their commitment to innovation drives better health outcomes",
    },
  ];

  return (
    <div className="w-full">
      {/* Hero Section */}
      <section className="py-20 px-6 bg-linear-to-br from-slate-900 to-slate-800">
        <ScrollRevealContainer className="max-w-6xl mx-auto">
          <ScrollRevealItem className="mb-4">
            <p className="text-teal-400 uppercase tracking-widest text-sm font-semibold">
              Why Choose Us
            </p>
          </ScrollRevealItem>

          <ScrollRevealItem className="mb-6">
            <h2 className="text-4xl md:text-5xl font-bold text-white">
              Excellence in Every Dose
            </h2>
          </ScrollRevealItem>

          <ScrollRevealItem>
            <p className="text-xl text-gray-300 max-w-2xl">
              Synergy Pharmaceuticals combines decades of expertise with modern
              innovation to deliver healthcare solutions that matter.
            </p>
          </ScrollRevealItem>
        </ScrollRevealContainer>
      </section>

      {/* Features Grid Section */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <ScrollReveal className="mb-16 text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Our Core Strengths
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Built on foundations of trust, quality, and continuous innovation
            </p>
          </ScrollReveal>

          <ScrollRevealContainer
            staggerDelay={0.12}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {features.map((feature, index) => (
              <ScrollRevealItem key={index}>
                <div
                  className={`p-8 bg-linear-to-br ${feature.color} rounded-2xl shadow-md hover:shadow-lg transition-all duration-300 h-full`}
                >
                  <div className="text-5xl mb-4">{feature.icon}</div>
                  <h3 className="text-xl font-bold text-gray-900 mb-3">
                    {feature.title}
                  </h3>
                  <p className="text-gray-700 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </ScrollRevealItem>
            ))}
          </ScrollRevealContainer>
        </div>
      </section>

      {/* Statistics Section */}
      <section className="py-20 px-6 bg-linear-to-r from-blue-50 to-indigo-50">
        <div className="max-w-6xl mx-auto">
          <ScrollRevealContainer
            staggerDelay={0.15}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 text-center"
          >
            {[
              { number: "50+", label: "Countries Served" },
              { number: "2M+", label: "Lives Impacted" },
              { number: "100%", label: "GMP Compliant" },
              { number: "25+", label: "Years of Trust" },
            ].map((stat, index) => (
              <ScrollRevealItem key={index}>
                <div className="p-6">
                  <div className="text-4xl md:text-5xl font-bold text-blue-600 mb-2">
                    {stat.number}
                  </div>
                  <p className="text-gray-700 font-semibold">{stat.label}</p>
                </div>
              </ScrollRevealItem>
            ))}
          </ScrollRevealContainer>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <ScrollReveal className="mb-16 text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              What Healthcare Leaders Say
            </h2>
            <p className="text-lg text-gray-600">
              Trusted by hospitals and clinics across the region
            </p>
          </ScrollReveal>

          <ScrollRevealContainer
            staggerDelay={0.15}
            className="grid grid-cols-1 md:grid-cols-3 gap-8"
          >
            {testimonials.map((testimonial, index) => (
              <ScrollRevealItem key={index}>
                <div className="p-8 bg-white rounded-xl border-2 border-gray-200 shadow-md hover:shadow-lg transition-shadow">
                  <div className="flex items-start mb-4">
                    {[...Array(5)].map((_, i) => (
                      <span key={i} className="text-yellow-400 text-xl">
                        ★
                      </span>
                    ))}
                  </div>
                  <blockquote className="text-gray-700 italic mb-6">
                    "{testimonial.quote}"
                  </blockquote>
                  <div>
                    <p className="font-bold text-gray-900">
                      {testimonial.name}
                    </p>
                    <p className="text-gray-600 text-sm">{testimonial.role}</p>
                  </div>
                </div>
              </ScrollRevealItem>
            ))}
          </ScrollRevealContainer>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6 bg-linear-to-r from-blue-600 to-indigo-600">
        <div className="max-w-4xl mx-auto text-center">
          <ScrollRevealContainer staggerDelay={0.2}>
            <ScrollRevealItem className="mb-6">
              <h2 className="text-4xl md:text-5xl font-bold text-white">
                Ready to Transform Healthcare?
              </h2>
            </ScrollRevealItem>

            <ScrollRevealItem className="mb-8">
              <p className="text-xl text-blue-100">
                Join thousands of healthcare providers choosing Synergy for
                quality, reliability, and innovation.
              </p>
            </ScrollRevealItem>

            <ScrollRevealItem>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button className="px-8 py-3 bg-white text-blue-600 font-bold rounded-lg hover:bg-blue-50 transition-colors">
                  Learn More
                </button>
                <button className="px-8 py-3 bg-blue-700 text-white font-bold rounded-lg hover:bg-blue-800 transition-colors border-2 border-white">
                  Contact Us
                </button>
              </div>
            </ScrollRevealItem>
          </ScrollRevealContainer>
        </div>
      </section>
    </div>
  );
}

/**
 * Minimal Integration Example
 * Use this pattern for simple sections on existing pages
 */
export function MinimalScrollRevealExample() {
  return (
    <ScrollRevealContainer staggerDelay={0.1} className="space-y-6">
      <ScrollRevealItem>
        <h3 className="text-2xl font-bold">Point One</h3>
        <p className="text-gray-600">Description of the first point</p>
      </ScrollRevealItem>

      <ScrollRevealItem>
        <h3 className="text-2xl font-bold">Point Two</h3>
        <p className="text-gray-600">Description of the second point</p>
      </ScrollRevealItem>

      <ScrollRevealItem>
        <h3 className="text-2xl font-bold">Point Three</h3>
        <p className="text-gray-600">Description of the third point</p>
      </ScrollRevealItem>
    </ScrollRevealContainer>
  );
}
