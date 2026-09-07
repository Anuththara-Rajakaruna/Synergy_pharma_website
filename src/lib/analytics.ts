// Shared between the GoogleAnalytics component (which renders this exact text as
// an inline <script>) and proxy.ts (which allow-lists it in the CSP via a static
// SHA-256 hash). Keeping it in one place guarantees the rendered script and the
// hashed script are byte-identical — a nonce isn't used here so this stays a
// static string and pages that render it can still be statically prerendered.
export function gaBootstrapScript(measurementId: string): string {
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${measurementId}');var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${measurementId}';document.head.appendChild(s);`;
}
