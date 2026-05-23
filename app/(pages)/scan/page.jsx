"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function ScanPage() {
  const router = useRouter();
  const scannerRef = useRef(null);
  const containerRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    import("html5-qrcode").then(({ Html5Qrcode }) => {
      if (!mounted) return;
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;
      setCameraReady(true);
    });

    return () => {
      mounted = false;
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const handleQRResult = (decodedText) => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
    }
    setScanning(false);
    setResult(decodedText);

    try {
      const url = new URL(decodedText);
      const path = url.pathname + url.search + url.hash;
      if (path.startsWith("/")) {
        setTimeout(() => router.push(path), 800);
      }
    } catch {
      // Not a valid URL — just show the text
    }
  };

  const startScanning = async () => {
    try {
      setError(null);
      setResult(null);
      setScanning(true);

      await scannerRef.current.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        handleQRResult,
        () => {}
      );
    } catch (err) {
      setError(err.message || "Camera access denied or unavailable");
      setScanning(false);
    }
  };

  const stopScanning = () => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
    }
    setScanning(false);
  };

  const extractRoomLabel = (text) => {
    try {
      const url = new URL(text);
      const match = url.pathname.match(/\/(room|share|receive)\/([^/]+)/);
      if (match) return `Room: ${match[2].slice(0, 12)}...`;
    } catch {}
    return text;
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-zinc-950 px-4 py-10">
      <div className="max-w-md mx-auto space-y-4">
        {/* Header */}
        <div className="text-center">
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            &larr; Back
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
            Scan QR Code
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
            Point your camera at a fyDrop room QR code to join
          </p>
        </div>

        {/* Scanner */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 overflow-hidden">
          <div className="p-4">
            <div
              id="qr-reader"
              ref={containerRef}
              className="w-full aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-zinc-800"
            />

            {!scanning && !result && (
              <button
                onClick={startScanning}
                disabled={!cameraReady}
                className="w-full mt-4 py-3 bg-black dark:bg-white text-white dark:text-black rounded-xl font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {cameraReady ? "Start Scanning" : "Initializing camera..."}
              </button>
            )}

            {scanning && (
              <button
                onClick={stopScanning}
                className="w-full mt-4 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors"
              >
                Stop Scanning
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-xl text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-green-200 dark:border-green-900 p-4 space-y-2">
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              QR Code detected
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 break-all font-mono">
              {extractRoomLabel(result)}
            </p>
            <p className="text-xs text-gray-400">
              Redirecting to room...
            </p>
          </div>
        )}

        {/* Hint */}
        <p className="text-xs text-center text-gray-400">
          The QR code is shown by the host on the room page.
        </p>
      </div>
    </main>
  );
}