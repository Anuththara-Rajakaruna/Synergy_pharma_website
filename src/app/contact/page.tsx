import { Building2, Clock, Mail, MapPin, Phone } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { ScrollReveal } from "@/components/scroll-reveal";
import { ContactForm } from "@/components/contact-form";

export const metadata = {
  title: "Contact Us | Synergy Pharma",
  description:
    "Get in touch with Synergy Pharmaceuticals Corporation for product, partnership, and general enquiries.",
};

const contactDetails = [
  {
    icon: <Building2 aria-hidden="true" />,
    title: "Head Office",
    content: (
      <address>
        Astoria Colombo
        <br />
        Level 14, Commercial Tower III
        <br />
        422, R. A. De Mel Mawatha
        <br />
        Colombo 3, Sri Lanka
      </address>
    ),
  },
  {
    icon: <Phone aria-hidden="true" />,
    title: "Phone",
    content: <p>[Phone Number]</p>,
  },
  {
    icon: <Mail aria-hidden="true" />,
    title: "Email",
    content: (
      <p>
        <a href="mailto:info@synergypharma.lk">info@synergypharma.lk</a>
      </p>
    ),
  },
  {
    icon: <Clock aria-hidden="true" />,
    title: "Business Hours",
    content: <p>[Business Hours]</p>,
  },
];

const connectItems = [
  {
    title: "Business Enquiries",
    description: "Speak with our team about distribution, supply, or commercial opportunities.",
  },
  {
    title: "Partnership Opportunities",
    description: "Explore collaboration, licensing, or strategic partnerships with Synergy Pharma.",
  },
  {
    title: "Product Enquiries",
    description: "Ask about our product portfolio, availability, or technical specifications.",
  },
  {
    title: "General Enquiries",
    description: "Reach out with any other questions and our team will direct you to the right person.",
  },
];

export default function ContactPage() {
  return (
    <main className="contact-page">
      <SiteHeader />

      <section className="contact-hero">
        <div className="container contact-hero-inner">
          <p className="contact-hero-eyebrow">Get In Touch</p>
          <h1>Contact Us</h1>
          <p className="contact-hero-copy">
            We&apos;re here to connect, collaborate, and support your healthcare needs. Reach out to our team for
            more information about Synergy Pharma, our products, partnerships, or services.
          </p>
        </div>
      </section>

      <section className="contact-main-section">
        <div className="contact-shell contact-main-grid">
          <ScrollReveal className="contact-info-column">
            <p className="contact-eyebrow">Contact Information</p>
            <h2>We&apos;d love to hear from you</h2>
            <p className="contact-subtitle">
              Whether you have a question about our products, want to explore a partnership, or simply want to
              learn more about Synergy Pharma, our team is ready to help.
            </p>

            <div className="contact-info-list">
              {contactDetails.map((detail) => (
                <div className="contact-info-card" key={detail.title}>
                  <div className="contact-info-icon">{detail.icon}</div>
                  <div>
                    <h3>{detail.title}</h3>
                    {detail.content}
                  </div>
                </div>
              ))}
            </div>
          </ScrollReveal>

          <ScrollReveal className="contact-form-card" delay={0.1}>
            <h2>Send us a message</h2>
            <p>Fields marked with an asterisk (*) are required.</p>
            <ContactForm />
          </ScrollReveal>
        </div>
      </section>

      <section className="contact-connect-section">
        <div className="contact-shell">
          <ScrollReveal className="contact-connect-header">
            <p className="contact-eyebrow">Let&apos;s Connect</p>
            <h2>Partner with Synergy Pharma</h2>
            <p>
              From business enquiries to partnership opportunities, we welcome the chance to connect with
              organizations and individuals who share our commitment to advancing healthcare.
            </p>
          </ScrollReveal>

          <div className="contact-connect-grid">
            {connectItems.map((item) => (
              <div className="contact-connect-card" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="contact-map-section">
        <div className="contact-shell">
          <ScrollReveal className="contact-map-card">
            <div className="contact-map-icon">
              <MapPin aria-hidden="true" />
            </div>
            <div className="contact-map-info">
              <h3>Find us on the map</h3>
              <p className="contact-map-coordinates"></p>
              <a
                href="https://www.google.com/maps?q=7.525822,79.922285"
                target="_blank"
                rel="noreferrer"
                className="contact-map-link"
              >
                Open in Google Maps
              </a>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </main>
  );
}
