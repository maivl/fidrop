"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import { rtcConfig } from "@/libs/webrtc";
import { fileStorage } from "@/libs/fileStorage";
import Link from "next/link";

const CHUNK_SIZE = 16 * 1024;
const MAX_BUFFERED = 8 * 1024 * 1024;
const PROGRESS_THROTTLE_MS = 200;

export default function ShareRoomPage() {
    const params = useParams();
    const router = useRouter();
    const roomId = params.roomId;
    const [files, setFiles] = useState([]);
    const [clientUrl, setClientUrl] = useState("");
    const [roomUsers, setRoomUsers] = useState([]);
    const [pendingUsers, setPendingUsers] = useState([]);
    const [isHost, setIsHost] = useState(true);
    const [status, setStatus] = useState("Initializing...");
    const [deviceName, setDeviceName] = useState("");
    const [messages, setMessages] = useState([]);
    const [fileBlobs, setFileBlobs] = useState([]);
    const [transfers, setTransfers] = useState([]);
    const [approvedUsers, setApprovedUsers] = useState(new Set());
    const [myId, setMyId] = useState(null);
    const [isFileReady, setIsFileReady] = useState(false);

    const approvedUsersRef = useRef(new Set());
    const sendingPeersRef = useRef(new Set());
    const wsRef = useRef(null);
    const peersRef = useRef({});
    const channelsRef = useRef({});
    const pendingUsersRef = useRef([]);
    const connectedUserIds = useRef(new Set());
    const processedJoinRequests = useRef(new Set());
    const sendingProgress = useRef({});
    const shouldReconnect = useRef(true);

    useEffect(() => {
        if (typeof window !== "undefined") {
            setClientUrl(
                `${window.location.origin}/receive/${roomId}`
            );
        }

    }, [roomId]);

    useEffect(() => {
        connectedUserIds.current = new Set(roomUsers.map((u) => u.id));
    }, [roomUsers]);

    useEffect(() => {
        pendingUsersRef.current = pendingUsers;
    }, [pendingUsers]);

    const log = useCallback((msg) => {
        console.log(msg);
        setMessages((prev) => [
            `[${new Date().toLocaleTimeString()}] ${msg}`,
            ...prev.slice(0, 49),
        ]);
    }, []);

    useEffect(() => {
        log(`Current roomUsers: ${roomUsers.map((u) => u.name).join(", ")}`);
    }, [roomUsers, log]);

    useEffect(() => {
        log(`Current pendingUsers: ${pendingUsers.map((u) => u.name).join(", ")}`);
    }, [pendingUsers, log]);

    useEffect(() => {
        const generateRandomName = () => {
            const adjectives = [
                "Swift",
                "Brave",
                "Clever",
                "Mighty",
                "Noble",
                "Wise",
            ];
            const nouns = ["Phoenix", "Tiger", "Eagle", "Wolf", "Dragon", "Knight"];
            return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]
                }`;
        };
        setDeviceName(generateRandomName());
    }, []);

    useEffect(() => {
        if (!deviceName) return;
        const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        let reconnectTimeout = null;
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 5;
        const isMounted = { current: true };
        ws.onopen = () => {
            setStatus("Connected");
            reconnectAttempts = 0;
            ws.send(
                JSON.stringify({
                    type: "join-room",
                    roomId,
                    name: deviceName,
                    mode: "share", // ✅ tambahkan mode
                })
            );
        };
        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            log(`Received: ${data.type}`);
            switch (data.type) {
                case "joined-as-host":
                    setMyId(data.id);
                    setIsHost(true);
                    setStatus("Ready");
                    log("You are the host of this room");
                    break;
                case "room-users": {
                    if (!myId) return;
                    const filteredUsers = (data.users || []).filter(
                        (user) => user.id !== myId
                    );
                    setRoomUsers((prev) => {
                        const merged = [...prev];
                        filteredUsers.forEach((user) => {
                            const exists = merged.some((u) => u.id === user.id);
                            if (!exists) {
                                merged.push(user);
                            }
                        });
                        const finalUsers = merged.filter(
                            (user) =>
                                filteredUsers.some((u) => u.id === user.id) ||
                                approvedUsers.has(user.id)
                        );
                        return finalUsers;
                    });
                    break;
                }
                case "join-request": {
                    const userId = data.id;
                    if (userId === myId) return;
                    if (approvedUsersRef.current.has(userId)) {
                        log(`Ignoring join request from approved user ${data.name}`);
                        if (wsRef.current?.readyState === WebSocket.OPEN) {
                            wsRef.current.send(
                                JSON.stringify({
                                    type: "approve-user",
                                    targetId: userId,
                                })
                            );
                        }
                        return;
                    }
                    if (connectedUserIds.current.has(userId)) {
                        log(`Ignoring join request from connected user ${data.name}`);
                        return;
                    }
                    const alreadyPending = pendingUsersRef.current.some(
                        (u) => u.id === userId
                    );
                    if (alreadyPending) {
                        log(`Duplicate pending request ignored from ${data.name}`);
                        return;
                    }
                    if (processedJoinRequests.current.has(userId)) {
                        log(`Duplicate processed request ignored from ${data.name}`);
                        return;
                    }
                    processedJoinRequests.current.add(userId);
                    log(`${data.name} wants to join`);
                    setPendingUsers((prev) => [
                        ...prev,
                        {
                            id: userId,
                            name: data.name,
                        },
                    ]);
                    break;
                }
                case "pending-users-update": {
                    const filteredPending = (data.pending || []).filter(
                        (user) => user.id !== myId
                    );
                    const finalPending = filteredPending.filter((user) => {
                        return !roomUsers.some((u) => u.id === user.id);
                    });
                    setPendingUsers(finalPending);
                    break;
                }
                case "room-mode-mismatch": {
                    shouldReconnect.current = false;
                    const expectedMode = data.expectedMode;
                    const roomId = data.roomId;

                    log(`Room mode mismatch. Expected: ${expectedMode}`, "warn");

                    reconnectAttempts = maxReconnectAttempts; // Set ke max agar tidak reconnect
                    isMounted.current = false; // Tandai sebagai unmount

                    // ✅ Tutup WebSocket
                    if (ws) {
                        ws.onclose = null; // Hapus handler agar tidak trigger reconnect
                        ws.close();
                    }

                    if (expectedMode === "full") {
                        router.push(`/room/${roomId}`);
                    } else if (expectedMode === "receive") {
                        router.push(`/receive/${roomId}`);
                    } else {
                        router.push("/");
                    }
                    return;
                }
                case "signal":
                    await handleSignal(data);
                    break;
                case "error": {
                    log(`Server error: ${data.message}`, "error");
                    // Tampilkan error ke user
                    if (data.message.includes("host")) {
                        alert("Error: " + data.message);
                    }
                    break;
                }
                default:
                    console.log("Unknown message:", data.type);
            }
        };
        return () => {
            isMounted.current = false;
            shouldReconnect.current = false;
            ws.close();
            Object.values(peersRef.current).forEach((peer) => peer.close());
        };
    }, [roomId, deviceName]);

    useEffect(() => {
        processedJoinRequests.current.clear();
        setApprovedUsers(new Set());
        setPendingUsers([]);
        setRoomUsers([]);
    }, [roomId]);

    useEffect(() => {
        approvedUsersRef.current = approvedUsers;
    }, [approvedUsers]);

    const sendSingleFile = useCallback(async (peerId, file) => {
        const channel = channelsRef.current[peerId];
        if (!channel || channel.readyState !== "open") return;

        const fileId = `${peerId}-${file.name}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        
        log(`Sending ${file.name} to ${peerId}...`);

        // Metadata
        channel.send(JSON.stringify({
            type: "file-meta",
            name: file.name,
            size: file.size,
            mime: file.type,
            fileId: fileId
        }));

        setTransfers((prev) => [
            {
                id: fileId,
                name: file.name,
                from: deviceName,
                to: peerId,
                progress: 0,
                speed: "Sending...",
                done: false,
                size: file.size,
                sent: 0,
            },
            ...prev,
        ]);

        const CHUNK_SIZE = 64 * 1024;
        const MAX_BUFFERED = 1024 * 1024; // 1MB buffer limit
        let offset = 0;
        let lastProgressUpdate = 0;

        while (offset < file.size) {
            if (channel.readyState !== "open") break;

            if (channel.bufferedAmount > MAX_BUFFERED) {
                await new Promise(resolve => setTimeout(resolve, 50));
                continue;
            }

            const end = Math.min(offset + CHUNK_SIZE, file.size);
            const slice = file.slice(offset, end);
            const buffer = await slice.arrayBuffer();
            channel.send(buffer);

            offset = end;
            const progress = Math.floor((offset / file.size) * 100);
            const now = Date.now();

            if (progress !== lastProgressUpdate && (progress % 5 === 0 || now - lastProgressUpdate > 500)) {
                lastProgressUpdate = progress;
                setTransfers((prev) =>
                    prev.map((t) =>
                        t.id === fileId ? { ...t, progress, sent: offset } : t
                    )
                );
            }
        }

        setTransfers((prev) =>
            prev.map((t) =>
                t.id === fileId ? { ...t, progress: 100, done: true, speed: "Completed" } : t
            )
        );
        log(`✓ ${file.name} sent to ${peerId}`);
    }, [deviceName, log]);

    const sendFilesToPeer = useCallback(
        async (peerId, filesToSend) => {
            const channel = channelsRef.current[peerId];
            if (!channel || channel.readyState !== "open") return;

            // Use a per-channel queue
            if (!channel._queue) channel._queue = [];
            for (const file of filesToSend) {
                channel._queue.push(file);
            }

            if (channel._isSending) return;
            channel._isSending = true;

            log(`Starting transfer of ${channel._queue.length} files to ${peerId}`);

            while (channel._queue.length > 0) {
                const nextFile = channel._queue.shift();
                try {
                    await sendSingleFile(peerId, nextFile);
                    // Small delay between files to let receiver catch up
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (err) {
                    console.error(`Error sending file to ${peerId}:`, err);
                }
            }

            channel._isSending = false;
            log(`All files sent to ${peerId}`);
        },
        [sendSingleFile, log]
    );
    const setupDataChannel = useCallback(
        (channel, peerId) => {
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
                }, 15000);
                if (
                    !sendingPeersRef.current.has(peerId) &&
                    fileBlobs.length > 0
                ) {
                    sendingPeersRef.current.add(peerId);
                    log(`Auto-sending ${fileBlobs.length} file(s) to ${peerId}`);
                    sendFilesToPeer(peerId, fileBlobs);
                }
            };
            channel.onclose = () => {
                log(`Data channel closed for ${peerId}`);
                if (keepAliveInterval) clearInterval(keepAliveInterval);
            };
            channel.onerror = (error) => {
                log(
                    `Data channel error: ${error?.message || "Unknown error"}`,
                    "error"
                );
            };
            return () => {
                if (keepAliveInterval) clearInterval(keepAliveInterval);
            };
        },
        [files, fileBlobs, sendFilesToPeer, log]
    );
    const createPeer = useCallback(
        (targetId) => {
            const peer = new RTCPeerConnection(rtcConfig);
            peersRef.current[targetId] = peer;
            let keepAliveInterval;
            peer.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log("Sending ICE candidate:", event.candidate);
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({
                            type: "signal",
                            targetId,
                            payload: {
                                type: "ice",
                                candidate: event.candidate
                            }
                        }));
                    }
                } else {
                    console.log("ICE candidate gathering complete");
                }
            };
            peer.oniceconnectionstatechange = () => {
                const state = peer.iceConnectionState;
                log(`ICE connection state for ${targetId}: ${state}`);

                if (state === "connected") {
                    keepAliveInterval = setInterval(() => {
                        const channel = channelsRef.current[targetId];
                        if (channel && channel.readyState === "open") {
                            try {
                                channel.send(JSON.stringify({ type: "ping" }));
                            } catch (e) { }
                        }
                    }, 10000);
                } else if (state === "disconnected" || state === "failed") {
                    if (keepAliveInterval) {
                        clearInterval(keepAliveInterval);
                    }

                    log(`ICE ${state} for ${targetId}, but keeping user in list`, "warn");
                }
            };
            peer.onconnectionstatechange = () => {
                const state = peer.connectionState;
                log(`Connection state for ${targetId}: ${state}`);

                if (state === "connected") {
                    log(`Successfully connected to ${targetId}`);
                } else if (state === "failed") {
                    log(`Connection failed for ${targetId}, but keeping in list`, "warn");

                    setTimeout(() => {
                        if (peer && peer.signalingState !== "closed") {
                            peer.restartIce();
                        }
                    }, 2000);
                }
            };

            peer.ondatachannel = (event) => {
                log(`Data channel received from ${targetId}`);
                setupDataChannel(event.channel, targetId);
            };
            return peer;
        },
        [setupDataChannel, log]
    );

    const connectToPeer = useCallback(
        async (targetId) => {
            const existingPeer = peersRef.current[targetId];
            if (
                existingPeer &&
                existingPeer.connectionState !== "closed" &&
                existingPeer.connectionState !== "failed"
            ) {
                log(`Peer ${targetId} already connected`);
                return;
            }
            let peer = existingPeer;
            if (
                !peer ||
                peer.connectionState === "closed" ||
                peer.connectionState === "failed"
            ) {
                peer = createPeer(targetId);
                peersRef.current[targetId] = peer;
            }
            try {
                const existingChannel = channelsRef.current[targetId];
                if (existingChannel && existingChannel.readyState === "open") {
                    log(`Channel already exists for ${targetId}`);
                    return;
                }
                const channel = peer.createDataChannel("file", {
                    ordered: true,
                });
                channel.binaryType = "arraybuffer";
                setupDataChannel(channel, targetId);
                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(
                        JSON.stringify({
                            type: "signal",
                            targetId,
                            payload: {
                                type: "offer",
                                offer,
                            },
                        })
                    );
                    log(`Offer sent to ${targetId}`);
                }
            } catch (error) {
                console.error("Error creating offer:", error);
                log(`Failed to connect to ${targetId}`, "error");
                if (peersRef.current[targetId]) {
                    try {
                        peersRef.current[targetId].close();
                    } catch (e) { }
                    delete peersRef.current[targetId];
                }
                if (channelsRef.current[targetId]) {
                    try {
                        channelsRef.current[targetId].close();
                    } catch (e) { }

                    delete channelsRef.current[targetId];
                }
            }
        },
        [createPeer, setupDataChannel, log]
    );

    const handleSignal = useCallback(
        async (data) => {
            const fromId = data.fromId;
            const payload = data.payload;

            console.log(`Received signal from ${fromId}: ${payload.type}`);

            let peer = peersRef.current[fromId];

            if (payload.type === "ice") {
                if (peer && peer.remoteDescription) {
                    try {
                        await peer.addIceCandidate(new RTCIceCandidate(payload.candidate));
                        console.log(`ICE candidate added for ${fromId}`);
                    } catch (e) {
                        console.error("Error adding ICE candidate:", e);
                    }
                } else {
                    console.warn(
                        `Cannot add ICE candidate: remote description not set for ${fromId}`
                    );

                    if (!peer) {
                        peer = createPeer(fromId);
                        peersRef.current[fromId] = peer;
                    }
                    if (!peer._pendingCandidates) peer._pendingCandidates = [];
                    peer._pendingCandidates.push(payload.candidate);
                }
                return;
            }

            if (payload.type === "offer") {
                if (!peer) {
                    peer = createPeer(fromId);
                    peersRef.current[fromId] = peer;
                }

                try {
                    await peer.setRemoteDescription(
                        new RTCSessionDescription(payload.offer)
                    );
                    console.log(`Remote description set for ${fromId}`);

                    const answer = await peer.createAnswer();
                    await peer.setLocalDescription(answer);

                    if (peer._pendingCandidates) {
                        for (const candidate of peer._pendingCandidates) {
                            try {
                                await peer.addIceCandidate(new RTCIceCandidate(candidate));
                            } catch (e) {
                                console.error("Error adding pending ICE candidate:", e);
                            }
                        }
                        delete peer._pendingCandidates;
                    }

                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(
                            JSON.stringify({
                                type: "signal",
                                targetId: fromId,
                                payload: {
                                    type: "answer",
                                    answer: answer,
                                },
                            })
                        );
                        console.log(`Answer sent to ${fromId}`);
                    }
                } catch (error) {
                    console.error("Error handling offer:", error);
                }
                return;
            }

            if (payload.type === "answer") {
                if (!peer) {
                    console.error(`No peer found for ${fromId} when receiving answer`);
                    return;
                }

                try {
                    if (peer.signalingState === "have-local-offer") {
                        await peer.setRemoteDescription(
                            new RTCSessionDescription(payload.answer)
                        );
                        console.log(`Remote answer set for ${fromId}`);
                    } else {
                        console.warn(`Cannot set answer in state: ${peer.signalingState}`);
                    }
                } catch (error) {
                    console.error("Error handling answer:", error);
                }
                return;
            }
        },
        [createPeer]
    );

    const approveUser = useCallback(
        async (userId) => {
            if (approvedUsers.has(userId)) {
                log(`User ${userId} already approved, skipping`);
                return;
            }

            const userData = pendingUsers.find((u) => u.id === userId);
            if (!userData) {
                log(`User ${userId} not found in pending`, "warn");
                return;
            }

            log(`Approving user: ${userData.name}`);

            setApprovedUsers((prev) => new Set([...prev, userId]));

            approvedUsersRef.current.add(userId);
            processedJoinRequests.current.add(userId);

            setPendingUsers((prev) => prev.filter((u) => u.id !== userId));

            setRoomUsers((prev) => {
                const exists = prev.some((u) => u.id === userId);
                if (!exists) {
                    return [
                        ...prev,
                        {
                            id: userData.id,
                            name: userData.name,
                            role: "client",
                            connected: true,
                        },
                    ];
                }
                return prev;
            });

            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(
                    JSON.stringify({
                        type: "approve-user",
                        targetId: userId,
                    })
                );
            }

            await connectToPeer(userId);
        },
        [connectToPeer, pendingUsers, approvedUsers, log]
    );

    const rejectUser = useCallback((userId) => {
        wsRef.current.send(
            JSON.stringify({
                type: "reject-user",
                targetId: userId,
            })
        );
        setPendingUsers((prev) => prev.filter((u) => u.id !== userId));
    }, []);

    useEffect(() => {
        return () => {
            Object.values(peersRef.current).forEach((peer) => {
                if (peer._keepAliveInterval) {
                    clearInterval(peer._keepAliveInterval);
                }
                try {
                    peer.close();
                } catch (e) { }
            });
        };
    }, []);

    useEffect(() => {
        console.log("Files state:", files);
        console.log("FileBlobs state:", fileBlobs);
        console.log("Files length:", files.length);
        console.log("FileBlobs length:", fileBlobs.length);
    }, [files, fileBlobs]);

    useEffect(() => {
        const loadFilesFromStorage = async () => {
            const savedData = sessionStorage.getItem(`share_${roomId}`);

            if (!savedData) {
                log("No session data found", "error");
                setTimeout(() => router.push("/share"), 2000);
                return;
            }

            try {
                const parsed = JSON.parse(savedData);
                const savedFiles = parsed.files;

                if (parsed.timestamp && Date.now() - parsed.timestamp > 3600000) {
                    log("Session expired", "warn");
                    sessionStorage.removeItem(`share_${roomId}`);
                    await fileStorage.deleteFiles(roomId);
                    router.push("/share");
                    return;
                }

                if (
                    !savedFiles ||
                    !Array.isArray(savedFiles) ||
                    savedFiles.length === 0
                ) {
                    log("No valid files metadata", "error");
                    router.push("/share");
                    return;
                }

                setFiles(
                    savedFiles.map((f) => ({
                        name: f.name,
                        size: f.size,
                        type: f.type,
                    }))
                );

                const loadedFilesData = await fileStorage.loadFiles(roomId);

                if (loadedFilesData && loadedFilesData.length > 0) {
                    const loadedFiles = [];
                    for (const meta of savedFiles) {
                        const fileData = loadedFilesData.find(f => f.name === meta.name && f.size === meta.size);
                        if (!fileData) {
                            console.error(`Missing file data in IndexedDB for: ${meta.name}`);
                            continue;
                        }
                        try {
                            if (!fileData.data) {
                                console.error(`No data for file: ${fileData.name}`);
                                continue;
                            }
                            const response = await fetch(fileData.data);
                            if (!response.ok) {
                                throw new Error(`Failed to fetch ${fileData.name}`);
                            }
                            const blob = await response.blob();
                            const fileObj = new File([blob], fileData.name, {
                                type: fileData.type,
                            });
                            loadedFiles.push(fileObj);
                        } catch (err) {
                            console.error(`Error loading file ${fileData.name}:`, err);
                        }
                    }

                    if (loadedFiles.length > 0) {
                        setFileBlobs(loadedFiles);
                        setIsFileReady(true);
                        log(
                            `${loadedFiles.length} file(s) loaded successfully from IndexedDB`
                        );
                    } else {
                        log("No files could be loaded from IndexedDB", "error");
                    }
                } else {
                    log("No files found in IndexedDB, but metadata exists", "warn");
                }
            } catch (error) {
                console.error("Error loading files:", error);
                log(`Error loading files: ${error.message}`, "error");
            }
        };

        loadFilesFromStorage();
    }, [roomId, router, log]);

    const connectedClients = roomUsers.filter((u) => u.role === "client").length;

    const totalSize = files.reduce((acc, file) => acc + file.size, 0);

    const formatBytes = (bytes) => {
        if (!bytes) return "0 B";

        const units = ["B", "KB", "MB", "GB"];
        let i = 0;

        while (bytes >= 1024 && i < units.length - 1) {
            bytes /= 1024;
            i++;
        }

        return `${bytes.toFixed(1)} ${units[i]}`;
    };

    return (
        <main className="min-h-screen bg-gray-50 dark:bg-zinc-950 px-4 py-10">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <Link href="/share">
                        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg
                                className="w-8 h-8 text-green-600"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={1.5}
                                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                                />
                            </svg>
                        </div>
                    </Link>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                        Ready to Share
                    </h1>

                    <p className="text-gray-500 dark:text-gray-400 mt-2">
                        Approve nearby devices to instantly send files
                    </p>
                </div>

                <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl p-4 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                            <span className="font-semibold text-blue-700 dark:text-blue-300">
                                {deviceName?.slice(0, 2).toUpperCase()}
                            </span>
                        </div>

                        <div>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">
                                {deviceName}
                            </p>

                            <p className="text-xs text-gray-400">Your device identity</p>
                        </div>
                    </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                    {/* Left Panel - QR Code & Files */}
                    <div className="space-y-4">
                        {/* QR Code */}
                        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-gray-100 dark:border-zinc-800 p-8 text-center">
                            <p className="text-xs uppercase tracking-widest text-gray-400 mb-4">
                                Scan to Receive
                            </p>

                            <div className="bg-white p-4 rounded-2xl inline-block">
                                <QRCode value={clientUrl} size={190} />
                            </div>

                            <p className="text-sm font-medium text-gray-900 dark:text-white mt-5">
                                Recipients scan this QR code
                            </p>

                            <button
                                onClick={() => navigator.clipboard.writeText(clientUrl)}
                                className="mt-4 px-4 py-2 rounded-full bg-gray-100 dark:bg-zinc-800 text-sm hover:bg-gray-200 dark:hover:bg-zinc-700 transition"
                            >
                                Copy Invite Link
                            </button>
                        </div>

                        {/* Files to Share */}
                        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                                        Files Ready
                                    </h3>
                                    <p className="text-xs text-gray-400 mt-1">
                                        {files.length} file(s) • {formatBytes(totalSize)}
                                    </p>
                                </div>
                            </div>
                            <div className="space-y-2 max-h-60 overflow-y-auto">
                                {files.map((file, idx) => (
                                    <div
                                        key={idx}
                                        className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-zinc-800 rounded-lg"
                                    >
                                        <svg
                                            className="w-4 h-4 text-gray-400"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                            />
                                        </svg>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm truncate">{file.name}</p>
                                            <p className="text-xs text-gray-400">
                                                {(file.size / 1024).toFixed(1)} KB
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="text-xs text-gray-400 mt-3">
                                Files will be sent automatically when recipients are approved
                            </p>
                        </div>
                    </div>

                    {/* Right Panel - Devices & Approvals */}
                    <div className="space-y-4">
                        {/* Connected Devices */}
                        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 p-6">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                                    Approved Receivers
                                </h3>
                                <span className="text-xs text-gray-400">
                                    {connectedClients} connected
                                </span>
                            </div>

                            {roomUsers.length === 0 ? (
                                <p className="text-sm text-gray-400 text-center py-4">
                                    No devices connected yet
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {roomUsers.map((user) => (
                                        <div
                                            key={user.id}
                                            className="flex items-center justify-between p-4 rounded-2xl bg-gray-50 dark:bg-zinc-800"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-11 h-11 rounded-2xl bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                                                    <span className="text-sm font-semibold text-green-700 dark:text-green-300">
                                                        {user.name?.slice(0, 2).toUpperCase()}
                                                    </span>
                                                </div>

                                                <div>
                                                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                                                        {user.name}
                                                    </p>

                                                    <p className="text-xs text-gray-400 mt-0.5">
                                                        Ready to receive files
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 text-green-500">
                                                <div className="w-2 h-2 rounded-full bg-green-500" />
                                                <span className="text-xs font-medium">Connected</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Pending Approvals */}
                        {pendingUsers.length > 0 && (
                            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 p-6">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                                        Join Requests ({pendingUsers.length})
                                    </h3>
                                    <button
                                        onClick={() => {
                                            log("Manual refresh pending users");
                                        }}
                                        className="text-xs text-gray-400 hover:text-gray-600"
                                    >
                                        Refresh
                                    </button>
                                </div>
                                {pendingUsers.map((user) => (
                                    <div
                                        key={`pending-${user.id}`}
                                        className="p-4 rounded-2xl border border-yellow-200 dark:border-yellow-900 bg-yellow-50 dark:bg-yellow-950/20 mb-3"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-11 h-11 rounded-2xl bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
                                                    <span className="text-sm font-semibold text-yellow-700 dark:text-yellow-300">
                                                        {user.name?.slice(0, 2).toUpperCase()}
                                                    </span>
                                                </div>

                                                <div>
                                                    <p className="font-semibold text-sm text-gray-900 dark:text-white">
                                                        {user.name}
                                                    </p>

                                                    <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">
                                                        Wants to receive your files
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => rejectUser(user.id)}
                                                    className="px-4 py-2 text-xs font-medium bg-gray-200 dark:bg-zinc-700 rounded-full hover:bg-gray-300 transition"
                                                >
                                                    Decline
                                                </button>

                                                <button
                                                    onClick={() => approveUser(user.id)}
                                                    className="px-4 py-2 text-xs font-medium bg-green-600 text-white rounded-full hover:bg-green-700 transition"
                                                >
                                                    Approve
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}
