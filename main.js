import * as THREE from 'three';
import { initChat } from './chatbox.js'; 
import { initWorld } from './world.js';
import { initMultiplayer } from './multiplayer.js';
import { MobileControls } from './mobile-controls.js';

// --- 1. DEVICE DETECTION ---
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window);
const mobile = new MobileControls();

const CURRENT_ROOM = "lobby"; 

const statusEl = document.getElementById('status');
if (statusEl) {
    statusEl.innerText = isMobile ? "📱 Mobile Mode" : "💻 Desktop Mode";
    statusEl.style.color = isMobile ? "#00ffcc" : "#fbff00";
}

// --- 2. SETTINGS & DATA ---
const spawnPos = { x: 0, y: 0, z: 60 };
const playerSpeed = 0.3;
const jumpForce = 0.25; 
const gravity = -0.01;
const LERP_FACTOR = 0.15; 
let isEnteringPortal = false;
let isSitting = false; // New: Track seating state

// --- SOCKET SETUP ---
const socket = io(); 
window.gameSocket = socket; 
window.dispatchEvent(new CustomEvent('socketReady', { detail: socket }));

const remotePlayers = {};
const colliders = [];
const seats = [];
const portals = []; 
const playerListUI = document.getElementById('player-list');

let lastTouchX = 0;
let lastTouchY = 0;

// --- 3. CORE SETUP ---
const scene = new THREE.Scene();
// Note: Background and Fog are now handled by the Sky in world.js
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const ambient = new THREE.AmbientLight(0xffffff, 0.5); scene.add(ambient);
const sun = new THREE.DirectionalLight(0xfff5e1, 1.2); sun.position.set(200, 500, 200); scene.add(sun);

// --- 4. WORLD LIMITS ---
const mapSize = 250; 
const glassHeight = 20;
const glassGeo = new THREE.BoxGeometry(mapSize, glassHeight, mapSize);
const glassMat = new THREE.MeshStandardMaterial({
    color: 0x00ffff, 
    transparent: true, 
    opacity: 0.1,
    side: THREE.BackSide,
    metalness: 0.5,
    roughness: 0.1
});
const glassFence = new THREE.Mesh(glassGeo, glassMat);
glassFence.position.y = glassHeight / 2;
scene.add(glassFence);

const edges = new THREE.EdgesGeometry(glassGeo);
const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.3 }));
line.position.copy(glassFence.position);
scene.add(line);

const half = mapSize / 2;
colliders.push(new THREE.Box3(new THREE.Vector3(-half-1, 0, -half), new THREE.Vector3(-half, glassHeight, half)));
colliders.push(new THREE.Box3(new THREE.Vector3(half, 0, -half), new THREE.Vector3(half+1, glassHeight, half)));
colliders.push(new THREE.Box3(new THREE.Vector3(-half, 0, -half-1), new THREE.Vector3(half, glassHeight, -half)));
colliders.push(new THREE.Box3(new THREE.Vector3(-half, 0, half), new THREE.Vector3(half, glassHeight, half+1)));

// --- 5. CHAT BUBBLE LOGIC ---
function createChatBubble(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 512; canvas.height = 128;
    ctx.fillStyle = 'rgba(10, 10, 20, 0.9)';
    ctx.beginPath(); ctx.roundRect(10, 10, 492, 108, 25); ctx.fill();
    ctx.strokeStyle = '#00f2ff'; ctx.lineWidth = 6; ctx.stroke();
    ctx.font = 'bold 36px Courier New'; ctx.fillStyle = 'white'; ctx.textAlign = 'center';
    ctx.fillText(text, 256, 75);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sprite.scale.set(7, 1.75, 1);
    return sprite;
}

window.addEventListener('show3DBubble', (e) => {
    const { id, message } = e.detail;
    let target = (id === socket.id) ? localPlayer : (remotePlayers[id] ? remotePlayers[id].mesh : null);
    if (target) {
        const old = target.getObjectByName('chatBubble');
        if (old) target.remove(old);
        const bubble = createChatBubble(message);
        bubble.name = 'chatBubble';
        bubble.position.set(0, 5, 0); 
        target.add(bubble);
        setTimeout(() => { if(target) target.remove(bubble); }, 5000);
    }
});

// --- UTILITY ---
function createTextSprite(text, color = "white") {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 512; canvas.height = 128;
    ctx.font = 'bold 60px Courier New'; ctx.fillStyle = color; ctx.textAlign = 'center';
    ctx.fillText(text, 256, 80);
    const tex = new THREE.CanvasTexture(canvas);
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
}

function updatePlayerList() {
    if(!playerListUI) return;
    playerListUI.innerHTML = '<li style="color: #fbff00;">● You</li>';
    Object.keys(remotePlayers).forEach(id => {
        const li = document.createElement('li');
        li.innerText = `● Guest_${id.substring(0,4)}`;
        playerListUI.appendChild(li);
    });
}

// --- 6. PLAYER MODEL ---
const localPlayer = new THREE.Group();
const charGroup = new THREE.Group();

function applyPlayerShape() {
    charGroup.clear();
    const torsoMat = new THREE.MeshStandardMaterial({color: 0x00aaff});
    const headMat = new THREE.MeshStandardMaterial({color: 0xffdbac});
    const legMat = new THREE.MeshStandardMaterial({color: 0x333333});
    
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.4), torsoMat); torso.position.y = 1.3;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), headMat); head.position.y = 2.2;
    
    window.lArm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 0.3), torsoMat); lArm.position.set(-0.6, 1.3, 0);
    window.rArm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 0.3), torsoMat); rArm.position.set(0.6, 1.3, 0);
    window.lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1, 0.35), legMat); lLeg.position.set(-0.25, 0.5, 0);
    window.rLeg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1, 0.35), legMat); rLeg.position.set(0.25, 0.5, 0);
    
    window.foodModel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({color: 0xffcc00}));
    foodModel.position.set(0, -0.6, 0); foodModel.visible = false; rArm.add(foodModel);
    
    charGroup.add(torso, head, lArm, rArm, lLeg, rLeg);
}

applyPlayerShape();
localPlayer.add(charGroup);
localPlayer.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
scene.add(localPlayer);

// --- 7. INTERACTIONS & SEATING ---
function tryToSit() {
    let nearestSeat = null;
    let minDist = 6;
    seats.forEach(seat => {
        const dist = localPlayer.position.distanceTo(seat.pos);
        if (dist < minDist) { nearestSeat = seat; }
    });

    if (nearestSeat) {
        localPlayer.position.copy(nearestSeat.pos);
        yaw = nearestSeat.rot; // Face the table
        isSitting = true;
    } else {
        isSitting = false;
    }
}

// --- 8. ASSETS & MODULES ---
const truck = new THREE.Group();
const tBody = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 16), new THREE.MeshStandardMaterial({color: 0xdddddd}));
tBody.position.y = 4; truck.add(tBody);
const truckTV = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4, 6), new THREE.MeshBasicMaterial({color: 0x00ffff}));
truckTV.position.set(5.1, 5, 0); truck.add(truckTV);
truck.position.set(-60, 0, 0); scene.add(truck);
colliders.push(new THREE.Box3().setFromObject(tBody));

const vending = new THREE.Group();
const vBody = new THREE.Mesh(new THREE.BoxGeometry(4, 9, 4), new THREE.MeshStandardMaterial({color: 0xcc0000}));
vBody.position.y = 4.5; vending.add(vBody);
vending.position.set(-40, 0, -30); scene.add(vending);
colliders.push(new THREE.Box3().setFromObject(vBody));

const portalConfigs = [
    { name: "Herd Mentality", url: "herdmentality.html", x: 22.5, z: 80, color: 0xff00ff },
    { name: "Mystery Game", url: "race.html", x: 7.5, z: 80, color: 0x00ff00 },
    { name: "The Calling", url: "callinggame.html", x: -7.5, z: 80, color: 0xffaa00 },
    { name: "Battle Arena", url: "hunt.html", x: -22.5, z: 80, color: 0x00ffff }
];

portalConfigs.forEach(conf => {
    const pGroup = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.4, 16, 100), new THREE.MeshBasicMaterial({ color: conf.color, wireframe: true }));
    pGroup.add(ring);
    const label = createTextSprite(conf.name, "#" + conf.color.toString(16));
    label.position.y = 5; pGroup.add(label);
    pGroup.position.set(conf.x, 3.5, conf.z);
    pGroup.userData.url = conf.url;
    scene.add(pGroup);
    portals.push(pGroup);
});

initChat(socket);
initWorld(scene, colliders, seats, portals, createTextSprite);
initMultiplayer(socket, scene, localPlayer, remotePlayers, createTextSprite, updatePlayerList, CURRENT_ROOM);

// --- 9. LOGIC & INPUTS ---
let velocityY = 0, pitch = 0, yaw = 0, walkTime = 0, vShake = 0;
const keys = {};
let isTyping = false, isLeftMouseDown = false;
let inventory = [null, null, null];
let activeSlot = 0;

const cInput = document.getElementById('chat-input');
if(cInput) {
    cInput.addEventListener('focus', () => { isTyping = true; });
    cInput.addEventListener('blur', () => { isTyping = false; });
}

window.addEventListener('slotChanged', (e) => { 
    activeSlot = e.detail; updateInventoryUI(); checkHandItem(); 
});
window.addEventListener('mobileJump', () => { 
    if(localPlayer.position.y <= 0.05) { velocityY = jumpForce; isSitting = false; }
});
window.addEventListener('itemOrdered', (e) => {
    inventory[activeSlot] = e.detail; updateInventoryUI(); checkHandItem();
});

function updateInventoryUI() {
    for(let i = 0; i < 3; i++) {
        const slot = document.getElementById(`slot-${i}`);
        if(slot) {
            slot.innerText = inventory[i] ? inventory[i][0] : (i + 1);
            i === activeSlot ? slot.classList.add('active') : slot.classList.remove('active');
        }
    }
}

function checkHandItem() {
    if (!window.foodModel) return;
    const item = inventory[activeSlot];
    foodModel.visible = !!item;
    if(item) foodModel.material.color.setHex(item === 'Cola' ? 0x2222aa : 0xffcc00);
}

function handleInteractions(clientX, clientY) {
    const mouse = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    if (raycaster.intersectObject(truckTV).length > 0) {
        document.getElementById('cooking-menu')?.classList.remove('hidden');
    }
    if (raycaster.intersectObject(vending).length > 0) { 
        vShake = 20; window.dispatchEvent(new CustomEvent('itemOrdered', {detail: 'Cola'})); 
    }
}

document.addEventListener('mousemove', e => {
    if (isLeftMouseDown && !isTyping) {
        yaw -= e.movementX * 0.004;
        pitch = Math.max(-0.8, Math.min(0.8, pitch - e.movementY * 0.004));
    }
});

window.addEventListener('touchstart', e => {
    const touch = e.touches[0];
    if(touch.target.id === 'jump-btn' || touch.target.classList.contains('slot') || touch.target.closest('#joystick-container') || touch.target.id === 'chat-input') return;
    isLeftMouseDown = true;
    lastTouchX = touch.clientX; lastTouchY = touch.clientY;
    handleInteractions(touch.clientX, touch.clientY);
}, { passive: false });

window.addEventListener('touchmove', e => {
    if (isLeftMouseDown && !isTyping) {
        const touch = e.touches[0];
        yaw -= (touch.clientX - lastTouchX) * 0.006; 
        pitch = Math.max(-0.8, Math.min(0.8, pitch - (touch.clientY - lastTouchY) * 0.006));
        lastTouchX = touch.clientX; lastTouchY = touch.clientY;
    }
}, { passive: false });

window.addEventListener('mousedown', e => { 
    if(e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON' && !e.target.classList.contains('slot')) {
        isLeftMouseDown = true; handleInteractions(e.clientX, e.clientY); 
    }
});

window.addEventListener('mouseup', () => isLeftMouseDown = false);
window.addEventListener('touchend', () => isLeftMouseDown = false);

window.addEventListener('keydown', e => {
    if(isTyping) return;
    keys[e.code] = true;
    if(e.code === 'KeyE') tryToSit();
    if(['Digit1','Digit2','Digit3'].includes(e.code)) {
        window.dispatchEvent(new CustomEvent('slotChanged', {detail: parseInt(e.code.replace('Digit','')) - 1}));
    }
});
window.addEventListener('keyup', e => keys[e.code] = false);

// --- 10. ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);
    const time = Date.now() * 0.002;

    truck.position.y = Math.abs(Math.sin(time)) * 0.1;
    if (vShake > 0) { vending.position.x = -40 + Math.sin(Date.now() * 0.5) * 0.3; vShake--; } 
    
    portals.forEach(p => {
        p.rotation.y += 0.01;
        p.children[0].rotation.z += 0.03;
    });

    Object.values(remotePlayers).forEach(p => {
        p.mesh.position.lerp(p.targetPos, LERP_FACTOR);
        p.mesh.rotation.y = THREE.MathUtils.lerp(p.mesh.rotation.y, p.targetYaw, LERP_FACTOR);
    });

    let moving = false;
    if (!isTyping) { 
        let x = 0, z = 0;
        if (keys['KeyW']) z = -playerSpeed;
        if (keys['KeyS']) z = playerSpeed;
        if (keys['KeyA']) x = -playerSpeed;
        if (keys['KeyD']) x = playerSpeed;

        if (isMobile && mobile.moveVector) {
            x = mobile.moveVector.x * playerSpeed;
            z = mobile.moveVector.z * playerSpeed;
        }

        if(x !== 0 || z !== 0) {
            moving = true;
            isSitting = false; // Standing up if moving
            localPlayer.rotation.y = yaw;
            const move = new THREE.Vector3(x, 0, z).applyQuaternion(localPlayer.quaternion);
            const nextPos = localPlayer.position.clone().add(move);
            const pBox = new THREE.Box3().setFromCenterAndSize(nextPos, new THREE.Vector3(1, 2, 1));
            
            let canMove = true;
            colliders.forEach(c => { if(pBox.intersectsBox(c)) canMove = false; });
            
            if (!isEnteringPortal) {
                portals.forEach(p => {
                    if(localPlayer.position.distanceTo(p.position) < 3.0) {
                        isEnteringPortal = true; window.location.href = p.userData.url;
                    }
                });
            }
            if(canMove) localPlayer.position.add(move);
        }

        // Gravity & Jump
        if(!isSitting) {
            localPlayer.position.y += velocityY;
            if(localPlayer.position.y > 0) { velocityY += gravity; moving = true; } 
            else { localPlayer.position.y = 0; velocityY = 0; }
        }

        if(keys['Space'] && localPlayer.position.y <= 0.05) {
            velocityY = jumpForce; moving = true; isSitting = false;
        }

        if ((moving || isSitting) && socket.connected) {
            socket.emit('playerMovement', { 
                x: localPlayer.position.x, y: localPlayer.position.y, z: localPlayer.position.z, 
                yaw: yaw, room: CURRENT_ROOM 
            });
        }
    }

    // Animation
    if(moving && window.lLeg) {
        walkTime += 0.15;
        lLeg.rotation.x = Math.sin(walkTime) * 0.5;
        rLeg.rotation.x = -Math.sin(walkTime) * 0.5;
        lArm.rotation.x = -Math.sin(walkTime) * 0.5;
        rArm.rotation.x = Math.sin(walkTime) * 0.5;
    } else if(window.lLeg) {
        lLeg.rotation.x = rLeg.rotation.x = lArm.rotation.x = rArm.rotation.x = 0;
    }

    // Camera
    const cameraOffset = new THREE.Vector3(0, 7, 16).applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    camera.position.copy(localPlayer.position).add(cameraOffset);
    camera.lookAt(localPlayer.position.x, localPlayer.position.y + 2, localPlayer.position.z);

    renderer.render(scene, camera);
}

updateInventoryUI();
animate();