import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { QualityPageContent } from "./quality-content";

export const metadata: Metadata = buildMetadata({
  title: "Quality & Compliance | Synergy Pharmaceutical Corporation",
  description:
    "See how Synergy Pharmaceutical Corporation embeds quality from design to delivery — GMP compliance, stability studies, and a global quality management ecosystem.",
  path: "/quality",
});

export default function QualityPage() {
  return <QualityPageContent />;
}
