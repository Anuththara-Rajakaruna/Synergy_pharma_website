import Link from "next/link";

const currentYear = new Date().getFullYear();

const socialLinks = [
  {
    name: "Facebook",
    href: "https://www.facebook.com/synergypharmasrilanka",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13.5 21v-7h2.4l.36-2.8H13.5V9.42c0-.81.22-1.36 1.38-1.36H16.5V5.57c-.28-.04-1.24-.12-2.36-.12-2.34 0-3.94 1.43-3.94 4.06v1.69H7.8V14h2.4v7h3.3Z" />
      </svg>
    ),
  },
  {
    name: "LinkedIn",
    href: "https://lk.linkedin.com/company/synergy-pharmaceuticals-corporation-private-limited",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.94 8.5A1.56 1.56 0 1 1 6.93 5.4a1.56 1.56 0 0 1 0 3.12ZM5.6 9.7h2.67V18H5.6V9.7Zm4.34 0h2.56v1.13h.04c.36-.68 1.23-1.4 2.52-1.4 2.69 0 3.19 1.77 3.19 4.07V18h-2.67v-4.02c0-.96-.02-2.2-1.34-2.2-1.34 0-1.54 1.05-1.54 2.13V18H9.94V9.7Z" />
      </svg>
    ),
  },
  {
    name: "Instagram",
    href: "https://www.instagram.com/synergypharmaceuitcals?stkn=cmE1YmJrandmNDM5",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.012-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069Zm0-2.163C8.741 0 8.333.014 7.053.072c-4.358.2-6.78 2.618-6.98 6.98C.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0Zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.406-11.845a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z" />
      </svg>
    ),
  },
];

export function SiteFooter() {
  return (
    <footer className="footer" aria-label="Site footer" id="locations">
      <div className="container footer-inner">
        <div className="footer-col footer-col-wide">
          <h3>Manufacturing and R&amp;D Site Address</h3>
          <address>
            Synergy Pharmaceuticals Corporation Pvt. Ltd.
            <br />
            Bingiria BOI Export processing Zone,
            <br />
            Bingiria,
            <br />
            Wathuwaththa,
            <br />
            Dummalasuriya 60260,
            <br />
            Kurunegala district,
            <br />
            Sri Lanka
          </address>
        </div>

        <div className="footer-col footer-col-wide">
          <h3>Head office</h3>
          <address>
            Astoria Colombo,
            <br />
            Level 14, 
            <br />
            Commercial Tower III,
            <br />
            422, R. A. De Mel Mawatha,
            <br />
            Colombo 3,
            <br />
            Sri Lanka
          </address>
        </div>

        <div className="footer-col footer-col-wide">
          <h3>Registered Office Address</h3>
          <address>
            Synergy Pharmaceuticals Corporation Pvt. Ltd.

            <br />
            No.: 282/1, 4th floor,
            <br />
            CBS Building, Galle Road,
            <br />
            Colombo 3,
            <br />
            Sri Lanka
          </address>
        </div>

        <div className="footer-col">
          <h3>New Business Inquiries</h3>
          <p>
            <br />
            <a href="mailto:info@synergypharma.lk">info@synergypharma.lk</a>
          </p>
          <div className="footer-social" aria-label="Social media links">
            {socialLinks.map((socialLink) => (
              <a
                key={socialLink.name}
                href={socialLink.href}
                className="footer-social-link"
                aria-label={socialLink.name}
                target="_blank"
                rel="noreferrer"
              >
                {socialLink.icon}
              </a>
            ))}
          </div>
        </div>

        <div className="footer-bottom">
          <span>© {currentYear} Synergy Pharmaceutical Corporation Pvt. Ltd.</span>
          <span className="footer-bottom-muted">All rights reserved.</span>
          <Link href="/privacy-policy" className="footer-bottom-muted hover:text-[#1075bd] transition-colors">
            Privacy Policy
          </Link>
        </div>
      </div>
    </footer>
  );
}
