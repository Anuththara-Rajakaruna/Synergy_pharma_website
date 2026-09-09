import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { FacilityPageContent } from "./facility-content";

export const metadata: Metadata = buildMetadata({
  title: "Our Facility | Synergy Pharmaceutical Corporation",
  description:
    "Explore Synergy Pharmaceutical Corporation's manufacturing campus in Bingiriya, Sri Lanka — GMP-compliant production blocks, R&D, and quality-controlled facilities.",
  path: "/facility",
});

export default function FacilityPage() {
  return <FacilityPageContent />;
}
