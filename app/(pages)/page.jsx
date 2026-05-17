"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
    const router = useRouter();
    const generateRoomId = () => {
        return Math.random().toString(36).substring(2, 10);
    };

    useEffect(() => {
        const rejectMessage = sessionStorage.getItem("rejectMessage");
        const rejectTimestamp = sessionStorage.getItem("rejectTimestamp");

        if (rejectMessage && rejectTimestamp) {
            const timestamp = parseInt(rejectTimestamp);
            const now = Date.now();

            if (now - timestamp < 5000) {
                // Show toast or alert
                const toast = document.createElement("div");
                toast.className = "fixed top-4 right-4 z-50 bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg animate-slide-in";
                toast.textContent = rejectMessage;
                document.body.appendChild(toast);

                // Remove toast after 3 seconds
                setTimeout(() => toast.remove(), 5000);
            }

            // Clean up
            sessionStorage.removeItem("rejectMessage");
            sessionStorage.removeItem("rejectTimestamp");
        }
        const roomId = generateRoomId();

        router.replace(`/room/${roomId}`);
    }, [router]);

    return (
        <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-white">
            <p>Creating session...</p>
        </main>
    );
}
