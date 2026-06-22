"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import { rtcConfig } from "@/libs/webrtc";
import Link from "next/link";

const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const shouldShowTimeDivider = (prevMsg, currMsg) => {
    if (!prevMsg) return true;
    return currMsg.timestamp - prevMsg.timestamp > 5 * 60 * 1000;
};

export default function RoomPage() {
    const params = useParams();
    const router = useRouter();
    const roomId = params.roomId;
    const roomUrl = typeof window !== "undefined" ? window.location.href : "";

    // States
    const [isDragging, setIsDragging] = useState(false);
    const [myId, setMyId] = useState(null);
    const [isHost, setIsHost] = useState(false);
    const [status, setStatus] = useState("Connecting...");
    const [roomUsers, setRoomUsers] = useState([]);
    const [pendingUsers, setPendingUsers] = useState([]);
    const [messages, setMessages] = useState([]);
    const [receivedFiles, setReceivedFiles] = useState([]);
    const [transfers, setTransfers] = useState([]);
    const [selectedTargets, setSelectedTargets] = useState(["all"]);
    const [deviceName, setDeviceName] = useState("");
    const [isHydrated, setIsHydrated] = useState(false);
    const [approvalStatus, setApprovalStatus] = useState("pending");
    const [isApproved, setIsApproved] = useState(false);
    const [textMessages, setTextMessages] = useState([]);
    const [textInput, setTextInput] = useState("");
    const [activeTab, setActiveTab] = useState("files");
    const [toast, setToast] = useState(null);
    const [unreadMessages, setUnreadMessages] = useState(0);

    // Refs
    const deviceNameRef = useRef("");
    const wsRef = useRef(null);
    const peersRef = useRef({});
    const channelsRef = useRef({});
    const fileInputRef = useRef(null);
    const dropZoneRef = useRef(null);
    const sendingFilesRef = useRef(new Set());
    const shouldReconnect = useRef(true);
    const messagesEndRef = useRef(null);
    const toastTimerRef = useRef(null);
    const isChatVisibleRef = useRef(false);

    const connectedClients = useMemo(() => {
        return roomUsers.filter((u) => u.role === "client").length;
    }, [roomUsers]);

    const isConnected = useMemo(() => {
        return isHost || (!isHost && isApproved);
    }, [isHost, isApproved]);

    const availableTargets = useMemo(() => {
        if (isHost) {
            return roomUsers.filter((u) => u.role === "client" && u.id !== myId);
        } else {
            return roomUsers.filter((u) => u.role === "host");
        }
    }, [roomUsers, isHost, myId]);

    const displayTargets = useMemo(() => {
        if (isHost) {
            return roomUsers.filter((u) => u.role === "client");
        } else {
            return roomUsers.filter((u) => u.role === "host");
        }
    }, [roomUsers, isHost]);

    const showToast = useCallback((msg, type = "info") => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast({ msg, type, id: Date.now() });
        toastTimerRef.current = setTimeout(() => setToast(null), 2500);
    }, []);

    const generateRandomName = useCallback(() => {
        const adjectives = [
            "Blue", "Silver", "Neon", "Green", "Red", "Golden", "Crimson", "Scarlet", "Violet", "Purple",
            "Indigo", "Teal", "Cyan", "Magenta", "Rose", "Amber", "Emerald", "Sapphire", "Ruby", "Onyx",
            "Shadow", "Swift", "Brave", "Clever", "Mighty", "Noble", "Wise", "Fierce", "Gentle", "Loyal",
            "Silent", "Quick", "Bold", "Calm", "Wild", "Storm", "Thunder", "Lightning", "Crystal", "Iron",
            "Ancient", "Mystic", "Legendary", "Cosmic", "Stellar", "Phantom", "Enchanted", "Magical",
            "Wild", "Forest", "Ocean", "Solar", "Lunar", "Aurora", "Eclipse",
            "Cyber", "Digital", "Quantum", "Atomic", "Laser", "Plasma", "Rocket", "Turbo",
            "Blazing", "Brilliant", "Cosmic", "Drifting", "Electric", "Flashing", "Hyper",
            "Infinite", "Jade", "Kinetic", "Luminous", "Magnetic", "Nebular", "Orbital",
            "Prismatic", "Radiant", "Shifting", "Turbo", "Ultra", "Vivid", "Warp"
        ];
        const nouns = [
            "Phoenix", "Tiger", "Eagle", "Wolf", "Dragon", "Knight", "Panda", "Fox", "Falcon", "Bear",
            "Griffin", "Pegasus", "Unicorn", "Hydra", "Sphinx", "Centaur",
            "Warrior", "Mage", "Wizard", "Ranger", "Berserker", "Guardian", "Samurai", "Ninja",
            "Wraith", "Specter", "Angel", "Valkyrie", "Golem",
            "Storm", "Flame", "Frost", "Ember", "Spark",
            "Star", "Moon", "Comet", "Meteor", "Galaxy", "Nebula",
            "Forest", "Mountain", "River", "Ocean", "Glacier", "Waterfall",
            "Blade", "Shield", "Armor", "Arrow",
            "Drake", "Wyrm", "Mech", "Drone", "Orbit", "Pulsar", "Quasar"
        ];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        return `${adj} ${noun}`;
    }, []);

    const avatarColors = useMemo(() => [
        "bg-blue-100 text-blue-700",
        "bg-orange-100 text-orange-700",
        "bg-purple-100 text-purple-700",
        "bg-emerald-100 text-emerald-700",
        "bg-rose-100 text-rose-700",
    ], []);

    const getInitials = useCallback((name = "") => {
        return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    }, []);

    const log = useCallback((msg) => {
        setMessages((prev) => [
            `[${new Date().toLocaleTimeString()}] ${msg}`,
            ...prev.slice(0, 99),
        ]);
    }, []);

    // ============================================================
    // DATA CHANNEL SETUP
    // ============================================================

    const setupDataChannel = useCallback((channel, peerId) => {
        channelsRef.current[peerId] = channel;
        channel.binaryType = "arraybuffer";

        channel.onopen = () => {
            log(`Data channel connected to ${peerId}`);
        };

        channel.onclose = () => {
            log(`Data channel disconnected from ${peerId}`);
        };

        channel.onerror = (error) => {
            log(`Data channel error: ${error.message}`);
        };

        channel.onmessage = async (event) => {
            if (typeof event.data === "string") {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === "file-meta") {
                        channelsRef.current[peerId]._incomingFile = {
                            name: data.name,
                            size: data.size,
                            type: data.mime,
                            buffers: [],
                            fileId: data.fileId,
                        };
                        log(`Receiving ${data.name} (${formatBytes(data.size)})`);
                    } else if (data.type === "text-message") {
                        const newMsg = {
                            id: data.messageId || Date.now(),
                            content: data.content,
                            senderName: data.senderName || "Unknown",
                            senderId: peerId,
                            timestamp: data.timestamp || Date.now(),
                            isMine: false,
                        };
                        setTextMessages((prev) => [...prev, newMsg]);
                        // Track unread if chat tab not active
                        if (!isChatVisibleRef.current) {
                            setUnreadMessages((prev) => prev + 1);
                        }
                    }
                } catch (e) {
                    console.error("Failed to parse message:", e);
                }
                return;
            }

            const fileData = channelsRef.current[peerId]?._incomingFile;
            if (!fileData) return;

            fileData.buffers.push(event.data);
            const receivedSize = fileData.buffers.reduce((acc, b) => acc + b.byteLength, 0);

            setTransfers((prev) => {
                const transferId = `${peerId}-${fileData.name}`;
                const existing = prev.find(t => t.id === transferId);
                const progress = Math.floor((receivedSize / fileData.size) * 100);
                if (existing) {
                    return prev.map(t => t.id === transferId ? { ...t, progress, received: receivedSize } : t);
                }
                return [...prev, {
                    id: transferId, name: fileData.name, from: peerId, to: deviceName,
                    progress, speed: "Receiving...", done: false, size: fileData.size, received: receivedSize
                }];
            });

            if (receivedSize >= fileData.size) {
                const blob = new Blob(fileData.buffers, { type: fileData.type });
                const url = URL.createObjectURL(blob);
                setReceivedFiles((prev) => [
                    { id: Date.now(), name: fileData.name, url, size: fileData.size, type: fileData.type, receivedAt: new Date() },
                    ...prev,
                ]);
                log(`✓ ${fileData.name} received completely`);
                showToast(`Received: ${fileData.name}`, "success");
                delete channelsRef.current[peerId]._incomingFile;
                setTransfers((prev) => prev.map(t =>
                    t.id === `${peerId}-${fileData.name}` ? { ...t, done: true, progress: 100, speed: "Completed" } : t
                ));
            }
        };
    }, [log, deviceName, showToast]);

    // ============================================================
    // PEER CONNECTION
    // ============================================================

    const createPeer = useCallback((targetId) => {
        const peer = new RTCPeerConnection(rtcConfig);
        peersRef.current[targetId] = peer;
        peer.onicecandidate = (event) => {
            if (!event.candidate) return;
            wsRef.current.send(JSON.stringify({
                type: "signal", targetId, payload: { type: "ice", candidate: event.candidate },
            }));
        };
        peer.oniceconnectionstatechange = () => {
            log(`ICE connection state for ${targetId}: ${peer.iceConnectionState}`);
        };
        peer.ondatachannel = (event) => {
            setupDataChannel(event.channel, targetId);
        };
        return peer;
    }, [setupDataChannel, log]);

    const connectToPeer = useCallback(async (targetId) => {
        const peer = createPeer(targetId);
        const channel = peer.createDataChannel("file");
        setupDataChannel(channel, targetId);
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        wsRef.current.send(JSON.stringify({
            type: "signal", targetId, payload: { type: "offer", offer },
        }));
        log(`Connecting to peer ${targetId}...`);
    }, [createPeer, setupDataChannel, log]);

    // ============================================================
    // SIGNAL HANDLING
    // ============================================================

    const handleSignal = useCallback(async (data) => {
        const fromId = data.fromId;
        let peer = peersRef.current[fromId];
        if (!peer) peer = createPeer(fromId);
        const payload = data.payload;

        if (payload.type === "offer") {
            await peer.setRemoteDescription(new RTCSessionDescription(payload.offer));
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            wsRef.current.send(JSON.stringify({
                type: "signal", targetId: fromId, payload: { type: "answer", answer },
            }));
            log(`Responded to connection from ${fromId}`);
            return;
        }
        if (payload.type === "answer") {
            await peer.setRemoteDescription(new RTCSessionDescription(payload.answer));
            log(`Connection established with ${fromId}`);
            return;
        }
        if (payload.type === "ice") {
            try { await peer.addIceCandidate(new RTCIceCandidate(payload.candidate)); }
            catch (e) { console.error("Error adding ICE candidate:", e); }
            return;
        }
    }, [createPeer, log]);

    // ============================================================
    // SEND FILES
    // ============================================================

    const sendSingleFile = useCallback(async (targetId, file) => {
        const fileKey = `${targetId}-${file.name}`;
        if (sendingFilesRef.current.has(fileKey)) return;
        sendingFilesRef.current.add(fileKey);

        const channel = channelsRef.current[targetId];
        if (!channel || channel.readyState !== "open") {
            sendingFilesRef.current.delete(fileKey);
            return;
        }

        const fileId = `${targetId}-${file.name}-${Date.now()}`;
        let startTime = Date.now();
        let bytesSent = 0;
        let lastProgressUpdate = 0;

        channel.send(JSON.stringify({ type: "file-meta", name: file.name, size: file.size, mime: file.type, fileId }));

        setTransfers((prev) => {
            const exists = prev.find(t => t.id === fileId);
            if (exists) return prev;
            return [{ id: fileId, name: file.name, from: deviceName, to: targetId, progress: 0, speed: "0 B/s", done: false, size: file.size, sent: 0 }, ...prev];
        });

        const chunkSize = 64 * 1024;
        let offset = 0;

        while (offset < file.size) {
            if (channel.bufferedAmount > 1024 * 1024) {
                await new Promise(resolve => setTimeout(resolve, 50));
                continue;
            }
            const end = Math.min(offset + chunkSize, file.size);
            const slice = file.slice(offset, end);
            const buffer = await slice.arrayBuffer();
            channel.send(buffer);
            bytesSent += buffer.byteLength;
            offset = end;

            const currentProgress = Math.floor((bytesSent / file.size) * 100);
            const now = Date.now();
            const elapsed = (now - startTime) / 1000;
            let currentSpeed = "0 B/s";
            if (elapsed > 0.1) currentSpeed = `${formatBytes(bytesSent / elapsed)}/s`;

            if (currentProgress !== lastProgressUpdate && (currentProgress % 2 === 0 || now - lastProgressUpdate > 500)) {
                lastProgressUpdate = currentProgress;
                setTransfers((prev) => prev.map((t) =>
                    t.id === fileId ? { ...t, progress: Math.min(currentProgress, 100), speed: currentSpeed, sent: bytesSent } : t
                ));
            }
        }

        setTransfers((prev) => prev.map((t) => t.id === fileId ? { ...t, progress: 100, done: true, speed: "Completed" } : t));
        log(`✓ ${file.name} sent to ${targetId}`);
        showToast(`Sent: ${file.name}`, "success");
        sendingFilesRef.current.delete(fileKey);
    }, [log, deviceName, showToast]);

    const sendFiles = useCallback(async (files) => {
        if (files.length === 0) return;
        let targets = [];
        if (isHost) {
            targets = selectedTargets.includes("all") ? availableTargets.map((u) => u.id) : selectedTargets;
        } else {
            const host = roomUsers.find((u) => u.role === "host");
            if (host) targets = [host.id];
        }
        if (targets.length === 0) { log("No targets available"); return; }
        log(`Sending ${files.length} file(s) to ${targets.length} target(s)`);

        const sendTasks = [];
        for (const targetId of targets) {
            const channel = channelsRef.current[targetId];
            if (!channel || channel.readyState !== "open") { log(`Channel not ready for ${targetId}, skipping...`); continue; }
            if (!channel._queue) channel._queue = [];
            for (const file of files) channel._queue.push(file);
            const processQueue = async () => {
                if (channel._isSending) return;
                channel._isSending = true;
                while (channel._queue.length > 0) {
                    const fileToSend = channel._queue.shift();
                    try { await sendSingleFile(targetId, fileToSend); }
                    catch (err) { console.error(`Error sending to ${targetId}:`, err); }
                }
                channel._isSending = false;
            };
            sendTasks.push(processQueue());
        }
        await Promise.all(sendTasks);
        log("All files queued/sent!");
    }, [selectedTargets, availableTargets, sendSingleFile, log, isHost, roomUsers]);

    // ============================================================
    // DRAG & DROP HANDLERS
    // ============================================================

    const handleDragEnter = useCallback((e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }, []);
    const handleDragLeave = useCallback((e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }, []);
    const handleDragOver = useCallback((e) => { e.preventDefault(); e.stopPropagation(); if (!isDragging) setIsDragging(true); }, [isDragging]);
    const handleDrop = useCallback(async (e) => {
        e.preventDefault(); e.stopPropagation(); setIsDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) await sendFiles(files);
    }, [sendFiles]);
    const handleFileSelect = useCallback(async (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) await sendFiles(files);
        if (fileInputRef.current) fileInputRef.current.value = null;
    }, [sendFiles]);

    // ============================================================
    // ROOM ACTIONS
    // ============================================================

    const approveUser = useCallback(async (targetId) => {
        setPendingUsers((prev) => prev.filter((u) => u.id !== targetId));
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "approve-user", targetId }));
        }
        await connectToPeer(targetId);
        log(`Approved user to join`);
    }, [connectToPeer, log]);

    const rejectUser = useCallback((targetId) => {
        setPendingUsers((prev) => prev.filter((u) => u.id !== targetId));
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "reject-user", targetId }));
        }
        log(`Rejected user`);
    }, [log]);

    const toggleTarget = useCallback((id) => {
        if (!isHost) return;
        if (id === "all") { setSelectedTargets(["all"]); return; }
        let next = selectedTargets.filter((t) => t !== "all");
        if (next.includes(id)) next = next.filter((t) => t !== id);
        else next.push(id);
        if (next.length === 0) next = ["all"];
        setSelectedTargets(next);
    }, [selectedTargets, isHost]);

    // ============================================================
    // TEXT MESSAGING
    // ============================================================

    const sendTextMessage = useCallback(() => {
        const text = textInput.trim();
        if (!text) return;

        let targets = [];
        if (isHost) {
            targets = selectedTargets.includes("all") ? availableTargets.map((u) => u.id) : selectedTargets;
        } else {
            const host = roomUsers.find((u) => u.role === "host");
            if (host) targets = [host.id];
        }

        if (targets.length === 0) {
            showToast("No connected peers to send to", "warn");
            return;
        }

        const messageId = `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const message = { type: "text-message", content: text, messageId, timestamp: Date.now(), senderName: deviceName };

        let sentCount = 0;
        for (const targetId of targets) {
            const channel = channelsRef.current[targetId];
            if (channel && channel.readyState === "open") {
                channel.send(JSON.stringify(message));
                sentCount++;
            }
        }

        if (sentCount > 0) {
            setTextMessages((prev) => [...prev, {
                id: messageId, content: text, senderName: deviceName, senderId: myId, timestamp: Date.now(), isMine: true,
            }]);
            setTextInput("");
        } else {
            showToast("Failed to send — no active connections", "warn");
        }
    }, [textInput, isHost, selectedTargets, availableTargets, roomUsers, deviceName, myId, showToast]);

    const handleTextKeyDown = useCallback((e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTextMessage(); }
    }, [sendTextMessage]);

    const copyMessageText = useCallback((content) => {
        navigator.clipboard.writeText(content);
        showToast("Copied to clipboard", "success");
    }, [showToast]);

    const copyRoomUrl = useCallback(() => {
        navigator.clipboard.writeText(roomUrl);
        showToast("Room URL copied!", "success");
    }, [roomUrl, showToast]);

    const refreshPendingUsers = useCallback(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "get-pending-users", roomId }));
        }
    }, [roomId]);

    // Track chat tab visibility for unread count
    useEffect(() => {
        isChatVisibleRef.current = activeTab === "chat";
        if (activeTab === "chat") setUnreadMessages(0);
    }, [activeTab]);

    // ============================================================
    // WEBSOCKET SETUP
    // ============================================================

    useEffect(() => {
        if (!isHost && availableTargets.length > 0) setSelectedTargets([availableTargets[0].id]);
        else if (isHost) setSelectedTargets(["all"]);
    }, [isHost, availableTargets]);

    useEffect(() => {
        const savedName = localStorage.getItem("fyDrop_deviceName");
        let name;
        if (savedName) name = savedName;
        else { name = generateRandomName(); localStorage.setItem("fyDrop_deviceName", name); }
        setDeviceName(name);
        deviceNameRef.current = name;
        setIsHydrated(true);
    }, [generateRandomName]);

    useEffect(() => {
        if (!deviceName || !isHydrated) return;
        const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
        if (!wsUrl) { console.error("WebSocket URL is not defined"); setStatus("Configuration Error"); return; }

        let ws = null;
        let reconnectTimeout = null;
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 5;
        const isMounted = { current: true };

        const connectWebSocket = () => {
            try {
                ws = new WebSocket(wsUrl);
                wsRef.current = ws;
                ws.onopen = () => {
                    setStatus("Connected"); reconnectAttempts = 0;
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: "join-room", roomId, name: deviceName, mode: "full" }));
                    }
                };
                ws.onmessage = async (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        switch (data.type) {
                            case "joined-as-host": setMyId(data.id); setIsHost(true); setIsApproved(true); setApprovalStatus("approved"); setStatus("Connected as Host"); log("You are the host"); break;
                            case "approved": setMyId(data.id); setIsApproved(true); setApprovalStatus("approved"); setStatus("Connected & Approved"); log("Approved to join"); break;
                            case "pending-users-update": setPendingUsers((prev) => { const n = data.pending || []; return JSON.stringify(prev) === JSON.stringify(n) ? prev : n; }); break;
                            case "join-request": setPendingUsers((prev) => { if (prev.some(u => u.id === data.id)) return prev; log(`${data.name} wants to join`); return [...prev, { id: data.id, name: data.name }]; }); break;
                            case "room-users": setRoomUsers(Array.from(new Map(data.users.map(u => [u.id, u])).values())); break;
                            case "signal": await handleSignal(data); break;
                            case "room-closed": alert("Room closed by host"); setStatus("Disconnected");
                                Object.values(peersRef.current).forEach(p => { try { if (p.signalingState !== "closed") p.close(); } catch (e) { } });
                                peersRef.current = {}; channelsRef.current = {};
                                setTimeout(() => router.push("/"), 1000); break;
                            case "rejected":
                                Object.values(peersRef.current).forEach(p => { try { if (p.signalingState !== "closed") p.close(); } catch (e) { } });
                                peersRef.current = {}; channelsRef.current = {};
                                if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.close(1000, "Rejected");
                                sessionStorage.setItem("rejectMessage", data.message || "Rejected by host");
                                sessionStorage.setItem("rejectTimestamp", Date.now().toString());
                                router.push("/"); break;
                            case "error": console.error("Server error:", data.message); log(`Error: ${data.message}`);
                                if (data.message.includes("full") || data.message.includes("limit") || data.message.includes("mode")) { alert(data.message); setTimeout(() => router.push("/"), 2000); } break;
                            case "user-connected": setRoomUsers(prev => prev.map(u => u.id === data.userId ? { ...u, connected: true, lastSeen: Date.now() } : u)); log(`User ${data.userName || data.userId} connected`); break;
                            case "user-disconnected": setRoomUsers(prev => prev.map(u => u.id === data.userId ? { ...u, connected: false, lastSeen: Date.now() } : u)); log(`User ${data.userName || data.userId} disconnected`); break;
                            case "room-mode-mismatch": {
                                shouldReconnect.current = false; reconnectAttempts = maxReconnectAttempts; isMounted.current = false;
                                if (ws) { ws.onclose = null; ws.close(); }
                                const em = data.expectedMode; const ri = data.roomId;
                                if (em === "share" || em === "receive") router.push(`/receive/${ri}`);
                                else router.push("/");
                                return;
                            }
                            default: break;
                        }
                    } catch (error) { console.error("Error parsing WS message:", error); }
                };
                ws.onclose = (event) => {
                    if (!isMounted.current || !shouldReconnect.current) return;
                    setStatus("Disconnected"); log("Disconnected");
                    if (reconnectAttempts < maxReconnectAttempts && event.code !== 1000) {
                        reconnectTimeout = setTimeout(() => { reconnectAttempts++; connectWebSocket(); }, 3000 * reconnectAttempts);
                    }
                };
                ws.onerror = () => { setStatus("Connection Error"); log("WebSocket connection error"); };
            } catch (error) { setStatus("Connection Failed"); log(`Failed: ${error.message}`); }
        };
        connectWebSocket();
        return () => {
            isMounted.current = false; shouldReconnect.current = false;
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            if (ws?.readyState === WebSocket.OPEN) {
                try { ws.send(JSON.stringify({ type: "leave-room", roomId })); } catch (e) { }
                ws.onclose = null; ws.close(1000, "Unmounting");
            }
            Object.values(peersRef.current).forEach(p => { try { if (p.signalingState !== "closed") p.close(); } catch (e) { } });
            peersRef.current = {}; channelsRef.current = {};
        };
    }, [roomId, handleSignal, log, deviceName, isHydrated]);

    // Auto-scroll
    useEffect(() => {
        if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }, [textMessages]);

    // ============================================================
    // UI
    // ============================================================

    if (!isHydrated) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-8 h-8 border-2 border-gray-300 border-t-black rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-500">Loading...</p>
                </div>
            </div>
        );
    }

    const statusColor = status === "Connected" || status === "Connected & Approved" || status === "Connected as Host"
        ? "bg-green-500" : status === "Rejected by Host" || status === "Disconnected" || status === "Connection Error"
        ? "bg-red-500" : "bg-yellow-500 animate-pulse";

    const statusText = status === "Connecting..." ? "Connecting..." :
        status === "Connected" && !isApproved ? "Waiting for approval..." :
        status === "Connected & Approved" ? "Connected" :
        status === "Connected as Host" ? "Host Mode" :
        status === "Rejected by Host" ? "Rejected" :
        status === "Disconnected" ? "Disconnected" :
        status === "Connection Error" ? "Connection Error" :
        status === "Configuration Error" ? "Config Error" : status;

    return (
        <main className="min-h-screen bg-gray-50 dark:bg-zinc-950 pb-20 sm:pb-10">
            {/* TOAST */}
            {toast && (
                <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium transition-all animate-[fadeIn_0.2s_ease-out] ${
                    toast.type === "success" ? "bg-green-600 text-white" :
                    toast.type === "warn" ? "bg-yellow-500 text-white" :
                    "bg-black dark:bg-white text-white dark:text-black"
                }`}>
                    {toast.msg}
                </div>
            )}

            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
                {/* TOPBAR */}
                <div className="flex items-center justify-between mb-6 sm:mb-8">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 dark:bg-white rounded-xl flex items-center justify-center blur-[2px] brightness-75">
                            <svg width="900" height="900" viewBox="0 0 900 900" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="455" y="121.921" width="66.8412" height="94.23" fill="#9CD7E4"/>
                                <rect x="650.565" y="403.117" width="66.8412" height="94.23" fill="#9CD7E4"/>
                                <path d="M287.033 215.634H787.018L612.961 684.366H112.977L287.033 215.634Z" fill="#0B4957"/>
                            </svg>
                        </div>
                        <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
                            <Link href="/">fyDrop</Link>
                        </h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${statusColor}`} />
                        <span className="text-xs text-gray-500 dark:text-zinc-400">{statusText}</span>
                    </div>
                </div>

                {/* GRID */}
                <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
                    {/* SIDEBAR */}
                    <div className="space-y-3">
                        {/* SESSION CARD */}
                        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl overflow-hidden">
                            <div className="px-4 pt-4 pb-3">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-[15px] font-medium text-gray-900 dark:text-white truncate">{deviceName}</p>
                                        <p className="text-[12px] font-mono text-gray-400 dark:text-zinc-500 mt-0.5 truncate">room / {roomId}</p>
                                    </div>
                                    {isConnected && (
                                        <div className="px-2.5 py-1 rounded-full bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 text-[11px] font-medium whitespace-nowrap flex items-center gap-1.5">
                                            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                            {connectedClients} {connectedClients === 1 ? 'device' : 'devices'}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {isHost && (
                                <>
                                    <div className="h-px bg-gray-100 dark:bg-zinc-800" />
                                    <div className="px-4 py-4 flex flex-col items-center gap-3">
                                        <div className="p-2.5 border border-gray-100 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-950">
                                            <QRCode value={roomUrl} size={140} />
                                        </div>
                                        <p className="text-sm font-medium text-gray-900 dark:text-white">Invite devices</p>
                                        <p className="text-[12px] text-gray-400 text-center">Scan QR or share the link</p>
                                        <button
                                            onClick={copyRoomUrl}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-zinc-800 rounded-lg text-[12px] font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                            Copy link
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* DEVICES */}
                            <div className="h-px bg-gray-100 dark:bg-zinc-800" />
                            <div className="px-4 py-3">
                                <p className="text-[10px] font-medium tracking-widest uppercase text-gray-400 dark:text-zinc-500 mb-2">Devices</p>
                                <div className="space-y-1.5">
                                    {roomUsers.length === 0 && (
                                        <p className="text-[13px] text-gray-400 text-center py-3">No devices connected</p>
                                    )}
                                    {roomUsers.map((user, i) => (
                                        <div key={user.id + i} className={`flex items-center gap-2.5 p-2 rounded-xl ${!isHost && user.role === "host" ? "bg-gray-50 dark:bg-zinc-800" : ""}`}>
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-medium ${avatarColors[i % avatarColors.length]}`}>
                                                {getInitials(user.name)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <p className="text-[13px] font-medium text-gray-900 dark:text-white truncate">{user.name}</p>
                                                    {user.role === "host" && (
                                                        <span className="px-1 py-0.5 rounded bg-black dark:bg-white text-white dark:text-black text-[8px] font-bold">HOST</span>
                                                    )}
                                                </div>
                                                <p className="text-[11px] text-gray-400">{user.connected !== false ? "Connected" : "Connecting..."}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* JOIN REQUEST */}
                        {isHost && pendingUsers.length > 0 && (
                            <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl overflow-hidden">
                                <div className="flex justify-between items-center px-4 pt-4 pb-2">
                                    <p className="text-[10px] font-medium tracking-widest uppercase text-gray-400">Join requests ({pendingUsers.length})</p>
                                    <button onClick={refreshPendingUsers} className="text-[11px] text-gray-400 hover:text-gray-600 cursor-pointer">Refresh</button>
                                </div>
                                {pendingUsers.map((user) => (
                                    <div key={user.id} className="px-4 py-2.5 flex items-center gap-2.5 border-t border-gray-100 dark:border-zinc-800">
                                        <div className="w-8 h-8 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center text-[11px] font-medium text-yellow-700 dark:text-yellow-300">
                                            {getInitials(user.name)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[13px] font-medium text-gray-900 dark:text-white truncate">{user.name}</p>
                                            <p className="text-[11px] text-gray-400">Wants to join</p>
                                        </div>
                                        <div className="flex gap-1.5">
                                            <button onClick={() => rejectUser(user.id)} className="px-2.5 py-1 bg-gray-100 dark:bg-zinc-800 rounded-lg text-[11px] font-medium hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer">Reject</button>
                                            <button onClick={() => approveUser(user.id)} className="px-2.5 py-1 bg-black dark:bg-white text-white dark:text-black rounded-lg text-[11px] font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors cursor-pointer">Approve</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* CONTENT */}
                    <div className="space-y-3">
                        {/* TAB BAR */}
                        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl p-1.5 flex gap-1">
                            <button
                                onClick={() => setActiveTab("files")}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium transition-all cursor-pointer ${
                                    activeTab === "files"
                                        ? "bg-black dark:bg-white text-white dark:text-black shadow-sm"
                                        : "text-gray-500 hover:text-gray-700 dark:hover:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800"
                                }`}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                                Files
                            </button>
                            <button
                                onClick={() => setActiveTab("chat")}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium transition-all cursor-pointer relative ${
                                    activeTab === "chat"
                                        ? "bg-black dark:bg-white text-white dark:text-black shadow-sm"
                                        : "text-gray-500 hover:text-gray-700 dark:hover:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800"
                                }`}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
                                Chat
                                {unreadMessages > 0 && (
                                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
                                        {unreadMessages > 99 ? '99+' : unreadMessages}
                                    </span>
                                )}
                            </button>
                        </div>

                        {/* FILES TAB */}
                        {activeTab === "files" && (
                            <div className="space-y-3">
                                {/* DROPZONE */}
                                {(isHost || (!isHost && availableTargets.length > 0)) && (
                                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 overflow-hidden">
                                        <div className="px-4 pt-4 pb-2">
                                            {/* TARGETS */}
                                            {isHost && (
                                                <div className="flex flex-wrap gap-1.5 mb-3">
                                                    <button onClick={() => toggleTarget("all")} className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${selectedTargets.includes("all") ? "bg-black dark:bg-white text-white dark:text-black" : "bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700"}`}>
                                                        Everyone ({availableTargets.length})
                                                    </button>
                                                    {availableTargets.map((user) => (
                                                        <button key={user.id} onClick={() => toggleTarget(user.id)} className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${selectedTargets.includes(user.id) ? "bg-black dark:bg-white text-white dark:text-black" : "bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700"}`}>
                                                            {user.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            {!isHost && availableTargets.length > 0 && (
                                                <div className="flex items-center gap-1.5 mb-3">
                                                    <span className="text-[11px] text-gray-400">Sending to:</span>
                                                    {availableTargets.map((u) => (
                                                        <span key={u.id} className="px-2 py-0.5 rounded-full bg-black dark:bg-white text-white dark:text-black text-[10px] font-medium">{u.name}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        {availableTargets.length !== 0 ? (
                                            <div ref={dropZoneRef} onClick={() => fileInputRef.current?.click()} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop} className="px-4 pb-4">
                                                <div className={`border-[1.5px] border-dashed rounded-2xl py-10 flex flex-col items-center gap-2 cursor-pointer transition-all duration-200 ${isDragging ? 'border-black dark:border-white bg-gray-50 dark:bg-zinc-800 scale-[1.01]' : 'border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800'}`}>
                                                    <svg className={`w-8 h-8 transition-all ${isDragging ? 'text-black dark:text-white' : 'text-gray-300 dark:text-zinc-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                                        {isDragging ? (
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                                                        ) : (
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                                                        )}
                                                    </svg>
                                                    <p className="text-[14px] font-medium text-gray-700 dark:text-zinc-300">{isDragging ? "Drop files here" : "Drop files here"}</p>
                                                    <p className="text-[12px] text-gray-400">{isDragging ? "Release to upload" : "or click to browse"}</p>
                                                    <span className="mt-1 inline-flex items-center gap-1 px-3 py-1.5 bg-black dark:bg-white text-white dark:text-black rounded-full text-[12px] font-medium">
                                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                                                        Choose files
                                                    </span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="px-4 pb-4">
                                                <p className="text-[12px] text-yellow-600 dark:text-yellow-400 text-center py-6">
                                                    {isHost ? "No clients connected yet" : "Waiting for host connection..."}
                                                </p>
                                            </div>
                                        )}
                                        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
                                    </div>
                                )}

                                {/* TRANSFERS */}
                                <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl overflow-hidden">
                                    <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                                        <div>
                                            <p className="text-[10px] font-medium tracking-widest uppercase text-gray-400">Transfers</p>
                                            <p className="text-[11px] text-gray-400 mt-0.5">{transfers.filter(t => !t.done).length} active, {transfers.filter(t => t.done).length} done</p>
                                        </div>
                                        {transfers.length > 0 && (
                                            <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-[11px] font-medium text-gray-500">{transfers.length}</span>
                                        )}
                                    </div>
                                    <div className="divide-y divide-gray-100 dark:divide-zinc-800 max-h-[300px] overflow-y-auto">
                                        {transfers.length === 0 && (
                                            <div className="p-6 text-center">
                                                <svg className="w-10 h-10 text-gray-200 dark:text-zinc-700 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4" /></svg>
                                                <p className="text-[13px] text-gray-400">No active transfers</p>
                                            </div>
                                        )}
                                        {transfers.map((item) => (
                                            <div key={item.id} className="px-4 py-3">
                                                <div className="flex items-start gap-2.5">
                                                    <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                                                        <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <p className="text-[13px] font-medium text-gray-900 dark:text-white truncate">{item.name}</p>
                                                            <span className="text-[12px] font-mono font-medium flex-shrink-0">{item.done ? "✓" : `${item.progress}%`}</span>
                                                        </div>
                                                        <p className="text-[11px] text-gray-400 mt-0.5">{item.from} → {item.to}</p>
                                                        {!item.done && item.size && (
                                                            <p className="text-[11px] text-gray-400 mt-0.5">{formatBytes(item.sent || 0)} / {formatBytes(item.size)} · {item.speed}</p>
                                                        )}
                                                        <div className="mt-2 h-1 rounded-full bg-gray-100 dark:bg-zinc-800 overflow-hidden">
                                                            <div className={`h-full rounded-full transition-all duration-300 ${item.done ? "bg-green-500" : "bg-black dark:bg-white"}`} style={{ width: `${item.progress}%` }} />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* RECEIVED FILES */}
                                <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl overflow-hidden">
                                    <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                                        <p className="text-[10px] font-medium tracking-widest uppercase text-gray-400">Received</p>
                                        {receivedFiles.length > 0 && (
                                            <button onClick={() => { receivedFiles.forEach(f => URL.revokeObjectURL(f.url)); setReceivedFiles([]); }} className="text-[11px] text-red-500 hover:text-red-600 cursor-pointer">Clear all</button>
                                        )}
                                    </div>
                                    <div className="divide-y divide-gray-100 dark:divide-zinc-800 max-h-[250px] overflow-y-auto">
                                        {receivedFiles.length === 0 && (
                                            <div className="p-6 text-center">
                                                <svg className="w-10 h-10 text-gray-200 dark:text-zinc-700 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                                <p className="text-[13px] text-gray-400">No files received yet</p>
                                            </div>
                                        )}
                                        {receivedFiles.map((file, idx) => (
                                            <div key={`${file.id}-${file.name}-${idx}`} className="px-4 py-3 flex items-center gap-2.5">
                                                <div className="w-9 h-9 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                                                    <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[13px] font-medium text-gray-900 dark:text-white truncate">{file.name}</p>
                                                    <p className="text-[11px] text-gray-400 mt-0.5">{formatBytes(file.size)} · {formatTime(file.receivedAt)}</p>
                                                </div>
                                                <a href={file.url} download={file.name} className="px-2.5 py-1 bg-black dark:bg-white text-white dark:text-black rounded-lg text-[11px] font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors flex items-center gap-1">
                                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                                    Save
                                                </a>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* CHAT TAB */}
                        {activeTab === "chat" && (
                            <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl overflow-hidden flex flex-col" style={{ minHeight: 'calc(100vh - 200px)' }}>
                                {/* Messages */}
                                <div className="flex-1 overflow-y-auto px-4 py-3" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                                    {textMessages.length === 0 && (
                                        <div className="flex flex-col items-center justify-center py-16 text-center">
                                            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
                                                <svg className="w-8 h-8 text-gray-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
                                            </div>
                                            <p className="text-[14px] font-medium text-gray-500 dark:text-zinc-400">No messages yet</p>
                                            <p className="text-[12px] text-gray-400 mt-1">Start a conversation below</p>
                                        </div>
                                    )}

                                    {textMessages.map((msg, idx) => {
                                        const prevMsg = idx > 0 ? textMessages[idx - 1] : null;
                                        const showDivider = shouldShowTimeDivider(prevMsg, msg);
                                        const sameSender = prevMsg && prevMsg.senderId === msg.senderId && (msg.timestamp - prevMsg.timestamp < 2 * 60 * 1000);

                                        return (
                                            <div key={msg.id}>
                                                {showDivider && (
                                                    <div className="flex items-center gap-3 py-4">
                                                        <div className="flex-1 h-px bg-gray-100 dark:bg-zinc-800" />
                                                        <span className="text-[10px] text-gray-400 dark:text-zinc-500 font-medium">
                                                            {new Date(msg.timestamp).toLocaleDateString() === new Date().toLocaleDateString()
                                                                ? formatTime(msg.timestamp)
                                                                : new Date(msg.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + formatTime(msg.timestamp)}
                                                        </span>
                                                        <div className="flex-1 h-px bg-gray-100 dark:bg-zinc-800" />
                                                    </div>
                                                )}
                                                <div className={`flex ${msg.isMine ? 'justify-end' : 'justify-start'} ${sameSender && !showDivider ? 'mt-0.5' : 'mt-2'}`}>
                                                    <div className={`max-w-[80%] sm:max-w-[70%] ${msg.isMine ? 'items-end' : 'items-start'}`}>
                                                        {!sameSender && (
                                                            <p className="text-[10px] text-gray-400 dark:text-zinc-500 mb-1 px-1">{msg.isMine ? 'You' : msg.senderName}</p>
                                                        )}
                                                        <div
                                                            onClick={() => copyMessageText(msg.content)}
                                                            className={`px-3 py-1.5 rounded-2xl break-words whitespace-pre-wrap cursor-pointer active:scale-[0.98] transition-transform ${
                                                                msg.isMine
                                                                    ? 'bg-black dark:bg-white text-white dark:text-black rounded-br-sm'
                                                                    : 'bg-gray-100 dark:bg-zinc-800 text-gray-900 dark:text-white rounded-bl-sm'
                                                            }`}
                                                            title="Click to copy"
                                                        >
                                                            <p className="text-[13px] leading-relaxed">{msg.content}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <div ref={messagesEndRef} />
                                </div>

                                {/* INPUT - always visible, disabled when not connected */}
                                <div className="border-t border-gray-100 dark:border-zinc-800 p-3">
                                    {!isConnected && (
                                        <p className="text-[11px] text-gray-400 dark:text-zinc-500 text-center mb-2">Connect to a peer to start chatting</p>
                                    )}
                                    <div className="flex items-end gap-2">
                                        <textarea
                                            value={textInput}
                                            onChange={(e) => setTextInput(e.target.value)}
                                            onKeyDown={isConnected ? handleTextKeyDown : undefined}
                                            placeholder={isConnected ? "Type a message..." : "Waiting for connection..."}
                                            rows={1}
                                            disabled={!isConnected}
                                            className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 px-3.5 py-2.5 text-[13px] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                            style={{ minHeight: '40px', maxHeight: '120px' }}
                                            onInput={(e) => {
                                                e.target.style.height = 'auto';
                                                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                                            }}
                                        />
                                        <button
                                            onClick={sendTextMessage}
                                            disabled={!isConnected || !textInput.trim()}
                                            className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                                                isConnected && textInput.trim()
                                                    ? 'bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-100 cursor-pointer active:scale-95'
                                                    : 'bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-600 cursor-not-allowed'
                                            }`}
                                        >
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
