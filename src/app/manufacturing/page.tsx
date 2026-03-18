import { SiteHeader } from "@/components/site-header";

const highlights = [
  "Research & Development",
  "Our Solid Dosage",
  "Packaging",
  "Nutritional",
  "Quality Compliance",
  "Supply Ecosystem",
];

const products = ["Dermics", "Cardiovascular", "Psychiatric"];

export default function ManufacturingPage() {
  return (
    <main className="manufacturing-page">
      <SiteHeader />

      <section className="container section manufacturing-capabilities-page" id="manufacturing-capabilities">
        <p className="eyebrow">Core Strengths</p>
        <h1>Manufacturing Capabilities</h1>
        <p className="showcase-copy capabilities-intro">
          Explore our end-to-end manufacturing ecosystem designed for quality, scalability, and
          global compliance.
        </p>

        <div className="grid-cards">
          {highlights.map((item) => (
            <article className="card" key={item}>
              <h3>{item}</h3>
              <p>Built to support scale, compliance, and long-term product quality outcomes.</p>
            </article>
          ))}
        </div>
      </section>

      <section className="container section" id="pharmaceutical-solutions">
        <p className="eyebrow">Therapeutic Portfolio</p>
        <h2>Pharmaceutical Solutions</h2>
        <div className="grid-cards products">
          {products.map((product) => (
            <article className="card" key={product}>
              <h3>{product}</h3>
              <p>Therapeutic solutions engineered for performance, safety, and accessibility.</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
