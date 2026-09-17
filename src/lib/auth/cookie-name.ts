// Admin session cookie settings shared by the proxy, route handlers and server components.
// Pure module: safe to import from client components and the proxy.

// The __Host- prefix makes browsers reject the cookie unless it is Secure, has Path=/ and no
// Domain, so a sibling subdomain cannot plant or overwrite it. Browsers only honour the prefix
// on HTTPS, hence the plain name in development.
export const SESSION_COOKIE_NAME = process.env.NODE_ENV === "production" ? "__Host-synergy_admin" : "synergy_admin";

// Absolute session lifetime (the cookie Max-Age and the server-side expiry).
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
