import * as THREE from 'three';
import { HerdGame } from './HerdGame.js'; 

const socket = io();
window.socket = socket; 
const herdGame = new HerdGame();

/** * --- CORE GAME ARCHITECTURE v4.2 ---
 * Strictly Maintaining 700+ Line Infrastructure
 * Fixed: Voting Poll Sticky 0/X & Global State Sync
 * STATUS: NO REMOVALS - ONLY ENHANCEMENTS
 */

// --- 1. DEVICE DETECTION & MOBILE SCALING ---
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window);

if (isMobile) {
    const style = document.createElement('style');
    style.innerHTML = `
        #chat-container { width: 180px !important; height: 120px !important; font-size: 10px !important; bottom: 70px !important; }
        #ui-container { transform: translateX(-50%) scale(0.7) !important; bottom: 10px !important; }
    `;
    document.head.appendChild(style);
}

// --- HERD MENTALITY RULES & STATE ---
let gameState = {
    phase: 'LOBBY',
    hasPinkCow: false,
    score: 0,
    isSeated: false,
    readyToStart: false,
    totalReady: 0,
    totalPlayers: 1,
    lastUpdate: Date.now(),
    serverTimeOffset: 0
};

// --- HELPER: UPDATE UI ELEMENTS ---
function updateVoteUI() {
    // Ensure numbers are valid before rendering
    const ready = Math.max(0, gameState.totalReady || 0);
    const total = Math.max(1, gameState.totalPlayers || 1);
    const statusText = `Votes: ${ready} / ${total}`;
    
    if (document.getElementById('vote-status-text')) {
        document.getElementById('vote-status-text').innerHTML = statusText;
    }

    const htmlCounter = document.getElementById('player-count-msg');
    if (htmlCounter) htmlCounter.innerText = `Players: ${total}`;

    let playerListUI = document.getElementById('player-list');
    if (!playerListUI) {
        const sidebar = document.createElement('div');
        sidebar.id = "leaderboard-sidebar";
        sidebar.style = "position:absolute; top:20px; left:20px; background:rgba(0,0,0,0.7); padding:15px; border-radius:10px; color:white; font-family:sans-serif; z-index:105; border:1px solid gold; min-width:160px; box-shadow: 0 0 15px rgba(212,175,55,0.3);";
        sidebar.innerHTML = `<h4 style="margin:0 0 10px 0; color:gold; text-align:center; border-bottom:1px solid gold;">LIVE STANDINGS</h4><ul id="player-list" style="list-style:none; padding:0; margin:0; font-size:14px;"></ul>`;
        document.body.appendChild(sidebar);
        playerListUI = document.getElementById('player-list');
    }

    if (playerListUI) {
        let listHTML = `<li style="margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:4px;">
            <span style="color:gold;">★</span> <b style="color:white;">${myName} (You)</b>: <span style="font-size:16px; color:#00ffcc; font-weight:bold;">${gameState.score}</span>
            ${gameState.hasPinkCow ? " <span style='color:#ff69b4;'>🐄</span>" : ""}
        </li>`;

        Object.keys(remotePlayers).forEach(id => {
            const p = remotePlayers[id];
            const pName = p.userData.name || "Joining...";
            const pScore = Number(p.userData.score) || 0;
            const hasCow = p.userData.hasPinkCow ? " <span style='color:#ff69b4;'>🐄</span>" : "";
            listHTML += `<li style="margin-bottom:5px; color:#eee; display:flex; justify-content:space-between;">
                <span><span style="color:#00ffcc;">●</span> ${pName}</span> <b>${pScore}${hasCow}</b>
            </li>`;
        });
        playerListUI.innerHTML = listHTML;
    }
}

// --- NEW FEATURE: 3D CHAT BUBBLES ---
function createChatBubble(text) {
    const canvas = document.createElement('canvas');
    const ctxB = canvas.getContext('2d');
    canvas.width = 512; canvas.height = 128;
    ctxB.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctxB.beginPath();
    ctxB.roundRect(10, 10, 492, 108, 25);
    ctxB.fill();
    ctxB.strokeStyle = 'gold';
    ctxB.lineWidth = 6;
    ctxB.stroke();
    ctxB.font = 'bold 36px Arial';
    ctxB.fillStyle = 'white';
    ctxB.textAlign = 'center';
    ctxB.fillText(text, 256, 75);
    const tex = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(7, 1.75, 1);
    sprite.renderOrder = 999; 
    return sprite;
}

// --- UI CHAT SYSTEM ---
const chatContainer = document.createElement('div');
chatContainer.id = "chat-container"; 
chatContainer.style = "position:absolute; bottom:80px; left:20px; width:250px; height:200px; background:rgba(0,0,0,0.5); border-radius:10px; display:flex; flex-direction:column; padding:10px; z-index:110; border: 1px solid rgba(255,255,255,0.2);";
document.body.appendChild(chatContainer);

const chatMessages = document.createElement('div');
chatMessages.style = "flex:1; overflow-y:auto; color:white; font-size:14px; margin-bottom:5px; font-family: sans-serif;";
chatContainer.appendChild(chatMessages);

const chatInput = document.createElement('input');
chatInput.type = "text";
chatInput.placeholder = "Press Enter to chat...";
chatInput.style = "width:100%; background:rgba(255,255,255,0.2); border:none; color:white; padding:5px; border-radius:5px; outline:none;";
chatContainer.appendChild(chatInput);

function addChatMessage(msg, color = "white") {
    const msgEl = document.createElement('div');
    msgEl.style.color = color;
    msgEl.style.marginBottom = "4px";
    msgEl.innerText = msg;
    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && chatInput.value.trim() !== "") {
        socket.emit('chatMessage', chatInput.value);
        chatInput.value = "";
        chatInput.blur();
    }
});

function showBubbleOnPlayer(id, message) {
    let target = (id === socket.id) ? localPlayer : remotePlayers[id];
    if (target) {
        const old = target.getObjectByName('chatBubble');
        if (old) target.remove(old);
        const bubble = createChatBubble(message);
        bubble.name = 'chatBubble';
        bubble.position.set(0, 10, 0); 
        target.add(bubble);
        setTimeout(() => { if (target.getObjectByName('chatBubble') === bubble) target.remove(bubble); }, 4000);
    }
}

// --- OVERLAY & JOIN LOGIC ---
let myName = "Player";
const nameOverlay = document.createElement('div');
nameOverlay.id = "name-overlay-screen";
nameOverlay.style = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); display:flex; flex-direction:column; justify-content:center; align-items:center; z-index:1000; font-family:sans-serif;";
nameOverlay.innerHTML = `
    <h2 style="color:white; letter-spacing:2px; font-size:32px; text-shadow:0 0 10px gold;">JOIN THE HERD</h2>
    <p style="color:gold; margin-bottom:20px;">Think like the majority to win Cow Tokens!</p>
    <input type="text" id="playerNameInput" maxlength="12" placeholder="Enter Name..." style="padding:15px; border-radius:8px; border:2px solid gold; width:220px; font-size:18px; text-align:center; background:#222; color:white;">
    <button id="joinGameBtn" style="margin-top:20px; padding:12px 30px; background:gold; border:none; border-radius:8px; cursor:pointer; font-weight:bold; font-size:16px; transition:0.3s;">START PLAYING</button>
`;
document.body.appendChild(nameOverlay);

document.getElementById('joinGameBtn').onclick = () => {
    const input = document.getElementById('playerNameInput').value.trim();
    if (input) {
        myName = input;
        nameOverlay.style.display = 'none';
        socket.emit('setPlayerName', myName);
        socket.emit('joinRoom', "herd_lobby");
        socket.emit('playerMovement', { x: 0, z: 0, rot: 0, name: myName, score: 0, room: "herd_lobby" });
        // ADDED: Force immediate poll refresh on join
        socket.emit('requestVoteUpdate');
        updateVoteUI(); 
    }
};

const uiContainer = document.createElement('div');
uiContainer.id = "ui-container"; 
uiContainer.style = "position:absolute; bottom:20px; left:50%; transform:translateX(-50%); text-align:center; z-index:100;";
document.body.appendChild(uiContainer);

const voteStatus = document.createElement('div');
voteStatus.id = "vote-status-text";
voteStatus.style = "color: white; font-weight: bold; margin-bottom: 10px; text-shadow: 2px 2px 2px black; font-family: sans-serif;";
voteStatus.innerHTML = "Votes: 0 / 1 (Waiting for players...)";
uiContainer.appendChild(voteStatus);

const startVoteBtn = document.createElement('button');
startVoteBtn.innerHTML = "Vote to Start Game";
startVoteBtn.style = "padding:15px; background:gold; border:none; border-radius:10px; font-weight:bold; cursor:pointer; box-shadow: 0 4px #b8860b;";
uiContainer.appendChild(startVoteBtn);

const radar = document.createElement('canvas');
radar.id = "radar-canvas";
radar.width = 150;
radar.height = 150;
radar.style = "position:absolute; top:20px; right:20px; border: 2px solid rgba(255,255,255,0.5); border-radius: 50%; background: rgba(0,0,0,0.4); z-index:100;";
document.body.appendChild(radar);
const ctx = radar.getContext('2d');

startVoteBtn.onclick = () => {
    gameState.readyToStart = !gameState.readyToStart;
    startVoteBtn.innerHTML = gameState.readyToStart ? "Ready!" : "Vote to Start Game";
    startVoteBtn.style.background = gameState.readyToStart ? "#4cc936" : "gold";
    startVoteBtn.style.boxShadow = gameState.readyToStart ? "0 4px #2e7d32" : "0 4px #b8860b";
    socket.emit('playerReady', gameState.readyToStart);
};

// --- MOBILE JOYSTICK ---
let joystickVector = { x: 0, y: 0 };
if (isMobile) {
    const joyContainer = document.createElement('div');
    joyContainer.style = "position:fixed; bottom:40px; right:40px; width:100px; height:100px; background:rgba(255,255,255,0.1); border: 2px solid white; border-radius:50%; z-index:200; touch-action:none;";
    const joyStick = document.createElement('div');
    joyStick.style = "position:absolute; top:25px; left:25px; width:50px; height:50px; background:gold; border-radius:50%;";
    joyContainer.appendChild(joyStick);
    document.body.appendChild(joyContainer);

    joyContainer.addEventListener('touchmove', (e) => {
        const touch = e.touches[0];
        const rect = joyContainer.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        let dx = touch.clientX - centerX;
        let dy = touch.clientY - centerY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const max = 40;
        if (dist > max) { dx *= max/dist; dy *= max/dist; }
        joyStick.style.transform = `translate(${dx}px, ${dy}px)`;
        joystickVector.x = dx / max; joystickVector.y = dy / max;
    });

    joyContainer.addEventListener('touchend', () => {
        joyStick.style.transform = `translate(0,0)`;
        joystickVector = { x: 0, y: 0 };
    });
}

// --- THREE.JS ENVIRONMENT ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 100, 250);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
sunLight.position.set(50, 100, 50);
sunLight.castShadow = true;
scene.add(sunLight);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x4cc936 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// --- WORLD BUILDING ---
function createFencePerimeter(size) {
    const fenceGroup = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const createSide = (width, zPos, rotate = false) => {
        const side = new THREE.Group();
        const postGeo = new THREE.BoxGeometry(1.2, 7, 1.2);
        const railGeo = new THREE.BoxGeometry(width, 1, 0.5);
        for (let i = -width/2; i <= width/2; i += 10) {
            const post = new THREE.Mesh(postGeo, mat);
            post.position.set(i, 3.5, 0);
            side.add(post);
        }
        const r1 = new THREE.Mesh(railGeo, mat); r1.position.set(0, 5, 0);
        const r2 = new THREE.Mesh(railGeo, mat); r2.position.set(0, 2.5, 0);
        side.add(r1, r2);
        if(rotate) side.rotation.y = Math.PI / 2;
        side.position.set(rotate ? zPos : 0, 0, rotate ? 0 : zPos);
        fenceGroup.add(side);
    };
    createSide(size, -size/2); createSide(size, size/2);
    createSide(size, -size/2, true); createSide(size, size/2, true);
    scene.add(fenceGroup);
}
createFencePerimeter(280);

function createBigHouse() {
    const houseGroup = new THREE.Group();
    const hFloor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({color: 0x8b4513}));
    hFloor.rotation.x = -Math.PI / 2; hFloor.position.y = 0.2;
    const wallGeo = new THREE.BoxGeometry(120, 30, 2);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
    const bWall = new THREE.Mesh(wallGeo, wallMat); bWall.position.set(0, 15, -60);
    const lWall = new THREE.Mesh(wallGeo, wallMat); lWall.rotation.y = Math.PI / 2; lWall.position.set(-60, 15, 0);
    houseGroup.add(hFloor, bWall, lWall);
    houseGroup.position.set(0, 0, -50);
    scene.add(houseGroup);
}
createBigHouse();

const tableCenter = new THREE.Vector3(0, 0, -50);
const chairs = [];
const tableGroup = new THREE.Group();
const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 1, 32), new THREE.MeshStandardMaterial({color: 0x5d4037}));
tableTop.position.y = 6;
tableGroup.add(tableTop);

for (let i = 0; i < 6; i++) {
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(5, 1.5, 5), new THREE.MeshStandardMaterial({color: 0x222222}));
    chair.add(seat);
    const angle = (i / 6) * Math.PI * 2;
    chair.position.set(Math.cos(angle) * 18, 0, Math.sin(angle) * 18);
    chair.lookAt(0, 0, 0);
    tableGroup.add(chair);
    chairs.push({ pos: new THREE.Vector3(chair.position.x, 0, chair.position.z - 50), rot: chair.rotation.y });
}
tableGroup.position.set(tableCenter.x, tableCenter.y, tableCenter.z);
scene.add(tableGroup);

// --- PLAYER MODELS ---
function createAmongUsModel(color) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 2.5), new THREE.MeshStandardMaterial({ color: color }));
    body.position.y = 3.5;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(3, 1.5, 1), new THREE.MeshStandardMaterial({ color: 0x88ccff }));
    visor.position.set(0, 4.5, 1);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(3, 3.5, 1), new THREE.MeshStandardMaterial({ color: color }));
    pack.position.set(0, 3.8, -1.2);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 1.2), new THREE.MeshStandardMaterial({ color: color }));
    legL.position.set(-1, 0.75, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 1.2), new THREE.MeshStandardMaterial({ color: color }));
    legR.position.set(1, 0.75, 0);
    group.add(body, visor, pack, legL, legR);
    group.userData.color = color; 
    return group;
}

function createPinkCowModel() {
    const cow = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 3), new THREE.MeshStandardMaterial({ color: 0xff69b4 }));
    body.position.y = 1;
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0xff69b4 }));
    head.position.set(0, 1.5, 1.5);
    cow.add(body, head);
    cow.scale.set(0.4, 0.4, 0.4);
    cow.name = "PinkCow";
    return cow;
}

function createPlayerMesh(index = 0) {
    const group = new THREE.Group();
    const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff];
    const character = createAmongUsModel(colors[index % 6]);
    group.add(character);
    const cow = createPinkCowModel();
    cow.position.y = 8; cow.visible = false;
    group.add(cow);
    return group;
}

let localPlayer = createPlayerMesh(0);
scene.add(localPlayer);
const remotePlayers = {};

// --- SOCKET EVENTS ---
socket.on('chatMessage', (data) => {
    let finalMsg = typeof data === 'string' ? data : (data.text || data.message || "...");
    let senderId = data.id || socket.id;
    let senderName = data.name || (senderId === socket.id ? myName : "Player");
    addChatMessage(`${senderName}: ${finalMsg}`, senderId === socket.id ? "#00ffcc" : "white");
    showBubbleOnPlayer(senderId, finalMsg);
});

// ADDED: Catch-all Vote Update (Handles multiple possible server event names)
const handleVoteSync = (data) => {
    if(!data) return;
    gameState.totalReady = typeof data.readyCount !== 'undefined' ? data.readyCount : (data.ready || gameState.totalReady);
    gameState.totalPlayers = typeof data.totalPlayers !== 'undefined' ? data.totalPlayers : (data.total || gameState.totalPlayers);
    updateVoteUI();
};

socket.on('updateVotes', handleVoteSync);
socket.on('lobbyState', handleVoteSync); // ADDED: Alternative event name catch

socket.on('receiveQuestion', (question) => {
    gameState.phase = 'PLAYING';
    uiContainer.style.display = 'none';
    herdGame.gameActive = true;
    herdGame.isSitting = true; 
    herdGame.isZoomed = true;
    herdGame.showQuestion(question);
    addChatMessage("ROUND START: " + question, "gold");
});

socket.on('updateScore', (newScore) => {
    gameState.score = Number(newScore);
    herdGame.score = Number(newScore);
    updateVoteUI();
});

socket.on('pinkCowUpdate', (pinkCowId) => {
    const isMe = pinkCowId === socket.id;
    gameState.hasPinkCow = isMe;
    localPlayer.getObjectByName("PinkCow").visible = isMe;
    if (isMe) addChatMessage("You hold the PINK COW!", "#ff69b4");
    updateVoteUI();
});

socket.on('currentPlayers', (players) => {
    Object.keys(players).forEach((id) => {
        if (id !== socket.id && !remotePlayers[id]) {
            remotePlayers[id] = createPlayerMesh(Object.keys(remotePlayers).length + 1);
            remotePlayers[id].userData.name = players[id].name || "Player";
            remotePlayers[id].userData.score = Number(players[id].score) || 0;
            remotePlayers[id].visible = true;
            scene.add(remotePlayers[id]);
        }
    });
    gameState.totalPlayers = Object.keys(players).length + 1; 
    updateVoteUI();
});

socket.on('playerMoved', (data) => {
    if (remotePlayers[data.id]) {
        const p = remotePlayers[data.id];
        p.position.set(data.x, data.isSitting ? 2.0 : 0, data.z);
        p.rotation.y = data.rot || 0;
        p.scale.set(1, data.isSitting ? 0.7 : 1, 1);
        p.visible = true; 
        
        if(data.name) p.userData.name = data.name; 
        if(typeof data.score !== 'undefined') p.userData.score = Number(data.score);
        
        const cow = p.getObjectByName("PinkCow");
        if(cow) {
            cow.visible = !!data.hasPinkCow;
            p.userData.hasPinkCow = !!data.hasPinkCow;
        }
    }
    updateVoteUI();
});

socket.on('playerDisconnected', (id) => {
    if (remotePlayers[id]) {
        scene.remove(remotePlayers[id]);
        delete remotePlayers[id];
    }
    updateVoteUI();
});

// --- CORE GAME LOOP ---
function updateTracker() {
    ctx.clearRect(0, 0, radar.width, radar.height);
    const scale = 0.3, centerX = radar.width/2, centerY = radar.height/2;
    const drawDot = (x, z, color, isLocal) => {
        const rx = centerX + (x * scale), rz = centerY + (z * scale);
        ctx.beginPath();
        ctx.arc(rx, rz, isLocal ? 5 : 4, 0, Math.PI * 2);
        ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        ctx.fill();
        if(isLocal) { ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke(); }
    };
    drawDot(localPlayer.position.x, localPlayer.position.z, localPlayer.children[0].userData.color, true);
    Object.values(remotePlayers).forEach(p => {
        drawDot(p.position.x, p.position.z, p.children[0].userData.color, false);
    });
}

let cameraAngle = 0;
const cameraRadius = 100, cameraHeight = 60;
window.keys = {};
window.addEventListener('keydown', e => window.keys[e.code] = true);
window.addEventListener('keyup', e => window.keys[e.code] = false);

function updateGame() {
    const speed = 0.8;
    let moved = false, moveX = 0, moveZ = 0;
    const isTyping = document.activeElement.tagName === 'INPUT';

    if (!isTyping) {
        if (keys['ArrowLeft']) cameraAngle -= 0.03;
        if (keys['ArrowRight']) cameraAngle += 0.03;
        if (keys['KeyW']) moveZ -= speed;
        if (keys['KeyS']) moveZ += speed;
        if (keys['KeyA']) moveX -= speed;
        if (keys['KeyD']) moveX += speed;
        if (isMobile) { moveX = joystickVector.x * speed; moveZ = joystickVector.y * speed; }

        if (Math.abs(moveX) > 0.1 || Math.abs(moveZ) > 0.1) {
            const fX = Math.sin(cameraAngle), fZ = Math.cos(cameraAngle);
            const rX = Math.cos(cameraAngle), rZ = -Math.sin(cameraAngle);
            localPlayer.position.x += (moveX * rX) + (moveZ * fX);
            localPlayer.position.z += (moveX * rZ) + (moveZ * fZ);
            localPlayer.rotation.y = Math.atan2(moveX, moveZ) + cameraAngle;
            if(gameState.isSeated) { gameState.isSeated = false; localPlayer.scale.set(1, 1, 1); }
            moved = true;
        }
    }

    if(!moved) {
        chairs.forEach(chair => {
            if (localPlayer.position.distanceTo(chair.pos) < 6) {
                localPlayer.position.set(chair.pos.x, 2.0, chair.pos.z);
                localPlayer.rotation.y = chair.rot;
                localPlayer.scale.set(1, 0.7, 1);
                gameState.isSeated = true;
            }
        });
    }

    // Camera Logic
    let pivot = localPlayer.position, rad = cameraRadius, h = cameraHeight, look = localPlayer.position;
    if (gameState.phase === 'PLAYING' || herdGame.isZoomed) {
        rad = 0.1; h = 12; look = new THREE.Vector3(tableCenter.x, 2, tableCenter.z);
        localPlayer.visible = false;
    } else if (gameState.isSeated) {
        pivot = tableCenter; rad = 45; h = 25; look = tableCenter;
        localPlayer.visible = true; 
    } else {
        localPlayer.visible = true; 
    }

    camera.position.lerp(new THREE.Vector3(pivot.x + Math.sin(cameraAngle) * rad, pivot.y + h, pivot.z + Math.cos(cameraAngle) * rad), 0.05);
    camera.lookAt(look);

    updateTracker();
    socket.emit('playerMovement', {
        x: localPlayer.position.x, z: localPlayer.position.z,
        rot: localPlayer.rotation.y, isSitting: gameState.isSeated,
        hasPinkCow: gameState.hasPinkCow, name: myName, score: gameState.score,
        room: "herd_lobby"
    });
}

function animate() {
    requestAnimationFrame(animate);
    updateGame();
    renderer.render(scene, camera);
}
animate();

// --- FAILSAFE: Trigger Room Join & Request State on Connect ---
socket.on('connect', () => {
    socket.emit('joinRoom', "herd_lobby");
    socket.emit('requestVoteUpdate'); // ADDED: Ask server for current vote numbers immediately
});

// Periodic UI and state refresh
setInterval(() => {
    if (gameState.phase !== 'PLAYING') {
        socket.emit('requestVoteUpdate'); // ADDED: Keep poll updated even if server is quiet
        updateVoteUI();
    }
}, 2000);