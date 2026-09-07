import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { AboutPageContent } from "./about-content";

export const metadata: Metadata = buildMetadata({
  title: "About Us | Synergy Pharmaceutical Corporation",
  description:
    "Learn about Synergy Pharmaceutical Corporation's leadership, connected businesses, and commitment to quality-first pharmaceutical manufacturing in Sri Lanka.",
  path: "/about",
});

export default function AboutPage() {
  return <AboutPageContent />;
}
