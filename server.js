const express = require('express');
const path = require('path'); 
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const os = require('os');

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Opening.html'));
});

app.use(express.static(__dirname));

// --- CORE SHARED STATE ---
let players = {};
let rooms = {}; // NEW: Track private room passwords and metadata
let readyPlayers = new Set(); 
let roundTimer = null;
const MAX_PLAYERS = 6; 

// --- HERD GAME DATA ---
let pinkCowHolder = null;
const questionBank = [
    "What's the best fruit?", "What's the best pizza topping?",
    "Name a movie everyone has seen.", "What's the most annoying household chore?",
    "What's the best color for a car?", "Name a country you'd visit for the food.",
    "What's the best superpower?", "What's the most popular sport in the world?",
    "Name a breakfast food.", "What's the best ice cream flavor?","What's the best type of pet?", 
    "Name a popular tourist destination.","What's the best season of the year?", 
    "Name a common household item.","What's the best kind of music?", 
    "Name a type of public transportation.","What's the best way to relax?", 
    "Name a popular social media platform.","What's the best type of weather?", 
    "Name a famous landmark."
];

// --- EXIT 8 DATA ---
let exit8Votes = { yes: 0, no: 0, votedPlayers: new Set() };

// --- SCAVENGER / PUZZLE DATA ---
let solvedObjects = new Set();
let playerPairs = {}; 

// --- CALLING GAME DATA ---
let callingVotes = {}; 
let callingGameStatus = "waiting"; 
let currentSecretWord = ""; 
const callingWords = ["Apple", "Tower", "Ocean", "Pizza", "Guitar", "Space", "Robot", "Forest", "Dragon", "Storm"];

let gameData = { status: "waiting", question: "", round: 1 };

// --- RACING DATA ---
let raceSession = { 
    mode: "LOBBY", 
    lapVotes: {}, 
    finalLaps: 3,
    weather: "CLEAR", 
    trackTemp: 25,
    airDensity: 1.225,
    countdownValue: 5,
    startTime: 0,
    gridSlots: [
        { x: 4, z: 50, label: "P1" },   { x: -4, z: 40, label: "P2" },
        { x: 4, z: 30, label: "P3" },   { x: -4, z: 20, label: "P4" },
        { x: 4, z: 10, label: "P5" },   { x: -4, z: 0, label: "P6" },
        { x: 4, z: -10, label: "P7" },  { x: -4, z: -20, label: "P8" },
        { x: 4, z: -30, label: "P9" },  { x: -4, z: -40, label: "P10" },
        { x: 4, z: -50, label: "P11" }, { x: -4, z: -60, label: "P12" }
    ]
};

let raceLaps = {}; 
let raceProgress = {}; 
let raceBestLaps = {};
let penalties = {}; 
let pitStatus = {};
let playerSpeeds = {}; 
let playerHealth = {}; 

// --- UTILITY: LOCAL IP ---
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (let devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return 'localhost';
}

function broadcastLobbyState() {
    const herdPlayers = Object.values(players).filter(p => p.room === "herd_lobby" && p.role === "player");
    io.to("herd_lobby").emit('updateVotes', { 
        readyCount: readyPlayers.size, 
        totalPlayers: herdPlayers.length 
    });
}

// --- CORE TICKER ---
setInterval(() => { 
    const playersWithStatus = {};
    Object.keys(players).forEach(id => {
        playersWithStatus[id] = {
            ...players[id],
            isReady: readyPlayers.has(id)
        };
    });
    io.emit('playerUpdates', playersWithStatus); 
}, 100);

// --- ADVANCED RACING PHYSICS & TICKER ---
setInterval(() => {
    const racingPlayers = Object.values(players).filter(p => p.room === "racing");
    if (racingPlayers.length === 0) return;

    racingPlayers.forEach(p1 => {
        let draftFactor = 1.0;
        racingPlayers.forEach(p2 => {
            if (p1.id === p2.id) return;
            const distZ = p2.z - p1.z;
            const distX = Math.abs(p1.x - p2.x);
            if (distZ > 5 && distZ < 20 && distX < 2.5) {
                draftFactor = 1.15; 
            }
        });
        playerSpeeds[p1.id] = draftFactor;
    });

    if (Math.random() < 0.001) {
        const states = ["CLEAR", "RAIN", "FOG"];
        raceSession.weather = states[Math.floor(Math.random() * states.length)];
        io.to("racing").emit('weatherChange', { 
            type: raceSession.weather, 
            temp: raceSession.weather === "RAIN" ? 18 : 28 
        });
    }

    const leaderboard = racingPlayers
        .map(p => ({
            id: p.id,
            name: p.name,
            laps: raceLaps[p.id] || 0,
            progress: raceProgress[p.id] || 0,
            bestLap: raceBestLaps[p.id] || 999.99,
            health: playerHealth[p.id] || 100,
            penalty: penalties[p.id] || 0,
            isPitting: pitStatus[p.id] || false
        }))
        .sort((a, b) => b.laps - a.laps || b.progress - a.progress)
        .slice(0, 12);

    io.to("racing").emit('raceTicker', { 
        session: {
            mode: raceSession.mode,
            weather: raceSession.weather,
            laps: raceSession.finalLaps,
            countdown: raceSession.countdownValue
        }, 
        leaderboard: leaderboard 
    });
}, 500);

// --- HERD GAME FUNCTIONS ---
function startRound() {
    if (gameData.status === "voting") return; 
    if (roundTimer) clearInterval(roundTimer);
    
    gameData.question = questionBank[Math.floor(Math.random() * questionBank.length)];
    gameData.status = "voting";
    
    Object.keys(players).forEach(id => { 
        players[id].currentAnswer = ""; 
        if(players[id].room === "herd_lobby" && players[id].role === "player") {
            const s = io.sockets.sockets.get(id);
            if(s) s.join("herd_active"); 
        }
    });
    
    io.to("herd_lobby").emit('receiveQuestion', gameData.question);
    io.emit('gameUpdate', gameData);
    
    let internalTimer = 60; 
    roundTimer = setInterval(() => {
        internalTimer--;
        const herdPlayers = Object.values(players).filter(p => p.room === "herd_lobby" && p.role === "player");
        const totalInGame = herdPlayers.length;
        const answerCount = herdPlayers.filter(p => p.currentAnswer && p.currentAnswer !== "").length;
        
        if (internalTimer <= 0 || (answerCount >= totalInGame && totalInGame >= 2)) {
            clearInterval(roundTimer);
            roundTimer = null;
            calculateResults();
        }
    }, 1000);
}

function calculateResults() {
    if (gameData.status !== "voting") return; 
    gameData.status = "results";
    let answerCounts = {};
    const herdPlayers = Object.values(players).filter(p => p.room === "herd_lobby" && p.role === "player");
    
    herdPlayers.forEach(p => {
        if (p.currentAnswer) {
            let ans = p.currentAnswer.toLowerCase().trim();
            answerCounts[ans] = (answerCounts[ans] || 0) + 1;
        }
    });

    let maxVotes = 0;
    let majorityAnswer = "";
    for (let ans in answerCounts) {
        if (answerCounts[ans] > maxVotes) {
            maxVotes = answerCounts[ans];
            majorityAnswer = ans;
        }
    }

    if (majorityAnswer !== "") {
        herdPlayers.forEach(p => {
            let pAns = (p.currentAnswer || "").toLowerCase().trim();
            if (pAns === majorityAnswer && p.id !== pinkCowHolder) {
                p.score += 1;
                io.to(p.id).emit('updateScore', p.score);
            }
        });
    }

    let oddOnes = herdPlayers.filter(p => {
        let pAns = (p.currentAnswer || "").toLowerCase().trim();
        return pAns !== "" && answerCounts[pAns] === 1;
    }).map(p => p.id);

    if (oddOnes.length > 0) {
        pinkCowHolder = oddOnes[Math.floor(Math.random() * oddOnes.length)];
    }
    
    io.to("herd_lobby").emit('currentPlayers', players);
    io.to("herd_lobby").emit('roundResults', { counts: answerCounts, majorityAnswer: majorityAnswer, pinkCowId: pinkCowHolder });
    io.to("herd_lobby").emit('pinkCowUpdate', pinkCowHolder);

    setTimeout(() => {
        let winnerPlayer = herdPlayers.find(p => p.score >= 8);
        if (winnerPlayer) {
            io.to("herd_lobby").emit('gameOver', winnerPlayer.name);
            gameData.status = "waiting";
            gameData.round = 1;
            pinkCowHolder = null;
            readyPlayers.clear();
            herdPlayers.forEach(p => p.score = 0);
        } else {
            gameData.status = "waiting";
            gameData.round++;
            readyPlayers.clear(); 
        }
        io.emit('gameUpdate', gameData);
        broadcastLobbyState();
    }, 5000); 
}

function updatePairs() {
    const allPlayers = Object.keys(players);
    playerPairs = {};
    for (let i = 0; i < allPlayers.length; i += 2) {
        if (allPlayers[i + 1]) {
            playerPairs[allPlayers[i]] = allPlayers[i+1];
            playerPairs[allPlayers[i+1]] = allPlayers[i];
        }
    }
}

// --- SOCKET HANDLERS ---
io.on('connection', (socket) => {
    const activePlayerCount = Object.values(players).filter(p => p.role === "player").length;
    const role = (activePlayerCount < MAX_PLAYERS) ? "player" : "spectator";

    socket.join("lobby");
    players[socket.id] = { 
        id: socket.id, x: 0, y: 2, z: 60, yaw: 0, 
        name: `Guest_${socket.id.substring(0,4)}`,
        currentAnswer: "", score: 0, room: "lobby", role: role,
        message: "" 
    };

    updatePairs();
    socket.emit('roleAssignment', role);
    socket.emit('currentPlayers', players);
    socket.emit('gameUpdate', gameData); 
    socket.to("lobby").emit('newPlayer', players[socket.id]);

    // --- NEW: PRIVATE ROOM & PASSWORD HANDLER ---
    socket.on('initializePrivateRoom', (data) => {
        const { roomID, password } = data;
        if (!roomID) return;
        
        rooms[roomID] = { 
            password: password || null,
            createdAt: Date.now()
        };
        socket.emit('roomCreated', roomID);
    });

    socket.on('joinRoom', (data) => {
        if (!players[socket.id]) return;
        
        // Handle both simple string (public) and object (private) room joins
        const roomName = (typeof data === 'string') ? data : data.roomID;
        const providedPass = (typeof data === 'object') ? data.password : null;

        // Check password if room is private
        if (rooms[roomName] && rooms[roomName].password) {
            if (providedPass !== rooms[roomName].password) {
                return socket.emit('roomError', 'Invalid Password');
            }
        }

        socket.leave(players[socket.id].room);
        players[socket.id].room = roomName;
        socket.join(roomName);
        
        io.to(roomName).emit('currentPlayers', players); 
        broadcastLobbyState();
        socket.emit('roomJoined', roomName);
    });

    socket.on('startCallingGame', () => {
        if (!players[socket.id]) return;
        const room = players[socket.id].room;
        const allInRoom = Object.values(players).filter(p => p.room === room);
        if (allInRoom.length < 2) return;

        callingGameStatus = "active";
        currentSecretWord = callingWords[Math.floor(Math.random() * callingWords.length)].toUpperCase();
        const caller = allInRoom[Math.floor(Math.random() * allInRoom.length)];
        
        io.to(room).emit('callingGameStarted', {
            callerId: caller.id,
            callerName: caller.name
        });
        io.to(caller.id).emit('secretWord', currentSecretWord);
    });

    socket.on('castVote', (data) => {
        if (!players[socket.id]) return;
        const room = players[socket.id].room;
        callingVotes[socket.id] = data.targetId;
        
        const playersInRoom = Object.values(players).filter(p => p.room === room);
        const currentVoteCount = Object.keys(callingVotes).filter(id => players[id] && players[id].room === room).length;

        if (currentVoteCount >= playersInRoom.length && playersInRoom.length >= 2) {
            callingGameStatus = "playing";
            const host = playersInRoom[Math.floor(Math.random() * playersInRoom.length)];
            io.to(room).emit('votingComplete', { hostId: host.id, hostName: host.name });
            callingVotes = {}; 
        }
    });

    socket.on('setSecretWord', (data) => {
        if (!players[socket.id]) return;
        const room = players[socket.id].room;
        currentSecretWord = data.word.toUpperCase();
        io.to(room).emit('gameStarted', { word: currentSecretWord });
    });

    socket.on('callPlayer', (data) => {
        if (!players[socket.id]) return;
        const room = players[socket.id].room;
        io.to(room).emit('playerCalling', {
            senderId: socket.id,
            senderName: players[socket.id].name,
            guess: data.guess || "no data",
            type: data.type || "info"
        });
    });

    socket.on('giverConfirmClue', () => {
        if (!players[socket.id]) return;
        io.to(players[socket.id].room).emit('clueAccepted');
    });

    socket.on('giverDeny', () => {
        if (!players[socket.id]) return;
        io.to(players[socket.id].room).emit('wordDenied');
    });

    socket.on('wordGuessedCorrectly', (data) => {
        if (!players[socket.id]) return;
        callingGameStatus = "waiting";
        io.to(players[socket.id].room).emit('gameWon', { word: data.word });
    });

    socket.on('requestVoteUpdate', () => {
        broadcastLobbyState();
    });

    socket.on('playerReady', (isReady) => {
        if (isReady === true) {
            readyPlayers.add(socket.id);
        } else {
            readyPlayers.delete(socket.id);
        }
        broadcastLobbyState();

        const herdPlayers = Object.values(players).filter(p => p.room === "herd_lobby" && p.role === "player");
        if (readyPlayers.size >= herdPlayers.length && herdPlayers.length >= 2) {
            startRound();
        }
    });

    socket.on('chat', (msg) => {
        if (players[socket.id]) {
            const messageText = msg.message || msg;
            players[socket.id].message = messageText; 
            const payload = { user: players[socket.id].name, message: messageText };
            io.to(players[socket.id].room).emit('chat', payload);
            io.to(players[socket.id].room).emit('msg', payload); 
        }
    });

    socket.on('playerMovement', (data) => {
        if (players[socket.id]) {
            Object.assign(players[socket.id], { x: data.x, y: data.y, z: data.z, yaw: data.yaw });
            
            if (data.room && players[socket.id].room !== data.room) {
                socket.leave(players[socket.id].room);
                players[socket.id].room = data.room;
                socket.join(data.room);
                readyPlayers.delete(socket.id);
                broadcastLobbyState();

                if (data.room === "racing") {
                    const racingCount = Object.values(players).filter(p => p.room === "racing").length;
                    const gridIndex = (racingCount - 1) % raceSession.gridSlots.length;
                    const spot = raceSession.gridSlots[gridIndex];
                    playerHealth[socket.id] = 100;
                    socket.emit('gridSpawn', { ...spot, index: gridIndex });
                }
            }
            
            if (players[socket.id].room === "racing") {
                raceProgress[socket.id] = data.z;
                if (data.velocity) {
                    socket.to("racing").emit('speedLines', { id: socket.id, vel: data.velocity });
                }
            }

            io.to(players[socket.id].room).emit('playerMoved', { 
                id: socket.id, 
                drafting: (playerSpeeds[socket.id] || 1.0) > 1.0,
                score: players[socket.id].score,
                ...data 
            });
        }
    });

    socket.on('submitLapTime', (data) => {
        if (!players[socket.id]) return;
        const lapTime = typeof data === 'number' ? data : data.time;
        raceLaps[socket.id] = (raceLaps[socket.id] || 0) + 1;
        if (!raceBestLaps[socket.id] || lapTime < raceBestLaps[socket.id]) {
            raceBestLaps[socket.id] = lapTime;
            socket.emit('newPersonalBest', lapTime);
        }
        socket.emit('lapUpdate', raceLaps[socket.id]);
        io.to("racing").emit('notify', {
            text: `${players[socket.id].name} LAP ${raceLaps[socket.id]} | ${lapTime.toFixed(3)}s`,
            type: "LAP"
        });
        if (raceLaps[socket.id] >= raceSession.finalLaps) {
            io.to("racing").emit('notify', { text: `🏁 ${players[socket.id].name} FINISHED!`, type: "FINISH" });
            socket.emit('raceComplete', { rank: 1 });
        }
    });

    socket.on('requestRaceStart', () => {
        if (raceSession.mode === "COUNTDOWN" || raceSession.mode === "RACE") return;

        raceSession.mode = "COUNTDOWN";
        raceSession.countdownValue = 5;
        
        Object.keys(players).forEach(id => {
            if (players[id].room === "racing") {
                raceLaps[id] = 0;
                raceProgress[id] = 0;
                playerHealth[id] = 100;
            }
        });

        let countInterval = setInterval(() => {
            io.to("racing").emit('startCountdown', raceSession.countdownValue);
            raceSession.countdownValue--;
            
            if (raceSession.countdownValue < 0) {
                clearInterval(countInterval);
                raceSession.mode = "RACE";
                raceSession.startTime = Date.now();
                io.to("racing").emit('lightsOut');
            }
        }, 1000);
    });

    socket.on('playerImpact', (data) => {
        if (players[socket.id]?.room === "racing") {
            const damage = Math.floor(Math.random() * 15) + 5;
            playerHealth[socket.id] = Math.max(0, (playerHealth[socket.id] || 100) - damage);
            socket.to("racing").emit('crashEffect', { 
                id: socket.id, 
                pos: { x: data.x, z: data.z },
                severity: damage > 15 ? "HIGH" : "LOW"
            });
            if (playerHealth[socket.id] <= 0) {
                socket.emit('engineFailure');
                io.to("racing").emit('notify', { text: `🔥 ${players[socket.id].name} Engine Failure!`, type: "CRASH" });
            }
        }
    });

    socket.on('outOfLimits', () => {
        penalties[socket.id] = (penalties[socket.id] || 0) + 2;
        socket.emit('penaltyActive', penalties[socket.id]);
        socket.emit('notify', { text: `TRACK LIMITS: +2.0s`, type: "PENALTY" });
    });

    socket.on('boxNow', () => {
        if (pitStatus[socket.id]) return;
        const damageToRepair = 100 - (playerHealth[socket.id] || 100);
        const totalWait = 4000 + ((penalties[socket.id] || 0) * 1000) + (damageToRepair * 50);
        pitStatus[socket.id] = true;
        socket.emit('pitAction', { msg: "SERVICING CAR", duration: totalWait });
        setTimeout(() => {
            if (!players[socket.id]) return;
            penalties[socket.id] = 0;
            playerHealth[socket.id] = 100;
            pitStatus[socket.id] = false;
            socket.emit('clearDamage');
            socket.emit('pitComplete');
            io.to("racing").emit('notify', { text: `🔧 ${players[socket.id].name} Pit Exit`, type: "PIT" });
        }, totalWait);
    });

    socket.on('voteLaps', (laps) => {
        if (!players[socket.id]) return;
        const val = parseInt(laps);
        if (isNaN(val) || val < 1 || val > 50) return;
        raceSession.lapVotes[socket.id] = val;
        const votes = Object.values(raceSession.lapVotes);
        raceSession.finalLaps = Math.round(votes.reduce((a, b) => a + b, 0) / votes.length) || 3;
        io.to("racing").emit('voteUpdate', { 
            voter: players[socket.id].name, 
            currentLaps: raceSession.finalLaps 
        });
    });

    socket.on('chatMessage', (data) => {
        if (players[socket.id]) {
            const msgText = (typeof data === 'string') ? data : data.text;
            const msgType = (typeof data === 'object') ? data.type : null;
            const msgWord = (typeof data === 'object') ? data.word : null;
            const isGuesser = players[socket.id].room === 'calling_game' && players[socket.id].id !== callingVotes.hostId;

            io.to(players[socket.id].room).emit('chatMessage', { 
                id: socket.id, 
                message: msgText,
                type: msgType,
                word: msgWord,
                isGuesser: isGuesser
            });
        }
    });

    socket.on('submitAnswer', (data) => {
        if (players[socket.id]?.role === "player") {
            const ans = typeof data === 'string' ? data : data.answer;
            players[socket.id].currentAnswer = ans;
            const currentRoom = players[socket.id].room;
            const roomPlayers = Object.values(players).filter(p => p.room === currentRoom && p.role === "player");
            
            io.to(currentRoom).emit('updateVotes', { 
                readyCount: roomPlayers.filter(p => p.currentAnswer && p.currentAnswer !== "").length, 
                totalPlayers: roomPlayers.length 
            });
        }
    });

    socket.on('disconnect', () => {
        if (socket.id === pinkCowHolder) pinkCowHolder = null;
        const roomToClean = players[socket.id] ? players[socket.id].room : null;

        delete callingVotes[socket.id];
        delete players[socket.id];
        delete raceLaps[socket.id];
        delete raceProgress[socket.id];
        delete raceBestLaps[socket.id];
        delete penalties[socket.id];
        delete pitStatus[socket.id];
        delete playerHealth[socket.id];
        delete playerSpeeds[socket.id];
        readyPlayers.delete(socket.id);
        
        // NEW: Clean up empty rooms (excluding base lobbies)
        if (roomToClean && !['lobby', 'racing', 'herd_lobby'].includes(roomToClean)) {
            const remaining = Object.values(players).filter(p => p.room === roomToClean).length;
            if (remaining === 0) delete rooms[roomToClean];
        }

        updatePairs();
        broadcastLobbyState(); 
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`MULTIPLAYER GAME IS ONLINE | http://${getLocalIP()}:${PORT}`);
});