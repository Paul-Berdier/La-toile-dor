import type { MetadataRoute } from "next";

// Interdiction totale d'indexation : réseau privé.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
