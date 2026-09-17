import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";
import { GoogleAnalytics } from "@/components/google-analytics";
import { serializeJsonLd } from "@/lib/json-ld";
import { buildMetadata } from "@/lib/metadata";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  ...buildMetadata({
    title: "Synergy Pharmaceutical Corporation | Sri Lankan Manufacturing, Global Quality",
    description:
      "Synergy Pharmaceutical Corporation manufactures high-quality, affordable medicines in Sri Lanka for the global healthcare economy.",
    path: "/",
  }),
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1075bd",
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/logo.png`,
  sameAs: [
    "https://www.facebook.com/synergypharmasrilanka",
    "https://lk.linkedin.com/company/synergy-pharmaceuticals-corporation-private-limited",
    "https://twitter.com/synergypharmalK",
  ],
};

// Hidden-until-revealed content must stay readable when JavaScript is disabled or blocked.
const NO_SCRIPT_REVEAL_CSS = ".reveal-on-scroll{opacity:1!important;transform:none!important}";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Every page is rendered per request so Next.js can attach the proxy's CSP nonce to its
  // scripts. Prerendered HTML carries no nonce, and the browser would block hydration.
  await connection();

  return (
    <html lang="en">
      <head>
        {/* type="application/ld+json" is exempt from the script-src CSP (it never executes as JS),
            so it needs no nonce. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(organizationJsonLd) }}
        />
        <noscript>
          <style>{NO_SCRIPT_REVEAL_CSS}</style>
        </noscript>
      </head>
      <body>
        {children}
        <SiteFooter />
        <GoogleAnalytics />
      </body>
    </html>
  );
}
