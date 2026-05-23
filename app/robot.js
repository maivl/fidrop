export default function robots() {
  const BASE_URL =
    process.env.NEXT_PUBLIC_BASE_URL || "https://fyDrop.vercel.app";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/room/*", "/private/", "/temp/"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
