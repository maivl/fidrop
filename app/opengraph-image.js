import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #000000 0%, #1a1a1a 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            marginBottom: "40px",
          }}
        >
          <svg
            width="80"
            height="80"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
          >
            <path
              d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span
            style={{
              fontSize: "60px",
              fontWeight: "bold",
              color: "white",
            }}
          >
            fyDrop
          </span>
        </div>
        <div
          style={{
            fontSize: "32px",
            color: "#cccccc",
            textAlign: "center",
          }}
        >
          Seamless Peer-to-Peer File Sharing
        </div>
        <div
          style={{
            fontSize: "24px",
            color: "#666666",
            marginTop: "30px",
            textAlign: "center",
          }}
        >
          Fast • Secure • Private
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
