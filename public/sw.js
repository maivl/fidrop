const CACHE_NAME = "fidrop-v1";
const SHARED_CACHE = "fidrop-shared-files";
const urlsToCache = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (
    event.request.method === "POST" &&
    url.pathname === "/share/external"
  ) {
    event.respondWith(handleShareTarget(event));
    return;
  }

  event.respondWith(
    caches
      .match(event.request)
      .then((response) => response || fetch(event.request))
  );
});

async function handleShareTarget(event) {
  try {
    const formData = await event.request.formData();

    const files = [];
    for (const value of formData.values()) {
      if (value instanceof File && value.size > 0) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return Response.redirect("/share?error=No files received", 303);
    }

    const roomId = Array.from({ length: 8 }, () =>
      "abcdefghijklmnopqrstuvwxyz0123456789".charAt(
        Math.floor(Math.random() * 36)
      )
    ).join("");

    const cache = await caches.open(SHARED_CACHE);
    const meta = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const key = `file-${roomId}-${i}`;
      await cache.put(key, new Response(file));
      meta.push({
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        index: i,
      });
    }

    await cache.put(`meta-${roomId}`, new Response(JSON.stringify(meta)));

    return Response.redirect(`/share/process-external?roomId=${roomId}`, 303);
  } catch (err) {
    console.error("Share target error:", err);
    return Response.redirect("/share?error=Processing failed", 303);
  }
}