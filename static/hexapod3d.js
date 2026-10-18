/**
 * Hexapod 3D Renderer (Three.js WebGL Engine)
 * Builds procedural 3D model with 18 articulated leg joints, L298-driven Mouth & Pulsating Neck,
 * and 4x HC-SR04 Ultrasonic Distance Sensors (Front, Rear, Left, Right).
 */

class Hexapod3DRenderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = new THREE.Scene();

        // Camera setup
        this.camera = new THREE.PerspectiveCamera(
            45,
            this.container.clientWidth / this.container.clientHeight,
            1,
            5000
        );
        this.camera.position.set(380, 320, 480);

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 + 0.1;
        this.controls.target.set(0, 80, 0);

        // Hardware State Flags
        this.mouthEnergized = false; // L298 Channel 1
        this.neckPulsating = false;  // L298 Channel 2
        this.sensorDistances = { front: 45, rear: 120, left: 80, right: 65 };

        // Setup Lighting & Environment
        this.setupEnvironment();

        // Build Hexapod Robot 3D Object Hierarchy
        this.buildRobot();

        // Window resize event listener
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupEnvironment() {
        this.scene.background = new THREE.Color(0x0b0e14);
        this.scene.fog = new THREE.FogExp2(0x0b0e14, 0.0008);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(300, 500, 250);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.camera.near = 100;
        dirLight.shadow.camera.far = 1500;
        this.scene.add(dirLight);

        const pointLight = new THREE.PointLight(0x00f0ff, 1.5, 600);
        pointLight.position.set(0, 150, 0);
        this.scene.add(pointLight);

        const grid = new THREE.GridHelper(1600, 32, 0x00f0ff, 0x1e293b);
        grid.position.y = 0;
        this.scene.add(grid);

        const planeGeo = new THREE.PlaneGeometry(2000, 2000);
        const planeMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });
        const ground = new THREE.Mesh(planeGeo, planeMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);
    }

    buildRobot() {
        this.robotGroup = new THREE.Group();
        this.scene.add(this.robotGroup);

        // Chassis Main Body
        const bodyGeo = new THREE.CylinderGeometry(110, 125, 28, 6);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.3 });
        this.chassisMesh = new THREE.Mesh(bodyGeo, bodyMat);
        this.chassisMesh.castShadow = true;
        this.chassisMesh.receiveShadow = true;
        this.robotGroup.add(this.chassisMesh);

        // Top Carbon Plate
        const topPlateGeo = new THREE.CylinderGeometry(105, 105, 4, 6);
        const topPlateMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9 });
        const topPlate = new THREE.Mesh(topPlateGeo, topPlateMat);
        topPlate.position.y = 16;
        this.chassisMesh.add(topPlate);

        // Center Status Ring Light
        const ringGeo = new THREE.RingGeometry(30, 38, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 18.5;
        this.chassisMesh.add(ring);

        // Build Front Pulsating Neck & Articulated Mouth Assembly
        this.buildNeckAndMouth();

        // Build 4x HC-SR04 Ultrasonic Sensors (Front, Rear, Left, Right)
        this.buildUltrasonicSensors();

        // Build 6 Articulated Legs
        this.legs = [];
        const legAngles = [
            Math.PI / 4,       // Leg 0: RF
            0,                 // Leg 1: RM
            -Math.PI / 4,      // Leg 2: RR
            -3 * Math.PI / 4,  // Leg 3: LR
            Math.PI,           // Leg 4: LM
            3 * Math.PI / 4    // Leg 5: LF
        ];

        for (let i = 0; i < 6; i++) {
            const angle = legAngles[i];
            const coxaGroup = new THREE.Group();
            coxaGroup.position.set(Math.cos(angle) * 120, 0, Math.sin(angle) * 120);
            coxaGroup.rotation.y = angle;
            this.chassisMesh.add(coxaGroup);

            const coxaMesh = this.createSegmentMesh(52, 20, 18, 0x475569);
            coxaGroup.add(coxaMesh);

            const femurGroup = new THREE.Group();
            femurGroup.position.x = 52;
            coxaGroup.add(femurGroup);

            const femurMesh = this.createSegmentMesh(82, 18, 14, 0x0284c7);
            femurGroup.add(femurMesh);

            const tibiaGroup = new THREE.Group();
            tibiaGroup.position.x = 82;
            femurGroup.add(tibiaGroup);

            const tibiaMesh = this.createSegmentMesh(140, 12, 12, 0x1e293b);
            tibiaGroup.add(tibiaMesh);

            const footGeo = new THREE.SphereGeometry(7, 12, 12);
            const footMat = new THREE.MeshStandardMaterial({ color: 0xef4444 });
            const footTip = new THREE.Mesh(footGeo, footMat);
            footTip.position.x = 140;
            tibiaGroup.add(footTip);

            this.legs.push({ coxaGroup, femurGroup, tibiaGroup, footTip });
        }
    }

    buildNeckAndMouth() {
        // Front Assembly Container (+Z direction, mounted on chassis top)
        this.frontHeadGroup = new THREE.Group();
        this.frontHeadGroup.position.set(0, 18, 90);
        this.chassisMesh.add(this.frontHeadGroup);

        // 1. Pulsating Neck (Flexible Ribbed Cylinder angled UPRIGHT)
        this.neckGroup = new THREE.Group();
        this.neckGroup.rotation.x = -Math.PI / 2.5; // Tilt neck upward ~72°
        this.frontHeadGroup.add(this.neckGroup);

        const neckMat = new THREE.MeshStandardMaterial({
            color: 0x8b5cf6, // Violet Cyber Accent
            roughness: 0.3,
            metalness: 0.7
        });

        // 3 Ribbed Neck Rings extending upward along neck axis
        this.neckRings = [];
        for (let r = 0; r < 3; r++) {
            const ringGeo = new THREE.TorusGeometry(18 - r * 1.5, 4, 12, 24);
            const ringMesh = new THREE.Mesh(ringGeo, neckMat);
            ringMesh.position.z = r * 14 + 10;
            this.neckGroup.add(ringMesh);
            this.neckRings.push(ringMesh);
        }

        // Head Frame mounted upright at top of neck
        this.headBase = new THREE.Group();
        this.headBase.position.z = 52;
        this.headBase.rotation.x = Math.PI / 2.5; // Counter-rotate so head sits upright and faces level forward
        this.neckGroup.add(this.headBase);

        // Upper Lip / Head Skull
        const upperHeadGeo = new THREE.BoxGeometry(32, 14, 28);
        const headMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 });
        const upperHead = new THREE.Mesh(upperHeadGeo, headMat);
        upperHead.position.set(0, 6, 14);
        this.headBase.add(upperHead);

        // Cyan Head Eye LEDs
        const eyeGeo = new THREE.SphereGeometry(5, 12, 12);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-10, 8, 28);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(10, 8, 28);
        this.headBase.add(leftEye);
        this.headBase.add(rightEye);

        // 2. Articulated Lower Jaw / Mouth (Driven by L298 Channel 1 DC Motor)
        this.lowerJawGroup = new THREE.Group();
        this.lowerJawGroup.position.set(0, -2, 10); // Pivot hinge
        this.headBase.add(this.lowerJawGroup);

        const lowerJawGeo = new THREE.BoxGeometry(28, 8, 24);
        lowerJawGeo.translate(0, -4, 12); // Hinge origin
        const jawMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.9, roughness: 0.2 });
        const lowerJawMesh = new THREE.Mesh(lowerJawGeo, jawMat);
        this.lowerJawGroup.add(lowerJawMesh);

        // Chrome Teeth inside mouth
        const teethMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.9 });
        for (let t = -10; t <= 10; t += 5) {
            const toothGeo = new THREE.ConeGeometry(2, 5, 4);
            const tooth = new THREE.Mesh(toothGeo, teethMat);
            tooth.position.set(t, 0, 22);
            tooth.rotation.x = Math.PI;
            this.lowerJawGroup.add(tooth);
        }
    }

    buildUltrasonicSensors() {
        this.sensorCones = {};

        const sensorPositions = [
            { id: 'front', pos: [0, 32, 115], rotY: 0 },
            { id: 'rear', pos: [0, 32, -115], rotY: Math.PI },
            { id: 'left', pos: [-115, 32, 0], rotY: -Math.PI / 2 },
            { id: 'right', pos: [115, 32, 0], rotY: Math.PI / 2 }
        ];

        const postMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 });
        const baseFlangeMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 });

        sensorPositions.forEach(cfg => {
            const sensorGroup = new THREE.Group();
            sensorGroup.position.set(...cfg.pos);
            sensorGroup.rotation.y = cfg.rotY;
            this.chassisMesh.add(sensorGroup);

            // 1. Vertical Mounting Standoff Post (Pillar) under Rangefinder
            const postGeo = new THREE.CylinderGeometry(4, 5, 26, 16);
            const postMesh = new THREE.Mesh(postGeo, postMat);
            postMesh.position.set(0, -13, 0);
            postMesh.castShadow = true;
            sensorGroup.add(postMesh);

            // Base Flange Bracket connecting post to chassis plate
            const flangeGeo = new THREE.CylinderGeometry(9, 10, 4, 16);
            const flangeMesh = new THREE.Mesh(flangeGeo, baseFlangeMat);
            flangeMesh.position.set(0, -25, 0);
            flangeMesh.castShadow = true;
            sensorGroup.add(flangeMesh);

            // 2. Blue HC-SR04 Rangefinder PCB Board
            const pcbGeo = new THREE.BoxGeometry(45, 20, 6);
            const pcbMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.3 });
            const pcb = new THREE.Mesh(pcbGeo, pcbMat);
            pcb.castShadow = true;
            sensorGroup.add(pcb);

            // 3. Dual Transducer Barrels (Emitter & Receiver)
            const barrelGeo = new THREE.CylinderGeometry(7, 7, 12, 16);
            const barrelMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.9, roughness: 0.1 });

            const barrelL = new THREE.Mesh(barrelGeo, barrelMat);
            barrelL.rotation.x = Math.PI / 2;
            barrelL.position.set(-12, 0, 6);
            barrelL.castShadow = true;

            const barrelR = new THREE.Mesh(barrelGeo, barrelMat);
            barrelR.rotation.x = Math.PI / 2;
            barrelR.position.set(12, 0, 6);
            barrelR.castShadow = true;

            sensorGroup.add(barrelL);
            sensorGroup.add(barrelR);

            // 4. Glowing Ultrasonic Visual Beam Cone
            const coneGeo = new THREE.ConeGeometry(40, 100, 16, 1, true);
            coneGeo.rotateX(-Math.PI / 2);
            coneGeo.translate(0, 0, 50); // Extend forward
            const coneMat = new THREE.MeshBasicMaterial({
                color: 0x00f0ff,
                transparent: true,
                opacity: 0.2,
                wireframe: true,
                side: THREE.DoubleSide
            });
            const coneMesh = new THREE.Mesh(coneGeo, coneMat);
            sensorGroup.add(coneMesh);

            this.sensorCones[cfg.id] = coneMesh;
        });
    }

    createSegmentMesh(length, width, height, colorHex) {
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.7, roughness: 0.3 });
        const boxGeo = new THREE.BoxGeometry(length, height, width);
        boxGeo.translate(length / 2, 0, 0);
        const mesh = new THREE.Mesh(boxGeo, mat);
        mesh.castShadow = true;
        group.add(mesh);
        return group;
    }

    /**
     * Updates 3D model chassis position, leg joints, mouth position (L298 Ch1), and neck pulsation (L298 Ch2).
     */
    updatePose(bodyState, legResults) {
        this.robotGroup.position.y = 110 + bodyState.heightOffset;
        this.robotGroup.position.x = bodyState.transX || 0;
        this.robotGroup.position.z = bodyState.transZ || 0;

        this.robotGroup.rotation.x = (bodyState.pitch * Math.PI) / 180;
        this.robotGroup.rotation.z = -(bodyState.roll * Math.PI) / 180;
        this.robotGroup.rotation.y = (bodyState.yaw * Math.PI) / 180;

        // Update Leg Joints
        legResults.forEach((result, i) => {
            const leg = this.legs[i];
            const angles = result.angles;
            leg.coxaGroup.rotation.y = this.getLegBaseAngle(i) + angles.coxa;
            leg.femurGroup.rotation.z = angles.femur;
            leg.tibiaGroup.rotation.z = angles.tibia;
        });

        // 1. L298 Channel 1 Mouth Motor State: Pulses on and off (opens and closes rhythmically) while speaking
        if (this.lowerJawGroup) {
            if (this.mouthEnergized) {
                const talkPulse = Math.abs(Math.sin(performance.now() * 0.016)) * 0.55; // Open and close ~6 Hz
                this.lowerJawGroup.rotation.x = talkPulse;
            } else {
                this.lowerJawGroup.rotation.x += (0.0 - this.lowerJawGroup.rotation.x) * 0.25;
            }
        }

        // 2. L298 Channel 2 Neck Motor State: As long as energized, neck keeps pulsating
        if (this.neckGroup && this.neckRings) {
            const time = performance.now() * 0.012;
            this.neckRings.forEach((ring, idx) => {
                if (this.neckPulsating) {
                    const scale = 1.0 + Math.sin(time + idx * 0.8) * 0.25;
                    ring.scale.set(scale, scale, 1.0);
                } else {
                    ring.scale.set(1.0, 1.0, 1.0);
                }
            });
        }

        // Update Ultrasonic Sensor Beam Cones scale based on distances
        Object.keys(this.sensorDistances).forEach(sensorId => {
            const cone = this.sensorCones[sensorId];
            if (cone) {
                const distCm = this.sensorDistances[sensorId] || 50;
                const scaleZ = Math.max(0.2, Math.min(2.5, distCm / 50));
                cone.scale.set(scaleZ, scaleZ, scaleZ);
            }
        });
    }

    getLegBaseAngle(index) {
        return [Math.PI / 4, 0, -Math.PI / 4, -3 * Math.PI / 4, Math.PI, 3 * Math.PI / 4][index];
    }

    render() {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        const parent = (this.renderer && this.renderer.domElement && this.renderer.domElement.parentElement) ? this.renderer.domElement.parentElement : this.container;
        const targetContainer = parent || this.container;
        if (!targetContainer) return;

        const width = targetContainer.clientWidth || targetContainer.offsetWidth || 800;
        const height = targetContainer.clientHeight || targetContainer.offsetHeight || 300;

        if (width > 0 && height > 0) {
            this.container = targetContainer;
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(width, height);
        }
    }
}
