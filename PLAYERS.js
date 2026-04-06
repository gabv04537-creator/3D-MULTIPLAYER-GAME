import * as THREE from 'three';

export const remotePlayers = {};
const SMOOTHING_FACTOR = 0.1; 

export function addRemotePlayer(id, data, scene, localPlayer) {
    if (remotePlayers[id]) return;
    const p = localPlayer.clone();
    p.position.set(data.x, data.y, data.z);
    p.traverse(c => { 
        if(c.isMesh && c.material.color.getHex() === 0x00aaff) {
            c.material = new THREE.MeshStandardMaterial({color: 0xff3333}); 
        }
    });
    scene.add(p);
    remotePlayers[id] = {
        mesh: p,
        targetPos: new THREE.Vector3(data.x, data.y, data.z),
        targetYaw: data.yaw || 0
    };
}

export function removeRemotePlayer(id, scene) {
    if (remotePlayers[id]) {
        scene.remove(remotePlayers[id].mesh);
        delete remotePlayers[id];
    }
}

export function updateRemotePlayerPos(id, data) {
    if (remotePlayers[id]) {
        remotePlayers[id].targetPos.set(data.x, data.y, data.z);
        remotePlayers[id].targetYaw = data.yaw;
    }
}

export function interpolatePlayers() {
    Object.values(remotePlayers).forEach(p => {
        p.mesh.position.lerp(p.targetPos, SMOOTHING_FACTOR);
        let diff = p.targetYaw - p.mesh.rotation.y;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        p.mesh.rotation.y += diff * SMOOTHING_FACTOR;
    });
}