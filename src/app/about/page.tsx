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