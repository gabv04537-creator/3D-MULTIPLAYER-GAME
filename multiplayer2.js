import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { createCar } from './car.js';
import { FlagSystem } from './flags.js'; 

export class MultiplayerManager {
    constructor(scene, camera, socket, playerName) {
        this.scene = scene;
        this.camera = camera;
        this.socket = socket;
        this.playerName = playerName;
        this.remotePlayers = {};
        this.REMOTE_ROTATION_FIX = Math.PI;
        this.lastSyncTime = 0;
    }

    init() {
        if (!this.socket) return;

        // --- FIXED SESSION TIMER (Anti-Flicker) ---
        this.socket.on('sessionTimerUpdate', (data) => {
            const timerElement = document.getElementById('session-timer');
            const modeElement = document.getElementById('session-mode');
            
            if (timerElement) {
                const mins = Math.floor(data.time / 60);
                const secs = data.time % 60;
                const timeString = `${mins}:${secs.toString().padStart(2, '0')}`;
                
                // ONLY update DOM if value is different to stop flickering
                if (timerElement.innerText !== timeString) {
                    timerElement.innerText = timeString;
                }
            }
            if (modeElement && data.mode) {
                if (modeElement.innerText !== data.mode) {
                    modeElement.innerText = data.mode;
                }
            }
        });

        // --- SESSION TRANSITION HANDLER ---
        // This forces the timer to reset immediately when the server starts the race
        this.socket.on('startRace', (data) => {
            if (data.newTime) {
                const timerElement = document.getElementById('session-timer');
                if (timerElement) {
                    const mins = Math.floor(data.newTime / 60);
                    const secs = data.newTime % 60;
                    timerElement.innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
                }
            }
            console.log("Session Transitioned to:", data.mode);
        });

        // --- LIVE STANDINGS UPDATE ---
        this.socket.on('leaderboardUpdate', (playersArray) => {
            const container = document.getElementById('leaderboard-content');
            if (!container) return;

            container.innerHTML = ""; 
            playersArray.forEach((p, index) => {
                const entry = document.createElement('div');
                entry.className = "leaderboard-entry";
                
                const isMe = p.id === this.socket.id;
                const nameStyle = isMe ? "color: #fff; font-weight: bold; text-shadow: 0 0 10px #00ffcc;" : "";

                entry.innerHTML = `
                    <div style="display: flex; align-items: center;">
                        <span class="pos-num" style="${isMe ? 'background:#00ffcc; color:#000;' : ''}">${index + 1}</span>
                        <span style="${nameStyle}">${p.name}</span>
                    </div>
                    <span style="color: ${isMe ? '#00ffcc' : '#aaa'}; font-family: monospace;">
                        ${p.bestLap || '--:--.---'}
                    </span>
                `;
                container.appendChild(entry);
            });
        });

        // --- FLAG UPDATES ---
        this.socket.on('weatherOrFlagUpdate', (data) => {
            if (data.flagStatus && FlagSystem && typeof FlagSystem.update === 'function') {
                FlagSystem.update(data.flagStatus);
            }
        });

        // --- PLAYER MODELS & SMOOTH LERPING ---
        this.socket.on('playerUpdates', (players) => {
            Object.keys(players).forEach(id => {
                if (id === this.socket.id) return;
                const p = players[id];
                
                if (p.room !== "racing") {
                    if (this.remotePlayers[id]) this.removeRemotePlayer(id);
                    return;
                }

                if (!this.remotePlayers[id]) {
                    this.createRemotePlayer(id, p.name);
                }
                
                const otherCar = this.remotePlayers[id];
                // Slightly higher lerp (0.35) for high-speed responsiveness
                otherCar.position.lerp(new THREE.Vector3(p.x, p.y, p.z), 0.35);
                
                if (p.ry !== undefined) {
                    otherCar.rotation.y = p.ry + this.REMOTE_ROTATION_FIX; 
                }

                // Update Name Label Position
                const vector = otherCar.position.clone().project(this.camera);
                if (vector.z < 1) {
                    otherCar.userData.label.style.display = 'block';
                    otherCar.userData.label.style.left = (vector.x * 0.5 + 0.5) * window.innerWidth + 'px';
                    otherCar.userData.label.style.top = (-(vector.y * 0.5 - 0.5) * window.innerHeight) - 40 + 'px';
                } else {
                    otherCar.userData.label.style.display = 'none';
                }
            });
        });

        this.socket.on('playerDisconnected', (id) => {
            this.removeRemotePlayer(id);
        });
    }

    createRemotePlayer(id, name) {
        this.remotePlayers[id] = createCar('phantom');
        const label = document.createElement('div');
        label.className = "player-label";
        label.style.position = 'absolute';
        label.style.color = 'white';
        label.style.background = 'rgba(0,0,0,0.7)';
        label.style.padding = '2px 8px';
        label.style.borderBottom = '2px solid #00ffcc';
        label.style.borderRadius = '3px';
        label.style.fontSize = '12px';
        label.style.pointerEvents = 'none';
        label.innerText = name;
        document.body.appendChild(label);
        
        this.remotePlayers[id].userData.label = label;
        this.scene.add(this.remotePlayers[id]);
    }

    removeRemotePlayer(id) {
        if (this.remotePlayers[id]) {
            if (this.remotePlayers[id].userData.label) {
                this.remotePlayers[id].userData.label.remove();
            }
            this.scene.remove(this.remotePlayers[id]);
            delete this.remotePlayers[id];
        }
    }

    broadcastFlag(status) {
        if (this.socket && this.socket.connected) {
            this.socket.emit('weatherOrFlagUpdate', { flagStatus: status });
        }
    }

    update(playerCar, currentBestLap = null) {
        if (this.socket && this.socket.connected && playerCar) {
            const now = Date.now();
            // 30ms throttle prevents packet floods while keeping movement smooth
            if (now - this.lastSyncTime > 30) { 
                this.socket.emit('playerMovement', {
                    x: playerCar.position.x, 
                    y: playerCar.position.y, 
                    z: playerCar.position.z,
                    ry: playerCar.rotation.y, 
                    room: "racing", 
                    name: this.playerName,
                    bestLap: currentBestLap
                });
                this.lastSyncTime = now;
            }
        }
    }
}