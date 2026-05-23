'use client';

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLogger } from '@/hooks/useLogger';
import { rtcConfig } from "@/libs/webrtc";

const PROGRESS_THROTTLE_MS = 200;

export default function ReceivePage() {
    const params = useParams();
    const router = useRouter();
    const roomId = params.roomId;

    const { log } = useLogger();

    // States
    const [status, setStatus] = useState("Connecting...");
    const [isApproved, setIsApproved] = useState(false);
    const [approvalStatus, setApprovalStatus] = useState("pending");
    const [deviceName, setDeviceName] = useState("");
    const [receivedFiles, setReceivedFiles] = useState([]);
    const [transfers, setTransfers] = useState([]);
    const [receivedFileIds, setReceivedFileIds] = useState(new Set());

    // Refs
    const wsRef = useRef(null);
    const peersRef = useRef({});
    const channelsRef = useRef({});
    // WebSocket connection
    const hasConnectedRef = useRef(false);
    const isApprovedRef = useRef(false);
    const objectUrlsRef = useRef(new Set());

    // Format bytes helper
    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    // Generate device name
    useEffect(() => {
        const savedName = localStorage.getItem("fyDrop_deviceName");
        if (savedName) {
            setDeviceName(savedName);
            log(`Device name loaded: ${savedName}`);
        } else {
            const adjectives = ["Swift", "Brave", "Clever", "Mighty", "Noble", "Wise"];
            const nouns = ["Phoenix", "Tiger", "Eagle", "Wolf", "Dragon", "Knight"];
            const name = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
            setDeviceName(name);
            localStorage.setItem("fyDrop_deviceName", name);
            log(`New device name generated: ${name}`);
        }
    }, [log]);

    useEffect(() => {
        return () => {
            // Clean up all object URLs when component unmounts
            objectUrlsRef.current.forEach(url => {
                try {
                    URL.revokeObjectURL(url);
                } catch (e) { }
            });
            objectUrlsRef.current.clear();
        };
    }, []);

    // Setup data channel untuk menerima file

    const setupDataChannel = useCallback((channel, peerId) => {
        channelsRef.current[peerId] = channel;
        channel.binaryType = "arraybuffer";

        let keepAliveInterval;

        channel.onopen = () => {
            log(`Data channel connected to ${peerId}`);
            keepAliveInterval = setInterval(() => {
                if (channel?.readyState === "open") {
                    try {
                        channel.send(JSON.stringify({ type: "ping" }));
                    } catch (e) { }
                }
            }, 10000);
        };

        channel.onclose = () => {
            log(`Data channel disconnected from ${peerId}`);
            if (keepAliveInterval) clearInterval(keepAliveInterval);
        };

        channel.onerror = (error) => {
            log(`Data channel error: ${error?.message || "Unknown error"}`, "error");
        };

        channel.onmessage = async (event) => {
            if (typeof event.data === "string") {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === "file-meta") {
                        // Use a property on the channel to store incoming file data
                        // This avoids issues with closures and multiple files
                        channel._incomingFile = {
                            name: data.name,
                            size: data.size,
                            type: data.mime,
                            buffers: [],
                            fileId: data.fileId,
                            receivedSize: 0,
                            lastProgressUpdate: 0
                        };

                        log(`Receiving: ${data.name} (${formatBytes(data.size)})`);

                        // Update UI
                        setTransfers(prev => {
                            const exists = prev.some(t => t.id === data.fileId);
                            if (exists) return prev;
                            return [{
                                id: data.fileId,
                                name: data.name,
                                from: peerId,
                                to: deviceName,
                                progress: 0,
                                speed: "Receiving...",
                                done: false,
                                size: data.size,
                                received: 0
                            }, ...prev];
                        });
                    } else if (data.type === "ping") {
                        if (channel?.readyState === "open") {
                            channel.send(JSON.stringify({ type: "pong" }));
                        }
                    }
                } catch (e) {
                    console.error("Failed to parse message:", e);
                }
                return;
            }

            // Binary data
            const activeFile = channel._incomingFile;

            if (!activeFile) {
                console.warn("No active file for incoming chunk");
                return;
            }

            activeFile.buffers.push(event.data);
            activeFile.receivedSize += event.data.byteLength;

            const progress = Math.floor((activeFile.receivedSize / activeFile.size) * 100);
            const now = Date.now();

            // Throttle progress update
            if (progress % 5 === 0 || now - activeFile.lastProgressUpdate > PROGRESS_THROTTLE_MS) {
                activeFile.lastProgressUpdate = now;
                setTransfers(prev => prev.map(t =>
                    t.id === activeFile.fileId ? { ...t, progress, received: activeFile.receivedSize } : t
                ));
            }

            // Check if file is complete
            if (activeFile.receivedSize >= activeFile.size) {
                log(`✓ Received: ${activeFile.name}`);

                try {
                    const blob = new Blob(activeFile.buffers, { type: activeFile.type });
                    const url = URL.createObjectURL(blob);

                    objectUrlsRef.current.add(url);

                    setReceivedFiles(prev => [{
                        id: activeFile.fileId,
                        name: activeFile.name,
                        url,
                        size: activeFile.size,
                        type: activeFile.type,
                        receivedAt: new Date(),
                    }, ...prev]);

                    setTransfers(prev => prev.map(t =>
                        t.id === activeFile.fileId
                            ? { ...t, done: true, progress: 100, speed: "Completed" }
                            : t
                    ));

                    delete channel._incomingFile;

                } catch (err) {
                    log(`Error assembling file: ${err.message}`, "error");
                    delete channel._incomingFile;
                }
            }
        };
    }, [deviceName, setTransfers, setReceivedFiles, log]);

    // Create peer connection
    const createPeer = useCallback((targetId) => {
        const peer = new RTCPeerConnection(rtcConfig);

        peersRef.current[targetId] = peer;

        peer.onicecandidate = (event) => {
            if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    type: "signal",
                    targetId,
                    payload: { type: "ice", candidate: event.candidate }
                }));
            }
        };

        peer.oniceconnectionstatechange = () => {
            log(`ICE connection state: ${peer.iceConnectionState}`);
        };

        peer.ondatachannel = (event) => {
            log(`Data channel received from ${targetId}`);
            setupDataChannel(event.channel, targetId);
        };

        return peer;
    }, [setupDataChannel, log]);

    // Handle WebRTC signals
    const handleSignal = useCallback(async (data) => {
        const fromId = data.fromId;
        const payload = data.payload;

        log(`Received signal: ${payload.type}`);

        let peer = peersRef.current[fromId];

        if (payload.type === "ice") {
            if (peer && peer.remoteDescription) {
                try {
                    await peer.addIceCandidate(new RTCIceCandidate(payload.candidate));
                } catch (e) {
                    console.error("Error adding ICE candidate:", e);
                }
            }
            return;
        }

        if (payload.type === "offer") {
            if (!peer) {
                peer = createPeer(fromId);
                peersRef.current[fromId] = peer;
            }

            try {
                await peer.setRemoteDescription(new RTCSessionDescription(payload.offer));
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);

                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                        type: "signal",
                        targetId: fromId,
                        payload: { type: "answer", answer }
                    }));
                }
            } catch (error) {
                log(`Error handling offer: ${error.message}`, "error");
            }
            return;
        }

        if (payload.type === "answer") {
            if (!peer) return;
            try {
                await peer.setRemoteDescription(new RTCSessionDescription(payload.answer));
            } catch (error) {
                log(`Error handling answer: ${error.message}`, "error");
            }
            return;
        }
    }, [createPeer, log]);

    useEffect(() => {
        if (!deviceName) return;
        if (hasConnectedRef.current) return;

        hasConnectedRef.current = true;

        let ws = null;
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 5;
        let isUnmounting = false;

        const connectWebSocket = () => {
            if (isUnmounting) return;

            const wsUrl = process.env.NEXT_PUBLIC_WS_URL;

            log("Connecting websocket...");

            ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                log("WebSocket connected");
                reconnectAttempts = 0;

                setStatus(prev =>
                    prev === "Connected & Approved"
                        ? prev
                        : "Host approval required"
                );

                ws.send(JSON.stringify({
                    type: "join-room",
                    roomId,
                    name: deviceName,
                    mode: "receive", // ✅ tambahkan mode
                }));

                log(`Join room sent: ${roomId}`);
            };

            ws.onmessage = async (event) => {
                if (isUnmounting) return;

                const data = JSON.parse(event.data);

                log(`Received: ${data.type}`);

                switch (data.type) {

                    case "approved": {

                        // ✅ jangan proses approve berulang
                        if (isApproved) {
                            log("Already approved, ignoring duplicate approve");
                            return;
                        }

                        setIsApproved(true);
                        setApprovalStatus("approved");
                        setStatus("Connected & Approved");

                        log("✓ Approved by host");

                        break;
                    }

                    case "rejected": {
                        setApprovalStatus("rejected");
                        setStatus("Rejected");

                        log("✗ Rejected by host", "error");

                        isUnmounting = true;

                        setTimeout(() => {
                            router.push("/");
                        }, 2000);

                        break;
                    }

                    case "signal": {
                        await handleSignal(data);
                        break;
                    }

                    case "room-users": {
                        log(
                            `Room users: ${data.users?.map(u => u.name).join(", ") || "none"
                            }`
                        );
                        break;
                    }

                    case "room-closed": {
                        log("Room closed by host");

                        alert("Room has been closed");

                        isUnmounting = true;

                        router.push("/");

                        break;
                    }

                    case "room-mode-mismatch": {
                        const expectedMode = data.expectedMode;
                        const roomId = data.roomId;

                        log(`Room mode mismatch. Expected: ${expectedMode}`, "warn");

                        if (expectedMode === "share") {
                            // Ini seharusnya tidak terjadi karena receive sudah benar
                            // Tapi tetap handle
                            router.push(`/receive/${roomId}`);
                        } else if (expectedMode === "full") {
                            router.push(`/room/${roomId}`);
                        } else {
                            router.push("/");
                        }
                        break;
                    }

                    case "error": {
                        log(`Server error: ${data.message}`, "error");

                        if (data.message === "Host is not available") {
                            alert("Host is not available. Please try again.");
                        } else if (data.message.includes("mode")) {
                            // Error terkait mode, redirect ke home
                        }
                        break;
                    }

                    default:
                        console.log("Unknown message:", data.type);
                }
            };

            ws.onclose = (event) => {

                if (isUnmounting) return;

                log(`WebSocket disconnected: ${event.code}`);

                // ✅ reconnect hanya jika approved
                if (
                    reconnectAttempts < maxReconnectAttempts &&
                    isApprovedRef.current
                ) {

                    reconnectAttempts++;

                    setTimeout(() => {

                        if (isUnmounting) return;

                        log(
                            `Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`
                        );

                        connectWebSocket();

                    }, 3000);
                }
            };

            ws.onerror = (error) => {
                log(
                    `WebSocket error: ${error?.message || "Unknown error"
                    }`,
                    "error"
                );
            };
        };

        connectWebSocket();

        return () => {

            isUnmounting = true;

            hasConnectedRef.current = false;

            if (ws) {

                ws.onopen = null;
                ws.onmessage = null;
                ws.onclose = null;
                ws.onerror = null;

                if (
                    ws.readyState === WebSocket.OPEN ||
                    ws.readyState === WebSocket.CONNECTING
                ) {
                    ws.close(1000, "Component unmounting");
                }
            }

            Object.values(peersRef.current).forEach(peer => {
                try {
                    peer.close();
                } catch (e) { }
            });

            peersRef.current = {};
            channelsRef.current = {};
        };

    }, [roomId, deviceName]);

    useEffect(() => {
        isApprovedRef.current = isApproved;
    }, [isApproved]);

    if (!deviceName) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-8 h-8 border-2 border-gray-300 border-t-black rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-500">Initializing...</p>
                </div>
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-gray-50 dark:bg-zinc-950 px-4 py-10">
            <div className="max-w-2xl mx-auto">

                {/* Header */}
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Waiting for Files</h1>
                    <p className="text-gray-500 dark:text-gray-400">{status}</p>
                </div>

                {/* Device Identity */}
                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 p-4 mb-6">
                    <div className="flex items-center gap-3">

                        <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                            <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                                {deviceName?.slice(0, 2).toUpperCase()}
                            </span>
                        </div>

                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                                {deviceName}
                            </p>

                            <p className="text-xs text-gray-400 mt-0.5">
                                This name will appear to the host
                            </p>
                        </div>
                    </div>
                </div>

                {/* Status Card */}
                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 p-6 mb-6 text-center">
                    <div className="flex items-center justify-center gap-2 mb-3">
                        <div className={`w-3 h-3 rounded-full ${isApproved ? "bg-green-500" :
                            approvalStatus === "rejected" ? "bg-red-500" :
                                "bg-yellow-500 animate-pulse"
                            }`} />
                        <span className="font-medium text-gray-900 dark:text-white">{status}</span>
                    </div>

                    {!isApproved && approvalStatus !== "rejected" && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Waiting for host to approve your request
                        </p>
                    )}

                    {isApproved && (
                        <p className="text-sm text-green-600 dark:text-green-400">
                            Approved by host • Ready to receive
                        </p>
                    )}
                </div>

                {/* Transfer Progress */}
                {transfers.length > 0 && (
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 overflow-hidden mb-4">
                        <div className="px-5 pt-5 pb-3">
                            <p className="text-[11px] font-medium tracking-widest uppercase text-gray-400 dark:text-zinc-500">
                                Downloading
                            </p>
                        </div>
                        <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                            {transfers.filter(t => !t.done).map((item) => (
                                <div key={item.id} className="px-5 py-4">
                                    <div className="flex items-center justify-between gap-4 mb-2">
                                        <div>
                                            <p className="text-sm font-medium truncate">{item.name}</p>
                                            <p className="text-xs text-gray-400">
                                                {formatBytes(item.received || 0)} / {formatBytes(item.size)}
                                            </p>
                                        </div>
                                        <p className="text-sm font-mono">{item.progress}%</p>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-gray-100 dark:bg-zinc-800 overflow-hidden">
                                        <div
                                            className="h-full rounded-full bg-blue-500 transition-all"
                                            style={{ width: `${item.progress}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Received Files */}
                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 overflow-hidden">
                    <div className="px-5 pt-5 pb-3 flex items-center justify-between">
                        <p className="text-[11px] font-medium tracking-widest uppercase text-gray-400 dark:text-zinc-500">
                            Received Files
                        </p>

                        {receivedFiles.length > 0 && (
                            <button
                                onClick={() => {

                                    receivedFiles.forEach(f => {
                                        if (f.url) {
                                            URL.revokeObjectURL(f.url);
                                        }
                                    });

                                    setReceivedFiles([]);
                                }}
                                className="text-xs text-red-500 hover:text-red-600"
                            >
                                Clear all
                            </button>
                        )}
                    </div>

                    <div className="divide-y divide-gray-100 dark:divide-zinc-800 max-h-[400px] overflow-y-auto">
                        {receivedFiles.length === 0 && (
                            <div className="p-8 text-center">
                                <svg className="w-12 h-12 text-gray-300 dark:text-zinc-700 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                <p className="text-sm text-gray-400">
                                    {isApproved ? "No files received yet" : "Host approval required"}
                                </p>
                            </div>
                        )}

                        {receivedFiles.map((file) => (
                            <div key={file.id} className="px-5 py-4 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                                    <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{file.name}</p>
                                    <p className="text-xs text-gray-400 mt-0.5">
                                        {formatBytes(file.size)} • Received
                                    </p>
                                </div>
                                <a
                                    href={file.url}
                                    download={file.name}
                                    className="px-3 py-1.5 bg-black text-white rounded-full text-xs font-medium hover:bg-gray-800 transition-colors"
                                >
                                    Save
                                </a>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </main>
    );
}
