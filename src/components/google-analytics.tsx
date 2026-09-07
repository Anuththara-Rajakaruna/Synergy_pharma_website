import { gaBootstrapScript } from "@/lib/analytics";

// Rendered as a plain <script> (not next/script) so its text content is exactly
// what proxy.ts hashes for the CSP allow-list — see src/lib/analytics.ts. That
// script then injects the gtag.js loader itself; under the site's
// 'strict-dynamic' CSP, a script inserted by an already-trusted script is
// trusted too, so the external loader needs no nonce or host allow-list entry.
export function GoogleAnalytics() {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  if (!measurementId) return null;

  return (
    <script
      id="ga4-init"
      dangerouslySetInnerHTML={{ __html: gaBootstrapScript(measurementId) }}
    />
  );
}
