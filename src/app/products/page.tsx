import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { ProductsPageContent } from "./products-content";

export const metadata: Metadata = buildMetadata({
  title: "Our Products | Synergy Pharmaceutical Corporation",
  description:
    "Explore Synergy Pharmaceutical Corporation's portfolio of APIs and finished-dose medicines, manufactured under strict GMP compliance with global-standard quality assurance.",
  path: "/products",
});

export default function ProductsPage() {
  return <ProductsPageContent />;
}
