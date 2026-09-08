import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";
import { GoogleAnalytics } from "@/components/google-analytics";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* type="application/ld+json" is exempt from the script-src CSP (it never
            executes as JS), so this needs no nonce and doesn't force dynamic rendering. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
      </head>
      <body>
        {children}
        <SiteFooter />
        <GoogleAnalytics />
      </body>
    </html>
  );
}
