// ---------------------------------------------------------------------------
// Canonical site origin.
//
// Open Graph images, robots.txt and sitemap.xml all need absolute URLs. There
// is exactly one place to set this: NEXT_PUBLIC_SITE_URL. Vercel deployments
// fall back to the deployment host; local development stays on localhost.
// ---------------------------------------------------------------------------

function origin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  return "http://localhost:3000";
}

export const SITE_URL = origin();
export const SITE_NAME = "Elo";
export const SITE_TAGLINE = "Ranked heads-up poker. Ten hands. One rating.";
