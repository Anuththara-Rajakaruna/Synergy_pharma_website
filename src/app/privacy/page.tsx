import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Privacy Notice | Synergy Pharmaceuticals",
  description: "How Synergy Pharmaceuticals collects, uses, and protects your personal data.",
};

export default function PrivacyPage() {
  return (
    <main>
      <SiteHeader />
      <section className="privacy-page">
        <div className="privacy-shell">
          <nav className="career-breadcrumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span aria-hidden="true">›</span>
            <span aria-current="page">Privacy Notice</span>
          </nav>

          <h1>Privacy Notice</h1>
          <p className="privacy-updated">Last updated: June 2026</p>

          <section className="privacy-section">
            <h2>1. Who we are</h2>
            <p>
              Synergy Pharmaceuticals (Pvt) Ltd, Bingiriya, Sri Lanka ("Synergy", "we", "us") is the data controller
              for personal information collected through this website and careers portal.
            </p>
          </section>

          <section className="privacy-section">
            <h2>2. What data we collect</h2>
            <p>When you apply for a role or join our talent pool, we collect:</p>
            <ul>
              <li>Full name, email address, phone number</li>
              <li>CV / résumé (PDF)</li>
              <li>Cover letter (optional)</li>
              <li>Area of professional interest (talent pool only)</li>
              <li>IP address (for rate-limiting and fraud prevention)</li>
            </ul>
          </section>

          <section className="privacy-section">
            <h2>3. Why we collect it</h2>
            <ul>
              <li><strong>Recruitment:</strong> To evaluate your suitability for current or future roles.</li>
              <li><strong>Communication:</strong> To notify you of application status and next steps.</li>
              <li><strong>Legal obligations:</strong> To comply with employment laws in Sri Lanka.</li>
            </ul>
          </section>

          <section className="privacy-section">
            <h2>4. How long we keep your data</h2>
            <p>
              Successful applicants: data is retained as part of your employment record.<br />
              Unsuccessful applicants: data is retained for up to <strong>12 months</strong> after the closing date
              of the role, then deleted. Talent pool submissions are retained for up to <strong>24 months</strong>.
            </p>
          </section>

          <section className="privacy-section">
            <h2>5. Who can access your data</h2>
            <p>
              Only authorised HR and management personnel at Synergy Pharmaceuticals can access your application
              data. We do not sell, rent, or share your data with third parties except as required by law.
            </p>
          </section>

          <section className="privacy-section">
            <h2>6. Your rights</h2>
            <p>You have the right to:</p>
            <ul>
              <li>Request a copy of the data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data (right to erasure)</li>
              <li>Withdraw consent at any time</li>
            </ul>
            <p>
              To exercise any of these rights, email us at{" "}
              <a href="mailto:hr@synergypharma.lk">hr@synergypharma.lk</a> with the subject line
              "Data Request — [Your Name]".
            </p>
          </section>

          <section className="privacy-section">
            <h2>7. Security</h2>
            <p>
              Your CV and personal data are stored securely and are not publicly accessible. Access is restricted
              to authenticated administrators only. We use HTTPS for all data transmission.
            </p>
          </section>

          <section className="privacy-section">
            <h2>8. Contact us</h2>
            <p>
              For privacy-related enquiries:<br />
              <strong>Synergy Pharmaceuticals (Pvt) Ltd</strong><br />
              Bingiriya, North Western Province, Sri Lanka<br />
              Email: <a href="mailto:hr@synergypharma.lk">hr@synergypharma.lk</a>
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
