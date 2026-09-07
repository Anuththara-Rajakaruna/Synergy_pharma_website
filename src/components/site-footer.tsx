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
    name: "X",
    href: "https://twitter.com/synergypharmalK",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M17.81 3H20l-4.78 5.46L20.84 21h-4.4l-3.45-4.52L9.04 21H6.84l5.11-5.84L6.56 3h4.5l3.12 4.12L17.81 3Zm-.77 16.68h1.22L10.4 4.23H9.09l7.95 15.45Z" />
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
            No. 9, 15th Lane

            Synergy Pharmaceutical Corporation Pvt. Ltd.

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
