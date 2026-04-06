import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// --- CONFIG & UI ---
const socket = window.io ? window.io() : null;
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

const remotePlayers = {};
const playerStates = {}; 

// --- AUDIO SYSTEM ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let nextStepTime = 0;
let npcNextStepTime = 0;

function playStepSound(volume = 0.1, pitch = 1) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(400 * pitch, audioCtx.currentTime);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150 * pitch, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40 * pitch, audioCtx.currentTime + 0.1);

    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

if (socket) {
    socket.on('connect', () => {
        addChatMessage("SYSTEM", `Connected: ${socket.id.substring(0,5)}`, "#00ffcc");
    });
}

// Main Game UI (Scaled for Mobile)
const ui = document.createElement('div');
ui.style = `position:fixed; top:10px; left:10px; color:black; font-family:monospace; background:rgba(255,255,255,0.9); padding:${isMobile ? '8px' : '15px'}; border:2px solid #000; z-index:1000; min-width:${isMobile ? '120px' : '200px'}; font-size:${isMobile ? '10px' : '12px'};`;
ui.innerHTML = `
    <div style="font-weight:bold; border-bottom:1px solid #000; margin-bottom:5px;">EXIT 8 PROTOCOL</div>
    <div id="status">LOOPS: 0</div>
    <div id="vote-ui" style="margin-top:10px;">
        <button id="vote-yes" style="cursor:pointer; background:#ff4444; color:white; border:none; padding:5px; margin-bottom:2px; width:100%;">YES (BACK)</button>
        <button id="vote-no" style="cursor:pointer; background:#44ff44; border:none; padding:5px; width:100%;">NO (FORW)</button>
        <div id="vote-count" style="font-size:9px; margin-top:5px;">Votes: 0 (Y:0 N:0)</div>
    </div>
    <div style="font-size:8px; margin-top:5px; color:#666;">${isMobile ? 'USE BUTTONS TO MOVE' : 'HOLD [TAB] FOR CHECKLIST'}</div>
`;
document.body.appendChild(ui);

// Mobile Toggle Tablet Button
if(isMobile) {
    const tabBtn = document.createElement('button');
    tabBtn.innerText = "LOG";
    tabBtn.style = "position:fixed; top:10px; right:10px; width:50px; height:50px; border-radius:50%; background:rgba(0,255,0,0.3); color:white; border:2px solid #0f0; z-index:2001; font-family:monospace;";
    let logOpen = false;
    tabBtn.onclick = () => {
        logOpen = !logOpen;
        keys['tab'] = logOpen;
        tabletUI.style.bottom = logOpen ? "20px" : "-600px";
        tabBtn.style.background = logOpen ? "rgba(0,255,0,0.8)" : "rgba(0,255,0,0.3)";
    };
    document.body.appendChild(tabBtn);

    // Mobile Movement Buttons
    const moveUI = document.createElement('div');
    moveUI.style = "position:fixed; bottom:20px; left:20px; z-index:2001; display:flex; flex-direction:column; gap:10px;";
    moveUI.innerHTML = `
        <button id="m-up" style="width:60px; height:60px; background:rgba(255,255,255,0.5); border:2px solid #000;">▲</button>
        <button id="m-down" style="width:60px; height:60px; background:rgba(255,255,255,0.5); border:2px solid #000;">▼</button>
    `;
    document.body.appendChild(moveUI);
    
    const setupBtn = (id, key) => {
        const btn = document.getElementById(id);
        btn.ontouchstart = (e) => { e.preventDefault(); keys[key] = true; if(audioCtx.state==='suspended') audioCtx.resume(); };
        btn.ontouchend = () => { keys[key] = false; };
    };
    setupBtn('m-up', 'w');
    setupBtn('m-down', 's');
}

// HTML Overlay
const tabletUI = document.createElement('div');
tabletUI.id = "tablet-ui";
tabletUI.style = `position:fixed; bottom:-600px; right:${isMobile ? '10px' : '50px'}; width:${isMobile ? '220px' : '280px'}; background:#111; color:#0f0; font-family:monospace; padding:15px; border:5px solid #444; border-radius:15px; z-index:2000; transition: bottom 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); box-shadow: 0 0 20px rgba(0,0,0,0.8); font-size: 10px;`;
tabletUI.innerHTML = `
    <div style="text-align:center; border-bottom:1px solid #0f0; padding-bottom:5px; margin-bottom:10px;">ANOMALY LOG v2.0</div>
    <ul id="list-content" style="list-style:none; padding:0; line-height:1.2;">
        <li>[ ] 01: Ceiling Sign</li>
        <li>[ ] 02: Giant Resident</li>
        <li>[ ] 03: Macrocephaly</li>
        <li>[ ] 04: Blackout</li>
        <li>[ ] 05: Distorted Media</li>
        <li>[ ] 06: Faceless Entity</li>
        <li>[ ] 07: Missing Luggage</li>
        <li>[ ] 08: Compression</li>
        <li>[ ] 09: Red Light</li>
        <li>[ ] 10: Tilted Dimension</li>
        <li>[ ] 11: Speedster</li>
        <li>[ ] 12: Reverse Gravity</li>
    </ul>
`;
document.body.appendChild(tabletUI);

// --- PLAYERS MENU UI ---
const playerMenu = document.createElement('div');
playerMenu.style = `position:fixed; top:${isMobile ? '130px' : '20px'}; right:20px; width:${isMobile ? '100px' : '180px'}; background:rgba(0,0,0,0.8); color:white; font-family:monospace; padding:5px; border:1px solid #555; z-index:1000; font-size:${isMobile ? '8px' : '12px'};`;
playerMenu.innerHTML = `<div style="border-bottom:1px solid #555; text-align:center;">USERS</div><div id="player-list"></div>`;
document.body.appendChild(playerMenu);

function updatePlayerUI(players) {
    const list = document.getElementById('player-list');
    if(!list) return;
    list.innerHTML = "";
    Object.values(players).forEach(p => {
        const pEl = document.createElement('div');
        pEl.innerText = `• ${p.name || 'Guest'}${p.id === socket.id ? '*' : ''}`;
        list.appendChild(pEl);
    });
}

// Chat UI
const chatBox = document.createElement('div');
chatBox.style = `position:fixed; bottom:${isMobile ? '20px' : '20px'}; left:${isMobile ? '100px' : '20px'}; width:${isMobile ? '180px' : '300px'}; height:${isMobile ? '80px' : '200px'}; background:rgba(0,0,0,0.7); color:white; font-family:monospace; padding:5px; overflow-y:auto; z-index:1000; display:flex; flex-direction:column; font-size:${isMobile ? '9px' : '12px'};`;
chatBox.innerHTML = `<div id="messages" style="flex-grow:1; overflow-y:auto;"></div><input id="chat-input" placeholder="Chat..." style="background:none; border:none; border-top:1px solid #555; color:white; outline:none; font-size:10px;">`;
document.body.appendChild(chatBox);

const SENSITIVITY = isMobile ? 0.005 : 0.002;
const LERP_SPEED = 0.15;
const rotation = { x: 0, y: 0 };
const targetRotation = { x: 0, y: 0 };

let isAnomalyRound = false;
let currentLoop = 0;
let npcSpeed = 0.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

const keys = {};

// --- DYNAMIC TEXTURE FOR TABLET SCREEN ---
const canvas = document.createElement('canvas');
canvas.width = 512;
canvas.height = 768;
const ctx = canvas.getContext('2d');

function updateTabletCanvas() {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f0';
    ctx.font = 'bold 30px monospace';
    ctx.fillText('ANOMALY LOG v2.0', 100, 60);
    ctx.beginPath(); ctx.moveTo(20, 80); ctx.lineTo(492, 80); ctx.strokeStyle = '#0f0'; ctx.stroke();
    ctx.font = '22px monospace';
    const list = ["01: Ceiling Signs", "02: Giant Resident", "03: Macrocephaly", "04: Blackout", "05: Distorted Media", "06: Faceless Entity", "07: Missing Luggage", "08: Compression", "09: Red Light", "10: Tilted Hall", "11: Speedster", "12: Rev Gravity"];
    list.forEach((item, i) => { ctx.fillText(`[ ] ${item}`, 40, 130 + (i * 50)); });
    tabletTexture.needsUpdate = true;
}

const tabletTexture = new THREE.CanvasTexture(canvas);

// --- FIRST PERSON TABLET MODEL ---
const fpsGroup = new THREE.Group();
camera.add(fpsGroup);
scene.add(camera);

const fpsArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.8), new THREE.MeshStandardMaterial({color: 0xffdbac}));
fpsArm.position.set(0.4, -0.5, -0.4);
fpsArm.rotation.x = -0.6;

const fpsTablet = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.05), new THREE.MeshStandardMaterial({color: 0x222222}));
fpsTablet.position.set(0.3, -0.1, -0.8);
fpsTablet.rotation.x = -0.2;

const tabletScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75), new THREE.MeshBasicMaterial({map: tabletTexture}));
tabletScreen.position.z = 0.03;
fpsTablet.add(tabletScreen);

fpsGroup.add(fpsArm, fpsTablet);
fpsGroup.position.y = -2; 
updateTabletCanvas();

// --- ENVIRONMENT ---
const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
const floorMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.1 });
let hallwayGroup = new THREE.Group();
scene.add(hallwayGroup);

function createHallway() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 120), floorMat);
    floor.rotation.x = -Math.PI / 2;
    hallwayGroup.add(floor);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(14, 120), wallMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 9;
    hallwayGroup.add(ceiling);
    const wallGeo = new THREE.BoxGeometry(0.5, 9, 120);
    const leftW = new THREE.Mesh(wallGeo, wallMat);
    leftW.position.set(-7, 4.5, 0);
    const rightW = new THREE.Mesh(wallGeo, wallMat);
    rightW.position.set(7, 4.5, 0);
    hallwayGroup.add(leftW, rightW);
    for (let z = -50; z <= 50; z += 12) {
        const lightBox = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 1.5), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        lightBox.position.set(0, 8.9, z);
        hallwayGroup.add(lightBox);
        const pLight = new THREE.PointLight(0xffffff, 12, 30);
        pLight.position.set(0, 8, z);
        hallwayGroup.add(pLight);
    }
}
createHallway();

// --- HUMAN COP CREATION ---
function createCopHuman(color = 0x1e3a8a) {
    const human = new THREE.Group();
    const pantsMat = new THREE.MeshStandardMaterial({color: 0x111111});
    const shirtMat = new THREE.MeshStandardMaterial({color: color});
    const skinMat = new THREE.MeshStandardMaterial({color: 0xffdbac});

    const lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.2, 0.3), pantsMat);
    lLeg.position.set(-0.2, 0.6, 0);
    const rLeg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.2, 0.3), pantsMat);
    rLeg.position.set(0.2, 0.6, 0);
    human.add(lLeg, rLeg);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.3, 0.5), shirtMat);
    torso.position.y = 1.85;
    human.add(torso);

    const lArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 0.2), shirtMat);
    lArm.position.set(-0.45, 1.85, 0);
    const rArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 0.2), shirtMat);
    rArm.position.set(0.45, 1.85, 0);
    const tablet = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.05), new THREE.MeshStandardMaterial({color: 0x000000}));
    tablet.position.set(0.45, 1.3, 0.1);
    tablet.rotation.x = -0.3;
    human.add(lArm, rArm, tablet);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), skinMat);
    head.position.y = 2.7;
    const hat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.45), pantsMat);
    hat.position.y = 0.25;
    head.add(hat);
    human.add(head);
    human.userData = { lLeg, rLeg, lArm, rArm, head, isWalking: false, walkCycle: 0 };
    return human;
}

// --- NPC CREATION ---
function createHuman() {
    const human = new THREE.Group();
    const blackMat = new THREE.MeshStandardMaterial({color: 0x111111});
    const suitMat = new THREE.MeshStandardMaterial({color: 0x222233});
    const skinMat = new THREE.MeshStandardMaterial({color: 0xffdbac});

    const lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.2, 0.3), blackMat);
    lLeg.position.set(-0.2, 0.6, 0);
    const rLeg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.2, 0.3), blackMat);
    rLeg.position.set(0.2, 0.6, 0);
    human.add(lLeg, rLeg);

    const coat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.3, 0.5), suitMat);
    coat.position.y = 1.85;
    human.add(coat);

    const lArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 0.2), suitMat);
    lArm.position.set(-0.45, 1.85, 0);
    human.add(lArm);

    const rArmGroup = new THREE.Group(); 
    const rArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 0.2), suitMat);
    rArmMesh.position.set(0.45, 1.85, 0);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), skinMat);
    hand.position.set(0.45, 1.3, 0);
    const suitcase = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 1.1), new THREE.MeshStandardMaterial({color: 0x3d2b1f}));
    suitcase.position.set(0.45, 0.8, 0);
    rArmGroup.add(rArmMesh, hand, suitcase);
    human.add(rArmGroup);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), skinMat);
    head.position.y = 2.7;
    const lEye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshBasicMaterial({color: 0x000000})); 
    lEye.position.set(-0.1, 0.05, 0.21);
    const rEye = lEye.clone(); rEye.position.set(0.1, 0.05, 0.21);
    head.add(lEye, rEye);
    human.add(head);
    human.userData = { lLeg, rLeg, lArm, rArmGroup, suitcase, head, coat, walkCycle: 0 };
    return human;
}
const npc = createHuman();
scene.add(npc);

const meshes = { doors: [], posters: [], signs: [] };
function setupStaticItems() {
    const doorGeo = new THREE.BoxGeometry(0.2, 7, 4);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    [-20, 0, 20].forEach(z => {
        const d = new THREE.Mesh(doorGeo, doorMat); d.position.set(-6.7, 3.5, z);
        scene.add(d); meshes.doors.push(d);
    });
    const colors = [0xff5555, 0x55ff55, 0x5555ff, 0xffff55, 0xff55ff];
    const posterGeo = new THREE.PlaneGeometry(2.5, 3.5);
    [-30, -10, 5, 15, 35, -45, 45].forEach((z, i) => {
        const p = new THREE.Mesh(posterGeo, new THREE.MeshStandardMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide }));
        p.position.set(6.7, 5, z); p.rotation.y = -Math.PI / 2;
        scene.add(p); meshes.posters.push(p);
    });
    [-25, 0, 25].forEach(z => {
        const s = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 0.2), new THREE.MeshStandardMaterial({color: 0xffff00}));
        s.position.set(0, 7.5, z);
        scene.add(s); meshes.signs.push(s);
    });
}
setupStaticItems();

// --- MULTIPLAYER SYNC ---
if(socket) {
    socket.on('playerUpdates', (players) => {
        updatePlayerUI(players);
        Object.keys(players).forEach(id => {
            if (id === socket.id) return;
            if (!remotePlayers[id]) {
                remotePlayers[id] = createCopHuman();
                scene.add(remotePlayers[id]);
                playerStates[id] = { lastZ: 0 };
            }
            const p = players[id];
            remotePlayers[id].userData.isWalking = Math.abs(p.z - (playerStates[id].lastZ || 0)) > 0.01;
            playerStates[id].lastZ = p.z;
            remotePlayers[id].position.set(p.x, p.y - 4, p.z);
            remotePlayers[id].rotation.y = p.yaw || 0;
        });
    });
    socket.on('playerMoved', (data) => {
        if (remotePlayers[data.id]) {
            remotePlayers[data.id].position.set(data.x, data.y - 4, data.z);
            remotePlayers[data.id].rotation.y = data.yaw || 0;
        }
    });
    socket.on('playerDisconnected', (id) => {
        if (remotePlayers[id]) { scene.remove(remotePlayers[id]); delete remotePlayers[id]; delete playerStates[id]; }
    });
    socket.on('exit8VoteUpdate', (data) => {
        document.getElementById('vote-count').innerText = `Votes: ${data.total} (Y:${data.yes} N:${data.no})`;
    });
    socket.on('chat', (data) => {
        const sender = data.id === socket.id ? "YOU" : (data.user || "USER");
        addChatMessage(sender, data.message, data.id === socket.id ? "#00ffcc" : "#eee");
    });
}

document.getElementById('vote-yes').onclick = () => { if(socket) socket.emit('exit8Vote', 'yes'); };
document.getElementById('vote-no').onclick = () => { if(socket) socket.emit('exit8Vote', 'no'); };

function resetAnomalies() {
    scene.background = new THREE.Color(0xffffff);
    npc.scale.set(1,1,1); npc.userData.head.scale.set(1,1,1);
    npc.userData.head.visible = true; npc.userData.suitcase.visible = true;
    npcSpeed = 0.08; hallwayGroup.rotation.z = 0;
    meshes.signs.forEach(s => { s.position.y = 7.5; s.scale.set(1,1,1); s.material.color.set(0xffff00); });
    meshes.doors.forEach(d => d.scale.set(1,1,1));
    meshes.posters.forEach(p => { p.rotation.z = 0; p.scale.set(1,1,1); p.position.y = 5; });
    hallwayGroup.scale.x = 1;
}

function applyAnomaly(type) {
    if(type === 1) meshes.signs[0].position.y = 4;
    if(type === 2) npc.scale.set(2, 2, 2);
    if(type === 3) npc.userData.head.scale.set(4, 4, 4);
    if(type === 4) scene.background = new THREE.Color(0x000000);
    if(type === 5) meshes.posters.forEach(p => p.rotation.z = Math.PI / 4);
    if(type === 6) npc.userData.head.visible = false;
    if(type === 7) npc.userData.suitcase.visible = false;
    if(type === 8) hallwayGroup.scale.x = 0.3;
    if(type === 9) meshes.signs.forEach(s => s.material.color.set(0xff0000));
    if(type === 10) hallwayGroup.rotation.z = 0.2;
    if(type === 11) npcSpeed = 0.5;
    if(type === 12) meshes.posters.forEach(p => p.position.y = 8);
}

function nextRound(dir) {
    const isCorrect = (dir === "forward" && !isAnomalyRound) || (dir === "backward" && isAnomalyRound);
    currentLoop = isCorrect ? currentLoop + 1 : 0;
    document.getElementById('status').innerText = `LOOPS: ${currentLoop}`;
    addChatMessage("SYSTEM", isCorrect ? "Proceed..." : "RESETTING", isCorrect ? "#00ff00" : "#ff0000");
    if(socket) socket.emit('resetExit8Votes');
    resetAnomalies();
    isAnomalyRound = Math.random() > 0.4;
    npc.position.set(0, 0, -50);
    if (isAnomalyRound) applyAnomaly(Math.floor(Math.random() * 12) + 1);
}

function addChatMessage(user, msg, color = "#fff") {
    const m = document.getElementById('messages');
    if(m) {
        const div = document.createElement('div');
        div.style.color = color; div.innerHTML = `<b>${user}:</b> ${msg}`;
        m.appendChild(div); m.scrollTop = m.scrollHeight;
    }
}

// --- TOUCH & MOUSE CONTROLS ---
if (!isMobile) {
    renderer.domElement.addEventListener('click', () => { 
        renderer.domElement.requestPointerLock(); 
        if (audioCtx.state === 'suspended') audioCtx.resume();
    });
}

window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === renderer.domElement || isMobile) {
        let mult = isMobile ? 1.5 : 1.0;
        targetRotation.y -= e.movementX * SENSITIVITY * mult;
        targetRotation.x -= e.movementY * SENSITIVITY * mult;
        targetRotation.x = Math.max(-1.4, Math.min(1.4, targetRotation.x));
    }
});

// Mobile Touch Look
if(isMobile) {
    let lastTouchX = 0, lastTouchY = 0;
    renderer.domElement.ontouchstart = (e) => { 
        lastTouchX = e.touches[0].pageX; 
        lastTouchY = e.touches[0].pageY; 
        if(audioCtx.state==='suspended') audioCtx.resume(); 
    };
    renderer.domElement.ontouchmove = (e) => {
        const dx = e.touches[0].pageX - lastTouchX;
        const dy = e.touches[0].pageY - lastTouchY;
        targetRotation.y -= dx * SENSITIVITY;
        targetRotation.x -= dy * SENSITIVITY;
        targetRotation.x = Math.max(-1.4, Math.min(1.4, targetRotation.x));
        lastTouchX = e.touches[0].pageX;
        lastTouchY = e.touches[0].pageY;
    };
}

window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === "Tab") { e.preventDefault(); tabletUI.style.bottom = "20px"; }
    if (e.key === "Enter") {
        const input = document.getElementById('chat-input');
        if (input && input.value) { if(socket) socket.emit('chat', { message: input.value }); input.value = ""; }
    }
});

window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
    if (e.key === "Tab") { tabletUI.style.bottom = "-600px"; }
});

// --- ANIMATION LOOP ---
camera.position.set(0, 5, 50);
function animate() {
    requestAnimationFrame(animate);
    const dt = 0.05;
    const now = audioCtx.currentTime;
    const time = Date.now() * 0.002;

    rotation.x += (targetRotation.x - rotation.x) * LERP_SPEED;
    rotation.y += (targetRotation.y - rotation.y) * LERP_SPEED;
    camera.rotation.set(rotation.x, rotation.y, 0, 'YXZ');

    const moveSpeed = 0.15;
    let isMoving = false;
    if (keys['w']) { camera.translateZ(-moveSpeed); isMoving = true; }
    if (keys['s']) { camera.translateZ(moveSpeed); isMoving = true; }
    camera.position.x = Math.max(-6, Math.min(6, camera.position.x));
    camera.position.y = 5;

    if (isMoving && now > nextStepTime) {
        playStepSound(0.05, 1.2);
        nextStepTime = now + 0.35;
    }

    // Tablet FPS Animation
    if (keys['tab']) {
        fpsGroup.position.y += (0 - fpsGroup.position.y) * 0.2;
        fpsGroup.rotation.z = Math.sin(time * 2) * 0.05;
        fpsGroup.rotation.x = Math.cos(time * 1.5) * 0.05;
    } else {
        fpsGroup.position.y += (-2.5 - fpsGroup.position.y) * 0.1;
    }

    if(socket && socket.connected) {
        socket.emit('playerMovement', { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: rotation.y });
    }

    // NPC Logic
    npc.position.z += npcSpeed;
    if(npc.position.z > 60) npc.position.z = -60;
    const dist = camera.position.distanceTo(npc.position);
    if (dist < 20 && now > npcNextStepTime) {
        const vol = Math.max(0, 0.1 * (1 - dist/20));
        playStepSound(vol, 0.8);
        npcNextStepTime = now + (0.4 / (npcSpeed / 0.08));
    }

    npc.userData.walkCycle += dt * 5;
    npc.userData.lLeg.rotation.x = Math.sin(npc.userData.walkCycle) * 0.5;
    npc.userData.rLeg.rotation.x = -Math.sin(npc.userData.walkCycle) * 0.5;
    npc.userData.lArm.rotation.x = -Math.sin(npc.userData.walkCycle) * 0.5;
    npc.userData.rArmGroup.rotation.x = Math.sin(npc.userData.walkCycle) * 0.5;

    Object.values(remotePlayers).forEach(p => {
        if(p.userData.isWalking) {
            p.userData.walkCycle += dt * 5;
            p.userData.lLeg.rotation.x = Math.sin(p.userData.walkCycle) * 0.5;
            p.userData.rLeg.rotation.x = -Math.sin(p.userData.walkCycle) * 0.5;
        } else {
            p.userData.lLeg.rotation.x *= 0.8; p.userData.rLeg.rotation.x *= 0.8;
        }
    });

    if (camera.position.z < -55) { camera.position.z = 50; nextRound("forward"); }
    if (camera.position.z > 60) { camera.position.z = 50; nextRound("backward"); }

    renderer.render(scene, camera);
}
animate();