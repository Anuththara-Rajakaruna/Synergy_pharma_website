import { SiteHeader } from "@/components/site-header";

const leaders = [
  { role: "Chairman", name: "Mr.Ravi Wijeratne" },
  { role: "Managing Director", name: "Dr.Rohan Lalith Wijesundara" },
  { role: "Director", name: "Mr.Rishi Wijeratne" },
  { role: "Director", name: "Mr.Rahul Wijeratne" },
];

export default function AboutPage() {
  return (
    <main className="about-page">
      <SiteHeader />

      <section
        className="hero"
        id="about"
        style={{ backgroundImage: 'url("/manufacturing-showcase-v2.jpg")', backgroundPosition: 'center 4%' }}
      >
        <div className="hero-overlay" />
        <div className="hero-content hero-shell">
          <p className="eyebrow">About Synergy</p>
          <h1>
            Built on trust,
            <br />
            driven by precision.
          </h1>
          <p className="hero-copy">
            Synergy Pharmaceutical combines visionary leadership, responsible manufacturing, and
            quality-first operations to deliver healthcare solutions that matter across the region.
          </p>
        </div>
      </section>

      <section className="container section leadership-page-section" id="leadership">
        <p className="eyebrow">Organization</p>
        <h1>Leadership & Vision</h1>
        <p className="showcase-copy capabilities-intro">
          Our strategic leadership team drives long-term innovation, governance, and sustainable
          growth across all pharmaceutical operations.
        </p>

        <div className="leaders">
          {leaders.map((leader) => (
            <article className="leader" key={`${leader.role}-${leader.name}`}>
              <div className="avatar" />
              <p className="leader-role">{leader.role}</p>
              <h3>{leader.name}</h3>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}