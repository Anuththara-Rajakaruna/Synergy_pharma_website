import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { HomeContent } from "./home-content";

export const metadata: Metadata = buildMetadata({
  title: "Synergy Pharmaceutical Corporation | Sri Lankan Manufacturing, Global Quality",
  description:
    "Synergy Pharmaceutical Corporation manufactures high-quality, affordable medicines in Sri Lanka for the global healthcare economy, built on NMRA-GMP and EU-GMP quality standards.",
  path: "/",
});

export default function Home() {
  return <HomeContent />;
}
