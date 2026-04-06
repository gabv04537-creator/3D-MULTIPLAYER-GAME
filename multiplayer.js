import * as THREE from 'three';

export function initMultiplayer(socket, scene, localPlayer, remotePlayers, createTextSprite, updatePlayerList, MY_ROOM = "lobby") {
    const statusUI = document.getElementById('status');

    socket.on('connect', () => { 
        if(statusUI) { statusUI.innerText = "Online"; statusUI.style.color = "#00ff00"; }
    });
    
    socket.on('disconnect', () => { 
        if(statusUI) { statusUI.innerText = "Offline"; statusUI.style.color = "#ff0000"; }
    });

    // 1. Handle existing players
    socket.on('currentPlayers', (players) => { 
        Object.keys(players).forEach((id) => { 
            if (id !== socket.id) {
                addRemotePlayer(id, players[id], scene, localPlayer, remotePlayers, createTextSprite, updatePlayerList);
                if (remotePlayers[id]) {
                    remotePlayers[id].mesh.visible = (players[id].room === MY_ROOM);
                }
            }
        }); 
    });

    // 2. Handle new arrivals
    socket.on('newPlayer', (data) => { 
        addRemotePlayer(data.id, data, scene, localPlayer, remotePlayers, createTextSprite, updatePlayerList);
        if (remotePlayers[data.id]) {
            remotePlayers[data.id].mesh.visible = (data.room === MY_ROOM);
        }
    });

    // 3. Movement & Room Filtering
    socket.on('playerMoved', (data) => { 
        const p = remotePlayers[data.id];
        if (!p) return;

        // Visibility Toggle based on Room
        const isInMyRoom = (data.room === MY_ROOM);
        p.mesh.visible = isInMyRoom;

        if (isInMyRoom) {
            // Check for large jumps/teleports
            const dist = p.mesh.position.distanceTo(new THREE.Vector3(data.x, data.y, data.z));
            if (dist > 5.0) {
                createGhostTrail(p.mesh, scene);
                p.mesh.position.set(data.x, data.y, data.z); // Instant snap for lag
            }

            p.targetPos.set(data.x, data.y, data.z);
            p.targetYaw = data.yaw;
        }
    });

    socket.on('playerDisconnected', (id) => { 
        if (remotePlayers[id]) { 
            scene.remove(remotePlayers[id].mesh); 
            delete remotePlayers[id]; 
            updatePlayerList(); 
        } 
    });

    // 4. Chat Bubbles
    socket.on('chatMessage', (data) => {
        const target = (data.id === socket.id) ? {mesh: localPlayer} : remotePlayers[data.id];
        if (target && target.mesh && (data.id === socket.id || target.mesh.visible)) {
            if (target.bubble) target.mesh.remove(target.bubble);
            const bubble = createTextSprite(data.message);
            bubble.position.y = 5.0; 
            bubble.scale.set(7, 1.8, 1);
            target.mesh.add(bubble); 
            target.bubble = bubble;
            setTimeout(() => { 
                if(target.bubble === bubble) { 
                    target.mesh.remove(bubble); 
                    target.bubble = null; 
                } 
            }, 4000);
        }
    });
}

function createGhostTrail(originalMesh, scene) {
    const ghost = originalMesh.clone();
    ghost.traverse(c => {
        if (c.isMesh) {
            c.material = c.material.clone();
            c.material.transparent = true;
            c.material.opacity = 0.3;
        }
    });
    scene.add(ghost);
    setTimeout(() => scene.remove(ghost), 500);
}

function addRemotePlayer(id, data, scene, localPlayer, remotePlayers, createTextSprite, updatePlayerList) {
    if (remotePlayers[id]) return;

    const pGroup = new THREE.Group();
    let hasVisuals = false;

    // Try to clone the local player visuals
    localPlayer.traverse(c => {
        if (c.isMesh) {
            const m = new THREE.Mesh(c.geometry, c.material.clone());
            if (m.material.color.getHex() === 0x00aaff) {
                m.material.color.setHex(0xff3333); // Red for remotes
            }
            m.position.copy(c.position);
            m.rotation.copy(c.rotation);
            m.scale.copy(c.scale);
            pGroup.add(m);
            hasVisuals = true;
        }
    });

    // FALLBACK: If localPlayer wasn't loaded/ready yet, create a simple box
    if (!hasVisuals) {
        const fallback = new THREE.Mesh(
            new THREE.BoxGeometry(1, 2, 1),
            new THREE.MeshStandardMaterial({ color: 0xff3333 })
        );
        fallback.position.y = 1;
        pGroup.add(fallback);
    }

    pGroup.position.set(data.x, data.y, data.z);
    const nameTag = createTextSprite(data.name || `Guest_${id.substring(0,4)}`);
    nameTag.position.y = 3.5; 
    nameTag.scale.set(6, 1.5, 1);
    pGroup.add(nameTag);

    scene.add(pGroup);

    remotePlayers[id] = { 
        mesh: pGroup, 
        targetPos: new THREE.Vector3(data.x, data.y, data.z), 
        targetYaw: data.yaw || 0,
        bubble: null
    };

    updatePlayerList();
}