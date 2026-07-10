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

  return (
    <header className={`topbar ${isScrolled ? "topbar-scrolled" : ""} ${isMenuOpen ? "topbar-menu-open" : ""}`}>
      <div className="topbar-inner container">
        <Link href="/" className="brand" aria-label="Synergy home">
          <Image src="/logo.png" alt="Synergy Pharmaceuticals" width={180} height={50} priority />
        </Link>

        <nav className="desktop-nav" aria-label="Main navigation">
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
