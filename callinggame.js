// --- 1. GLOBAL STATE & CONTACT LOGIC ---
const socket = io();
let currentSecretWord = "";
let revealedLetters = 1; 
let localRole = "guesser"; 
let playersInRoom = []; 
let chairs = []; 
let activeClues = {}; 
let isProcessingClue = false; 
let countdownInterval = null; 

// --- 2. THREE.JS SCENE SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020205); 
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const roomGroup = new THREE.Group();
const grid = new THREE.GridHelper(20, 20, 0xff0055, 0x00f2ff); 
roomGroup.add(grid);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x0a0a12, side: THREE.BackSide, emissive: 0xff0055, emissiveIntensity: 0.05 });
const roomMesh = new THREE.Mesh(new THREE.BoxGeometry(24, 12, 24), wallMat);
roomMesh.position.y = 5.9;
roomGroup.add(roomMesh);
scene.add(roomGroup);

const table = new THREE.Mesh(new THREE.BoxGeometry(5, 0.2, 5), new THREE.MeshStandardMaterial({ color: 0x00f2ff, transparent: true, opacity: 0.8, emissive: 0x00f2ff, emissiveIntensity: 0.5 }));
table.position.y = 1.2;
scene.add(table);

scene.add(new THREE.PointLight(0xff0055, 2, 20), new THREE.PointLight(0x00f2ff, 2, 20), new THREE.AmbientLight(0xffffff, 0.3));
camera.position.set(0, 6, 12); 
camera.lookAt(0, 1, 0);

// --- 3. DYNAMIC HUD & UI ---
const voteBtn = document.getElementById('vote-btn');
const chatInput = document.getElementById('chat-input');
const log = document.getElementById('chat-messages');
const finalBreachBtn = document.getElementById('final-breach-btn');

// Improved selection: Look for button, or wait for DOM
let contactBtn = document.getElementById('contact-btn');

let textSprite = null;
function updateHUD(text, color = '#00f2ff') {
    if (textSprite) scene.remove(textSprite);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1024; canvas.height = 512;
    ctx.fillStyle = 'rgba(10, 10, 20, 0.9)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.fillRect(50, 50, 924, 412);
    ctx.strokeRect(50, 50, 924, 412);
    ctx.fillStyle = color;
    ctx.font = 'bold 40px Courier New'; 
    ctx.textAlign = 'center';
    const lines = text.split('\n');
    lines.forEach((line, i) => ctx.fillText(line, 512, 180 + (i * 65)));
    const tex = new THREE.CanvasTexture(canvas);
    textSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
    textSprite.scale.set(8, 4, 1);
    textSprite.position.set(0, 5.5, -2);
    scene.add(textSprite);
}

updateHUD("TERMINAL STANDBY...\nLOCK SIGNAL TO BEGIN", "#00f2ff");

// --- 4. INPUT & AUTOMATIC LOGIC ---
if(voteBtn) {
    voteBtn.style.display = "block";
    voteBtn.onclick = () => {
        socket.emit('castVote', { targetId: socket.id });
        updateHUD("LOCKING SIGNAL...", "#fbff00");
        voteBtn.style.display = "none";
    };
}

// Logic for Contact Button
function setupContactClick() {
    if(!contactBtn) contactBtn = document.getElementById('contact-btn');
    if(!contactBtn) return;
    
    contactBtn.onclick = () => {
        const clueKeys = Object.keys(activeClues);
        if (clueKeys.length > 0) {
            // Priority: Someone else's clue, then the last active clue
            const otherClueKey = clueKeys.find(id => id !== socket.id) || clueKeys[clueKeys.length - 1];
            const targetClue = activeClues[otherClueKey];
            
            socket.emit('callPlayer', { guess: targetClue, type: 'clue' });
            contactBtn.style.display = "none";
            log.innerHTML += `<div class="msg-system">Initiating CONTACT for: ${targetClue}</div>`;
        }
    };
}
setupContactClick();

if(finalBreachBtn) {
    finalBreachBtn.onclick = () => {
        if (!currentSecretWord) return;
        const guess = prompt("ENTER FINAL BREACH CODE (FULL WORD):");
        if (guess && guess.toUpperCase().trim() === currentSecretWord) {
            socket.emit('wordGuessedCorrectly', { word: guess.toUpperCase().trim() });
        } else if (guess) {
            alert("BREACH FAILED: INVALID CODE");
        }
    };
}

function refreshHUD(extraNote = "") {
    if (!currentSecretWord) return;
    let display = "";
    for(let i=0; i<currentSecretWord.length; i++) {
        display += (i < revealedLetters) ? currentSecretWord[i] + " " : "_ ";
    }
    const prefix = currentSecretWord.substring(0, revealedLetters);
    
    if (localRole === "host") {
        updateHUD(`SECRET: ${currentSecretWord}\nPREFIX: ${prefix}\n${extraNote}`, '#ff0055');
    } else {
        updateHUD(`BREACH PROGRESS: ${display}\nREQUIRED START: ${prefix}\n${extraNote}`, '#00f2ff');
    }
}

function startContactCountdown(clueWord) {
    let count = 3;
    isProcessingClue = true;
    if(contactBtn) contactBtn.style.display = "none"; 
    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        if (count > 0) {
            refreshHUD(`CONTACT! REVEALING IN: ${count}\nCLUE: ${clueWord}`);
            count--;
        } else {
            clearInterval(countdownInterval);
            socket.emit('giverConfirmClue');
        }
    }, 1000);
}

if(chatInput) {
    chatInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            const rawVal = chatInput.value.trim();
            if (!rawVal) return;

            const val = rawVal.toUpperCase();
            
            if (currentSecretWord && val === currentSecretWord) {
                socket.emit('wordGuessedCorrectly', { word: val });
                chatInput.value = "";
                return;
            }

            const uselessMatch = rawVal.match(/NO\s?\(([^)]+)\)/i);
            if (uselessMatch) {
                const uselessWord = uselessMatch[1].toUpperCase();
                socket.emit('chatMessage', { text: rawVal, type: 'useless', word: uselessWord });
                chatInput.value = "";
                return;
            }

            const prefix = (currentSecretWord) ? currentSecretWord.substring(0, revealedLetters) : "";
            if (!currentSecretWord || !val.startsWith(prefix) || val === prefix) {
                socket.emit('chatMessage', rawVal);
            } else {
                if (localRole === "host") {
                    socket.emit('callPlayer', { guess: val, type: 'block' });
                } else {
                    socket.emit('callPlayer', { guess: val, type: 'clue' });
                }
            }
            chatInput.value = "";
        }
    };
}

// --- 5. SOCKET EVENTS ---

socket.on('connect', () => {
    socket.emit('playerMovement', { room: 'calling_game', x: 0, y: 0, z: 0 });
});

socket.on('chatMessage', (data) => {
    const msg = document.createElement('div');
    const sender = data.userName || data.name || data.senderName || (data.id ? data.id.substring(0,4) : "Unknown");
    const message = data.message || data.msg || data.text || (typeof data === 'string' ? data : "...");
    
    if (data.type === 'useless') {
        msg.style = "background: rgba(255, 0, 85, 0.2); border-left: 4px solid #ff0055; padding: 5px; margin: 2px 0;";
        msg.innerHTML = `<span style="color:#ff0055; font-weight:bold;">[SIGNAL LOST]:</span> "${data.word}" IS NO MORE USEFUL.`;
    } else if (data.role === 'guesser' || data.isGuesser) {
        msg.style = "background: rgba(0, 242, 255, 0.1); padding: 2px; border-radius: 3px;";
        msg.innerHTML = `<span style="color:#00f2ff;">[${sender}]:</span> ${message}`;
    } else {
        msg.innerHTML = `<span style="color:#ffffff;">[${sender}]:</span> ${message}`;
    }
    
    log.appendChild(msg);
    log.scrollTop = log.scrollHeight;
});

socket.on('votingComplete', (data) => {
    if(voteBtn) voteBtn.style.display = "none";
    showGameRules(() => {
        if (socket.id === data.hostId) {
            localRole = "host";
            showWordPicker();
            updateHUD("YOU ARE THE HOLDER\nINITIALIZING PROTOCOL", "#ff0055");
            if(contactBtn) contactBtn.style.display = "none";
            if(finalBreachBtn) finalBreachBtn.style.display = "none";
        } else {
            localRole = "guesser";
            const highlightedName = (data.hostName || "HOLDER").toUpperCase();
            updateHUD(`SYSTEM READY\nHOLDER: ${highlightedName}\nWAITING FOR DATA...`, '#00f2ff');
            if(finalBreachBtn) finalBreachBtn.style.display = "block";
        }
    });
});

socket.on('gameStarted', (data) => {
    currentSecretWord = data.word.toUpperCase();
    revealedLetters = 1;
    activeClues = {};
    isProcessingClue = false;
    if(contactBtn) contactBtn.style.display = "none";
    refreshHUD("SIGNAL ESTABLISHED.");
});

socket.on('playerCalling', (data) => {
    if (data.type === 'clue') {
        activeClues[data.senderId] = data.guess;
        
        // Show button for any guesser if there is at least one active clue
        if (localRole === 'guesser' && !isProcessingClue) {
            if(contactBtn) contactBtn.style.display = "block";
            else {
                contactBtn = document.getElementById('contact-btn');
                if(contactBtn) contactBtn.style.display = "block";
            }
        }

        if (localRole === "host") {
            refreshHUD(`GUESSER TYPED: ${data.guess}\nTYPE TO BLOCK!`);
        } else if (!isProcessingClue) {
            const counts = {};
            Object.values(activeClues).forEach(c => counts[c] = (counts[c] || 0) + 1);
            for (let c in counts) {
                if (counts[c] >= 2) {
                    startContactCountdown(c);
                    break;
                }
            }
        }
    }
    if (data.type === 'block') {
        if (countdownInterval) clearInterval(countdownInterval);
        isProcessingClue = false;
        if(contactBtn) contactBtn.style.display = "none";
        for (let id in activeClues) {
            if (activeClues[id] === data.guess) delete activeClues[id];
        }
        refreshHUD("HOLDER BLOCKED A CLUE.");
    }
});

socket.on('clueAccepted', () => {
    revealedLetters++;
    activeClues = {};
    isProcessingClue = false; 
    if(contactBtn) contactBtn.style.display = "none";
    if (revealedLetters >= currentSecretWord.length) {
        socket.emit('wordGuessedCorrectly', { word: currentSecretWord });
    } else {
        refreshHUD("CONTACT CONFIRMED.");
    }
});

socket.on('gameWon', (data) => {
    updateHUD(`BREACH COMPLETE\nWORD: ${data.word}\nREBOOTING...`, "#00ff88");
    if(contactBtn) contactBtn.style.display = "none";
    if(finalBreachBtn) finalBreachBtn.style.display = "none";
    setTimeout(() => {
        currentSecretWord = "";
        revealedLetters = 1;
        if(voteBtn) voteBtn.style.display = "block";
        updateHUD("TERMINAL STANDBY...\nLOCK SIGNAL TO BEGIN", "#00f2ff");
    }, 5000);
});

// --- 6. VISUALS & UTILS ---

function showGameRules(onComplete) {
    const r = document.createElement('div');
    r.id = "rules-overlay";
    r.style = "position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:rgba(5, 5, 15, 0.95); color:#00f2ff; padding:30px; border:2px solid #00f2ff; z-index:2000; text-align:left; border-radius:10px; font-family: 'Courier New', monospace; width: 400px; box-shadow: 0 0 30px #00f2ff;";
    r.innerHTML = `
        <h2 style="color:#ff0055; text-align:center; margin-top:0;">PROTOCOL RULES</h2>
        <p>1. <b>HOLDER:</b> Thinks of a secret word.</p>
        <p>2. <b>GUESSERS:</b> Use the prefix to give clues. For example, "THE" for "THEM".</p>
        <p>3. <b>CONTACT:</b> Use the "CONTACT" button or type the same word to reveal letters.</p>
        <p>4. <b>USELESS:</b> Type "No (word)" to mark a clue as dead.</p>
        <div style="text-align:center; margin-top:20px;">
            <button id="close-rules" style="background:#00f2ff; color:#000; border:none; padding:10px 20px; cursor:pointer; font-weight:bold;">I UNDERSTAND</button>
        </div>
    `;
    document.body.appendChild(r);
    document.getElementById('close-rules').onclick = () => {
        r.remove();
        if(onComplete) onComplete();
    };
}

function showWordPicker() {
    const p = document.createElement('div');
    p.id = "word-picker-overlay";
    p.style = "position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:#050505; color:#00f2ff; padding:40px; border:4px solid #ff0055; z-index:1000; text-align:center; border-radius:20px; font-family: 'Courier New', monospace; box-shadow: 0 0 20px #ff0055;";
    p.innerHTML = `
        <h2 style="margin-top:0;">SET SECRET WORD</h2>
        <input type="text" id="manual-word" placeholder="MIN 3 CHARS" style="background:#000; color:#fff; border:2px solid #00f2ff; padding:15px; width:280px; text-align:center; outline:none; text-transform:uppercase;">
        <br><br>
        <button id="submit-word" style="background:#ff0055; color:#fff; border:none; padding:12px 40px; cursor:pointer; font-weight:bold; letter-spacing:2px;">START PROTOCOL</button>
    `;
    document.body.appendChild(p);

    const input = document.getElementById('manual-word');
    input.focus();

    document.getElementById('submit-word').onclick = () => {
        const word = input.value.toUpperCase().trim();
        if(word.length >= 3) { 
            socket.emit('setSecretWord', { word: word }); 
            p.remove(); 
        } else {
            input.style.borderColor = "red";
        }
    };
}

function updateChairs(count) {
    chairs.forEach(c => scene.remove(c));
    chairs = [];
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({color: 0x111111, emissive: 0xff0055, emissiveIntensity: 0.2});
        const seat = new THREE.Mesh(new THREE.BoxGeometry(1, 0.15, 1), mat);
        const back = new THREE.Mesh(new THREE.BoxGeometry(1, 1.2, 0.15), mat);
        back.position.set(0, 0.6, -0.45);
        group.add(seat, back);
        group.position.set(Math.cos(angle) * 4, 0.6, Math.sin(angle) * 4);
        group.lookAt(0, 0.6, 0);
        scene.add(group);
        chairs.push(group);
    }
}

function animate() { 
    requestAnimationFrame(animate); 
    if(textSprite) {
        textSprite.position.y = 5.5 + Math.sin(Date.now() * 0.002) * 0.1;
    }
    renderer.render(scene, camera); 
}
animate();

socket.on('playerUpdates', (players) => {
    playersInRoom = Object.values(players).filter(p => p.room === 'calling_game');
    if (chairs.length !== playersInRoom.length) updateChairs(playersInRoom.length);
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});