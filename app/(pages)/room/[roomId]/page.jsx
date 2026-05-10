"use client";

import { useEffect, useRef, useState } from "react";

import { useParams } from "next/navigation";

import QRCode from "react-qr-code";
import { rtcConfig } from "@/libs/webrtc";

const adjectives = [
    "Blue",
    "Silver",
    "Neon",
    "Green",
    "Red",
    "Golden",
    "Shadow",
];

const animals = [
    "Tiger",
    "Panda",
    "Wolf",
    "Fox",
    "Eagle",
    "Falcon",
    "Bear",
];

function generateRandomName() {
    const adjective =
        adjectives[
        Math.floor(
            Math.random() * adjectives.length
        )
        ];

    const animal =
        animals[
        Math.floor(
            Math.random() * animals.length
        )
        ];

    return `${adjective} ${animal}`;
}

export default function RoomPage() {
    const params = useParams();

    const roomId = params.roomId;

    const [mounted, setMounted] = useState(false);

    const [socket, setSocket] = useState(null);

    const [messages, setMessages] = useState([]);

    const [status, setStatus] =
        useState("Idle");

    const [roomUsers, setRoomUsers] =
        useState([]);

    const [pendingUsers, setPendingUsers] =
        useState([]);

    const [locked, setLocked] =
        useState(false);

    const [isHost, setIsHost] =
        useState(false);

    const [approved, setApproved] =
        useState(false);

    const [connected, setConnected] =
        useState(false);

    const [receivedFiles, setReceivedFiles] =
        useState([]);

    const peerRef = useRef(null);

    const dataChannelRef = useRef(null);

    const clientId = useRef(null);

    const incomingFileInfo = useRef(null);

    const fileInputRef = useRef(null);

    const incomingChunks = useRef([]);

    const deviceName = useRef(
        generateRandomName()
    );

    const roomUrl =
        typeof window !== "undefined"
            ? window.location.href
            : "";

    // =====================================
    // INIT
    // =====================================

    useEffect(() => {
        setMounted(true);

        clientId.current =
            crypto.randomUUID();

        const ws = new WebSocket(
            process.env.NEXT_PUBLIC_WS_URL
        );

        ws.onopen = async () => {
            setStatus(
                "Connected to signaling server"
            );

            ws.send(
                JSON.stringify({
                    type: "join-room",
                    roomId,
                    name: deviceName.current,
                })
            );

            const peer =
                new RTCPeerConnection(
                    rtcConfig
                );

            peerRef.current = peer;

            peer.onconnectionstatechange =
                () => {
                    setStatus(
                        `P2P: ${peer.connectionState}`
                    );

                    if (
                        peer.connectionState ===
                        "connected"
                    ) {
                        setConnected(true);
                    }
                };

            peer.onicecandidate = (
                event
            ) => {
                if (event.candidate) {
                    ws.send(
                        JSON.stringify({
                            sender:
                                clientId.current,
                            type: "candidate",
                            candidate:
                                event.candidate,
                        })
                    );
                }
            };

            // RECEIVE DATA CHANNEL
            peer.ondatachannel = (
                event
            ) => {
                const channel =
                    event.channel;

                setupDataChannel(channel);
            };

            setSocket(ws);
        };

        // =====================================
        // SOCKET MESSAGE
        // =====================================

        ws.onmessage = async (event) => {
            const data = JSON.parse(
                event.data
            );

            // HOST
            if (
                data.type ===
                "joined-as-host"
            ) {
                setIsHost(true);

                setApproved(true);

                setStatus(
                    "You are host"
                );

                return;
            }

            // JOIN REQUEST
            if (
                data.type ===
                "join-request"
            ) {
                setPendingUsers(
                    (prev) => [
                        ...prev,
                        {
                            id: data.id,
                            name: data.name,
                        },
                    ]
                );

                return;
            }

            // APPROVED
            if (
                data.type === "approved"
            ) {
                setApproved(true);

                setStatus(
                    "Approved by host"
                );

                return;
            }

            // REJECTED
            if (
                data.type === "rejected"
            ) {
                setStatus(
                    "Rejected by host"
                );

                return;
            }

            // ROOM LOCKED
            if (
                data.type ===
                "room-locked"
            ) {
                setStatus(
                    "Room locked"
                );

                return;
            }

            // ROOM CLOSED
            if (
                data.type ===
                "room-closed"
            ) {
                setStatus(
                    "Room closed"
                );

                return;
            }

            // ROOM USERS
            if (
                data.type ===
                "room-users"
            ) {
                setRoomUsers(
                    data.users
                );

                setLocked(
                    data.locked
                );

                return;
            }

            // ignore own
            if (
                data.sender ===
                clientId.current
            ) {
                return;
            }

            const peer =
                peerRef.current;

            // OFFER
            if (
                data.type === "offer"
            ) {
                if (
                    peer.signalingState !==
                    "stable"
                )
                    return;

                setStatus(
                    "Receiving offer..."
                );

                await peer.setRemoteDescription(
                    new RTCSessionDescription(
                        data.offer
                    )
                );

                const answer =
                    await peer.createAnswer();

                await peer.setLocalDescription(
                    answer
                );

                ws.send(
                    JSON.stringify({
                        sender:
                            clientId.current,
                        type: "answer",
                        answer,
                    })
                );
            }

            // ANSWER
            if (
                data.type === "answer"
            ) {
                if (
                    peer.signalingState !==
                    "have-local-offer"
                )
                    return;

                await peer.setRemoteDescription(
                    new RTCSessionDescription(
                        data.answer
                    )
                );
            }

            // CANDIDATE
            if (
                data.type ===
                "candidate"
            ) {
                try {
                    await peer.addIceCandidate(
                        new RTCIceCandidate(
                            data.candidate
                        )
                    );
                } catch (err) {
                    console.error(
                        err
                    );
                }
            }
        };

        return () => {
            ws.close();
        };
    }, [roomId]);

    // =====================================
    // AUTO CONNECT
    // =====================================

    useEffect(() => {
        if (
            approved &&
            isHost &&
            roomUsers.length >= 2 &&
            !connected
        ) {
            createConnection();
        }
    }, [
        approved,
        isHost,
        roomUsers,
        connected,
    ]);

    // =====================================
    // SETUP DATA CHANNEL
    // =====================================

    const setupDataChannel = (
        channel
    ) => {
        dataChannelRef.current =
            channel;

        channel.binaryType =
            "arraybuffer";

        channel.onopen = () => {
            setStatus(
                "P2P: connected"
            );

            setConnected(true);
        };

        channel.onmessage = async (
            event
        ) => {
            // JSON message
            if (
                typeof event.data ===
                "string"
            ) {
                const data =
                    JSON.parse(
                        event.data
                    );

                // FILE INFO
                if (
                    data.type ===
                    "file-info"
                ) {
                    incomingFileInfo.current =
                        data;

                    incomingChunks.current =
                        [];

                    setMessages(
                        (prev) => [
                            ...prev,
                            `Receiving ${data.name}`,
                        ]
                    );

                    return;
                }

                // FILE END
                if (
                    data.type ===
                    "file-end"
                ) {
                    const blob =
                        new Blob(
                            incomingChunks.current
                        );

                    const url =
                        URL.createObjectURL(
                            blob
                        );

                    setReceivedFiles(
                        (prev) => [
                            ...prev,
                            {
                                name: incomingFileInfo
                                    .current
                                    .name,
                                url,
                            },
                        ]
                    );

                    setMessages(
                        (prev) => [
                            ...prev,
                            `Received ${incomingFileInfo.current.name}`,
                        ]
                    );

                    incomingChunks.current =
                        [];

                    return;
                }
            }

            // BINARY CHUNK
            incomingChunks.current.push(
                event.data
            );
        };
    };

    // =====================================
    // APPROVE USER
    // =====================================

    const approveUser = (
        targetId
    ) => {
        socket.send(
            JSON.stringify({
                type: "approve-user",
                targetId,
            })
        );

        setPendingUsers(
            (prev) =>
                prev.filter(
                    (user) =>
                        user.id !==
                        targetId
                )
        );
    };

    // =====================================
    // REJECT USER
    // =====================================

    const rejectUser = (
        targetId
    ) => {
        socket.send(
            JSON.stringify({
                type: "reject-user",
                targetId,
            })
        );

        setPendingUsers(
            (prev) =>
                prev.filter(
                    (user) =>
                        user.id !==
                        targetId
                )
        );
    };

    // =====================================
    // CREATE CONNECTION
    // =====================================

    const createConnection =
        async () => {
            const peer =
                peerRef.current;

            if (
                dataChannelRef.current
            )
                return;

            setStatus(
                "Creating WebRTC connection..."
            );

            const channel =
                peer.createDataChannel(
                    "file-transfer"
                );

            setupDataChannel(channel);

            const offer =
                await peer.createOffer();

            await peer.setLocalDescription(
                offer
            );

            socket.send(
                JSON.stringify({
                    sender:
                        clientId.current,
                    type: "offer",
                    offer,
                })
            );
        };

    // =====================================
    // SEND FILE
    // =====================================

    const sendFile = async (
        file
    ) => {
        const channel =
            dataChannelRef.current;

        if (
            !channel ||
            channel.readyState !==
            "open"
        ) {
            return;
        }

        const chunkSize =
            64 * 1024;

        // send file info
        channel.send(
            JSON.stringify({
                type: "file-info",
                name: file.name,
                size: file.size,
            })
        );

        let offset = 0;

        while (
            offset < file.size
        ) {
            const slice =
                file.slice(
                    offset,
                    offset + chunkSize
                );

            const buffer =
                await slice.arrayBuffer();

            channel.send(buffer);

            offset += chunkSize;
        }

        // file end
        channel.send(
            JSON.stringify({
                type: "file-end",
            })
        );

        setMessages((prev) => [
            ...prev,
            `Sent ${file.name}`,
        ]);
    };

    // =====================================
    // DROP FILE
    // =====================================

    const handleDrop = async (
        event
    ) => {
        event.preventDefault();

        const files =
            event.dataTransfer.files;

        if (!files.length) return;

        for (const file of files) {
            await sendFile(file);
        }
    };

    const handleFileSelect = async (
        event
    ) => {
        const files =
            event.target.files;

        if (!files.length) return;

        for (const file of files) {
            await sendFile(file);
        }

        event.target.value = "";
    };

    // =====================================
    // HYDRATION FIX
    // =====================================

    if (!mounted) return null;

    return (
        <main className="min-h-screen bg-gray-950 text-white p-10">
            <div className="max-w-4xl mx-auto space-y-6">
                <h1 className="text-4xl font-bold">
                    FIPE
                </h1>

                {/* INFO */}

                <div className="bg-gray-900 rounded-2xl p-6 space-y-3">
                    <p>
                        Device:
                        {" "}
                        <span className="text-green-400">
                            {
                                deviceName.current
                            }
                        </span>
                    </p>

                    <p className="text-blue-400 break-all">
                        Room:
                        <br />
                        {roomId}
                    </p>

                    <p>
                        Status:
                        {" "}
                        <span className="text-yellow-400">
                            {status}
                        </span>
                    </p>

                    <p>
                        Connected:
                        {" "}
                        {connected
                            ? "Yes"
                            : "No"}
                    </p>
                </div>

                {/* QR */}

                {!locked &&
                    !connected && (
                        <div className="bg-gray-900 rounded-2xl p-6 space-y-5">
                            <h2 className="text-2xl font-bold">
                                Scan to Join
                            </h2>

                            <div className="bg-white p-4 rounded-xl w-fit">
                                <QRCode
                                    value={
                                        roomUrl
                                    }
                                    size={
                                        220
                                    }
                                />
                            </div>

                            <p className="text-gray-400 break-all">
                                {
                                    roomUrl
                                }
                            </p>
                        </div>
                    )}

                {/* ROOM USERS */}

                <div className="bg-gray-900 rounded-2xl p-6 space-y-3">
                    <h2 className="text-2xl font-bold">
                        Devices
                    </h2>

                    {roomUsers.map(
                        (user) => (
                            <div
                                key={
                                    user.id
                                }
                                className="bg-gray-800 p-3 rounded-xl"
                            >
                                {
                                    user.name
                                }
                            </div>
                        )
                    )}
                </div>

                {/* PENDING */}

                {isHost &&
                    pendingUsers.length >
                    0 && (
                        <div className="bg-gray-900 rounded-2xl p-6 space-y-4">
                            <h2 className="text-2xl font-bold">
                                Join Requests
                            </h2>

                            {pendingUsers.map(
                                (
                                    user
                                ) => (
                                    <div
                                        key={
                                            user.id
                                        }
                                        className="bg-gray-800 rounded-xl p-4 flex justify-between items-center"
                                    >
                                        <p>
                                            {
                                                user.name
                                            }
                                        </p>

                                        <div className="flex gap-3">
                                            <button
                                                onClick={() =>
                                                    approveUser(
                                                        user.id
                                                    )
                                                }
                                                className="bg-green-500 px-4 py-2 rounded-xl"
                                            >
                                                Accept
                                            </button>

                                            <button
                                                onClick={() =>
                                                    rejectUser(
                                                        user.id
                                                    )
                                                }
                                                className="bg-red-500 px-4 py-2 rounded-xl"
                                            >
                                                Reject
                                            </button>
                                        </div>
                                    </div>
                                )
                            )}
                        </div>
                    )}

                {/* FILE TRANSFER */}

                {connected && (
                    <div className="bg-gray-900 rounded-2xl p-6 space-y-5">
                        <h2 className="text-2xl font-bold">
                            File Transfer
                        </h2>

                        <div
                            onDragOver={(e) =>
                                e.preventDefault()
                            }
                            onDrop={handleDrop}
                            onClick={() =>
                                fileInputRef.current?.click()
                            }
                            className="border-2 border-dashed border-gray-600 rounded-2xl p-16 text-center cursor-pointer hover:border-orange-500 transition"
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                className="hidden"
                                onChange={handleFileSelect}
                            />

                            <p className="text-xl">
                                Drop file here
                            </p>

                            <p className="text-gray-400 mt-2">
                                Drag & drop or click to select files
                            </p>
                        </div>
                    </div>
                )}

                {/* RECEIVED FILES */}

                {receivedFiles.length >
                    0 && (
                        <div className="bg-gray-900 rounded-2xl p-6 space-y-4">
                            <h2 className="text-2xl font-bold">
                                Received Files
                            </h2>

                            {receivedFiles.map(
                                (
                                    file,
                                    index
                                ) => (
                                    <a
                                        key={
                                            index
                                        }
                                        href={
                                            file.url
                                        }
                                        download={
                                            file.name
                                        }
                                        className="block bg-gray-800 p-4 rounded-xl hover:bg-gray-700"
                                    >
                                        Download{" "}
                                        {
                                            file.name
                                        }
                                    </a>
                                )
                            )}
                        </div>
                    )}

                {/* LOG */}

                <div className="bg-gray-900 rounded-2xl p-6 space-y-3">
                    <h2 className="text-2xl font-bold">
                        Activity
                    </h2>

                    {messages.map(
                        (
                            msg,
                            index
                        ) => (
                            <div
                                key={index}
                                className="bg-gray-800 p-3 rounded-xl"
                            >
                                {msg}
                            </div>
                        )
                    )}
                </div>
            </div>
        </main>
    );
}
