/**
 * Hexapod Kinematics & Gait Engine
 * Handles 18-DOF Inverse Kinematics (IK), Servo Trim Calibration,
 * Body Orientation (Roll, Pitch, Yaw), Stance/Swing Trajectories,
 * and Gaits (Tripod, Ripple, Wave).
 */

class HexapodKinematics {
    constructor() {
        // Robot Geometry (in mm)
        this.BODY_RADIUS = 120;
        this.COXA_LEN    = 52;
        this.FEMUR_LEN   = 82;
        this.TIBIA_LEN   = 140;
        this.DEFAULT_HEIGHT = 110;

        this.LEG_ANGLES = [
            Math.PI / 4,       // Leg 0: RF
            0,                 // Leg 1: RM
            -Math.PI / 4,      // Leg 2: RR
            -3 * Math.PI / 4,  // Leg 3: LR
            Math.PI,           // Leg 4: LM
            3 * Math.PI / 4    // Leg 5: LF
        ];

        // 18 Servo Trim Calibration Angles (in degrees)
        this.calibrationTrims = Array(6).fill(null).map(() => ({ coxa: 0, femur: 0, tibia: 0 }));

        this.initDefaultStance();

        this.gaitType = 'tripod';
        this.gaitPhase = 0;
        this.stepHeight = 35;
        this.stepLength = 60;
        this.activePose = 'Stand';
    }

    initDefaultStance() {
        this.defaultFeet = [];
        this.LEG_ANGLES.forEach(angle => {
            const stanceRadius = this.BODY_RADIUS + this.COXA_LEN + 80;
            const x = Math.cos(angle) * stanceRadius;
            const z = Math.sin(angle) * stanceRadius;
            const y = -this.DEFAULT_HEIGHT;
            this.defaultFeet.push({ x, y, z });
        });
    }

    solveLegIK(px, py, pz) {
        const coxaAngle = Math.atan2(pz, px);
        const r = Math.sqrt(px * px + pz * pz) - this.COXA_LEN;
        const y = py;
        const d = Math.sqrt(r * r + y * y);

        const maxReach = this.FEMUR_LEN + this.TIBIA_LEN - 1;
        const minReach = Math.abs(this.FEMUR_LEN - this.TIBIA_LEN) + 1;
        const clampedD = Math.max(minReach, Math.min(maxReach, d));

        const alpha1 = Math.atan2(y, r);
        const cosAlpha2 = (this.FEMUR_LEN * this.FEMUR_LEN + clampedD * clampedD - this.TIBIA_LEN * this.TIBIA_LEN) / (2 * this.FEMUR_LEN * clampedD);
        const alpha2 = Math.acos(Math.max(-1, Math.min(1, cosAlpha2)));
        const femurAngle = alpha1 + alpha2;

        const cosBeta = (this.FEMUR_LEN * this.FEMUR_LEN + this.TIBIA_LEN * this.TIBIA_LEN - clampedD * clampedD) / (2 * this.FEMUR_LEN * this.TIBIA_LEN);
        const beta = Math.acos(Math.max(-1, Math.min(1, cosBeta)));
        const tibiaAngle = beta - Math.PI;

        return {
            coxa: coxaAngle,
            femur: femurAngle,
            tibia: tibiaAngle,
            reachable: d <= maxReach && d >= minReach
        };
    }

    computeLegTargets(bodyState, feetPositions) {
        const { heightOffset, roll, pitch, yaw, stanceWidth } = bodyState;

        const radRoll = (roll * Math.PI) / 180;
        const radPitch = (pitch * Math.PI) / 180;
        const radYaw = (yaw * Math.PI) / 180;

        const legResults = [];

        for (let i = 0; i < 6; i++) {
            const legAngle = this.LEG_ANGLES[i];
            const coxaOriginX = Math.cos(legAngle) * this.BODY_RADIUS;
            const coxaOriginZ = Math.sin(legAngle) * this.BODY_RADIUS;
            const coxaOriginY = heightOffset;

            let footGlobal = { ...feetPositions[i] };

            if (stanceWidth) {
                footGlobal.x += Math.cos(legAngle) * stanceWidth;
                footGlobal.z += Math.sin(legAngle) * stanceWidth;
            }

            let rx = footGlobal.x - coxaOriginX;
            let ry = footGlobal.y - coxaOriginY;
            let rz = footGlobal.z - coxaOriginZ;

            let x1 = rx * Math.cos(-radYaw) - rz * Math.sin(-radYaw);
            let z1 = rx * Math.sin(-radYaw) + rz * Math.cos(-radYaw);
            let y1 = ry;

            let y2 = y1 * Math.cos(-radPitch) - z1 * Math.sin(-radPitch);
            let z2 = y1 * Math.sin(-radPitch) + z1 * Math.cos(-radPitch);
            let x2 = x1;

            let x3 = x2 * Math.cos(-radRoll) - y2 * Math.sin(-radRoll);
            let y3 = x2 * Math.sin(-radRoll) + y2 * Math.cos(-radRoll);
            let z3 = z2;

            const localX = x3 * Math.cos(-legAngle) - z3 * Math.sin(-legAngle);
            const localZ = x3 * Math.sin(-legAngle) + z3 * Math.cos(-legAngle);
            const localY = y3;

            const ik = this.solveLegIK(localX, localY, localZ);

            // Apply Servo Calibration Trim Offsets (deg to rad)
            const trim = this.calibrationTrims[i] || { coxa: 0, femur: 0, tibia: 0 };
            ik.coxa += (trim.coxa * Math.PI) / 180;
            ik.femur += (trim.femur * Math.PI) / 180;
            ik.tibia += (trim.tibia * Math.PI) / 180;

            legResults.push({
                legIndex: i,
                angles: ik,
                targetLocal: { x: localX, y: localY, z: localZ },
                footGlobal: footGlobal
            });
        }

        return legResults;
    }

    updateGait(dt, moveVector, gaitType) {
        this.gaitType = gaitType || 'tripod';
        const { fwd, strafe, turn } = moveVector;

        const isMoving = Math.abs(fwd) > 0.05 || Math.abs(strafe) > 0.05 || Math.abs(turn) > 0.05;

        let gaitSpeed = (this.gaitType === 'run') ? 3.8 : 1.8;

        if (isMoving) {
            this.gaitPhase = (this.gaitPhase + dt * gaitSpeed) % 1.0;
        } else {
            this.gaitPhase = 0;
        }

        const feet = [];
        const phaseOffsets = this.getGaitPhaseOffsets(this.gaitType);
        const now = performance.now();

        for (let i = 0; i < 6; i++) {
            const baseFoot = { ...this.defaultFeet[i] };

            // Up-Down Bouncing & Leg Waving Dance
            if (this.activePose === 'Bounce & Wave Dance' || this.activePose === 'Up Down Leg Wave' || this.activePose === 'Bounce & Wave') {
                if (i === 0) { // Right Front Leg Waving in the Air
                    const waveY = Math.sin(now * 0.014) * 45;
                    const waveZ = Math.cos(now * 0.014) * 30;
                    feet.push({ x: baseFoot.x + 20, y: baseFoot.y + 90 + waveY, z: baseFoot.z + 35 + waveZ });
                    continue;
                }
                if (i === 5) { // Left Front Leg Waving in the Air
                    const waveY = Math.sin(now * 0.014 + Math.PI) * 45;
                    const waveZ = Math.cos(now * 0.014 + Math.PI) * 30;
                    feet.push({ x: baseFoot.x - 20, y: baseFoot.y + 90 + waveY, z: baseFoot.z + 35 + waveZ });
                    continue;
                }
                if (i === 1 || i === 4) { // Middle Legs Air Pump
                    const waveY = Math.max(0, Math.sin(now * 0.01 + (i === 1 ? 0 : Math.PI))) * 35;
                    feet.push({ x: baseFoot.x + (i === 1 ? 20 : -20), y: baseFoot.y + 50 + waveY, z: baseFoot.z });
                    continue;
                }
            }

            // Flatten all legs flat against the floor
            if (this.activePose === 'Flatten Legs' || this.activePose === 'Flat Floor' || this.activePose === 'Flat Pancake' || this.activePose === 'Pancake') {
                const legAngle = this.LEG_ANGLES[i];
                const flatX = baseFoot.x + Math.cos(legAngle) * 85;
                const flatZ = baseFoot.z + Math.sin(legAngle) * 85;
                feet.push({ x: flatX, y: -5, z: flatZ });
                continue;
            }

            // Grand Ultimate Combo Dance Routine
            if (this.activePose === 'Ultimate Combo Dance' || this.activePose === 'Grand Combo Dance' || this.activePose === 'Combination Dance') {
                const dancePhase = (now * 0.001) % 16;
                if (dancePhase < 4 || dancePhase >= 12) {
                    if (i === 0) { // Right Front Leg Wave in Air
                        const waveY = Math.sin(now * 0.012) * 45;
                        const waveZ = Math.cos(now * 0.012) * 30;
                        feet.push({ x: baseFoot.x + 20, y: baseFoot.y + 90 + waveY, z: baseFoot.z + 35 + waveZ });
                        continue;
                    }
                    if (i === 5) { // Left Front Leg Wave in Air (Alternating)
                        const waveY = Math.sin(now * 0.012 + Math.PI) * 45;
                        const waveZ = Math.cos(now * 0.012 + Math.PI) * 30;
                        feet.push({ x: baseFoot.x - 20, y: baseFoot.y + 90 + waveY, z: baseFoot.z + 35 + waveZ });
                        continue;
                    }
                }
                if (dancePhase >= 8) {
                    if (i === 1) { // Right Middle Leg Air Tap
                        const waveY = Math.max(0, Math.sin(now * 0.01)) * 40;
                        feet.push({ x: baseFoot.x + 25, y: baseFoot.y + waveY, z: baseFoot.z });
                        continue;
                    }
                    if (i === 4) { // Left Middle Leg Air Tap
                        const waveY = Math.max(0, Math.cos(now * 0.01)) * 40;
                        feet.push({ x: baseFoot.x - 25, y: baseFoot.y + waveY, z: baseFoot.z });
                        continue;
                    }
                }
            }

            // Special Pose / Leg Waving / Dance Modifications
            if (this.activePose === 'Alternating Front Leg Wave' || this.activePose === 'Alternating Front Leg Wave Dance' || this.activePose === 'Alternating Wave') {
                const altPhase = (now * 0.003) % (Math.PI * 2);
                if (altPhase < Math.PI) {
                    if (i === 0) { // Right Front Leg 0 raised and waving high
                        const waveY = Math.sin(now * 0.014) * 45;
                        const waveZ = Math.cos(now * 0.014) * 30;
                        feet.push({ x: baseFoot.x + 25, y: baseFoot.y + 95 + waveY, z: baseFoot.z + 35 + waveZ });
                        continue;
                    }
                } else {
                    if (i === 5) { // Left Front Leg 5 raised and waving high
                        const waveY = Math.sin(now * 0.014) * 45;
                        const waveZ = Math.cos(now * 0.014) * 30;
                        feet.push({ x: baseFoot.x - 25, y: baseFoot.y + 95 + waveY, z: baseFoot.z + 35 + waveZ });
                        continue;
                    }
                }
            }

            if (this.activePose === 'Macarena Hexapod') {
                const macStep = Math.floor((now * 0.0015) % 4);
                if (macStep === 0 && i === 0) { // Right Front Leg extended & waving
                    const waveY = Math.sin(now * 0.012) * 40;
                    feet.push({ x: baseFoot.x + 30, y: baseFoot.y + 85 + waveY, z: baseFoot.z + 40 });
                    continue;
                } else if (macStep === 1 && i === 5) { // Left Front Leg extended & waving
                    const waveY = Math.sin(now * 0.012) * 40;
                    feet.push({ x: baseFoot.x - 30, y: baseFoot.y + 85 + waveY, z: baseFoot.z + 40 });
                    continue;
                } else if (macStep === 2 && (i === 0 || i === 5)) { // Both front legs raised
                    const waveY = Math.sin(now * 0.015) * 30;
                    feet.push({ x: baseFoot.x + (i === 0 ? 20 : -20), y: baseFoot.y + 75 + waveY, z: baseFoot.z + 30 });
                    continue;
                }
            }

            if (this.activePose === 'Sequential Leg Wave Shuffle') {
                const seqLeg = Math.floor((now * 0.002) % 6);
                if (i === seqLeg) {
                    const waveY = Math.sin(now * 0.016) * 40;
                    feet.push({ x: baseFoot.x + (i < 3 ? 20 : -20), y: baseFoot.y + 80 + waveY, z: baseFoot.z + 20 });
                    continue;
                }
            }

            if (this.activePose === 'Catwalk Front Leg Strut') {
                const strutPhase = (now * 0.004) % (Math.PI * 2);
                if (strutPhase < Math.PI && i === 0) { // High strut RF leg
                    const waveY = Math.sin(strutPhase) * 60;
                    feet.push({ x: baseFoot.x + 30, y: baseFoot.y + 40 + waveY, z: baseFoot.z + 40 });
                    continue;
                } else if (strutPhase >= Math.PI && i === 5) { // High strut LF leg
                    const waveY = Math.sin(strutPhase - Math.PI) * 60;
                    feet.push({ x: baseFoot.x - 30, y: baseFoot.y + 40 + waveY, z: baseFoot.z + 40 });
                    continue;
                }
            }

            if (this.activePose === 'Techno Beat Shuffle' || this.activePose === 'Techno Shuffle') {
                const beatPhase = (now * 0.008) % (Math.PI * 2);
                if (beatPhase < Math.PI && i === 0) { // Fast RF lift
                    feet.push({ x: baseFoot.x + 25, y: baseFoot.y + 90, z: baseFoot.z + 30 });
                    continue;
                } else if (beatPhase >= Math.PI && i === 5) { // Fast LF lift
                    feet.push({ x: baseFoot.x - 25, y: baseFoot.y + 90, z: baseFoot.z + 30 });
                    continue;
                }
            }

            if (this.activePose === 'K-Pop Synchronized Groove' || this.activePose === 'K-Pop Groove') {
                const kpopPhase = (now * 0.003) % (Math.PI * 2);
                if (kpopPhase < Math.PI && i === 0) { // Smooth RF wave
                    const waveY = Math.sin(now * 0.01) * 35;
                    feet.push({ x: baseFoot.x + 20, y: baseFoot.y + 80 + waveY, z: baseFoot.z + 25 });
                    continue;
                } else if (kpopPhase >= Math.PI && i === 5) { // Smooth LF wave
                    const waveY = Math.sin(now * 0.01) * 35;
                    feet.push({ x: baseFoot.x - 20, y: baseFoot.y + 80 + waveY, z: baseFoot.z + 25 });
                    continue;
                }
            }

            if (this.activePose === 'Wave Front Right' || this.activePose === 'Wave Right Leg') {
                if (i === 0) { // Leg 0: Right Front waving in the air
                    const waveY = Math.sin(now * 0.012) * 45;
                    const waveZ = Math.cos(now * 0.012) * 25;
                    feet.push({ x: baseFoot.x + 20, y: baseFoot.y + 85 + waveY, z: baseFoot.z + 30 + waveZ });
                    continue;
                }
            }

            if (this.activePose === 'Wave Front Left' || this.activePose === 'Wave Left Leg') {
                if (i === 5) { // Leg 5: Left Front waving in the air
                    const waveY = Math.sin(now * 0.012) * 45;
                    const waveZ = Math.cos(now * 0.012) * 25;
                    feet.push({ x: baseFoot.x - 20, y: baseFoot.y + 85 + waveY, z: baseFoot.z + 30 + waveZ });
                    continue;
                }
            }

            if (this.activePose === 'Dual Legs Air Wave' || this.activePose === 'Wave Left & Right Legs') {
                if (i === 0) { // Right Front leg waving high in the air
                    const waveY = Math.sin(now * 0.01) * 45;
                    const waveZ = Math.cos(now * 0.01) * 30;
                    feet.push({ x: baseFoot.x + 20, y: baseFoot.y + 90 + waveY, z: baseFoot.z + 35 + waveZ });
                    continue;
                }
                if (i === 5) { // Left Front leg waving high in the air (alternating phase)
                    const waveY = Math.sin(now * 0.01 + Math.PI) * 45;
                    const waveZ = Math.cos(now * 0.01 + Math.PI) * 30;
                    feet.push({ x: baseFoot.x - 20, y: baseFoot.y + 90 + waveY, z: baseFoot.z + 35 + waveZ });
                    continue;
                }
            }

            if (this.activePose === 'Mid Legs Air Wave') {
                if (i === 1) { // Leg 1: Right Mid
                    const waveY = Math.sin(now * 0.011) * 45;
                    feet.push({ x: baseFoot.x + 30, y: baseFoot.y + 80 + waveY, z: baseFoot.z });
                    continue;
                }
                if (i === 4) { // Leg 4: Left Mid
                    const waveY = Math.sin(now * 0.011 + Math.PI) * 45;
                    feet.push({ x: baseFoot.x - 30, y: baseFoot.y + 80 + waveY, z: baseFoot.z });
                    continue;
                }
            }

            if (this.activePose === 'Air Celebration') {
                if (i === 0 || i === 5) { // Front legs high wave
                    const waveY = Math.sin(now * 0.01 + (i === 0 ? 0 : Math.PI)) * 45;
                    feet.push({ x: baseFoot.x + (i === 0 ? 20 : -20), y: baseFoot.y + 95 + waveY, z: baseFoot.z + 35 });
                    continue;
                }
                if (i === 1 || i === 4) { // Mid legs mid wave
                    const waveY = Math.cos(now * 0.01 + (i === 1 ? 0 : Math.PI)) * 35;
                    feet.push({ x: baseFoot.x + (i === 1 ? 25 : -25), y: baseFoot.y + 65 + waveY, z: baseFoot.z });
                    continue;
                }
            }

            if (this.activePose === 'Beg') {
                if (i === 0 || i === 5) { // Front legs 0 & 5 raised high
                    feet.push({ x: baseFoot.x, y: baseFoot.y + 90, z: baseFoot.z + 40 });
                    continue;
                }
            }

            if (this.activePose === 'Disco Boogie Dance') {
                const boogiePhase = (now * 0.008) % (Math.PI * 2);
                if (i === 0 || i === 3) {
                    const lift = Math.max(0, Math.sin(boogiePhase)) * 45;
                    feet.push({ x: baseFoot.x, y: baseFoot.y + lift, z: baseFoot.z });
                    continue;
                } else if (i === 2 || i === 5) {
                    const lift = Math.max(0, Math.sin(boogiePhase + Math.PI)) * 45;
                    feet.push({ x: baseFoot.x, y: baseFoot.y + lift, z: baseFoot.z });
                    continue;
                }
            }

            if (this.activePose === 'Twist & Shimmy') {
                const shimmyLeg = Math.floor(now * 0.005) % 6;
                if (i === shimmyLeg) {
                    feet.push({ x: baseFoot.x, y: baseFoot.y + 35, z: baseFoot.z });
                    continue;
                }
            }

            if (this.activePose === 'Robot Breakdance') {
                if (i === 0) { // High kick RF
                    const kickY = Math.abs(Math.sin(now * 0.008)) * 85;
                    feet.push({ x: baseFoot.x + 35, y: baseFoot.y + kickY, z: baseFoot.z + 40 });
                    continue;
                } else if (i === 5) { // High kick LF
                    const kickY = Math.abs(Math.cos(now * 0.008)) * 85;
                    feet.push({ x: baseFoot.x - 35, y: baseFoot.y + kickY, z: baseFoot.z + 40 });
                    continue;
                }
            }

            if (this.activePose === 'Hexapod Salsa') {
                const salsaStep = Math.sin(now * 0.006 + i * 1.0) * 30;
                if (salsaStep > 12) {
                    feet.push({ x: baseFoot.x, y: baseFoot.y + salsaStep, z: baseFoot.z });
                    continue;
                }
            }

            if (!isMoving) {
                feet.push(baseFoot);
                continue;
            }

            const legPhase = (this.gaitPhase + phaseOffsets[i]) % 1.0;
            const dutyFactor = (this.gaitType === 'tripod' || this.gaitType === 'run') ? 0.5 : (this.gaitType === 'ripple' ? 0.66 : 0.83);

            let dx = 0, dz = 0, dy = 0;

            const curStepLen = (this.gaitType === 'run') ? this.stepLength * 1.5 : this.stepLength;
            const curStepH = (this.gaitType === 'run') ? this.stepHeight * 1.35 : this.stepHeight;

            const moveX = strafe * curStepLen;
            const moveZ = fwd * curStepLen;

            const legAngle = this.LEG_ANGLES[i];
            const turnX = -Math.sin(legAngle) * turn * (curStepLen * 0.6);
            const turnZ = Math.cos(legAngle) * turn * (curStepLen * 0.6);

            const totalMoveX = moveX + turnX;
            const totalMoveZ = moveZ + turnZ;

            if (legPhase < dutyFactor) {
                const stanceProgress = legPhase / dutyFactor;
                dx = (0.5 - stanceProgress) * totalMoveX;
                dz = (0.5 - stanceProgress) * totalMoveZ;
                dy = 0;
            } else {
                const swingProgress = (legPhase - dutyFactor) / (1.0 - dutyFactor);
                dx = (swingProgress - 0.5) * totalMoveX;
                dz = (swingProgress - 0.5) * totalMoveZ;
                dy = Math.sin(swingProgress * Math.PI) * curStepH;
            }

            feet.push({
                x: baseFoot.x + dx,
                y: baseFoot.y + dy,
                z: baseFoot.z + dz
            });
        }

        return feet;
    }

    getGaitPhaseOffsets(gaitType) {
        switch (gaitType) {
            case 'run':
                return [0.0, 0.5, 0.0, 0.5, 0.0, 0.5];
            case 'ripple':
                return [0.0, 0.33, 0.66, 0.0, 0.33, 0.66];
            case 'wave':
                return [0.0, 1/6, 2/6, 3/6, 4/6, 5/6];
            case 'tripod':
            default:
                return [0.0, 0.5, 0.0, 0.5, 0.0, 0.5];
        }
    }
}
