'use client';

import { useState, useEffect } from 'react';

export default function PWAInstallPrompt() {
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [showInstall, setShowInstall] = useState(false);

    useEffect(() => {
        const handler = (e) => {
            e.preventDefault();
            setDeferredPrompt(e);
            setShowInstall(true);
        };

        window.addEventListener('beforeinstallprompt', handler);

        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const handleInstall = async () => {
        if (!deferredPrompt) return;

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            console.log('PWA installed');
        }

        setDeferredPrompt(null);
        setShowInstall(false);
    };

    if (!showInstall) return null;

    return (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-gray-200 dark:border-zinc-700 p-4 z-50">
            <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-black dark:bg-white rounded-xl flex items-center justify-center shrink-0">
                    <svg className="w-6 h-6 text-white dark:text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                </div>
                <div className="flex-1">
                    <h4 className="font-medium text-gray-900 dark:text-white">Install fiDrop</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Share files directly from any app</p>
                </div>
                <button
                    onClick={handleInstall}
                    className="px-3 py-1.5 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium"
                >
                    Install
                </button>
                <button onClick={() => setShowInstall(false)} className="text-gray-400 hover:text-gray-600">
                    ✕
                </button>
            </div>
        </div>
    );
}
