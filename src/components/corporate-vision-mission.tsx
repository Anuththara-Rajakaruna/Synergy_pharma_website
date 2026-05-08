import { Leaf, ShieldCheck, Sparkles, Users, Waypoints } from "lucide-react";
import { ScrollReveal, ScrollRevealContainer, ScrollRevealItem } from "@/components/scroll-reveal";

const values = [
  { title: "Respect", icon: Users },
  { title: "Integrity", icon: ShieldCheck },
  { title: "Collaboration", icon: Waypoints },
  { title: "Excellence", icon: Sparkles },
  { title: "Sustainability", icon: Leaf },
];

type CorporateVisionMissionProps = {
  className?: string;
};

export function CorporateVisionMission({ className = "" }: CorporateVisionMissionProps) {
  return (
    <section className={`corporate-values-section reveal-on-scroll ${className}`.trim()}>
      <div className="corporate-values-shell">
        <ScrollReveal className="corporate-values-header">
          <p className="corporate-values-eyebrow">Strategic Direction</p>
          <h2>Vision, Mission &amp; Values</h2>
          <p className="corporate-values-subtitle">
            A modern pharmaceutical mandate shaped by global standards, disciplined execution, and
            long-term healthcare responsibility.
          </p>
        </ScrollReveal>

        <div className="corporate-values-layout">
          <ScrollReveal className="corporate-vision-card" delay={0.05}>
            <div className="" aria-hidden="true" />
            <p className="corporate-card-label">Vision</p>
            <blockquote>
              &ldquo;To become a leading Sri Lankan pharmaceutical manufacturer of high-quality
              finished dosage forms, recognized globally for innovation, reliability, and excellence
              in healthcare.&rdquo;
            </blockquote>
          </ScrollReveal>

          <div className="corporate-mission-column">
            <ScrollReveal className="corporate-mission-card" delay={0.12}>
              <p className="corporate-card-label">Mission</p>
              <p className="corporate-mission-copy">
                &ldquo;To manufacture and supply high-quality finished dosage forms that comply with
                international regulatory standards, ensuring safety, efficacy, and consistency.&rdquo;
              </p>
            </ScrollReveal>

            <ScrollReveal className="corporate-values-card" delay={0.18}>
              <div className="corporate-values-card-header">
                <p className="corporate-card-label">Values</p>
                <div className="corporate-values-divider" aria-hidden="true" />
              </div>

              <ScrollRevealContainer staggerDelay={0.07} className="corporate-values-grid">
                {values.map((value) => {
                  const Icon = value.icon;

                  return (
                    <ScrollRevealItem key={value.title}>
                      <article className="corporate-value-pill">
                        <span className="corporate-value-icon">
                          <Icon size={18} strokeWidth={2.1} />
                        </span>
                        <span>{value.title}</span>
                      </article>
                    </ScrollRevealItem>
                  );
                })}
              </ScrollRevealContainer>
            </ScrollReveal>
          </div>
        </div>
      </div>
    </section>
  );
}
