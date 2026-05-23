const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL || "https://fydrop.vercel.app";

export default async function sitemap() {
  // Static routes
  const staticRoutes = [
    {
      url: `${BASE_URL}`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1.0,
      alternates: {
        languages: {
          en: `${BASE_URL}/en`,
          id: `${BASE_URL}/id`,
        },
      },
    },
  ];

  // Dynamic routes - get from database or API
  // This is optional - only if you have dynamic content
  let dynamicRoutes = [];

  try {
    // Example: Fetch rooms that are public
    // const rooms = await fetchRooms();
    // dynamicRoutes = rooms.map((room) => ({
    //     url: `${BASE_URL}/room/${room.id}`,
    //     lastModified: room.updatedAt,
    //     changeFrequency: "weekly",
    //     priority: 0.7,
    // }));

    // For now, return empty array
    dynamicRoutes = [];
  } catch (error) {
    console.error("Error generating dynamic sitemap routes:", error);
  }

  return [...staticRoutes, ...dynamicRoutes];
}
