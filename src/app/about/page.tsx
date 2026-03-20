import { SiteHeader } from "@/components/site-header";

const leaders = [
  "MR.RAVI WIJERATNE",
  "Dr. Ruwan Sen",
  "Board of Directors",
  "Senior Management",
];

export default function AboutPage() {
  return (
    <main className="about-page">
      <SiteHeader />

      <section className="container section leadership-page-section" id="leadership">
        <p className="eyebrow">Organization</p>
        <h1>Leadership & Vision</h1>
        <p className="showcase-copy capabilities-intro">
          Our strategic leadership team drives long-term innovation, governance, and sustainable
          growth across all pharmaceutical operations.
        </p>

        <div className="leaders">
          {leaders.map((leader) => (
            <article className="leader" key={leader}>
              <div className="avatar" />
              <h3>{leader}</h3>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
