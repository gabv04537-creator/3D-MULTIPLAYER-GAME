import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// Note: Ensure Sky is imported in your main app or via a CDN if not using a bundler
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export function initWorld(scene, colliders, seats, portals, createTextSprite) {
    const loader = new GLTFLoader();
    const buildingScale = 100.0;
    const buildingHeight = 24;
    const rectWidth = 100;
    const rectLength = 150;
    const fenceSpacing = 3;

    // --- 1. ENHANCED SKY ---
    const sky = new Sky();
    sky.scale.setScalar(450000);
    scene.add(sky);

    const sun = new THREE.Vector3();
    const effectController = {
        turbidity: 10,
        rayleigh: 3,
        mieCoefficient: 0.005,
        mieDirectionalG: 0.7,
        elevation: 2, // Low sun for sunset/neon vibe
        azimuth: 180,
    };

    const uniforms = sky.material.uniforms;
    uniforms['turbidity'].value = effectController.turbidity;
    uniforms['rayleigh'].value = effectController.rayleigh;
    uniforms['mieCoefficient'].value = effectController.mieCoefficient;
    uniforms['mieDirectionalG'].value = effectController.mieDirectionalG;

    const phi = THREE.MathUtils.degToRad(90 - effectController.elevation);
    const theta = THREE.MathUtils.degToRad(effectController.azimuth);
    sun.setFromSphericalCoords(1, phi, theta);
    uniforms['sunPosition'].value.copy(sun);

    // --- 2. LAND & PLAZA (RETAINED COLORS) ---
    const land = new THREE.Mesh(new THREE.PlaneGeometry(10000, 10000), new THREE.MeshStandardMaterial({ color: 0x224422 }));
    land.rotation.x = -Math.PI / 2;
    scene.add(land);

    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(rectWidth * 2, rectLength * 2), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 }));
    plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.02;
    scene.add(plaza);

    // --- 3. AMBIENT LIGHTING ---
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(hemiLight);
    
    // Add some neon point lights near the building area
    const neon = new THREE.PointLight(0x00f2ff, 1, 100);
    neon.position.set(0, 10, -rectLength + 80);
    scene.add(neon);

    // --- 4. FENCES & COLLIDERS ---
    loader.load('fence.glb', (gltf) => {
        let mesh;
        gltf.scene.traverse(c => { if(c.isMesh) mesh = c; });
        const dummy = new THREE.Object3D();
        const createWall = (start, end, fixed, isVertical, rotY) => {
            for (let i = start; i <= end; i += fenceSpacing) {
                const inst = new THREE.Mesh(mesh.geometry, mesh.material);
                inst.position.set(isVertical ? fixed : i, 0, isVertical ? i : fixed);
                inst.rotation.set(-Math.PI/2, 0, rotY);
                scene.add(inst);
                colliders.push(new THREE.Box3().setFromObject(inst));
            }
        };
        createWall(-rectWidth, rectWidth, -rectLength, false, 0); 
        createWall(-rectWidth, rectWidth, rectLength, false, Math.PI);
        createWall(-rectLength, rectLength, -rectWidth, true, Math.PI/2);
        createWall(-rectLength, rectLength, rectWidth, true, -Math.PI/2);
    });

    // --- 5. MAIN BUILDING ---
    loader.load('Building.glb', (gltf) => {
        const model = gltf.scene;
        model.scale.set(buildingScale, buildingScale, buildingScale);
        model.position.set(0, buildingHeight, -rectLength + 60); 
        scene.add(model);
        colliders.push(new THREE.Box3().setFromObject(model));
    });

    // --- 6. SEATABLE DINING AREAS ---
    for(let i=0; i<8; i++) { // Increased count slightly
        const x = (i % 2 === 0 ? 50 : -50); 
        const z = -60 + (i * 20);
        
        const tableGroup = new THREE.Group();
        // Table
        const table = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 6), new THREE.MeshStandardMaterial({color: 0x222222, emissive: 0x00f2ff, emissiveIntensity: 0.1}));
        table.position.y = 1.5;
        
        // Neon Umbrella
        const umbrellaPole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 12), new THREE.MeshStandardMaterial({color: 0x888888}));
        umbrellaPole.position.y = 6;
        const umbrellaTop = new THREE.Mesh(new THREE.CylinderGeometry(0, 6, 2, 8), new THREE.MeshStandardMaterial({color: 0x111111, transparent: true, opacity: 0.9}));
        umbrellaTop.position.y = 11;
        
        tableGroup.add(table, umbrellaPole, umbrellaTop);
        tableGroup.position.set(x, 0, z);
        scene.add(tableGroup);

        // Seatable Chairs
        [[4, 0, -Math.PI/2], [-4, 0, Math.PI/2]].forEach(p => {
            const chairGeo = new THREE.BoxGeometry(2, 1.5, 2);
            const chairMat = new THREE.MeshStandardMaterial({color: 0x111111});
            const chair = new THREE.Mesh(chairGeo, chairMat);
            chair.position.set(x + p[0], 0.75, z + p[1]);
            scene.add(chair);
            
            // Register for seatable logic
            seats.push({
                pos: new THREE.Vector3(x + p[0], 1.8, z + p[1]), // Where the player sits
                rot: p[2],
                occupied: false
            });

            // Add a small interaction label above seats
            const label = createTextSprite("CHAIR", "#00f2ff");
            label.position.set(x + p[0], 3, z + p[1]);
            label.scale.set(2, 1, 1);
            scene.add(label);
        });
    }

    // --- 7. BACKGROUND BUILDINGS ---
    for(let i = 0; i < 30; i++) {
        const h = 100 + Math.random() * 200;
        const b = new THREE.Mesh(new THREE.BoxGeometry(30, h, 30), new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xff0055, emissiveIntensity: 0.05 }));
        const angle = (i / 30) * Math.PI * 2;
        const dist = 500 + Math.random() * 200;
        b.position.set(Math.cos(angle) * dist, h/2, Math.sin(angle) * dist);
        scene.add(b);
    }
}