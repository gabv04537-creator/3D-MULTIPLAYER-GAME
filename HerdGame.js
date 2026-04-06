// --- HERD GAME LOGIC MODULE ---
import * as THREE from 'three';

export class HerdGame {
    constructor(scene) {
        this.scene = scene;
        this.score = 0;
        this.hasPinkCow = false;
        this.gameActive = false;
        this.isSitting = false; 
        this.isReady = false; // NEW: Block questions until rules are done
        this.winCondition = 8;
        this.currentQuestion = "";
        this.isZoomed = false;
        this.timerInterval = null; 

        this.gameOverlay = document.getElementById('game-question-ui');
        if (!this.gameOverlay) {
            this.gameOverlay = document.createElement('div');
            this.gameOverlay.id = "game-question-ui";
            this.gameOverlay.style = "position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background:rgba(0,0,0,0.95); padding:30px; border-radius:20px; border:4px solid gold; color:white; text-align:center; display:none; z-index:1000; font-family:sans-serif; min-width:350px; box-shadow: 0 0 30px rgba(255,215,0,0.4); max-width: 90vw;";
            document.body.appendChild(this.gameOverlay);
        }

        this.cardMesh = this.createTableCard();
        if (this.scene) this.scene.add(this.cardMesh);

        this.initSocket();
    }

    createTableCard() {
        const cardGeo = new THREE.BoxGeometry(6, 0.2, 9);
        const cardMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const mesh = new THREE.Mesh(cardGeo, cardMat);
        mesh.position.set(0, 6.6, -50); 
        mesh.visible = false; 
        mesh.name = "TableCard";
        return mesh;
    }

    initSocket() {
        if (window.socket) {
            const events = ['updateScore', 'pinkCowUpdate', 'receiveQuestion', 'roundResults', 'updateVotes', 'gameOver', 'gameUpdate'];
            events.forEach(ev => window.socket.off(ev));

            window.socket.on('updateScore', (newScore) => { this.score = newScore; });

            window.socket.on('pinkCowUpdate', (pinkCowId) => {
                this.setPinkCow(window.socket.id === pinkCowId);
            });

            window.socket.on('gameUpdate', (data) => {
                if (data.status === "waiting") {
                    this.gameActive = false;
                    this.currentQuestion = "";
                    this.isReady = false; // Reset ready status for new round
                    
                    if (this.isSitting) {
                        this.showRulebook();
                    } else {
                        this.gameOverlay.style.display = "none";
                    }
                }
            });

            window.socket.on('receiveQuestion', (question) => {
                this.currentQuestion = question;
                this.gameActive = true;

                // FIX: Only show the question if sitting AND the rules phase is finished
                if (this.isSitting && this.isReady) {
                    this.stopTimer(); 
                    this.showQuestion(question);
                }
            });

            window.socket.on('roundResults', (results) => { 
                if (this.isSitting) this.showAnalysis(results); 
            });

            window.socket.on('updateVotes', (data) => { 
                if (this.isSitting) this.updateReadyUI(data.readyCount, data.totalPlayers); 
            });
            
            window.socket.on('gameOver', (winnerName) => { 
                if (this.isSitting) this.showGameOver(winnerName); 
            });
        }
    }

    updateReadyUI(ready, total) {
        const statusEl = document.getElementById('readyStatus');
        if (statusEl) {
            statusEl.innerText = `Ready: ${ready} / ${total}`;
            statusEl.style.color = (ready >= total && total >= 2) ? "gold" : "white";
        }
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    showRulebook() {
        this.stopTimer();
        this.isReady = false; // Ensure we are in "Rules Mode"
        this.gameOverlay.style.display = "block";
        
        let timeLeft = 10;
        this.updateRuleUI(timeLeft);

        this.timerInterval = setInterval(() => {
            timeLeft--;
            const timerText = document.getElementById('rulesTimer');
            if (timerText) {
                timerText.innerText = `Starting in: ${timeLeft}s`;
            }

            if (timeLeft <= 0) {
                this.completeRules();
            }
        }, 1000);

        const skipBtn = document.getElementById('skipRulesBtn');
        if (skipBtn) {
            skipBtn.onclick = () => this.completeRules();
        }
    }

    completeRules() {
        this.stopTimer();
        this.isReady = true; // GATE OPEN
        window.socket.emit('playerReady', true); 

        // If the server already sent the question while we were reading rules, show it now!
        if (this.currentQuestion) {
            this.showQuestion(this.currentQuestion);
        } else {
            // Otherwise, show a clean waiting state
            this.gameOverlay.innerHTML = `
                <h2 style="color:gold;">READY!</h2>
                <p>Waiting for the rest of the herd...</p>
                <div id="readyStatus" style="font-size:24px; font-weight:bold;"></div>
            `;
        }
    }

    updateRuleUI(seconds) {
        this.gameOverlay.innerHTML = `
            <h1 style="color:gold; margin-top:0;">📜 HERD RULES</h1>
            <div style="text-align:left; display:inline-block; margin-bottom:20px; font-size:18px; line-height:1.6;">
                <p>✅ <b>GOAL:</b> Answer exactly like the majority.</p>
                <p>❌ <b>THE PINK COW:</b> If you're the odd one out, you get the Cow.</p>
                <p>🏆 <b>WINNER:</b> First to 8 tokens wins.</p>
            </div>
            <div id="readyStatus" style="font-size:24px; font-weight:bold; margin-bottom:10px;">Ready: -- / --</div>
            <div id="rulesTimer" style="background:gold; color:black; font-weight:bold; padding:10px; border-radius:5px; font-size:18px;">
                Starting in: ${seconds}s
            </div>
            <button id="skipRulesBtn" style="margin-top:15px; background:none; border:1px solid gray; color:gray; cursor:pointer; padding:5px 10px; border-radius:5px;">Skip Rules & Ready Up</button>
        `;
    }

    startGame() {
        this.isSitting = true; 
        this.isZoomed = true;
        if (this.cardMesh) this.cardMesh.visible = true;
        this.showRulebook();
    }

    showQuestion(question) {
        this.gameOverlay.style.display = "block";
        this.gameOverlay.innerHTML = `
            <div style="border: 2px dashed gold; padding: 20px; border-radius: 15px;">
                <h2 style="color:gold; margin-bottom:10px; font-size:14px; letter-spacing:2px;">HERD ROUND</h2>
                <p style="font-size:26px; margin-bottom:25px; font-weight:bold; font-family:serif;">"${question}"</p>
                <input type="text" id="herdAnswerInput" placeholder="Write like the herd..." style="padding:15px; width:80%; border-radius:10px; border:none; text-align:center; font-size:20px; background:#111; color:white; border:2px solid #444;">
                <br><br>
                <button id="submitAnswerBtn" style="padding:15px 40px; background:gold; border:none; border-radius:10px; font-weight:bold; cursor:pointer; font-size:18px; color: black;">SUBMIT ANSWER</button>
            </div>
        `;
        const input = document.getElementById('herdAnswerInput');
        if (input) {
            input.focus();
            input.onkeydown = (e) => { if(e.key === 'Enter') this.submitAnswer(input.value.trim()); };
            document.getElementById('submitAnswerBtn').onclick = () => this.submitAnswer(input.value.trim());
        }
    }

    submitAnswer(answer) {
        if (!answer) return;
        this.gameOverlay.innerHTML = `
            <div style="padding:40px;">
                <div class="loader" style="border: 4px solid #f3f3f3; border-top: 4px solid gold; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; margin: 0 auto 20px auto;"></div>
                <h2 style="color:gold;">Answer Locked!</h2>
                <p style="font-size:22px;">"${answer}"</p>
                <p style="color:gray;">Waiting for the rest of the herd...</p>
            </div>
            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
        `;
        window.socket.emit('submitAnswer', answer);
    }

    showAnalysis(results) {
        const data = results.counts || {};
        let statsHTML = "";
        for (let [ans, count] of Object.entries(data)) {
            const isMajority = ans === results.majorityAnswer;
            statsHTML += `
                <div style="display:flex; justify-content: space-between; padding: 10px; background: ${isMajority ? 'rgba(255,215,0,0.2)' : 'rgba(255,255,255,0.05)'}; margin-bottom: 5px; border-radius: 5px; border: 1px solid ${isMajority ? 'gold' : '#333'}">
                    <span style="font-weight:bold; color:${isMajority ? 'gold' : 'white'}">${ans.toUpperCase()}</span>
                    <span>${count} Votes</span>
                </div>`;
        }
        const isMePinkCow = results.pinkCowId === window.socket.id;
        this.gameOverlay.innerHTML = `
            <h2 style="color:gold; margin-bottom:20px;">HERD ANALYSIS</h2>
            <div style="margin-bottom:20px;">${statsHTML}</div>
            ${isMePinkCow ? `<div style="background:#ff4444; color:white; padding:15px; border-radius:10px; font-weight:bold; animation: pulse 1s infinite;">⚠️ YOU HAVE THE PINK COW! ⚠️<br><span style="font-size:12px;">You can't score points right now.</span></div>` : ''}
            <p style="font-size:12px; color:gray; margin-top:20px;">Round complete. Resetting for next round...</p>
            <style>@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.7; } 100% { opacity: 1; } }</style>
        `;
    }

    showGameOver(winnerName) {
        this.gameOverlay.innerHTML = `
            <h1 style="color:gold; font-size:40px;">🏆 GAME OVER</h1>
            <h2 style="color:white;">${winnerName} is the Ultimate Herd Leader!</h2>
            <button id="restartBtn" style="padding:10px 20px; background:gold; border:none; border-radius:5px; cursor:pointer; font-weight:bold;">PLAY AGAIN</button>
        `;
        const rBtn = document.getElementById('restartBtn');
        if(rBtn) rBtn.onclick = () => location.reload();
    }

    setPinkCow(status) { this.hasPinkCow = status; }
}