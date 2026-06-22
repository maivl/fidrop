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
    const [textMessages, setTextMessages] = useState([]);
    const [textInput, setTextInput] = useState("");
    const [toast, setToast] = useState(null);

    // Refs
    const wsRef = useRef(null);
    const peersRef = useRef({});
    const channelsRef = useRef({});
    // WebSocket connection
    const hasConnectedRef = useRef(false);
    const isApprovedRef = useRef(false);
    const objectUrlsRef = useRef(new Set());
    const textMessagesEndRef = useRef(null);
    const hostPeerIdRef = useRef(null);
    const toastTimerRef = useRef(null);

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
                    } else if (data.type === "text-message") {
                        hostPeerIdRef.current = peerId;
                        setTextMessages((prev) => [
                            ...prev,
                            {
                                id: data.messageId || Date.now(),
                                content: data.content,
                                senderName: data.senderName || "Host",
                                senderId: peerId,
                                timestamp: data.timestamp || Date.now(),
                                isMine: false,
                            },
                        ]);
                        showToast(`Message from ${data.senderName || "Host"}`, "info");
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

    // Auto-scroll to bottom of text messages
    useEffect(() => {
        if (textMessagesEndRef.current) {
            textMessagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [textMessages]);

    const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const showToast = useCallback((msg, type = "info") => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast({ msg, type, id: Date.now() });
        toastTimerRef.current = setTimeout(() => setToast(null), 2500);
    }, []);

    const copyMessageText = useCallback((content) => {
        navigator.clipboard.writeText(content);
        showToast("Copied to clipboard", "success");
    }, [showToast]);

    const sendTextMessage = useCallback(() => {
        const text = textInput.trim();
        if (!text) return;

        const hostId = hostPeerIdRef.current;
        const targetIds = hostId ? [hostId] : Object.keys(channelsRef.current);
        const targets = targetIds.filter(id => {
            const ch = channelsRef.current[id];
            return ch && ch.readyState === "open";
        });

        if (targets.length === 0) {
            log("No connected peers to send text to");
            return;
        }

        const messageId = `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const message = {
            type: "text-message",
            content: text,
            messageId,
            timestamp: Date.now(),
            senderName: deviceName,
        };

        let sentCount = 0;
        for (const targetId of targets) {
            const channel = channelsRef.current[targetId];
            if (channel && channel.readyState === "open") {
                channel.send(JSON.stringify(message));
                sentCount++;
            }
        }

        if (sentCount > 0) {
            setTextMessages((prev) => [
                ...prev,
                {
                    id: messageId,
                    content: text,
                    senderName: deviceName,
                    senderId: "self",
                    timestamp: Date.now(),
                    isMine: true,
                },
            ]);
            setTextInput("");
        } else {
            log("No connected peers to send text to");
        }
    }, [textInput, deviceName, log]);

    const handleTextKeyDown = useCallback((e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendTextMessage();
        }
    }, [sendTextMessage]);

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
        <main className="min-h-screen bg-gray-50 dark:bg-zinc-950 pb-20 sm:pb-10">
            {/* TOAST */}
            {toast && (
                <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium transition-all ${
                    toast.type === "success" ? "bg-green-600 text-white" :
                    toast.type === "warn" ? "bg-yellow-500 text-white" :
                    "bg-black dark:bg-white text-white dark:text-black"
                }`}>
                    {toast.msg}
                </div>
            )}

            <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Waiting for Files</h1>
                            <p className="text-[12px] text-gray-400">{deviceName}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isApproved ? "bg-green-500" : approvalStatus === "rejected" ? "bg-red-500" : "bg-yellow-500 animate-pulse"}`} />
                        <span className="text-[12px] text-gray-500">{isApproved ? "Connected" : approvalStatus === "rejected" ? "Rejected" : "Waiting..."}</span>
                    </div>
                </div>

                {/* Status */}
                {!isApproved && approvalStatus !== "rejected" && (
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 p-5 mb-4 text-center">
                        <div className="w-10 h-10 mx-auto mb-3 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                        <p className="text-[13px] text-gray-500">Waiting for host to approve your request</p>
                    </div>
                )}

                {approvalStatus === "rejected" && (
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 p-5 mb-4 text-center">
                        <p className="text-[13px] text-red-500 font-medium">Your request was rejected by the host</p>
                    </div>
                )}

                {/* Transfer Progress */}
                {transfers.length > 0 && (
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 overflow-hidden mb-3">
                        <div className="px-4 pt-4 pb-2">
                            <p className="text-[10px] font-medium tracking-widest uppercase text-gray-400">Downloading</p>
                        </div>
                        <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                            {transfers.filter(t => !t.done).map((item) => (
                                <div key={item.id} className="px-4 py-3">
                                    <div className="flex items-center justify-between gap-3 mb-1.5">
                                        <p className="text-[13px] font-medium truncate">{item.name}</p>
                                        <span className="text-[12px] font-mono flex-shrink-0">{item.progress}%</span>
                                    </div>
                                    <p className="text-[11px] text-gray-400 mb-2">{formatBytes(item.received || 0)} / {formatBytes(item.size)}</p>
                                    <div className="h-1 rounded-full bg-gray-100 dark:bg-zinc-800 overflow-hidden">
                                        <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${item.progress}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Received Files */}
                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 overflow-hidden mb-3">
                    <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                        <p className="text-[10px] font-medium tracking-widest uppercase text-gray-400">Received Files</p>
                        {receivedFiles.length > 0 && (
                            <button onClick={() => { receivedFiles.forEach(f => { if (f.url) URL.revokeObjectURL(f.url); }); setReceivedFiles([]); }} className="text-[11px] text-red-500 hover:text-red-600 cursor-pointer">Clear all</button>
                        )}
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-zinc-800 max-h-[300px] overflow-y-auto">
                        {receivedFiles.length === 0 && (
                            <div className="p-6 text-center">
                                <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-3">
                                    <svg className="w-6 h-6 text-gray-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                </div>
                                <p className="text-[13px] text-gray-400">{isApproved ? "No files received yet" : "Host approval required"}</p>
                            </div>
                        )}
                        {receivedFiles.map((file) => (
                            <div key={file.id} className="px-4 py-3 flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                                    <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-medium truncate">{file.name}</p>
                                    <p className="text-[11px] text-gray-400">{formatBytes(file.size)}</p>
                                </div>
                                <a href={file.url} download={file.name} className="px-2.5 py-1 bg-black dark:bg-white text-white dark:text-black rounded-lg text-[11px] font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors cursor-pointer">Save</a>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Chat */}
                <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl overflow-hidden">
                    <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                        <p className="text-[10px] font-medium tracking-widest uppercase text-gray-400">Chat with Host</p>
                        {textMessages.length > 0 && (
                            <button onClick={() => setTextMessages([])} className="text-[11px] text-gray-400 hover:text-red-500 cursor-pointer">Clear</button>
                        )}
                    </div>
                    <div className="px-4 max-h-[250px] overflow-y-auto">
                        {textMessages.length === 0 && (
                            <div className="py-8 text-center">
                                <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-3">
                                    <svg className="w-6 h-6 text-gray-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
                                </div>
                                <p className="text-[13px] text-gray-400">No messages yet</p>
                            </div>
                        )}
                        {textMessages.map((msg, idx) => {
                            const prevMsg = idx > 0 ? textMessages[idx - 1] : null;
                            const sameSender = prevMsg && prevMsg.senderId === msg.senderId && (msg.timestamp - prevMsg.timestamp < 2 * 60 * 1000);
                            return (
                                <div key={msg.id} className={`flex ${msg.isMine ? 'justify-end' : 'justify-start'} ${sameSender ? 'mt-0.5' : 'mt-2'}`}>
                                    <div className="max-w-[80%]">
                                        {!sameSender && <p className="text-[10px] text-gray-400 mb-1 px-1">{msg.isMine ? 'You' : msg.senderName}</p>}
                                        <div onClick={() => copyMessageText(msg.content)} className={`px-3 py-1.5 rounded-2xl break-words whitespace-pre-wrap cursor-pointer active:scale-[0.98] transition-transform ${msg.isMine ? 'bg-black dark:bg-white text-white dark:text-black rounded-br-sm' : 'bg-gray-100 dark:bg-zinc-800 text-gray-900 dark:text-white rounded-bl-sm'}`} title="Click to copy">
                                            <p className="text-[13px] leading-relaxed">{msg.content}</p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={textMessagesEndRef} />
                    </div>
                    <div className="border-t border-gray-100 dark:border-zinc-800 p-3">
                        {!isApproved && (
                            <p className="text-[11px] text-gray-400 text-center mb-2">Connect to host to start chatting</p>
                        )}
                        <div className="flex items-end gap-2">
                            <textarea
                                value={textInput} onChange={(e) => setTextInput(e.target.value)}
                                onKeyDown={isApproved ? handleTextKeyDown : undefined}
                                placeholder={isApproved ? "Type a message..." : "Waiting for approval..."}
                                rows={1} disabled={!isApproved}
                                className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 px-3.5 py-2.5 text-[13px] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{ minHeight: '40px', maxHeight: '120px' }}
                                onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
                            />
                            <button onClick={sendTextMessage} disabled={!isApproved || !textInput.trim()}
                                className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isApproved && textInput.trim() ? 'bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-100 cursor-pointer active:scale-95' : 'bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-600 cursor-not-allowed'}`}>
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}
