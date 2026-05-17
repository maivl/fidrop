export default function manifest() {
  return {
    name: "fiDrop - Seamless File Sharing",
    short_name: "fiDrop",
    description:
      "Peer-to-peer file sharing application with WebRTC technology. Fast, secure, and private file transfers directly between devices.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    orientation: "portrait",
    scope: "/",
    categories: ["productivity", "utilities", "file-transfer"],
    share_target: {
      action: "/share/external",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [
          {
            name: "files",
            accept: ["*/*"],
          },
        ],
      },
    },
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
    screenshots: [
      {
        src: "/screenshot-desktop.jpeg",
        sizes: "995x812",
        type: "image/jpeg",
        form_factor: "wide",
        label: "fiDrop desktop interface",
      },
      {
        src: "/screenshot-mobile.png",
        sizes: "1920x2796",
        type: "image/png",
        form_factor: "narrow",
        label: "fiDrop mobile interface",
      },
    ],
    shortcuts: [
      {
        name: "Quick Share",
        short_name: "Share",
        description: "Quickly share files",
        url: "/?action=share",
        icons: [{ src: "/share-icon.png", sizes: "96x96" }],
      },
      {
        name: "Scan QR",
        short_name: "Scan",
        description: "Scan QR to join room",
        url: "/scan",
        icons: [{ src: "/join-icon.png", sizes: "96x96" }],
      },
    ],
    related_applications: [],
    prefer_related_applications: false,
  };
}
