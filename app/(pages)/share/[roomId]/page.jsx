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
    const [textMessages, setTextMessages] = useState([]);
    const [textInput, setTextInput] = useState("");
    const [activeTab, setActiveTab] = useState("files");
    const [toast, setToast] = useState(null);
    const [unreadMessages, setUnreadMessages] = useState(0);

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
    const textMessagesEndRef = useRef(null);
    const toastTimerRef = useRef(null);
    const isChatVisibleRef = useRef(false);

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

    const formatBytes = (bytes) => {
        if (!bytes) return "0 B";
        const units = ["B", "KB", "MB", "GB"];
        let i = 0;
        while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
        return `${bytes.toFixed(1)} ${units[i]}`;
    };

    const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const showToast = useCallback((msg, type = "info") => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast({ msg, type, id: Date.now() });
        toastTimerRef.current = setTimeout(() => setToast(null), 2500);
    }, []);

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
            channel.onmessage = async (event) => {
                if (typeof event.data === "string") {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.type === "text-message") {
                            setTextMessages((prev) => [
                                ...prev,
                                {
                                    id: data.messageId || Date.now(),
                                    content: data.content,
                                    senderName: data.senderName || "Unknown",
                                    senderId: peerId,
                                    timestamp: data.timestamp || Date.now(),
                                    isMine: false,
                                },
                            ]);
                            if (!isChatVisibleRef.current) {
                                setUnreadMessages((prev) => prev + 1);
                            }
                        } else if (data.type === "pong") {
                            // pong response, ignore
                        }
                    } catch (e) {
                        console.error("Failed to parse message:", e);
                    }
                    return;
                }
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

    // Auto-scroll to bottom of text messages
    useEffect(() => {
        if (textMessagesEndRef.current) {
            textMessagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [textMessages]);

    useEffect(() => {
        isChatVisibleRef.current = activeTab === "chat";
        if (activeTab === "chat") setUnreadMessages(0);
    }, [activeTab]);

    const copyMessageText = useCallback((content) => {
        navigator.clipboard.writeText(content);
        showToast("Copied to clipboard", "success");
    }, [showToast]);

    const sendTextMessage = useCallback(() => {
        const text = textInput.trim();
        if (!text) return;

        const targets = roomUsers.map((u) => u.id);
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
                    senderId: myId,
                    timestamp: Date.now(),
                    isMine: true,
                },
            ]);
            setTextInput("");
        } else {
            log("No connected peers to send text to");
        }
    }, [textInput, roomUsers, deviceName, myId, log]);

    const handleTextKeyDown = useCallback((e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendTextMessage();
        }
    }, [sendTextMessage]);

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

            <div className="max-w-4xl mx-auto px-4 py-6 sm:py-10">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <Link href="/share" className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                        </Link>
                        <div>
                            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Ready to Share</h1>
                            <p className="text-[12px] text-gray-400">{files.length} file(s) · {formatBytes(totalSize)}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${status === "Ready" ? "bg-green-500" : "bg-yellow-500 animate-pulse"}`} />
                        <span className="text-[12px] text-gray-500">{status}</span>
                    </div>
                </div>

                <div className="grid md:grid-cols-[1fr_1fr] gap-4">
                    {/* Left Panel */}
                    <div className="space-y-3">
                        {/* QR Code */}
                        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 p-5 text-center">
                            <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-3">Scan to Receive</p>
                            <div className="bg-white p-3 rounded-xl inline-block">
                                <QRCode value={clientUrl} size={150} />
                            </div>
                            <button
                                onClick={() => { navigator.clipboard.writeText(clientUrl); showToast("Invite link copied!", "success"); }}
                                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-zinc-800 text-[12px] font-medium hover:bg-gray-200 dark:hover:bg-zinc-700 transition cursor-pointer"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                Copy Invite Link
                            </button>
                        </div>

                        {/* Files */}
                        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 overflow-hidden">
                            <div className="px-4 pt-4 pb-2">
                                <p className="text-[10px] font-medium tracking-widest uppercase text-gray-400">Files Ready</p>
                            </div>
                            <div className="divide-y divide-gray-100 dark:divide-zinc-800 max-h-[200px] overflow-y-auto">
                                {files.map((file, idx) => (
                                    <div key={idx} className="px-4 py-2.5 flex items-center gap-2">
                                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[13px] truncate">{file.name}</p>
                                            <p className="text-[11px] text-gray-400">{formatBytes(file.size)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="px-4 py-2.5 border-t border-gray-100 dark:border-zinc-800">
                                <p className="text-[11px] text-gray-400">Auto-sent when recipients are approved</p>
                            </div>
                        </div>

                        {/* Transfers */}
                        {transfers.length > 0 && (
                            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 overflow-hidden">
                                <div className="px-4 pt-4 pb-2">
                                    <p className="text-[10px] font-medium tracking-widest uppercase text-gray-400">Transfers</p>
                                </div>
                                <div className="divide-y divide-gray-100 dark:divide-zinc-800 max-h-[200px] overflow-y-auto">
                                    {transfers.map((item) => (
                                        <div key={item.id} className="px-4 py-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-[13px] font-medium truncate">{item.name}</p>
                                                <span className="text-[12px] font-mono flex-shrink-0">{item.done ? "✓" : `${item.progress}%`}</span>
                                            </div>
                                            <div className="mt-2 h-1 rounded-full bg-gray-100 dark:bg-zinc-800 overflow-hidden">
                                                <div className={`h-full rounded-full transition-all ${item.done ? "bg-green-500" : "bg-black dark:bg-white"}`} style={{ width: `${item.progress}%` }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right Panel */}
                    <div className="space-y-3">
                        {/* Tab Bar */}
                        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl p-1.5 flex gap-1">
                            <button onClick={() => setActiveTab("devices")} className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-medium transition-all cursor-pointer ${activeTab === "devices" ? "bg-black dark:bg-white text-white dark:text-black shadow-sm" : "text-gray-500 hover:bg-gray-50 dark:hover:bg-zinc-800"}`}>
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
                                Devices
                            </button>
                            <button onClick={() => setActiveTab("chat")} className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-medium transition-all cursor-pointer relative ${activeTab === "chat" ? "bg-black dark:bg-white text-white dark:text-black shadow-sm" : "text-gray-500 hover:bg-gray-50 dark:hover:bg-zinc-800"}`}>
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
                                Chat
                                {unreadMessages > 0 && (
                                    <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full px-0.5">
                                        {unreadMessages > 99 ? '99+' : unreadMessages}
                                    </span>
                                )}
                            </button>
                        </div>

                        {/* DEVICES TAB */}
                        {activeTab === "devices" && (
                            <div className="space-y-3">
                                {/* Approved Receivers */}
                                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 overflow-hidden">
                                    <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                                        <p className="text-[10px] font-medium tracking-widest uppercase text-gray-400">Receivers</p>
                                        <span className="text-[11px] text-gray-400">{connectedClients} connected</span>
                                    </div>
                                    <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                                        {roomUsers.length === 0 && (
                                            <p className="text-[13px] text-gray-400 text-center py-6">No devices connected yet</p>
                                        )}
                                        {roomUsers.map((user) => (
                                            <div key={user.id} className="px-4 py-3 flex items-center gap-2.5">
                                                <div className="w-9 h-9 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center text-[11px] font-semibold text-green-700 dark:text-green-300">
                                                    {user.name?.slice(0, 2).toUpperCase()}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[13px] font-medium text-gray-900 dark:text-white truncate">{user.name}</p>
                                                    <p className="text-[11px] text-gray-400">Ready to receive</p>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                                    <span className="text-[10px] font-medium text-green-600">Connected</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Pending */}
                                {pendingUsers.length > 0 && (
                                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 overflow-hidden">
                                        <div className="px-4 pt-4 pb-2">
                                            <p className="text-[10px] font-medium tracking-widest uppercase text-gray-400">Join Requests ({pendingUsers.length})</p>
                                        </div>
                                        {pendingUsers.map((user) => (
                                            <div key={`pending-${user.id}`} className="px-4 py-3 flex items-center gap-2.5 border-t border-yellow-100 dark:border-yellow-900/30 bg-yellow-50/50 dark:bg-yellow-950/10">
                                                <div className="w-9 h-9 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center text-[11px] font-semibold text-yellow-700 dark:text-yellow-300">
                                                    {user.name?.slice(0, 2).toUpperCase()}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[13px] font-medium text-gray-900 dark:text-white truncate">{user.name}</p>
                                                    <p className="text-[11px] text-yellow-600 dark:text-yellow-400">Wants to receive files</p>
                                                </div>
                                                <div className="flex gap-1.5">
                                                    <button onClick={() => rejectUser(user.id)} className="px-2.5 py-1 text-[11px] font-medium bg-gray-200 dark:bg-zinc-700 rounded-lg hover:bg-gray-300 transition cursor-pointer">Decline</button>
                                                    <button onClick={() => approveUser(user.id)} className="px-2.5 py-1 text-[11px] font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition cursor-pointer">Approve</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* CHAT TAB */}
                        {activeTab === "chat" && (
                            <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl overflow-hidden flex flex-col" style={{ minHeight: '400px' }}>
                                <div className="flex-1 overflow-y-auto px-4 py-3" style={{ maxHeight: 'calc(100vh - 320px)' }}>
                                    {textMessages.length === 0 && (
                                        <div className="flex flex-col items-center justify-center py-16 text-center">
                                            <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-zinc-800 flex items-center justify-center mb-3">
                                                <svg className="w-7 h-7 text-gray-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
                                            </div>
                                            <p className="text-[13px] font-medium text-gray-500">No messages yet</p>
                                            <p className="text-[11px] text-gray-400 mt-1">Chat with connected receivers</p>
                                        </div>
                                    )}
                                    {textMessages.map((msg, idx) => {
                                        const prevMsg = idx > 0 ? textMessages[idx - 1] : null;
                                        const sameSender = prevMsg && prevMsg.senderId === msg.senderId && (msg.timestamp - prevMsg.timestamp < 2 * 60 * 1000);
                                        return (
                                            <div key={msg.id} className={`flex ${msg.isMine ? 'justify-end' : 'justify-start'} ${sameSender ? 'mt-0.5' : 'mt-2'}`}>
                                                <div className={`max-w-[80%]`}>
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
                                    {roomUsers.length === 0 && (
                                        <p className="text-[11px] text-gray-400 text-center mb-2">Approve receivers to start chatting</p>
                                    )}
                                    <div className="flex items-end gap-2">
                                        <textarea
                                            value={textInput} onChange={(e) => setTextInput(e.target.value)}
                                            onKeyDown={roomUsers.length > 0 ? handleTextKeyDown : undefined}
                                            placeholder={roomUsers.length > 0 ? "Type a message..." : "No receivers yet..."}
                                            rows={1} disabled={roomUsers.length === 0}
                                            className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 px-3.5 py-2.5 text-[13px] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                            style={{ minHeight: '40px', maxHeight: '120px' }}
                                            onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
                                        />
                                        <button onClick={sendTextMessage} disabled={roomUsers.length === 0 || !textInput.trim()}
                                            className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${roomUsers.length > 0 && textInput.trim() ? 'bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-100 cursor-pointer active:scale-95' : 'bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-600 cursor-not-allowed'}`}>
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}
