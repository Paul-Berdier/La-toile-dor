import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ...(!isDev
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js exige inline styles ; scripts inline limités au runtime Next.
      // 'unsafe-eval' est réservé au runtime de DÉVELOPPEMENT (HMR/React dev) —
      // jamais présent en production.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      // blob: requis pour les aperçus locaux d'images avant envoi (rapports)
      "img-src 'self' blob: data: https://cdn.discordapp.com",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self' https://discord.com",
      "base-uri 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@toile/database", "@toile/shared", "@toile/auth", "@toile/ui"],
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    // Rapports de mission : jusqu'à 5 images de 2 Mo par envoi (défaut : 1 Mo)
    serverActions: { bodySizeLimit: "12mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
