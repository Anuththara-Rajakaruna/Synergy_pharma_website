const currentYear = new Date().getFullYear();

const socialLinks = [
  {
    name: "Facebook",
    href: "#",
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
    href: "#",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M17.81 3H20l-4.78 5.46L20.84 21h-4.4l-3.45-4.52L9.04 21H6.84l5.11-5.84L6.56 3h4.5l3.12 4.12L17.81 3Zm-.77 16.68h1.22L10.4 4.23H9.09l7.95 15.45Z" />
      </svg>
    ),
  },
  {
    name: "Twitter",
    href: "#",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 7.54c-.66.29-1.37.49-2.12.58a3.71 3.71 0 0 0 1.63-2.05 7.4 7.4 0 0 1-2.35.9 3.7 3.7 0 0 0-6.3 3.37 10.5 10.5 0 0 1-7.63-3.87 3.7 3.7 0 0 0 1.15 4.94 3.67 3.67 0 0 1-1.67-.46v.05a3.7 3.7 0 0 0 2.97 3.63c-.4.11-.83.17-1.27.17-.31 0-.61-.03-.9-.08a3.71 3.71 0 0 0 3.46 2.57A7.43 7.43 0 0 1 3 18.82a10.48 10.48 0 0 0 5.67 1.66c6.8 0 10.52-5.63 10.52-10.52 0-.16 0-.32-.01-.48A7.5 7.5 0 0 0 21 7.54Z" />
      </svg>
    ),
  },
];

export function SiteFooter() {
  return (
    <footer className="footer" aria-label="Site footer">
      <div className="container footer-inner">
        <div className="footer-col footer-col-wide">
          <h3>Manufacturing and R&amp;D Site Address</h3>
          <address>
            Synergy Pharmaceutical Corporation Pvt. Ltd.
            <br />
            Bingiria BOI Export processing Zone,
            <br />
            Bingiria,
            <br />
            Wathuwaththa,
            <br />
            Dummalasuriya,
            <br />
            Kurunegala district,
            <br />
            Sri Lanka
          </address>
        </div>

        <div className="footer-col footer-col-wide">
          <h3>Headoffice</h3>
          <address>
            Astoria Colombo
            <br />
            Level 14, Commercial Tower III
            <br />
            422, R. A. De Mel Mawatha
            <br />
            Colombo 3
            <br />
            Sri Lanka
          </address>
        </div>

        {/* <div className="footer-col">
          <h3>Rank Entertainment</h3>
          <address>
            No. 9, 15th Lane
            <br />
            Galle Road
            <br />
            Colombo 3
            <br />
            Sri Lanka
          </address>
        </div> */}

        <div className="footer-col">
          <h3>New Business Inquiries</h3>
          <p>
            <a href="tel:+94114786786">+ 94 11 4786786</a>
            <br />
            <a href="mailto:info@rank.lk">info@rank.lk</a>
          </p>
          <div className="footer-social" aria-label="Social media links">
            {socialLinks.map((socialLink) => (
              <a
                key={socialLink.name}
                href={socialLink.href}
                className="footer-social-link"
                aria-label={socialLink.name}
              >
                {socialLink.icon}
              </a>
            ))}
          </div>
        </div>

        <div className="footer-bottom">
          <span>© {currentYear} Synergy Pharmaceutical Corporation Pvt. Ltd.</span>
          <span className="footer-bottom-muted">All rights reserved.</span>
        </div>
      </div>
    </footer>
  );
}