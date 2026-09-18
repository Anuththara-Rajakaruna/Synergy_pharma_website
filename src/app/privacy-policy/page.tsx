import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { buildMetadata } from "@/lib/metadata";

export const metadata = buildMetadata({
  title: "Privacy Policy | Synergy Pharmaceutical Corporation",
  description:
    "How Synergy Pharmaceutical Corporation collects, uses, and protects your personal data during the recruitment process.",
  path: "/privacy-policy",
});

export default function PrivacyPolicyPage() {
  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-[#f0f7fc] px-4 py-16">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-[32px] border border-white/70 bg-white shadow-[0_32px_80px_rgba(7,25,38,0.10)] p-8 md:p-12">

            <p className="text-[0.72rem] font-bold uppercase tracking-[0.22em] text-[#1075bd] mb-3">
              Synergy Pharmaceuticals Corporation
            </p>
            <h1 className="text-3xl font-bold text-[#0a1f35] mb-2">Privacy Policy</h1>
            <p className="text-sm text-[#5f89a4] mb-10">
              Effective date: 8 June 2026 · Applies to: Careers Portal and Recruitment Activities
            </p>

            <div className="prose prose-slate max-w-none space-y-8 text-[#2c4a5e] leading-7">

              <section>
                <h2 className="text-xl font-bold text-[#0a1f35] mb-3">1. Who we are</h2>
                <p>
                  Synergy Pharmaceuticals Corporation Pvt. Ltd. (&ldquo;Synergy Pharma&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is the data controller
                  responsible for personal data collected through this Careers Portal. Our registered address is
                  Astoria Colombo, Level 14, Commercial Tower III, 422 R. A. De Mel Mawatha, Colombo 3, Sri Lanka.
                </p>
                <p className="mt-2">
                  For privacy-related queries, contact us at:{" "}
                  <a href="mailto:info@synergypharma.lk" className="text-[#1075bd] underline">
                    info@synergypharma.lk
                  </a>
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-[#0a1f35] mb-3">2. What data we collect</h2>
                <p>When you submit a job application or join our talent pool, we collect:</p>
                <ul className="mt-2 list-disc pl-6 space-y-1">
                  <li>Full name, email address, and phone number</li>
                  <li>CV / résumé (uploaded as a PDF file)</li>
                  <li>Cover letter (optional)</li>
                  <li>Area of professional interest (talent pool only)</li>
                  <li>Date and time of submission</li>
                </ul>
                <p className="mt-3">
                  We do not collect sensitive personal data such as national identity numbers, health information,
                  or financial details at the application stage.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-[#0a1f35] mb-3">3. Legal basis for processing</h2>
                <p>
                  We process your personal data on the basis of your <strong>explicit consent</strong> (GDPR Article 6(1)(a);
                  Sri Lanka Personal Data Protection Act 2022, Section 7). You provide this consent by ticking the
                  consent checkbox before submitting your application.
                </p>
                <p className="mt-2">
                  You may withdraw your consent at any time by contacting us. Withdrawal does not affect the
                  lawfulness of processing carried out before withdrawal.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-[#0a1f35] mb-3">4. How we use your data</h2>
                <p>Your data is used exclusively for recruitment purposes:</p>
                <ul className="mt-2 list-disc pl-6 space-y-1">
                  <li>Evaluating your suitability for open or future roles</li>
                  <li>Communicating with you about your application</li>
                  <li>Maintaining records of our hiring process</li>
                </ul>
                <p className="mt-3">
                  We will not use your data for marketing, sell it to third parties, or share it with external
                  recruiters without your explicit permission.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-[#0a1f35] mb-3">5. Who has access to your data</h2>
                <p>
                  Access to application data is restricted to authorised HR personnel within Synergy Pharma.
                  Our Careers Portal is hosted on secure infrastructure. Your application details are held in
                  Google Sheets and your uploaded CV in Google Drive, within Synergy Pharma&apos;s own Google
                  Workspace account, and are accessible only to authorised recruitment staff. Google acts as a
                  data processor on our behalf and does not use your data for its own purposes. No third-party
                  analytics or advertising services receive your personal information.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-[#0a1f35] mb-3">6. Data retention</h2>
                <p>
                  We retain your personal data for a maximum of <strong>12 months</strong> from the date of submission,
                  or until a final hiring decision has been made for the role you applied for — whichever comes first.
                  After this period, your data and uploaded CV will be permanently deleted from our systems.
                </p>
                <p className="mt-2">
                  Talent pool submissions are retained for up to 12 months and reviewed periodically for relevant openings.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-[#0a1f35] mb-3">7. Your rights</h2>
                <p>Under the GDPR and Sri Lanka&apos;s Personal Data Protection Act 2022, you have the right to:</p>
                <ul className="mt-2 list-disc pl-6 space-y-1">
                  <li><strong>Access</strong> — request a copy of the personal data we hold about you</li>
                  <li><strong>Rectification</strong> — ask us to correct inaccurate or incomplete data</li>
                  <li><strong>Erasure</strong> — request deletion of your data (&ldquo;right to be forgotten&rdquo;)</li>
                  <li><strong>Portability</strong> — receive your data in a structured, machine-readable format</li>
                  <li><strong>Objection</strong> — object to processing in certain circumstances</li>
                  <li><strong>Restriction</strong> — request that we limit how we use your data</li>
                  <li><strong>Withdraw consent</strong> — at any time, without affecting prior lawful processing</li>
                </ul>
                <p className="mt-3">
                  To exercise any of these rights, email us at{" "}
                  <a href="mailto:info@synergypharma.lk" className="text-[#1075bd] underline">
                    info@synergypharma.lk
                  </a>{" "}
                  with your full name and email address used during registration. We will respond within 30 days.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-[#0a1f35] mb-3">8. Data security</h2>
                <p>
                  Uploaded CV files are stored in a private Google Drive folder inside our Google Workspace account.
                  The folder is not shared publicly and is not accessible to the public internet, and we never publish
                  a link to your file. Access is restricted through authenticated API routes. We apply
                  industry-standard security controls including HTTPS encryption, HTTP-only session cookies, and
                  access logging.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-[#0a1f35] mb-3">9. Changes to this policy</h2>
                <p>
                  We may update this Privacy Policy from time to time. Material changes will be communicated by
                  updating the effective date above. Continued use of the portal after changes constitutes acceptance
                  of the updated policy.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-[#0a1f35] mb-3">10. Contact</h2>
                <p>
                  For all privacy-related questions, requests, or complaints, contact our HR team at{" "}
                  <a href="mailto:info@synergypharma.lk" className="text-[#1075bd] underline">
                    info@synergypharma.lk
                  </a>.
                </p>
              </section>

            </div>

            <div className="mt-10 pt-8 border-t border-[#e0ecf5]">
              <Link
                href="/careers"
                className="inline-flex items-center gap-2 text-[0.82rem] font-semibold text-[#1075bd] hover:underline"
              >
                ← Back to Careers
              </Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
