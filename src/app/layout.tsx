import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Synergy | Advancing human health through precision",
  description: "Explore career opportunities at Synergy Pharma — Sri Lanka's leading pharmaceutical company advancing human health through precision.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/logo.png" sizes="48x48" type="image/png" />
        <link rel="icon" href="/logo.png" sizes="32x32" type="image/png" />
        <link rel="icon" href="/logo.png" sizes="16x16" type="image/png" />
        <link rel="shortcut icon" href="/logo.png" />
      </head>
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
