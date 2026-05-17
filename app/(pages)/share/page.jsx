'use client';

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fileStorage } from "@/libs/fileStorage";

export default function SharePage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [selectedFiles, setSelectedFiles] = useState([]); // File objects asli
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState(null);
    const [storageReady, setStorageReady] = useState(false);
    const [savingProgress, setSavingProgress] = useState(0);

    const totalSize = selectedFiles.reduce((acc, f) => acc + f.size, 0);
    const MAX_SIZE = 100 * 1024 * 1024;

    useEffect(() => {
        fileStorage.init().then(() => {
            setStorageReady(true);
            // Clean old files
            fileStorage.clearOldFiles();
        }).catch(err => {
            console.error("Failed to init IndexedDB:", err);
            setError("Storage initialization failed");
        });
    }, []);

    const MAX_FILE_SIZE = 50 * 1024 * 1024;

    const handleFileSelect = (e) => {
        const files = Array.from(e.target.files);
        const oversizedFiles = files.filter(f => f.size > MAX_FILE_SIZE);

        if (oversizedFiles.length > 0) {
            setError(`Some files exceed ${formatBytes(MAX_FILE_SIZE)} limit`);
            return;
        }

        setSelectedFiles(prev => [...prev, ...files]);
    };

    const removeFile = (index) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const createShareRoom = async () => {
        if (selectedFiles.length === 0) {
            setError("Please select files to share");
            return;
        }

        if (selectedFiles.length > 5) {
            const confirm = window.confirm(
                `You are about to share ${selectedFiles.length} files (${formatBytes(totalSize)}). Continue?`
            );
            if (!confirm) return;
        }

        if (!storageReady) {
            setError("Storage not ready, please wait");
            return;
        }

        setIsCreating(true);
        setError(null);

        try {
            const roomId = generateRoomId();

            // ✅ Save files to IndexedDB
            const filesData = [];
            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
                setSavingProgress(((i + 1) / selectedFiles.length) * 100);
                const savedFile = await fileStorage.saveFile(roomId, file);
                filesData.push({
                    name: savedFile.name,
                    size: savedFile.size,
                    type: savedFile.type,
                    id: savedFile.id,
                });
            }

            // ✅ Store only metadata in sessionStorage (not the file data)
            sessionStorage.setItem(`share_${roomId}`, JSON.stringify({
                files: filesData,
                timestamp: Date.now(),
                version: "2.0"
            }));

            console.log(`Saved ${filesData.length} file(s) to IndexedDB`);

            router.push(`/share/${roomId}`);
        } catch (err) {
            console.error("Error creating share room:", err);
            setError(err.message || "Failed to create share room");
            setIsCreating(false);
        }
    };

    const generateRoomId = () => {
        return Math.random().toString(36).substring(2, 10);
    };

    // Format file size
    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    return (
        <main className="min-h-screen bg-gray-50 dark:bg-zinc-950 px-4 py-10">
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Share Files</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">Select files to share securely</p>
                </div>

                {/* File Selection */}
                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 p-6 mb-4">
                    <div
                        onClick={() => document.getElementById('fileInput')?.click()}
                        className="border-2 border-dashed border-gray-200 dark:border-zinc-700 rounded-xl py-8 px-4 text-center cursor-pointer hover:border-green-500 transition-colors"
                    >
                        <svg className="w-10 h-10 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <p className="text-gray-600 dark:text-gray-300">Click to select files</p>
                        <p className="text-xs text-gray-400 mt-1">or share directly from other apps</p>
                    </div>
                    <input
                        id="fileInput"
                        type="file"
                        multiple
                        className="hidden"
                        onChange={handleFileSelect}
                    />

                    {/* File List */}
                    {selectedFiles.length > 0 && (
                        <div className="mt-4 space-y-2">
                            <div className="flex justify-between items-center">
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Selected files ({selectedFiles.length})
                                </p>
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <p className="text-xs text-gray-400">
                                    Total: {formatBytes(totalSize)}
                                </p>
                                <button
                                    onClick={() => setSelectedFiles([])}
                                    className="text-xs text-red-500 hover:text-red-600"
                                >
                                    Clear all
                                </button>
                            </div>
                            <div className="max-h-60 overflow-y-auto space-y-2">
                                {selectedFiles.map((file, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-zinc-800 rounded-lg">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{file.name}</p>
                                            <p className="text-xs text-gray-400">{formatBytes(file.size)}</p>
                                        </div>
                                        <button
                                            onClick={() => removeFile(idx)}
                                            className="text-red-500 hover:text-red-600 p-1 ml-2"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {error && (
                    <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 rounded-xl text-red-600 text-sm">
                        {error}
                    </div>
                )}
                {totalSize > MAX_SIZE && (
                    <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-950/30 rounded-xl text-yellow-600 text-sm">
                        ⚠️ Total file size ({formatBytes(totalSize)}) is large.
                        Transfer may take longer and might be unstable.
                    </div>
                )}
                {isCreating && (
                    <div className="mb-4">
                        <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-green-500 transition-all duration-300"
                                style={{ width: `${savingProgress}%` }}
                            />
                        </div>
                        <p className="text-xs text-gray-400 mt-1">Saving files... {Math.round(savingProgress)}%</p>
                    </div>
                )}

                <button
                    onClick={createShareRoom}
                    disabled={selectedFiles.length === 0 || isCreating}
                    className="w-full py-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isCreating ? "Processing..." : `Share ${selectedFiles.length} File(s)`}
                </button>

                <p className="text-xs text-center text-gray-400 mt-6">
                    Files are transferred directly between devices (P2P). Host needs to approve recipients.
                </p>
            </div>
        </main>
    );
}
