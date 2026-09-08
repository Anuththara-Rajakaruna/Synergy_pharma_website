import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";

const DEFAULT_OG_IMAGE = `${SITE_URL}/Synergy.png`;

export function buildMetadata(options: {
  title: string;
  description: string;
  path: string;
  image?: string;
}): Metadata {
  const url = `${SITE_URL}${options.path}`;
  const image = options.image ?? DEFAULT_OG_IMAGE;

  return {
    title: options.title,
    description: options.description,
    alternates: { canonical: url },
    openGraph: {
      title: options.title,
      description: options.description,
      url,
      siteName: SITE_NAME,
      images: [{ url: image }],
      locale: "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: options.title,
      description: options.description,
      images: [image],
    },
  };
}
