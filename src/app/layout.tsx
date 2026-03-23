import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Synergy | Advancing human health through precision",
  description: "Corporate website starter for Synergy",
};

const themeInitScript = `try {
  const storedTheme = localStorage.getItem("theme");
  document.documentElement.dataset.theme = storedTheme === "dark" ? "dark" : "light";
} catch {
  document.documentElement.dataset.theme = "light";
}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/logo.png" sizes="48x48" type="image/png" />
        <link rel="icon" href="/logo.png" sizes="32x32" type="image/png" />
        <link rel="icon" href="/logo.png" sizes="16x16" type="image/png" />
        <link rel="shortcut icon" href="/logo.png" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={manrope.className}>{children}</body>
    </html>
  );
}