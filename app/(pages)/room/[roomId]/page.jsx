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
    const [approvalStatus, setApprovalStatus] = useState("pending"); // pending, approved, rejected
    const [isApproved, setIsApproved] = useState(false);
    const [textMessages, setTextMessages] = useState([]);
    const [textInput, setTextInput] = useState("");
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

    const connectedClients = useMemo(() => {
        return roomUsers.filter((u) => u.role === "client").length;
    }, [roomUsers]);

    const availableTargets = useMemo(() => {
        if (isHost) {
            // Host bisa kirim ke semua client (kecuali dirinya sendiri)
            return roomUsers.filter((u) => u.role === "client" && u.id !== myId);
        } else {
            // Client bisa kirim ke host
            return roomUsers.filter((u) => u.role === "host");
        }
    }, [roomUsers, isHost, myId]);

    // Untuk display di UI (nama-nama target)
    const displayTargets = useMemo(() => {
        if (isHost) {
            return roomUsers.filter((u) => u.role === "client");
        } else {
            return roomUsers.filter((u) => u.role === "host");
        }
    }, [roomUsers, isHost]);

    const generateRandomName = useCallback(() => {
        const adjectives = [
            // Colors
            "Blue", "Silver", "Neon", "Green", "Red", "Golden", "Crimson", "Scarlet", "Violet", "Purple",
            "Indigo", "Teal", "Cyan", "Magenta", "Rose", "Amber", "Emerald", "Sapphire", "Ruby", "Onyx",
            "Ivory", "Pearl", "Coral", "Lavender", "Mauve", "Turquoise", "Azure", "Cerulean", "Chartreuse",
            "Fuchsia", "Lilac", "Maroon", "Olive", "Orchid", "Plum", "Tan", "Wheat",

            // Qualities
            "Shadow", "Swift", "Brave", "Clever", "Mighty", "Noble", "Wise", "Fierce", "Gentle", "Loyal",
            "Silent", "Quick", "Bold", "Calm", "Wild", "Savage", "Kind", "Dark", "Light", "Bright",
            "Storm", "Thunder", "Lightning", "Blizzard", "Hurricane", "Typhoon", "Tornado", "Volcano",
            "Crystal", "Iron", "Steel", "Bronze", "Titanium", "Obsidian", "Granite", "Marble",

            // Mythical & Fantasy
            "Ancient", "Mystic", "Legendary", "Mythical", "Divine", "Eternal", "Immortal", "Celestial",
            "Cosmic", "Galactic", "Stellar", "Astral", "Ethereal", "Phantom", "Ghostly", "Spirit",
            "Enchanted", "Magical", "Arcane", "Sorcerer", "Wizardly", "Druidic", "Runic",

            // Nature
            "Wild", "Forest", "Mountain", "Ocean", "River", "Desert", "Jungle", "Arctic", "Tropical",
            "Solar", "Lunar", "Starry", "Comet", "Meteor", "Aurora", "Eclipse", "Equinox",

            // Action
            "Running", "Flying", "Hunting", "Racing", "Leaping", "Soaring", "Diving", "Swimming",
            "Roaring", "Howling", "Screaming", "Whispering", "Sleeping", "Dreaming",

            // Tech
            "Cyber", "Digital", "Quantum", "Atomic", "Neon", "Laser", "Plasma", "Rocket", "Turbo",
            "Hyper", "Ultra", "Super", "Mega", "Giga", "Tera", "Infinite",

            // Descriptive
            "Abrupt", "Agile", "Alert", "Alive", "Alone", "Amused", "Angry", "Animated", "Anxious",
            "Arctic", "Arid", "Armed", "Arrogant", "Ashamed", "Aspiring", "Astonished", "Attentive",
            "Average", "Awake", "Aware", "Awesome", "Awkward", "Bad", "Balanced", "Bare", "Basic",
            "Battle", "Beaming", "Beloved", "Benevolent", "Berserk", "Big", "Bitter", "Bizarre",

            // More
            "Blazing", "Blind", "Blissful", "Blunt", "Boastful", "Bold", "Bouncy", "Boundless",
            "Brainy", "Brawny", "Breezy", "Brief", "Bright", "Brilliant", "Brisk", "Broken",
            "Brooding", "Bubbly", "Burly", "Busy", "Cagey", "Calculating", "Callous", "Capable",
            "Careful", "Careless", "Caring", "Casual", "Cautious", "Cerebral", "Charming",
            "Cheerful", "Chilled", "Chilly", "Chubby", "Civil", "Civilized", "Clammy", "Classy",
            "Clean", "Clear", "Clever", "Cloaked", "Cloudy", "Clumsy", "Coastal", "Coding",
            "Cold", "Combat", "Comfy", "Comic", "Comical", "Commando", "Common", "Complex",
            "Concerned", "Confident", "Confused", "Cool", "Cooperative", "Coordinated", "Courageous",
            "Cozy", "Crafty", "Crazy", "Creative", "Creepy", "Critical", "Crooked", "Cruel",
            "Crunchy", "Cuddly", "Curious", "Curly", "Curved", "Cute", "Damaged", "Damp",
            "Dangerous", "Dark", "Darling", "Dead", "Deadly", "Deaf", "Dear", "Deceitful",
            "Deep", "Defeated", "Defiant", "Delayed", "Delicate", "Delicious", "Delightful",
            "Dense", "Dependable", "Depressed", "Deserted", "Detailed", "Determined", "Devoted",
            "Different", "Difficult", "Digital", "Diligent", "Dim", "Dimpled", "Direct", "Dirty",
            "Discreet", "Discrete", "Dismal", "Distant", "Distinct", "Distorted", "Dizzy",
            "Dopey", "Doting", "Double", "Doubtful", "Drab", "Draconian", "Drafty", "Drained",
            "Dramatic", "Dreary", "Drenched", "Driven", "Droopy", "Drowsy", "Drunk", "Dry",
            "Dual", "Dull", "Dusty", "Dwarf", "Dying", "Dynamic", "Eager", "Early", "Earnest",
            "Earthly", "Earthy", "East", "Eastern", "Easy", "Edible", "Educated", "Eerie",
            "Efficient", "Elaborate", "Elastic", "Elderly", "Electric", "Elegant", "Elemental",
            "Elite", "Eloquent", "Empty", "Enchanted", "Enclosed", "Endless", "Enhanced",
            "Enormous", "Enraged", "Enthusiastic", "Entire", "Envious", "Epic", "Equal",
            "Erect", "Erratic", "Essential", "Eternal", "Even", "Evergreen", "Evil", "Exact",
            "Excellent", "Excited", "Exclusive", "Exotic", "Expert", "Explicit", "Exposed",
            "Express", "Exquisite", "Extended", "External", "Extra", "Extreme", "Exuberant",
            "Fabled", "Fabulous", "Facial", "Faint", "Fair", "Faithful", "Fake", "Fallen",
            "Familiar", "Famous", "Fancy", "Fantastic", "Far", "Fascinated", "Fast", "Fatal",
            "Faulty", "Fearless", "Feisty", "Feral", "Festive", "Fierce", "Fiery", "Filthy",
            "Final", "Financial", "Fine", "Firm", "First", "Fit", "Fixed", "Flaky", "Flamboyant",
            "Flare", "Flashy", "Flat", "Flawless", "Fleet", "Fleshy", "Flexible", "Flimsy",
            "Flippant", "Floppy", "Floral", "Fluffy", "Fluid", "Flustered", "Focused", "Foggy",
            "Fond", "Foolish", "Forbidden", "Forceful", "Foregoing", "Forgetful", "Forgiven"
        ];
        const nouns = [
            // Animals
            "Phoenix", "Tiger", "Eagle", "Wolf", "Dragon", "Knight", "Panda", "Fox", "Falcon", "Bear",
            "Lion", "Panther", "Leopard", "Cheetah", "Jaguar", "Hyena", "Coyote", "Jackal", "Dingo",
            "Hawk", "Owl", "Raven", "Crow", "Hawk", "Falcon", "Vulture", "Condor", "Eagle",
            "Shark", "Dolphin", "Whale", "Orca", "Octopus", "Squid", "Crab", "Lobster",
            "Python", "Cobra", "Viper", "Rattler", "Boa", "Anaconda", "Lizard", "Gecko",

            // Mythical
            "Griffin", "Pegasus", "Unicorn", "Cerberus", "Hydra", "Chimera", "Sphinx", "Minotaur",
            "Centaur", "Gorgon", "Harpy", "Manticore", "Behemoth", "Leviathan", "Kraken", "Wyvern",
            "Basilisk", "Phoenix", "Thunderbird", "Dragon", "Wyrm", "Drake", "Lindworm",

            // Warriors & Classes
            "Warrior", "Mage", "Wizard", "Sorcerer", "Warlock", "Priest", "Paladin", "Rogue",
            "Assassin", "Ranger", "Druid", "Necromancer", "Summoner", "Berserker", "Guardian",
            "Defender", "Crusader", "Templar", "Samurai", "Ninja", "Ronin", "Shogun",

            // Fantasy
            "Wraith", "Specter", "Phantom", "Ghost", "Spirit", "Demon", "Devil", "Angel", "Valkyrie",
            "Fairy", "Elf", "Dwarf", "Giant", "Orc", "Goblin", "Troll", "Ogre", "Golem",

            // Elements
            "Storm", "Thunder", "Lightning", "Blizzard", "Hurricane", "Tornado", "Cyclone",
            "Earthquake", "Volcano", "Tsunami", "Flood", "Wildfire", "Avalanche",
            "Fire", "Water", "Earth", "Air", "Wind", "Ice", "Frost", "Flame", "Ember", "Spark",
            "Crystal", "Gem", "Diamond", "Ruby", "Sapphire", "Emerald", "Topaz", "Amethyst",

            // Space & Cosmos
            "Star", "Moon", "Sun", "Comet", "Meteor", "Planet", "Galaxy", "Nebula", "Blackhole",
            "Constellation", "Asteroid", "Orbit", "Eclipse", "Supernova", "Quasar", "Pulsar",

            // Nature
            "Forest", "Mountain", "River", "Ocean", "Desert", "Jungle", "Arctic", "Tundra",
            "Valley", "Canyon", "Cave", "Cliff", "Peak", "Summit", "Glacier", "Waterfall",
            "Volcano", "Island", "Peninsula", "Archipelago", "Oasis", "Prairie", "Savanna",

            // Tech & Modern
            "Cyber", "Bot", "AI", "Android", "Cyborg", "Hacker", "Coder", "Programmer", "Developer",
            "Engineer", "Scientist", "Researcher", "Inventor", "Creator", "Builder", "Maker",

            // Abstract
            "Shadow", "Light", "Darkness", "Hope", "Fear", "Courage", "Wisdom", "Strength", "Power",
            "Speed", "Agility", "Precision", "Accuracy", "Stealth", "Magic", "Mystery", "Secret",

            // Jobs & Roles
            "Guard", "Sentinel", "Watchman", "Protector", "Savior", "Hero", "Champion", "Legend",
            "Master", "Expert", "Pro", "Veteran", "Ace", "Star", "Rockstar", "Ninja", "Guru",

            // More
            "Avenger", "Vindicator", "Executioner", "Slayer", "Hunter", "Tracker", "Scout",
            "Pathfinder", "Explorer", "Adventurer", "Pioneer", "Voyager", "Traveler", "Wanderer",
            "Nomad", "Drifter", "Outcast", "Recluse", "Hermit", "LoneWolf", "Maverick",
            "Rebel", "Outlaw", "Renegade", "Rouge", "Vagabond", "Rover", "Wayfarer",

            // Weapons
            "Blade", "Sword", "Dagger", "Spear", "Lance", "Axe", "Hammer", "Mace", "Flail",
            "Bow", "Arrow", "Crossbow", "Shield", "Armor", "Helm", "Gauntlet", "Greaves",

            // Birds
            "Hawk", "Falcon", "Eagle", "Owl", "Raven", "Crow", "Magpie", "Jay", "Hawk",
            "Vulture", "Condor", "Kestrel", "Merlin", "Peregrine", "Osprey", "Kite",

            // Big Cats
            "Lion", "Tiger", "Leopard", "Jaguar", "Panther", "Cheetah", "Cougar", "Lynx", "Bobcat",

            // Canines
            "Wolf", "Fox", "Coyote", "Jackal", "Dingo", "Hound", "Mastiff", "Husky",

            // Dragons
            "Drake", "Wyrm", "Wyvern", "Dragon", "Lindworm", "Amphiptere", "Knucker",

            // Mechanical
            "Mech", "Robot", "Android", "Cyborg", "Automaton", "Golem", "Construct", "Drone",

            // Elementals
            "Salamander", "Undine", "Sylph", "Gnome", "Ifrit", "Djinn", "Marid",

            // Undead
            "Zombie", "Skeleton", "Ghoul", "Revenant", "Lich", "Mummy", "Vampire",

            // Aquatic
            "Kraken", "Leviathan", "Serpent", "SeaMonster", "Hydra", "DragonTurtle"
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
        return name
            .split(" ")
            .map((word) => word[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();
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

            // Update receiving progress
            setTransfers((prev) => {
                const transferId = `${peerId}-${fileData.name}`;
                const existing = prev.find(t => t.id === transferId);
                const progress = Math.floor((receivedSize / fileData.size) * 100);

                if (existing) {
                    return prev.map(t =>
                        t.id === transferId
                            ? { ...t, progress, received: receivedSize }
                            : t
                    );
                }
                return [...prev, {
                    id: transferId,
                    name: fileData.name,
                    from: peerId,
                    to: deviceName,
                    progress,
                    speed: "Receiving...",
                    done: false,
                    size: fileData.size,
                    received: receivedSize
                }];
            });

            // Complete file reception
            if (receivedSize >= fileData.size) {
                const blob = new Blob(fileData.buffers, { type: fileData.type });
                const url = URL.createObjectURL(blob);
                setReceivedFiles((prev) => [
                    {
                        id: Date.now(),
                        name: fileData.name,
                        url,
                        size: fileData.size,
                        type: fileData.type,
                        receivedAt: new Date(),
                    },
                    ...prev,
                ]);
                log(`✓ ${fileData.name} received completely`);
                delete channelsRef.current[peerId]._incomingFile;

                // Mark as done in transfers
                setTransfers((prev) =>
                    prev.map(t =>
                        t.id === `${peerId}-${fileData.name}`
                            ? { ...t, done: true, progress: 100, speed: "Completed" }
                            : t
                    )
                );
            }
        };
    }, [log, deviceName]);

    // ============================================================
    // PEER CONNECTION
    // ============================================================

    const createPeer = useCallback((targetId) => {
        const peer = new RTCPeerConnection(rtcConfig);
        peersRef.current[targetId] = peer;

        peer.onicecandidate = (event) => {
            if (!event.candidate) return;
            wsRef.current.send(
                JSON.stringify({
                    type: "signal",
                    targetId,
                    payload: {
                        type: "ice",
                        candidate: event.candidate,
                    },
                })
            );
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
        log(`Connecting to peer ${targetId}...`);
    }, [createPeer, setupDataChannel, log]);

    // ============================================================
    // SIGNAL HANDLING
    // ============================================================

    const handleSignal = useCallback(async (data) => {
        const fromId = data.fromId;
        let peer = peersRef.current[fromId];

        if (!peer) {
            peer = createPeer(fromId);
        }

        const payload = data.payload;

        if (payload.type === "offer") {
            await peer.setRemoteDescription(new RTCSessionDescription(payload.offer));
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            wsRef.current.send(
                JSON.stringify({
                    type: "signal",
                    targetId: fromId,
                    payload: {
                        type: "answer",
                        answer,
                    },
                })
            );
            log(`Responded to connection from ${fromId}`);
            return;
        }

        if (payload.type === "answer") {
            await peer.setRemoteDescription(new RTCSessionDescription(payload.answer));
            log(`Connection established with ${fromId}`);
            return;
        }

        if (payload.type === "ice") {
            try {
                await peer.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } catch (e) {
                console.error("Error adding ICE candidate:", e);
            }
            return;
        }
    }, [createPeer, log]);

    // ============================================================
    // SEND FILES
    // ============================================================

    const sendSingleFile = useCallback(async (targetId, file) => {
        const fileKey = `${targetId}-${file.name}`;

        if (sendingFilesRef.current.has(fileKey)) {
            console.log(`File ${file.name} already being sent to ${targetId}`);
            return;
        }

        sendingFilesRef.current.add(fileKey);

        const channel = channelsRef.current[targetId];
        if (!channel || channel.readyState !== "open") {
            console.error(`Channel not ready for ${targetId}`);
            sendingFilesRef.current.delete(fileKey);
            return;
        }

        const fileId = `${targetId}-${file.name}-${Date.now()}`;
        let startTime = Date.now();
        let bytesSent = 0;
        let lastProgressUpdate = 0;

        // Kirim metadata
        channel.send(JSON.stringify({
            type: "file-meta",
            name: file.name,
            size: file.size,
            mime: file.type,
            fileId: fileId
        }));

        // Tambahkan ke state
        setTransfers((prev) => {
            const exists = prev.find(t => t.id === fileId);
            if (exists) return prev;

            return [{
                id: fileId,
                name: file.name,
                from: deviceName,
                to: targetId,
                progress: 0,
                speed: "0 B/s",
                done: false,
                size: file.size,
                sent: 0
            }, ...prev];
        });

        const chunkSize = 64 * 1024;
        let offset = 0;

        while (offset < file.size) {
            // Cek buffer WebRTC
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
            if (elapsed > 0.1) {
                const speedBytesPerSec = bytesSent / elapsed;
                currentSpeed = `${formatBytes(speedBytesPerSec)}/s`;
            }

            // Update progress setiap 2% atau setiap 500ms
            if (currentProgress !== lastProgressUpdate &&
                (currentProgress % 2 === 0 || now - lastProgressUpdate > 500)) {

                lastProgressUpdate = currentProgress;

                setTransfers((prev) =>
                    prev.map((t) =>
                        t.id === fileId
                            ? {
                                ...t,
                                progress: Math.min(currentProgress, 100),
                                speed: currentSpeed,
                                sent: bytesSent
                            }
                            : t
                    )
                );
            }
        }

        // Finalisasi
        setTransfers((prev) =>
            prev.map((t) =>
                t.id === fileId
                    ? {
                        ...t,
                        progress: 100,
                        done: true,
                        speed: "Completed"
                    }
                    : t
            )
        );

        log(`✓ ${file.name} sent to ${targetId}`);
        sendingFilesRef.current.delete(fileKey);
    }, [log, deviceName]);

    const sendFiles = useCallback(async (files) => {
        if (files.length === 0) return;

        let targets = [];

        if (isHost) {
            // Host: send to selected targets
            targets = selectedTargets.includes("all")
                ? availableTargets.map((u) => u.id)
                : selectedTargets;
        } else {
            // Client: send to host only
            const host = roomUsers.find((u) => u.role === "host");
            if (host) {
                targets = [host.id];
            }
        }

        if (targets.length === 0) {
            log("No targets available");
            return;
        }

        log(`Sending ${files.length} file(s) to ${targets.length} target(s)`);

        const sendTasks = [];
        for (const targetId of targets) {
            const channel = channelsRef.current[targetId];
            if (!channel || channel.readyState !== "open") {
                log(`Channel not ready for ${targetId}, skipping...`);
                continue;
            }

            // Initialize a per-channel transfer queue
            if (!channel._queue) channel._queue = [];

            // Add files to the queue
            for (const file of files) {
                channel._queue.push(file);
            }

            // Process the queue sequentially
            const processQueue = async () => {
                if (channel._isSending) return;
                channel._isSending = true;

                while (channel._queue.length > 0) {
                    const fileToSend = channel._queue.shift();
                    try {
                        await sendSingleFile(targetId, fileToSend);
                    } catch (err) {
                        console.error(`Error sending to ${targetId}:`, err);
                    }
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

    const handleDragEnter = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isDragging) setIsDragging(true);
    }, [isDragging]);

    const handleDrop = useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            await sendFiles(files);
        }
    }, [sendFiles]);

    const handleFileSelect = useCallback(async (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            await sendFiles(files);
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = null;
        }
    }, [sendFiles]);

    // ============================================================
    // ROOM ACTIONS
    // ============================================================

    const approveUser = useCallback(async (targetId) => {
        // Optimistic update - hapus dari pending dulu
        setPendingUsers((prev) => prev.filter((u) => u.id !== targetId));

        // Kirim approve ke backend
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(
                JSON.stringify({
                    type: "approve-user",
                    targetId,
                })
            );
        }

        await connectToPeer(targetId);
        log(`Approved user to join`);
    }, [connectToPeer, log]);

    const rejectUser = useCallback((targetId) => {
        console.log("Rejecting user:", targetId);
        console.log("Current pending before reject:", pendingUsers);

        // OPTIMISTIC UPDATE - Langsung hapus dari UI
        setPendingUsers((prev) => {
            const newPending = prev.filter((u) => u.id !== targetId);
            console.log("Optimistic update - new pending:", newPending);
            return newPending;
        });

        // Kirim ke backend
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(
                JSON.stringify({
                    type: "reject-user",
                    targetId,
                })
            );
            console.log("Reject message sent to backend");
        } else {
            console.error("WebSocket not ready");
        }

        log(`Rejected user`);
    }, [pendingUsers, log]);

    const toggleTarget = useCallback((id) => {
        // Client tidak bisa memilih target, hanya kirim ke host
        if (!isHost) return;

        if (id === "all") {
            setSelectedTargets(["all"]);
            return;
        }

        let next = selectedTargets.filter((t) => t !== "all");

        if (next.includes(id)) {
            next = next.filter((t) => t !== id);
        } else {
            next.push(id);
        }

        if (next.length === 0) {
            next = ["all"];
        }

        setSelectedTargets(next);
    }, [selectedTargets, isHost]);

    const sendTextMessage = useCallback(() => {
        const text = textInput.trim();
        if (!text) return;

        let targets = [];
        if (isHost) {
            targets = selectedTargets.includes("all")
                ? availableTargets.map((u) => u.id)
                : selectedTargets;
        } else {
            const host = roomUsers.find((u) => u.role === "host");
            if (host) {
                targets = [host.id];
            }
        }

        if (targets.length === 0) {
            log("No targets available to send text");
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
    }, [textInput, isHost, selectedTargets, availableTargets, roomUsers, deviceName, myId, log]);

    const handleTextKeyDown = useCallback((e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendTextMessage();
        }
    }, [sendTextMessage]);

    const copyRoomUrl = useCallback(() => {
        navigator.clipboard.writeText(roomUrl);
        log("Room URL copied to clipboard!");
    }, [roomUrl, log]);

    const refreshPendingUsers = useCallback(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            console.log("Manual refresh pending users");
            wsRef.current.send(JSON.stringify({
                type: "get-pending-users",
                roomId,
            }));
        }
    }, [roomId]);

    // useEffect(() => {
    //     if (!isHost) return;

    //     const interval = setInterval(() => {
    //         refreshPendingUsers();
    //     }, 5000);

    //     return () => clearInterval(interval);
    // }, [isHost, refreshPendingUsers]);

    // ============================================================
    // WEBSOCKET SETUP
    // ============================================================
    useEffect(() => {
        if (!isHost && availableTargets.length > 0) {
            // Client auto-select host
            setSelectedTargets([availableTargets[0].id]);
        } else if (isHost) {
            setSelectedTargets(["all"]);
        }
    }, [isHost, availableTargets]);

    useEffect(() => {
        const savedName = localStorage.getItem("fyDrop_deviceName");
        let name;

        if (savedName) {
            name = savedName;
        } else {
            name = generateRandomName();
            localStorage.setItem("fyDrop_deviceName", name);
        }

        setDeviceName(name);
        deviceNameRef.current = name;
        setIsHydrated(true);
    }, [generateRandomName]);

    // WebSocket connection
    useEffect(() => {
        if (!deviceName || !isHydrated) return;
        const wsUrl = process.env.NEXT_PUBLIC_WS_URL;

        if (!wsUrl) {
            console.error("WebSocket URL is not defined. Please set NEXT_PUBLIC_WS_URL in .env.local");
            setStatus("Configuration Error");
            return;
        }

        console.log("Connecting to WebSocket...");

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
                    console.log("WebSocket connected successfully");
                    setStatus("Connected");
                    reconnectAttempts = 0;

                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(
                            JSON.stringify({
                                type: "join-room",
                                roomId,
                                name: deviceName,
                                mode: "full", // ✅ tambahkan mode
                            })
                        );
                    }
                };

                ws.onmessage = async (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        console.log("Received message:", data.type);

                        switch (data.type) {
                            case "joined-as-host":
                                setMyId(data.id);
                                setIsHost(true);
                                setIsApproved(true);
                                setApprovalStatus("approved");
                                setStatus("Connected as Host");
                                log("You are the host of this room");
                                break;

                            case "approved":
                                setMyId(data.id);
                                setIsApproved(true);
                                setApprovalStatus("approved");
                                setStatus("Connected & Approved");
                                log("You have been approved to join the room");
                                break;

                            case "pending-users-update":
                                // Only update if there's actual change
                                setPendingUsers((prev) => {
                                    const newPending = data.pending || [];
                                    if (JSON.stringify(prev) === JSON.stringify(newPending)) return prev;
                                    return newPending;
                                });
                                break;

                            case "join-request":
                                setPendingUsers((prev) => {
                                    const exists = prev.some(u => u.id === data.id);
                                    if (exists) return prev;
                                    const newPending = [...prev, { id: data.id, name: data.name }];
                                    log(`${data.name} wants to join`);
                                    return newPending;
                                });
                                break;

                            case "room-users":
                                // Filter duplicate users efficiently
                                const uniqueUsers = Array.from(
                                    new Map(data.users.map(user => [user.id, user])).values()
                                );

                                if (uniqueUsers.length !== data.users.length) {
                                    console.warn("Duplicate users filtered:",
                                        data.users.length - uniqueUsers.length);
                                }

                                setRoomUsers(uniqueUsers);
                                break;

                            case "signal":
                                await handleSignal(data);
                                break;

                            case "room-closed":
                                // Show alert with room info
                                alert("Room has been closed by the host");
                                setStatus("Disconnected");

                                // Clean up all peers
                                const cleanupPromises = Object.values(peersRef.current).map((peer) => {
                                    return new Promise((resolve) => {
                                        try {
                                            if (peer.signalingState !== "closed") {
                                                peer.close();
                                            }
                                        } catch (e) {
                                            console.error("Error closing peer:", e);
                                        }
                                        resolve();
                                    });
                                });

                                await Promise.all(cleanupPromises);
                                peersRef.current = {};
                                channelsRef.current = {};

                                // ✅ Redirect to home after 1 second (lebih baik pakai router.push)
                                setTimeout(() => {
                                    router.push("/");
                                }, 1000);
                                break;

                            case "rejected":
                                console.log("Join request rejected by host");

                                // Clean up peers with proper error handling
                                for (const peer of Object.values(peersRef.current)) {
                                    try {
                                        if (peer.signalingState !== "closed") {
                                            peer.close();
                                        }
                                    } catch (e) {
                                        console.error("Error closing peer:", e);
                                    }
                                }
                                peersRef.current = {};
                                channelsRef.current = {};

                                // Close WebSocket connection
                                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                                    wsRef.current.close(1000, "Rejected by host");
                                }

                                // Store rejection message for home page
                                const rejectMessage = data.message || "Your join request was rejected by the host";
                                sessionStorage.setItem("rejectMessage", rejectMessage);
                                sessionStorage.setItem("rejectTimestamp", Date.now().toString());

                                // ✅ Redirect to home
                                router.push("/");
                                break;

                            case "error":
                                console.error("Server error:", data.message);
                                log(`Error: ${data.message}`);

                                // ✅ Show user-friendly error message
                                if (data.message.includes("full") || data.message.includes("limit") || data.message.includes("mode")) {
                                    alert(data.message);
                                    setTimeout(() => {
                                        router.push("/");
                                    }, 2000);
                                }
                                break;

                            case "user-connected":
                                setRoomUsers(prev => prev.map(user =>
                                    user.id === data.userId
                                        ? { ...user, connected: true, lastSeen: Date.now() }
                                        : user
                                ));
                                log(`User ${data.userName || data.userId} connected`);
                                break;

                            case "user-disconnected":
                                setRoomUsers(prev => prev.map(user =>
                                    user.id === data.userId
                                        ? { ...user, connected: false, lastSeen: Date.now() }
                                        : user
                                ));
                                log(`User ${data.userName || data.userId} disconnected`);
                                break;

                            case "room-mode-mismatch": {
                                shouldReconnect.current = false;
                                const expectedMode = data.expectedMode;
                                const roomId = data.roomId;

                                log(`Room mode mismatch. Expected: ${expectedMode}`, "warn");

                                reconnectAttempts = maxReconnectAttempts;
                                isMounted.current = false;

                                if (ws) {
                                    ws.onclose = null;
                                    ws.close();
                                }
                                if (expectedMode === "share") {
                                    router.push(`/receive/${roomId}`);
                                } else if (expectedMode === "receive") {
                                    router.push(`/receive/${roomId}`);
                                } else {
                                    router.push("/");
                                }
                                return;
                            }

                            default:
                                console.log("Unknown message type:", data.type);

                                // Optional: Log unknown types for debugging in development only
                                if (process.env.NODE_ENV === "development") {
                                    console.warn("Unhandled message type:", data.type, data);
                                }
                                break;
                        }
                    } catch (error) {
                        console.error("Error parsing WebSocket message:", error);
                    }
                };

                ws.onclose = (event) => {
                    console.log("WebSocket disconnected:", event.code, event.reason);

                    if (!isMounted.current) return;

                    // ✅ Jangan reconnect jika sudah mismatch
                    if (!shouldReconnect.current) return;

                    setStatus("Disconnected");
                    log("Disconnected from server");

                    if (reconnectAttempts < maxReconnectAttempts && event.code !== 1000) {
                        reconnectTimeout = setTimeout(() => {
                            reconnectAttempts++;
                            console.log(`Reconnecting... Attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
                            log(`Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`);
                            connectWebSocket();
                        }, 3000 * reconnectAttempts);
                    }
                };

                ws.onerror = (error) => {
                    console.error("WebSocket error details:", {
                        url: wsUrl,
                        readyState: ws.readyState,
                        error: error.message || error
                    });
                    setStatus("Connection Error");
                    log("WebSocket connection error. Check if server is running.");
                };

            } catch (error) {
                console.error("Failed to create WebSocket:", error);
                setStatus("Connection Failed");
                log(`Failed to connect: ${error.message}`);
            }
        };

        // Start connection
        connectWebSocket();

        // Cleanup function
        return () => {
            isMounted.current = false;
            shouldReconnect.current = false;

            // Clear reconnect timeout
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }

            // Close WebSocket connection
            if (ws && ws.readyState === WebSocket.OPEN) {
                // Send leave room message before closing (optional)
                try {
                    ws.send(JSON.stringify({
                        type: "leave-room",
                        roomId,
                    }));
                } catch (e) {
                    // Ignore error if can't send
                }

                ws.onclose = null; // Remove event handler to prevent reconnect attempts
                ws.close(1000, "Component unmounting"); // Normal closure
            }

            // Clean up all peer connections
            Object.values(peersRef.current).forEach((peer) => {
                try {
                    if (peer.signalingState !== "closed") {
                        peer.close();
                    }
                } catch (e) {
                    console.error("Error closing peer:", e);
                }
            });

            // Clear refs
            peersRef.current = {};
            channelsRef.current = {};

            console.log("Cleanup complete");
        };
    }, [roomId, handleSignal, log, deviceName, isHydrated]);

    useEffect(() => {
        console.log("Pending users updated:", pendingUsers);
    }, [pendingUsers]);

    // Auto-scroll to bottom of text messages
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [textMessages]);

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

    // ============================================================
    // UI
    // ============================================================

    return (
        <main className="min-h-screen bg-gray-50 dark:bg-zinc-950 px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
            <div className="max-w-6xl mx-auto space-y-3">

                {/* TOPBAR */}
                <div className="flex flex-col items-center gap-2 mb-8 sm:mb-10">
                    <div className="w-14 h-14 dark:bg-white rounded-2xl flex items-center justify-center blur-[3px] brightness-75 translate-x-2">
                        
                        <svg width="900" height="900" viewBox="0 0 900 900" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="455" y="121.921" width="66.8412" height="94.23" fill="#9CD7E4"/>
                        <rect x="650.565" y="403.117" width="66.8412" height="94.23" fill="#9CD7E4"/>
                        <path d="M287.033 215.634H787.018L612.961 684.366H112.977L287.033 215.634Z" fill="#0B4957"/>
                        <rect width="100" height="200" transform="matrix(1 0 -0.348081 0.937464 187.033 215.634)" fill="#0B5666"/>
                        <rect width="100" height="200" transform="matrix(1 0 -0.348081 0.937464 82.5966 496.873)" fill="#4994A5"/>
                        <rect width="100" height="200" transform="matrix(1 0 -0.348081 0.937464 487.021 215.634)" fill="#106E83"/>
                        <rect width="100" height="200" transform="matrix(1 0 -0.348081 0.937464 682.594 496.873)" fill="#6BB7C8"/>
                        <rect width="100" height="200" transform="matrix(1 0 -0.348081 0.937464 787.02 215.634)" fill="#48AEC5"/>
                        <rect width="200" height="100" transform="matrix(1 0 -0.348081 0.937464 321.841 121.887)" fill="#012E38"/>
                        <rect width="200" height="100" transform="matrix(1 0 -0.348081 0.937464 217.405 403.127)" fill="#21849A"/>
                        <rect width="200" height="100" transform="matrix(1 0 -0.348081 0.937464 517.403 403.127)" fill="#439EB3"/>
                        <rect width="200" height="100" transform="matrix(1 0 -0.348081 0.937464 412.978 684.366)" fill="#9CD7E4"/>
                        </svg>

                    </div>

                    <h1 className="text-2xl font-medium tracking-tight text-gray-900 dark:text-white">
                        <Link href="/">fyDrop</Link>
                    </h1>

                    <p className="text-sm text-gray-400">
                        Seamless file sharing
                    </p>
                </div>

                {/* GRID */}
                <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-3">

                    {/* SIDEBAR */}
                    <div className="space-y-3">

                        {/* SESSION */}
                        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl overflow-hidden">
                            <div className="px-5 pt-5 pb-4">
                                <p className="text-[11px] font-medium tracking-widest uppercase text-gray-400 dark:text-zinc-500 mb-3">
                                    Session
                                </p>

                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-[17px] font-medium text-gray-900 dark:text-white truncate">
                                            {deviceName}
                                        </p>
                                        <p className="text-[13px] font-mono text-gray-400 dark:text-zinc-500 mt-0.5 truncate">
                                            room / {roomId}
                                        </p>
                                    </div>

                                    <div className="px-3 py-1.5 rounded-full bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 text-[12px] font-medium whitespace-nowrap">
                                        {connectedClients} devices
                                    </div>
                                </div>

                                {/* Status Indicator */}
                                <div className="mt-3 flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${status === "Connected" || status === "Connected & Approved"
                                        ? "bg-green-500"
                                        : status === "Waiting for Approval"
                                            ? "bg-yellow-500 animate-pulse"
                                            : status === "Rejected by Host" || status === "Disconnected"
                                                ? "bg-red-500"
                                                : "bg-yellow-500"
                                        }`} />

                                    <div className="flex flex-col">
                                        <span className="text-xs text-gray-500">
                                            {status === "Connected" && !isApproved && "Waiting for approval..."}
                                            {status === "Connected & Approved" && "Connected"}
                                            {status === "Rejected by Host" && "Rejected"}
                                            {status === "Disconnected" && "Disconnected"}
                                            {status === "Connection Error" && "Connection Error"}
                                            {status === "Connected as Host" && "Host Mode"}
                                        </span>
                                        {/* {!isHost && !isApproved && status === "Connected" && (
                                            <span className="text-[10px] text-yellow-600 dark:text-yellow-400 mt-0.5">
                                                Waiting for host to approve...
                                            </span>
                                        )} */}
                                    </div>
                                </div>
                            </div>

                            {isHost && (
                                <>
                                    <div className="h-px bg-gray-100 dark:bg-zinc-800" />
                                    <div className="px-5 py-5 flex flex-col items-center gap-5">
                                        <div className="p-3 border border-gray-100 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-950">
                                            <QRCode value={roomUrl} size={180} />
                                        </div>
                                        <div className="text-center space-y-2">
                                            <p className="text-base font-medium text-gray-900 dark:text-white">
                                                Invite devices
                                            </p>
                                            <p className="text-[13px] text-gray-400 dark:text-zinc-500">
                                                Scan the QR code or share the room link.
                                            </p>
                                            <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-zinc-800 rounded-xl border border-gray-100 dark:border-zinc-700">
                                                <p className="text-[11px] font-mono text-gray-500 dark:text-zinc-400 break-all flex-1">
                                                    {roomUrl}
                                                </p>
                                                <button
                                                    onClick={copyRoomUrl}
                                                    className="px-2.5 py-1 bg-white dark:bg-zinc-700 border border-gray-200 dark:border-zinc-600 rounded-lg text-[11px] font-medium cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-600 transition-colors text-gray-700 dark:text-gray-200"
                                                >
                                                    Copy
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* DEVICES */}
                            <div className="h-px bg-gray-100 dark:bg-zinc-800" />
                            <div className="px-5 py-4">
                                <p className="text-[11px] font-medium tracking-widest uppercase text-gray-400 dark:text-zinc-500 mb-3">
                                    Devices in room
                                </p>

                                <div className="space-y-2">
                                    {roomUsers.length === 0 && (
                                        <p className="text-sm text-gray-400 text-center py-4">
                                            No devices connected
                                        </p>
                                    )}

                                    {roomUsers.map((user, i) => (
                                        <div
                                            key={user.id + i}
                                            className={`flex items-center gap-3 p-3 rounded-2xl transition-all ${!isHost && user.role === "host"
                                                ? "bg-gray-50 dark:bg-zinc-800"
                                                : ""
                                                }`}
                                        >
                                            <div
                                                className={`w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-medium ${avatarColors[i % avatarColors.length]}`}
                                            >
                                                {getInitials(user.name)}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                                        {user.name}
                                                    </p>

                                                    {user.role === "host" && (
                                                        <span className="px-1.5 py-0.5 rounded-full bg-black dark:bg-white text-white dark:text-black text-[10px] font-medium">
                                                            HOST
                                                        </span>
                                                    )}
                                                </div>

                                                <p className="text-[12px] text-gray-400">
                                                    {user.connected !== false ? "Connected" : "Connecting..."}
                                                </p>
                                            </div>

                                            {/* Optional: Show if this user is selected as target */}
                                            {isHost && selectedTargets.includes(user.id) && (
                                                <div className="w-2 h-2 rounded-full bg-green-500" />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* JOIN REQUEST */}
                        {isHost && pendingUsers.length > 0 && (
                            <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl overflow-hidden">
                                <div className="flex justify-between items-center px-5 pt-5 pb-3">
                                    <p className="text-[11px] font-medium tracking-widest uppercase text-gray-400 dark:text-zinc-500">
                                        Join requests ({pendingUsers.length})
                                    </p>
                                    <button
                                        onClick={refreshPendingUsers}
                                        className="text-xs text-gray-400 hover:text-gray-600"
                                    >
                                        Refresh
                                    </button>
                                </div>

                                {pendingUsers.map((user) => (
                                    <div
                                        key={user.id}
                                        className="px-5 py-3 flex items-center gap-3 border-t border-gray-100 dark:border-zinc-800"
                                    >
                                        <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-zinc-800 flex items-center justify-center text-[13px] font-medium">
                                            {getInitials(user.name)}
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-gray-900 dark:text-white">
                                                {user.name}
                                            </p>
                                            <p className="text-[12px] text-gray-400">
                                                Wants to join
                                            </p>
                                        </div>

                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => rejectUser(user.id)}
                                                className="px-3 py-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full text-[12px] font-medium hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors text-gray-700 dark:text-gray-200"
                                            >
                                                Reject
                                            </button>
                                            <button
                                                onClick={() => approveUser(user.id)}
                                                className="px-3 py-1.5 bg-black dark:bg-white text-white dark:text-black rounded-full text-[12px] font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
                                            >
                                                Approve
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* CONTENT */}
                    <div className="space-y-3">

                        {/* DROPZONE - Only show if host or has targets */}
                        {(isHost || (!isHost && availableTargets.length > 0)) && (
                            <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-gray-100 dark:border-zinc-800 overflow-hidden">
                                <div className="px-5 pt-5 pb-3">
                                    <p className="text-[11px] font-medium tracking-widest uppercase text-gray-400 dark:text-zinc-500">
                                        Send files
                                    </p>

                                    {/* TARGETS - Only for host */}
                                    {/* TARGETS - Only for host */}
                                    {isHost && (
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            <button
                                                onClick={() => toggleTarget("all")}
                                                className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-all ${selectedTargets.includes("all")
                                                    ? "bg-black dark:bg-white text-white dark:text-black"
                                                    : "bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700"
                                                    }`}
                                            >
                                                Everyone ({availableTargets.length})
                                            </button>

                                            {availableTargets.map((user) => (
                                                <button
                                                    key={user.id}
                                                    onClick={() => toggleTarget(user.id)}
                                                    className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-all ${selectedTargets.includes(user.id)
                                                        ? "bg-black dark:bg-white text-white dark:text-black"
                                                        : "bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700"
                                                        }`}
                                                >
                                                    {user.name}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {/* For non-host, show who they can send to */}
                                    {!isHost && availableTargets.length > 0 && (
                                        <div className="mt-4">
                                            <div className="flex items-center gap-2">
                                                <p className="text-xs text-gray-500">Sending to:</p>
                                                {availableTargets.map((user) => (
                                                    <div
                                                        key={user.id}
                                                        className="px-2 py-1 rounded-full bg-black dark:bg-white text-white dark:text-black text-[11px] font-medium"
                                                    >
                                                        {user.name}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Show message if no targets available */}
                                    {availableTargets.length === 0 && (
                                        <div className="mt-4">
                                            <p className="text-xs text-yellow-500">
                                                {isHost ? "No clients connected" : "Waiting for host connection..."}
                                            </p>
                                        </div>
                                    )}
                                </div>
                                {/* DROP ZONE */}
                                {availableTargets.length !== 0 && (
                                    <div
                                        ref={dropZoneRef}
                                        onClick={() => fileInputRef.current?.click()}
                                        onDragEnter={handleDragEnter}
                                        onDragLeave={handleDragLeave}
                                        onDragOver={handleDragOver}
                                        onDrop={handleDrop}
                                        className="px-5 pb-5"
                                    >
                                        <div
                                            className={`
                                            border-[1.5px] border-dashed rounded-2xl
                                            py-12 flex flex-col items-center gap-2
                                            cursor-pointer transition-all duration-200
                                            ${isDragging
                                                    ? 'border-black dark:border-white bg-gray-50 dark:bg-zinc-800 scale-[1.02]'
                                                    : 'border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800'
                                                }
                                        `}
                                        >
                                            <svg
                                                className={`w-8 h-8 transition-all ${isDragging
                                                    ? 'text-black dark:text-white'
                                                    : 'text-gray-300 dark:text-zinc-600'
                                                    }`}
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                                strokeWidth={1.5}
                                            >
                                                {isDragging ? (
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
                                                    />
                                                ) : (
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                                                    />
                                                )}
                                            </svg>

                                            <p className="text-[15px] font-medium text-gray-700 dark:text-zinc-300">
                                                {isDragging ? "Drop files here" : "Drop files here"}
                                            </p>

                                            <p className="text-[13px] text-gray-400">
                                                {isDragging ? "Release to upload" : "or click to browse"}
                                            </p>

                                            <button className="mt-2 flex items-center gap-1.5 px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-full text-[13px] font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors">
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                                </svg>
                                                Choose files
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    className="hidden"
                                    onChange={handleFileSelect}
                                />
                            </div>

                        )}

                        {/* TEXT MESSAGES */}
                        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl overflow-hidden">
                            <div className="px-5 pt-5 pb-3 flex items-center justify-between">
                                <div>
                                    <p className="text-[11px] font-medium tracking-widest uppercase text-gray-400 dark:text-zinc-500">
                                        Text Messages
                                    </p>
                                    <p className="text-xs text-gray-400 mt-1">
                                        Send text to connected devices
                                    </p>
                                </div>
                                {textMessages.length > 0 && (
                                    <button
                                        onClick={() => setTextMessages([])}
                                        className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>

                            {/* Messages List */}
                            <div className="px-5 max-h-[300px] overflow-y-auto">
                                {textMessages.length === 0 && (
                                    <div className="py-6 text-center">
                                        <svg className="w-10 h-10 text-gray-300 dark:text-zinc-700 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                                        </svg>
                                        <p className="text-sm text-gray-400">No messages yet</p>
                                        <p className="text-xs text-gray-400 mt-1">Type below to send a text message</p>
                                    </div>
                                )}

                                {textMessages.map((msg) => (
                                    <div
                                        key={msg.id}
                                        className={`py-3 ${msg.isMine ? 'pl-8' : 'pr-8'}`}
                                    >
                                        <div className={`flex flex-col ${msg.isMine ? 'items-end' : 'items-start'}`}>
                                            <p className="text-[11px] text-gray-400 dark:text-zinc-500 mb-1">
                                                {msg.isMine ? 'You' : msg.senderName}
                                            </p>
                                            <div className={`px-3.5 py-2 rounded-2xl max-w-[85%] break-words whitespace-pre-wrap ${
                                                msg.isMine
                                                    ? 'bg-black dark:bg-white text-white dark:text-black rounded-br-md'
                                                    : 'bg-gray-100 dark:bg-zinc-800 text-gray-900 dark:text-white rounded-bl-md'
                                            }`}>
                                                <p className="text-sm leading-relaxed">{msg.content}</p>
                                            </div>
                                            <p className="text-[10px] text-gray-300 dark:text-zinc-600 mt-1">
                                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Text Input */}
                            {(isHost || (!isHost && availableTargets.length > 0)) && (
                                <div className="border-t border-gray-100 dark:border-zinc-800 p-3">
                                    <div className="flex items-end gap-2">
                                        <textarea
                                            value={textInput}
                                            onChange={(e) => setTextInput(e.target.value)}
                                            onKeyDown={handleTextKeyDown}
                                            placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                                            rows={1}
                                            className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent transition-all"
                                            style={{ minHeight: '40px', maxHeight: '120px' }}
                                            onInput={(e) => {
                                                e.target.style.height = 'auto';
                                                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                                            }}
                                        />
                                        <button
                                            onClick={sendTextMessage}
                                            disabled={!textInput.trim()}
                                            className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                                                textInput.trim()
                                                    ? 'bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-100 cursor-pointer'
                                                    : 'bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-600 cursor-not-allowed'
                                            }`}
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* TRANSFERS */}
                        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl overflow-hidden">
                            <div className="px-5 pt-5 pb-4 flex items-center justify-between">
                                <div>
                                    <p className="text-[11px] font-medium tracking-widest uppercase text-gray-400 dark:text-zinc-500">
                                        Transfer Queue
                                    </p>
                                    <p className="text-xs text-gray-400 mt-1">
                                        {transfers.filter(t => !t.done).length} active, {transfers.filter(t => t.done).length} completed
                                    </p>
                                </div>

                                <div className="px-3 py-1.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-xs font-medium text-gray-700 dark:text-gray-200">
                                    {transfers.length} items
                                </div>
                            </div>

                            <div className="divide-y divide-gray-100 dark:divide-zinc-800 max-h-[400px] overflow-y-auto">
                                {transfers.length === 0 && (
                                    <div className="p-8 text-center">
                                        <svg className="w-12 h-12 text-gray-300 dark:text-zinc-700 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4" />
                                        </svg>
                                        <p className="text-sm text-gray-400">
                                            No active transfers
                                        </p>
                                        <p className="text-xs text-gray-400 mt-1">
                                            Drop files above to start sending
                                        </p>
                                    </div>
                                )}

                                {transfers.map((item) => (
                                    <div key={item.id} className="px-5 py-4">
                                        <div className="flex items-start gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                                                <svg
                                                    className="w-5 h-5 text-gray-500"
                                                    fill="none"
                                                    viewBox="0 0 24 24"
                                                    stroke="currentColor"
                                                >
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth={1.5}
                                                        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                                                    />
                                                </svg>
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-4 flex-wrap">
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                                            {item.name}
                                                        </p>
                                                        <p className="text-xs text-gray-400 mt-0.5">
                                                            {item.from} → {item.to}
                                                        </p>
                                                        {!item.done && item.size && (
                                                            <p className="text-xs text-gray-400 mt-1">
                                                                {formatBytes(item.sent || 0)} / {formatBytes(item.size)}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-sm font-mono font-medium">
                                                            {item.done
                                                                ? "✓ Completed"
                                                                : `${item.progress}%`
                                                            }
                                                        </p>
                                                        {!item.done && (
                                                            <p className="text-xs text-gray-400 mt-0.5">
                                                                {item.speed}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="mt-3 h-1.5 rounded-full bg-gray-100 dark:bg-zinc-800 overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all duration-300 ${item.done
                                                            ? "bg-green-500"
                                                            : "bg-black dark:bg-white"
                                                            }`}
                                                        style={{
                                                            width: `${item.progress}%`,
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* RECEIVED FILES */}
                        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl overflow-hidden">
                            <div className="px-5 pt-5 pb-3 flex items-center justify-between">
                                <p className="text-[11px] font-medium tracking-widest uppercase text-gray-400 dark:text-zinc-500">
                                    Received Files
                                </p>
                                {receivedFiles.length > 0 && (
                                    <button
                                        onClick={() => {
                                            receivedFiles.forEach(f => URL.revokeObjectURL(f.url));
                                            setReceivedFiles([]);
                                        }}
                                        className="text-xs text-red-500 hover:text-red-600 transition-colors"
                                    >
                                        Clear all
                                    </button>
                                )}
                            </div>

                            <div className="divide-y divide-gray-100 dark:divide-zinc-800 max-h-[300px] overflow-y-auto">
                                {receivedFiles.length === 0 && (
                                    <div className="p-8 text-center">
                                        <svg className="w-12 h-12 text-gray-300 dark:text-zinc-700 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                        </svg>
                                        <p className="text-sm text-gray-400">
                                            No files received yet
                                        </p>
                                        <p className="text-xs text-gray-400 mt-1">
                                            Files sent to you will appear here
                                        </p>
                                    </div>
                                )}

                                {receivedFiles.map((file, idx) => (
                                    <div key={`${file.id}-${file.name}-${idx}`} className="px-5 py-4 flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                                            <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                                {file.name}
                                            </p>
                                            <p className="text-[12px] text-gray-400 mt-0.5">
                                                {formatBytes(file.size)} • {new Date(file.receivedAt).toLocaleTimeString()}
                                            </p>
                                        </div>

                                        <a
                                            href={file.url}
                                            download={file.name}
                                            className="px-3 py-1.5 bg-black dark:bg-white text-white dark:text-black rounded-full text-[12px] font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors flex items-center gap-1"
                                        >
                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                            </svg>
                                            Save
                                        </a>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}
