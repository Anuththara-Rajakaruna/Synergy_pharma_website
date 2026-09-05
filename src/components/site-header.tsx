"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  isContact?: boolean;
};

const navItems: NavItem[] = [
  { href: "/about", label: "About Us" },
  { href: "/facility", label: "Facility" },
  { href: "/quality", label: "Quality" },
  { href: "/products", label: "Products" },
  { href: "/careers", label: "Careers" },
  { href: "/#locations", label: "Contact", isContact: true },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const updateScrollState = () => {
      setIsScrolled(window.scrollY > 16);
    };

    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollState);
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 900) {
        setIsMenuOpen(false);
      }
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    document.body.style.overflow = isMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMenuOpen]);

  const currentPath = useMemo(() => pathname ?? "/", [pathname]);
  const isHomeActive = currentPath === "/";

  return (
    <header className={`topbar ${isScrolled ? "topbar-scrolled" : ""} ${isMenuOpen ? "topbar-menu-open" : ""}`}>
      <div className="topbar-inner container">
        <Link href="/" className="brand" aria-label="Synergy home">
          <Image src="/logo.png" alt="Synergy Pharmaceuticals" width={180} height={50} priority />
        </Link>

        <nav className="desktop-nav" aria-label="Main navigation">
          {/* <Link href="/" className="home-icon-link" aria-label="Home page" data-active={isHomeActive ? "true" : "false"}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3.75 10.5 12 4l8.25 6.5v8.25a1.5 1.5 0 0 1-1.5 1.5h-4.5V14.5h-4.5v5.75h-4.5a1.5 1.5 0 0 1-1.5-1.5V10.5Z" />
            </svg>
          </Link> */}
          {navItems.map((item) => {
            const active =
              (item.href === "/about" && currentPath === "/about") ||
              (item.href === "/facility" && currentPath === "/facility") ||
              (item.href === "/quality" && currentPath === "/quality") ||
              (item.href === "/products" && currentPath === "/products") ||
              (item.href === "/careers" && currentPath.startsWith("/careers"));

            return (
              <Link
                key={item.label}
                href={item.href}
                className={item.isContact ? "contact-link" : undefined}
                data-active={active ? "true" : "false"}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="topbar-actions">
          {/* <button
            type="button"
            className="theme-toggle desktop-theme-toggle"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-pressed={theme === "dark"}
            onClick={toggleTheme}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {theme === "dark" ? (
                <path d="M12 5.25a.75.75 0 0 1 .75.75v1.25a.75.75 0 0 1-1.5 0V6a.75.75 0 0 1 .75-.75Zm0 11.5a.75.75 0 0 1 .75.75v1.25a.75.75 0 0 1-1.5 0V17.5a.75.75 0 0 1 .75-.75Zm6-4.75a.75.75 0 0 1 .75.75.75.75 0 0 1-.75.75h-1.25a.75.75 0 0 1 0-1.5H18Zm-10.75.75a.75.75 0 0 1-.75.75H5.25a.75.75 0 0 1 0-1.5H6.5a.75.75 0 0 1 .75.75Zm7.13-4.88a.75.75 0 0 1 1.06 0l.88.88a.75.75 0 0 1-1.06 1.06l-.88-.88a.75.75 0 0 1 0-1.06Zm-6.76 6.76a.75.75 0 0 1 1.06 0l.88.88a.75.75 0 0 1-1.06 1.06l-.88-.88a.75.75 0 0 1 0-1.06Zm7.82 1.94a.75.75 0 0 1 0-1.06l.88-.88a.75.75 0 1 1 1.06 1.06l-.88.88a.75.75 0 0 1-1.06 0Zm-6.76-6.76a.75.75 0 0 1 0-1.06l.88-.88a.75.75 0 0 1 1.06 1.06l-.88.88a.75.75 0 0 1-1.06 0ZM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z" />
              ) : (
                <path d="M14.72 3.53a.75.75 0 0 1 .84.94 7.25 7.25 0 1 0 8.97 8.97.75.75 0 0 1 .94.84 8.75 8.75 0 1 1-10.75-10.75Z" />
              )}
            </svg>
            <span>{theme === "dark" ? "Light" : "Dark"}</span>
          </button> */}

          <button
            type="button"
            className="nav-toggle"
            aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((prev) => !prev)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      <div className={`mobile-nav-backdrop ${isMenuOpen ? "open" : ""}`} onClick={() => setIsMenuOpen(false)} />

      <div className={`mobile-nav ${isMenuOpen ? "open" : ""}`}>
        <nav aria-label="Mobile navigation">
          {/* <Link href="/" className="home-icon-link mobile-home-link" onClick={() => setIsMenuOpen(false)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3.75 10.5 12 4l8.25 6.5v8.25a1.5 1.5 0 0 1-1.5 1.5h-4.5V14.5h-4.5v5.75h-4.5a1.5 1.5 0 0 1-1.5-1.5V10.5Z" />
            </svg>
            <span>Home</span>
          </Link> */}
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={item.isContact ? "contact-link" : undefined}
              onClick={() => setIsMenuOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
