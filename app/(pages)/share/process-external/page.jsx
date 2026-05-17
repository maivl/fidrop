"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fileStorage } from "@/libs/fileStorage";

export default function ProcessExternalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomId = searchParams.get("roomId");
  const [status, setStatus] = useState("Processing shared files...");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!roomId) {
      setError("No room ID provided");
      return;
    }

    processFiles();
  }, [roomId]);

  const processFiles = async () => {
    try {
      await fileStorage.init();

      const cache = await caches.open("fidrop-shared-files");
      const metaResponse = await cache.match(`meta-${roomId}`);
      if (!metaResponse) {
        setError("No shared files found. They may have expired.");
        return;
      }

      const meta = await metaResponse.json();
      if (!meta || meta.length === 0) {
        setError("No files to process.");
        return;
      }

      const filesData = [];
      for (const entry of meta) {
        const key = `file-${roomId}-${entry.index}`;
        const fileResponse = await cache.match(key);
        if (!fileResponse) continue;

        const blob = await fileResponse.blob();
        const file = new File([blob], entry.name, { type: entry.type });

        const saved = await fileStorage.saveFile(roomId, file);
        filesData.push({
          name: saved.name,
          size: saved.size,
          type: saved.type,
          id: saved.id,
        });
      }

      sessionStorage.setItem(
        `share_${roomId}`,
        JSON.stringify({
          files: filesData,
          timestamp: Date.now(),
          version: "2.0",
        })
      );

      // Clean up shared cache
      for (const entry of meta) {
        cache.delete(`file-${roomId}-${entry.index}`);
      }
      cache.delete(`meta-${roomId}`);

      router.replace(`/share/${roomId}`);
    } catch (err) {
      console.error("Error processing shared files:", err);
      setError(err.message || "Failed to process files");
    }
  };

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 bg-red-100 dark:bg-red-950/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{error}</p>
          <button
            onClick={() => router.push("/share")}
            className="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium"
          >
            Try Again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-black rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-500 dark:text-gray-400 text-sm">{status}</p>
      </div>
    </main>
  );
}