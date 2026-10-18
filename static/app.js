/**
 * Main Hexapod App Orchestrator
 * Connects UI inputs, Top Tab Navigation, Servo Calibration, Autonomous Obstacle Avoidance,
 * Kinematics solver, 3D WebGL Renderer, and Gemini AI.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Instantiate Core Engines
    const kinematics = new HexapodKinematics();
    const renderer = new Hexapod3DRenderer('viewport3d');

    // Motion State
    const moveVector = { fwd: 0, strafe: 0, turn: 0 };
    const bodyState = {
        heightOffset: 0,
        pitch: 0,
        roll: 0,
        yaw: 0,
        stanceWidth: 0,
        transX: 0,
        transZ: 0
    };

    let activePose = 'Stand';
    const activeKeys = {};
    let lastTime = performance.now();

    // DOM Elements
    const slideHeight = document.getElementById('slideHeight');
    const slidePitch  = document.getElementById('slidePitch');
    const slideRoll   = document.getElementById('slideRoll');
    const slideYaw    = document.getElementById('slideYaw');
    const slideStance = document.getElementById('slideStance');

    const valHeight = document.getElementById('valHeight');
    const valPitch  = document.getElementById('valPitch');
    const valRoll   = document.getElementById('valRoll');
    const valYaw    = document.getElementById('valYaw');
    const valStance = document.getElementById('valStance');

    const slideStepHeight = document.getElementById('slideStepHeight');
    const slideStepLen    = document.getElementById('slideStepLen');
    const valStepHeight    = document.getElementById('valStepHeight');
    const valStepLen       = document.getElementById('valStepLen');

    const ikStatusSpan   = document.getElementById('ikStatus');
    const telemetryGrid  = document.getElementById('telemetryGrid');
    const switchObstacleAvoidance = document.getElementById('switchObstacleAvoidance');

    // Build 18-Servo Joint Telemetry & Calibration Panels
    initTelemetryGrid();
    initCalibrationGrid();

    // Setup Navigation Tabs & Event Listeners
    setupTopNavTabs();
    setupSliderListeners();
    setupGaitTabs();
    setupPresetButtons();
    setupDPadControls();
    setupKeyboardListeners();
    setupMp3MusicPlayer();

    // Application API exposed to Gemini AI controller
    const appAPI = {
        setMoveVector: (fwd, strafe, turn) => {
            moveVector.fwd = fwd;
            moveVector.strafe = strafe;
            moveVector.turn = turn;
        },
        applyPresetPose: (poseName) => {
            applyPresetPose(poseName);
        },
        setMouthEnergized: (energized) => {
            renderer.mouthEnergized = energized;
            const el = document.getElementById('motorMouthStatus');
            if (el) {
                el.textContent = energized ? 'ENERGIZED (OPEN)' : 'OFF';
                el.style.color = energized ? 'var(--accent-green)' : 'var(--text-muted)';
            }
        },
        setNeckPulsating: (pulsating) => {
            renderer.neckPulsating = pulsating;
            const el = document.getElementById('motorNeckStatus');
            if (el) {
                el.textContent = pulsating ? 'ENERGIZED (PULSING)' : 'OFF';
                el.style.color = pulsating ? 'var(--accent-purple)' : 'var(--text-muted)';
            }
        }
    };

    const geminiController = new GeminiAIController(appAPI);

    // Poll 4x HC-SR04 Ultrasonic Distance Sensors & Autonomous Obstacle Avoidance
    setInterval(() => {
        fetch('/api/sensors/distances')
            .then(res => res.json())
            .then(data => {
                renderer.sensorDistances = data;

                const elF = document.getElementById('distFront');
                const elR = document.getElementById('distRear');
                const elL = document.getElementById('distLeft');
                const elRight = document.getElementById('distRight');

                if (elF) elF.textContent = `${data.front} cm`;
                if (elR) elR.textContent = `${data.rear} cm`;
                if (elL) elL.textContent = `${data.left} cm`;
                if (elRight) elRight.textContent = `${data.right} cm`;

                // Autonomous Obstacle Avoidance Routine
                if (switchObstacleAvoidance && switchObstacleAvoidance.checked) {
                    if (data.front < 35 && moveVector.fwd > 0) {
                        // Obstacle ahead! Halt forward motion and turn away
                        moveVector.fwd = 0;
                        moveVector.turn = (data.left > data.right) ? -1 : 1; // Turn towards greater clearance
                        console.log('Autonomous Obstacle Avoidance Triggered! Steering away.');
                    }
                }
            })
            .catch(err => {});
    }, 400);

    // Camera Source Selector & Switch Buttons
    const selectCamera = document.getElementById('selectCamera');
    const btnSwitchCamera = document.getElementById('btnSwitchCamera');
    const btnDefaultEmeetPixy = document.getElementById('btnDefaultEmeetPixy');
    const cameraStatusMsg = document.getElementById('cameraStatusMsg');

    const changeCameraSource = (sourceVal) => {
        const source = sourceVal || (selectCamera ? selectCamera.value : 'usb');

        if (selectCamera && sourceVal) {
            selectCamera.value = source;
        }

        if (cameraStatusMsg) {
            cameraStatusMsg.style.color = 'var(--accent-cyan)';
            cameraStatusMsg.textContent = '⏳ Switching camera stream...';
        }

        fetch('/api/camera/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source })
        })
        .then(res => res.json())
        .then(data => {
            console.log('Camera source switched:', data);
            const camFeed = document.getElementById('camFeed');
            if (camFeed) {
                camFeed.src = `/api/camera/frame?t=${Date.now()}`;
            }

            if (cameraStatusMsg) {
                const label = source === 'usb' ? 'eMeet Pixy USB Webcam (/dev/video0)' :
                              (source === 'csi' ? 'Raspberry Pi CSI Camera' : `Secondary USB Camera (/dev/video${source})`);
                cameraStatusMsg.style.color = 'var(--accent-green)';
                cameraStatusMsg.textContent = `Active Camera: ${label}`;
            }
        })
        .catch(err => {
            console.error('Error switching camera:', err);
            if (cameraStatusMsg) {
                cameraStatusMsg.style.color = 'var(--accent-red)';
                cameraStatusMsg.textContent = 'Error changing camera source.';
            }
        });
    };

    if (selectCamera) {
        selectCamera.addEventListener('change', (e) => changeCameraSource(e.target.value));
    }

    if (btnSwitchCamera) {
        btnSwitchCamera.addEventListener('click', () => changeCameraSource());
    }

    if (btnDefaultEmeetPixy) {
        btnDefaultEmeetPixy.addEventListener('click', () => changeCameraSource('usb'));
    }

    // Export Python Button
    document.getElementById('btnExportScript').addEventListener('click', exportPythonCode);
    document.getElementById('btnResetCam').addEventListener('click', () => {
        renderer.camera.position.set(380, 320, 480);
        renderer.controls.target.set(0, 80, 0);
    });

    document.getElementById('btnResetAttitude').addEventListener('click', () => {
        slideHeight.value = 0; slidePitch.value = 0; slideRoll.value = 0; slideYaw.value = 0; slideStance.value = 0;
        updateBodyStateFromSliders();
    });

    // Start Render Loop
    requestAnimationFrame(animate);

    function animate(now) {
        requestAnimationFrame(animate);

        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;

        updateMoveVectorFromKeys();

        updateDynamicDanceAttitude(now);

        kinematics.activePose = activePose;
        const feetPositions = kinematics.updateGait(dt, moveVector, kinematics.gaitType);
        const legResults = kinematics.computeLegTargets(bodyState, feetPositions);

        const allReachable = legResults.every(r => r.angles.reachable);
        if (ikStatusSpan) {
            ikStatusSpan.textContent = allReachable ? 'IK VALID' : 'REACH LIMIT';
            ikStatusSpan.style.color = allReachable ? 'var(--accent-cyan)' : 'var(--accent-red)';
        }

        renderer.updatePose(bodyState, legResults);
        renderer.render();

        updateTelemetryUI(legResults);
    }

    function setupTopNavTabs() {
        const tabBtns = document.querySelectorAll('.nav-tab-btn');
        const screens = document.querySelectorAll('.view-screen');

        const moveCanvasToView = (viewName) => {
            const dom = renderer.renderer.domElement;
            if (viewName === 'viewCalibration') {
                const calibContainer = document.getElementById('calibViewport3d');
                if (calibContainer && dom.parentElement !== calibContainer) {
                    calibContainer.appendChild(dom);
                }
            } else if (viewName === 'viewAnimation') {
                const animContainer = document.getElementById('viewport3d');
                if (animContainer && dom.parentElement !== animContainer) {
                    animContainer.appendChild(dom);
                }
            }
            renderer.onWindowResize();
            setTimeout(() => renderer.onWindowResize(), 50);
            setTimeout(() => renderer.onWindowResize(), 200);
        };

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                screens.forEach(s => {
                    s.classList.remove('active');
                    s.style.display = 'none';
                });

                btn.classList.add('active');
                const targetViewId = btn.dataset.view || btn.getAttribute('data-view');
                const targetView = document.getElementById(targetViewId);
                if (targetView) {
                    targetView.classList.add('active');
                    if (targetViewId === 'viewWiring' || targetViewId === 'viewInstructions') {
                        targetView.style.display = 'block';
                    } else {
                        targetView.style.display = 'grid';
                    }
                }

                try {
                    moveCanvasToView(targetViewId);
                } catch (err) {
                    console.error("Error moving canvas to view:", err);
                }
            });
        });

        const checkHashView = () => {
            const hash = window.location.hash.replace('#', '').toLowerCase();
            if (hash) {
                let targetBtn = null;
                tabBtns.forEach(btn => {
                    const v = btn.dataset.view.toLowerCase();
                    if (v === hash || v === 'view' + hash || (hash.includes('wiring') || hash.includes('schematic')) && v === 'viewwiring' || (hash.includes('instruction') || hash.includes('guide') || hash.includes('manual')) && v === 'viewinstructions') {
                        targetBtn = btn;
                    }
                });
                if (targetBtn) {
                    targetBtn.click();
                }
            }
        };

        window.addEventListener('hashchange', checkHashView);
        checkHashView();

        const btnResetCamCalib = document.getElementById('btnResetCamCalib');
        if (btnResetCamCalib) {
            btnResetCamCalib.addEventListener('click', () => {
                renderer.camera.position.set(380, 320, 480);
                renderer.controls.target.set(0, 80, 0);
            });
        }

        const btnExportInstructionsPDF = document.getElementById('btnExportInstructionsPDF');
        if (btnExportInstructionsPDF) {
            btnExportInstructionsPDF.addEventListener('click', async () => {
                const element = document.querySelector('#viewInstructions .guide-wrapper') || document.getElementById('viewInstructions');
                if (!element) return;

                const origText = btnExportInstructionsPDF.innerHTML;
                btnExportInstructionsPDF.innerHTML = '⏳ Exporting PDF...';
                btnExportInstructionsPDF.disabled = true;

                document.body.classList.add('exporting-pdf');

                const opt = {
                    margin: [8, 8, 8, 8],
                    filename: 'Hexapod_Operating_Instructions_Guide.pdf',
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: {
                        scale: 2,
                        useCORS: true,
                        logging: false,
                        backgroundColor: '#0f172a'
                    },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
                };

                try {
                    if (window.html2pdf) {
                        await html2pdf().set(opt).from(element).save();
                    } else {
                        window.print();
                    }
                } catch (err) {
                    console.error("PDF generation error, falling back to print:", err);
                    window.print();
                } finally {
                    document.body.classList.remove('exporting-pdf');
                    btnExportInstructionsPDF.innerHTML = origText;
                    btnExportInstructionsPDF.disabled = false;
                }
            });
        }

        const btnPrintInstructionsPDF = document.getElementById('btnPrintInstructionsPDF');
        if (btnPrintInstructionsPDF) {
            btnPrintInstructionsPDF.addEventListener('click', () => {
                window.print();
            });
        }

        const btnExportWiringPDF = document.getElementById('btnExportWiringPDF');
        if (btnExportWiringPDF) {
            btnExportWiringPDF.addEventListener('click', async () => {
                const element = document.querySelector('.wiring-container');
                if (!element) return;

                const origText = btnExportWiringPDF.innerHTML;
                btnExportWiringPDF.innerHTML = '⏳ Exporting PDF...';
                btnExportWiringPDF.disabled = true;

                document.body.classList.add('exporting-pdf');

                const opt = {
                    margin: [8, 8, 8, 8],
                    filename: 'Hexapod_Electrical_Wiring_Schematic.pdf',
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: {
                        scale: 2,
                        useCORS: true,
                        logging: false,
                        backgroundColor: '#0f172a'
                    },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
                    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
                };

                try {
                    if (window.html2pdf) {
                        await html2pdf().set(opt).from(element).save();
                    } else {
                        window.print();
                    }
                } catch (err) {
                    console.error("PDF generation error, falling back to print:", err);
                    window.print();
                } finally {
                    document.body.classList.remove('exporting-pdf');
                    btnExportWiringPDF.innerHTML = origText;
                    btnExportWiringPDF.disabled = false;
                }
            });
        }

        const btnPrintWiringPDF = document.getElementById('btnPrintWiringPDF');
        if (btnPrintWiringPDF) {
            btnPrintWiringPDF.addEventListener('click', () => {
                window.print();
            });
        }
    }

    function initTelemetryGrid() {
        const legNames = ["RF (0)", "RM (1)", "RR (2)", "LR (3)", "LM (4)", "LF (5)"];
        telemetryGrid.innerHTML = '';

        for (let i = 0; i < 6; i++) {
            const card = document.createElement('div');
            card.className = 'leg-card';
            card.innerHTML = `
                <div class="leg-title">Leg ${legNames[i]}</div>
                <div class="joint-row"><span>Coxa:</span><span class="joint-deg" id="deg_${i}_coxa">0°</span></div>
                <div class="joint-row"><span>Femur:</span><span class="joint-deg" id="deg_${i}_femur">0°</span></div>
                <div class="joint-row"><span>Tibia:</span><span class="joint-deg" id="deg_${i}_tibia">0°</span></div>
            `;
            telemetryGrid.appendChild(card);
        }
    }

    function initCalibrationGrid() {
        const calibGrid = document.getElementById('calibrationGrid');
        if (!calibGrid) return;

        const legNames = ["Right Front (0)", "Right Mid (1)", "Right Rear (2)", "Left Rear (3)", "Left Mid (4)", "Left Front (5)"];
        calibGrid.innerHTML = '';

        const generateOffsetOptions = (selectedVal = 0) => {
            let opts = '';
            for (let deg = -30; deg <= 30; deg++) {
                const label = deg > 0 ? `+${deg}°` : `${deg}°`;
                const sel = (deg === selectedVal) ? 'selected' : '';
                opts += `<option value="${deg}" ${sel}>${label}</option>`;
            }
            return opts;
        };

        for (let i = 0; i < 6; i++) {
            const card = document.createElement('div');
            card.className = 'calib-leg-card';
            card.innerHTML = `
                <div class="leg-title" style="font-size:0.85rem; margin-bottom:10px;">${legNames[i]}</div>
                
                <div class="slider-control">
                    <div class="slider-label">
                        <span>Coxa Servo</span>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <label style="font-size:0.7rem; color:var(--text-muted)">Offset:</label>
                            <select class="trim-dropdown" data-leg="${i}" data-joint="coxa" id="selectTrim_${i}_coxa">
                                ${generateOffsetOptions(0)}
                            </select>
                            <span class="slider-val" id="valTrim_${i}_coxa">0°</span>
                        </div>
                    </div>
                    <input type="range" class="trim-slider" data-leg="${i}" data-joint="coxa" id="slideTrim_${i}_coxa" min="-30" max="30" value="0">
                </div>

                <div class="slider-control">
                    <div class="slider-label">
                        <span>Femur Servo</span>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <label style="font-size:0.7rem; color:var(--text-muted)">Offset:</label>
                            <select class="trim-dropdown" data-leg="${i}" data-joint="femur" id="selectTrim_${i}_femur">
                                ${generateOffsetOptions(0)}
                            </select>
                            <span class="slider-val" id="valTrim_${i}_femur">0°</span>
                        </div>
                    </div>
                    <input type="range" class="trim-slider" data-leg="${i}" data-joint="femur" id="slideTrim_${i}_femur" min="-30" max="30" value="0">
                </div>

                <div class="slider-control">
                    <div class="slider-label">
                        <span>Tibia Servo</span>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <label style="font-size:0.7rem; color:var(--text-muted)">Offset:</label>
                            <select class="trim-dropdown" data-leg="${i}" data-joint="tibia" id="selectTrim_${i}_tibia">
                                ${generateOffsetOptions(0)}
                            </select>
                            <span class="slider-val" id="valTrim_${i}_tibia">0°</span>
                        </div>
                    </div>
                    <input type="range" class="trim-slider" data-leg="${i}" data-joint="tibia" id="slideTrim_${i}_tibia" min="-30" max="30" value="0">
                </div>
            `;
            calibGrid.appendChild(card);
        }

        const updateServoOffset = (leg, joint, val) => {
            kinematics.calibrationTrims[leg][joint] = val;

            const slider = document.getElementById(`slideTrim_${leg}_${joint}`);
            const dropdown = document.getElementById(`selectTrim_${leg}_${joint}`);
            const valDisplay = document.getElementById(`valTrim_${leg}_${joint}`);

            if (slider && parseInt(slider.value, 10) !== val) slider.value = val;
            if (dropdown && parseInt(dropdown.value, 10) !== val) dropdown.value = val;
            if (valDisplay) valDisplay.textContent = (val > 0 ? `+${val}°` : `${val}°`);
        };

        // Attach Dropdown Listeners
        document.querySelectorAll('.trim-dropdown').forEach(select => {
            select.addEventListener('change', (e) => {
                const leg = parseInt(e.target.dataset.leg, 10);
                const joint = e.target.dataset.joint;
                const val = parseInt(e.target.value, 10);
                updateServoOffset(leg, joint, val);
            });
        });

        // Attach Trim Slider Listeners
        document.querySelectorAll('.trim-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const leg = parseInt(e.target.dataset.leg, 10);
                const joint = e.target.dataset.joint;
                const val = parseInt(e.target.value, 10);
                updateServoOffset(leg, joint, val);
            });
        });

        const btnResetCalib = document.getElementById('btnResetCalibration');
        if (btnResetCalib) {
            btnResetCalib.addEventListener('click', () => {
                for (let i = 0; i < 6; i++) {
                    ['coxa', 'femur', 'tibia'].forEach(j => {
                        updateServoOffset(i, j, 0);
                    });
                }
            });
        }

        // Calibration Workbench Gait Playground
        const calibGaitSelect = document.getElementById('calibGaitSelect');
        if (calibGaitSelect) {
            calibGaitSelect.addEventListener('change', (e) => {
                kinematics.gaitType = e.target.value;
            });
        }

        const btnTestGaitForward = document.getElementById('btnTestGaitForward');
        if (btnTestGaitForward) {
            btnTestGaitForward.addEventListener('click', () => {
                moveVector.fwd = 1; moveVector.strafe = 0; moveVector.turn = 0;
            });
        }

        const btnTestGaitTurnL = document.getElementById('btnTestGaitTurnL');
        if (btnTestGaitTurnL) {
            btnTestGaitTurnL.addEventListener('click', () => {
                moveVector.fwd = 0; moveVector.strafe = 0; moveVector.turn = -1;
            });
        }

        const btnTestGaitTurnR = document.getElementById('btnTestGaitTurnR');
        if (btnTestGaitTurnR) {
            btnTestGaitTurnR.addEventListener('click', () => {
                moveVector.fwd = 0; moveVector.strafe = 0; moveVector.turn = 1;
            });
        }

        const btnTestGaitStop = document.getElementById('btnTestGaitStop');
        if (btnTestGaitStop) {
            btnTestGaitStop.addEventListener('click', () => {
                moveVector.fwd = 0; moveVector.strafe = 0; moveVector.turn = 0;
            });
        }

        // Calibration Workbench Pose Playground
        const calibPoseSelect = document.getElementById('calibPoseSelect');
        if (calibPoseSelect) {
            calibPoseSelect.addEventListener('change', (e) => {
                applyPresetPose(e.target.value);
            });
        }

        const calibQuickPoses = document.querySelectorAll('#calibQuickPoses button');
        calibQuickPoses.forEach(btn => {
            btn.addEventListener('click', () => {
                const poseName = btn.dataset.pose;
                applyPresetPose(poseName);
            });
        });
    }

    function updateTelemetryUI(legResults) {
        legResults.forEach((result, i) => {
            const degCoxa  = Math.round((result.angles.coxa * 180) / Math.PI);
            const degFemur = Math.round((result.angles.femur * 180) / Math.PI);
            const degTibia = Math.round((result.angles.tibia * 180) / Math.PI);

            const elCoxa  = document.getElementById(`deg_${i}_coxa`);
            const elFemur = document.getElementById(`deg_${i}_femur`);
            const elTibia = document.getElementById(`deg_${i}_tibia`);

            if (elCoxa)  elCoxa.textContent  = `${degCoxa}°`;
            if (elFemur) elFemur.textContent = `${degFemur}°`;
            if (elTibia) elTibia.textContent = `${degTibia}°`;
        });
    }

    function setupSliderListeners() {
        const update = () => updateBodyStateFromSliders();

        slideHeight.addEventListener('input', update);
        slidePitch.addEventListener('input', update);
        slideRoll.addEventListener('input', update);
        slideYaw.addEventListener('input', update);
        slideStance.addEventListener('input', update);

        slideStepHeight.addEventListener('input', () => {
            kinematics.stepHeight = parseInt(slideStepHeight.value, 10);
            valStepHeight.textContent = `${kinematics.stepHeight} mm`;
        });

        slideStepLen.addEventListener('input', () => {
            kinematics.stepLength = parseInt(slideStepLen.value, 10);
            valStepLen.textContent = `${kinematics.stepLength} mm`;
        });
    }

    function updateBodyStateFromSliders() {
        bodyState.heightOffset = parseInt(slideHeight.value, 10);
        bodyState.pitch        = parseInt(slidePitch.value, 10);
        bodyState.roll         = parseInt(slideRoll.value, 10);
        bodyState.yaw          = parseInt(slideYaw.value, 10);
        bodyState.stanceWidth  = parseInt(slideStance.value, 10);

        valHeight.textContent = `${bodyState.heightOffset} mm`;
        valPitch.textContent  = `${bodyState.pitch}°`;
        valRoll.textContent   = `${bodyState.roll}°`;
        valYaw.textContent    = `${bodyState.yaw}°`;
        valStance.textContent = `${bodyState.stanceWidth} mm`;
    }

    function setupGaitTabs() {
        const tabs = document.querySelectorAll('#gaitTabs .tab-btn');
        tabs.forEach(btn => {
            btn.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                btn.classList.add('active');
                kinematics.gaitType = btn.dataset.gait;
            });
        });
    }

    function setupPresetButtons() {
        const buttons = document.querySelectorAll('#presetButtons button');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const poseName = btn.dataset.pose;
                applyPresetPose(poseName);
            });
        });
    }

    function updateDynamicDanceAttitude(now) {
        if (activePose === 'Bounce & Wave Dance' || activePose === 'Up Down Leg Wave' || activePose === 'Bounce & Wave') {
            bodyState.heightOffset = Math.round(12 + Math.sin(now * 0.01) * 30); // Dynamic up and down bouncing (-18mm to +42mm)
            bodyState.pitch = Math.round(-10 + Math.cos(now * 0.005) * 8);
            bodyState.roll = Math.round(Math.sin(now * 0.005) * 8);
            bodyState.yaw = Math.round(Math.sin(now * 0.003) * 10);
        } else if (activePose === 'Ultimate Combo Dance' || activePose === 'Grand Combo Dance' || activePose === 'Combination Dance') {
            const dancePhase = (now * 0.001) % 16;
            if (dancePhase < 4) {
                // Stage 1: Front Elevation & Dual Air Leg Waving
                bodyState.heightOffset = Math.round(18 + Math.sin(now * 0.008) * 10);
                bodyState.pitch = Math.round(-14 + Math.sin(now * 0.005) * 8);
                bodyState.roll = Math.round(Math.sin(now * 0.006) * 12);
                bodyState.yaw = Math.round(Math.cos(now * 0.006) * 12);
            } else if (dancePhase < 8) {
                // Stage 2: Up/Down Bouncing & Pitch Tilting
                bodyState.heightOffset = Math.round(10 + Math.sin(now * 0.012) * 28);
                bodyState.pitch = Math.round(Math.sin(now * 0.01) * 22);
                bodyState.roll = Math.round(Math.cos(now * 0.008) * 10);
                bodyState.yaw = 0;
            } else if (dancePhase < 12) {
                // Stage 3: Side-to-Side Roll & Yaw Twist Shimmy
                bodyState.heightOffset = Math.round(5 + Math.cos(now * 0.006) * 12);
                bodyState.roll = Math.round(Math.sin(now * 0.012) * 24);
                bodyState.yaw = Math.round(Math.cos(now * 0.012) * 28);
                bodyState.pitch = Math.round(Math.sin(now * 0.006) * 10);
            } else {
                // Stage 4: Grand Finale All-Out Combo!
                bodyState.heightOffset = Math.round(15 + Math.sin(now * 0.014) * 20);
                bodyState.pitch = Math.round(Math.sin(now * 0.01) * 18);
                bodyState.roll = Math.round(Math.cos(now * 0.01) * 20);
                bodyState.yaw = Math.round(Math.sin(now * 0.008) * 25);
            }
        } else if (activePose === 'Disco Boogie Dance') {
            bodyState.heightOffset = Math.round(10 + Math.sin(now * 0.008) * 18);
            bodyState.roll = Math.round(Math.sin(now * 0.006) * 16);
            bodyState.pitch = Math.round(Math.cos(now * 0.008) * 10);
            bodyState.yaw = Math.round(Math.sin(now * 0.004) * 14);
        } else if (activePose === 'Twist & Shimmy') {
            bodyState.yaw = Math.round(Math.sin(now * 0.014) * 25);
            bodyState.roll = Math.round(Math.cos(now * 0.014) * 18);
            bodyState.pitch = Math.round(Math.sin(now * 0.007) * 8);
        } else if (activePose === 'Hexapod Salsa') {
            bodyState.roll = Math.round(Math.sin(now * 0.005) * 20);
            bodyState.pitch = Math.round(Math.cos(now * 0.005) * 12);
            bodyState.yaw = Math.round(Math.sin(now * 0.003) * 15);
            bodyState.heightOffset = Math.round(5 + Math.sin(now * 0.01) * 10);
        } else if (activePose === 'Robot Breakdance') {
            bodyState.heightOffset = Math.round(-25 + Math.sin(now * 0.01) * 12);
            bodyState.yaw = Math.round(Math.sin(now * 0.012) * 30);
            bodyState.pitch = Math.round(15 + Math.cos(now * 0.008) * 10);
            bodyState.roll = Math.round(Math.sin(now * 0.008) * 15);
        } else if (activePose === 'Dance Sway') {
            bodyState.heightOffset = Math.round(10 + Math.sin(now * 0.004) * 12);
            bodyState.roll = Math.round(Math.sin(now * 0.003) * 16);
            bodyState.pitch = Math.round(Math.cos(now * 0.004) * 12);
            bodyState.yaw = Math.round(Math.sin(now * 0.002) * 15);
        } else if (activePose === 'Dual Legs Air Wave' || activePose === 'Air Celebration' || activePose === 'Wave Left & Right Legs') {
            bodyState.heightOffset = 15;
            bodyState.pitch = -12;
            bodyState.roll = Math.round(Math.sin(now * 0.004) * 8);
            bodyState.yaw = Math.round(Math.cos(now * 0.004) * 8);
        } else if (activePose === 'Alternating Front Leg Wave' || activePose === 'Alternating Front Leg Wave Dance' || activePose === 'Alternating Wave') {
            bodyState.heightOffset = Math.round(12 + Math.sin(now * 0.008) * 15);
            bodyState.pitch = Math.round(-10 + Math.cos(now * 0.006) * 6);
            bodyState.roll = Math.round(Math.sin(now * 0.003) * 14); // Tilt body side-to-side as legs wave
            bodyState.yaw = Math.round(Math.cos(now * 0.003) * 12);
        } else if (activePose === 'Macarena Hexapod') {
            bodyState.heightOffset = Math.round(8 + Math.sin(now * 0.01) * 12);
            bodyState.roll = Math.round(Math.sin(now * 0.006) * 15);
            bodyState.yaw = Math.round(Math.cos(now * 0.006) * 18);
        } else if (activePose === 'Sequential Leg Wave Shuffle') {
            bodyState.heightOffset = Math.round(10 + Math.sin(now * 0.006) * 10);
            bodyState.roll = Math.round(Math.sin(now * 0.004) * 10);
            bodyState.yaw = Math.round(Math.cos(now * 0.004) * 15);
        } else if (activePose === 'Catwalk Front Leg Strut') {
            bodyState.heightOffset = Math.round(15 + Math.sin(now * 0.008) * 12);
            bodyState.pitch = Math.round(-12 + Math.cos(now * 0.008) * 8);
            bodyState.roll = Math.round(Math.sin(now * 0.008) * 16);
            bodyState.yaw = Math.round(Math.cos(now * 0.008) * 14);
        } else if (activePose === 'Techno Beat Shuffle' || activePose === 'Techno Shuffle') {
            bodyState.heightOffset = Math.round(15 + Math.sin(now * 0.016) * 18);
            bodyState.roll = Math.round(Math.sin(now * 0.008) * 18);
            bodyState.yaw = Math.round(Math.cos(now * 0.008) * 22);
            bodyState.pitch = Math.round(Math.sin(now * 0.008) * 12);
        } else if (activePose === 'K-Pop Synchronized Groove' || activePose === 'K-Pop Groove') {
            bodyState.heightOffset = Math.round(10 + Math.sin(now * 0.006) * 12);
            bodyState.roll = Math.round(Math.sin(now * 0.006) * 15);
            bodyState.yaw = Math.round(Math.cos(now * 0.006) * 16);
            bodyState.pitch = Math.round(-5 + Math.sin(now * 0.003) * 6);
        } else if (activePose === 'Moonwalk Slide') {
            bodyState.pitch = 18;
            bodyState.heightOffset = -10;
            moveVector.fwd = -0.8;
            moveVector.strafe = 0;
            moveVector.turn = 0;
        }
    }

    function applyPresetPose(poseName) {
        activePose = poseName;
        switch (poseName) {
            case "Stand":
                slideHeight.value = 0; slidePitch.value = 0; slideRoll.value = 0; slideYaw.value = 0; slideStance.value = 0;
                moveVector.fwd = 0; moveVector.strafe = 0; moveVector.turn = 0;
                break;
            case "Bounce & Wave Dance":
            case "Up Down Leg Wave":
            case "Bounce & Wave":
                slideHeight.value = 12; slidePitch.value = -10; slideRoll.value = 0; slideYaw.value = 0;
                moveVector.fwd = 0; moveVector.strafe = 0; moveVector.turn = 0;
                break;
            case "Ultimate Combo Dance":
            case "Grand Combo Dance":
            case "Combination Dance":
                slideHeight.value = 15; slidePitch.value = 0; slideRoll.value = 0; slideYaw.value = 0;
                moveVector.fwd = 0; moveVector.strafe = 0; moveVector.turn = 0;
                break;
            case "Flatten Legs":
            case "Flat Floor":
            case "Flat Pancake":
            case "Pancake":
                slideHeight.value = -50; slidePitch.value = 0; slideRoll.value = 0; slideYaw.value = 0; slideStance.value = 60;
                moveVector.fwd = 0; moveVector.strafe = 0; moveVector.turn = 0;
                break;
            case "Dual Legs Air Wave":
            case "Wave Left & Right Legs":
                slideHeight.value = 15; slidePitch.value = -12; slideRoll.value = 0; slideYaw.value = 0;
                moveVector.fwd = 0; moveVector.strafe = 0; moveVector.turn = 0;
                break;
            case "Wave Front Right":
            case "Wave Right Leg":
                slideHeight.value = 10; slidePitch.value = -10; slideRoll.value = 12; slideYaw.value = 10;
                break;
            case "Wave Front Left":
            case "Wave Left Leg":
                slideHeight.value = 10; slidePitch.value = -10; slideRoll.value = -12; slideYaw.value = -10;
                break;
            case "Alternating Front Leg Wave":
            case "Alternating Front Leg Wave Dance":
            case "Alternating Wave":
                slideHeight.value = 12; slidePitch.value = -10; slideRoll.value = 0; slideYaw.value = 0;
                moveVector.fwd = 0; moveVector.strafe = 0; moveVector.turn = 0;
                break;
            case "Macarena Hexapod":
                slideHeight.value = 10; slidePitch.value = -8; slideRoll.value = 10; slideYaw.value = 15;
                break;
            case "Sequential Leg Wave Shuffle":
                slideHeight.value = 8; slidePitch.value = 0; slideRoll.value = 0; slideYaw.value = 0;
                break;
            case "Catwalk Front Leg Strut":
                slideHeight.value = 15; slidePitch.value = -12; slideRoll.value = -10; slideYaw.value = -10;
                break;
            case "Techno Beat Shuffle":
            case "Techno Shuffle":
                slideHeight.value = 15; slidePitch.value = 10; slideRoll.value = 15; slideYaw.value = 20;
                break;
            case "K-Pop Synchronized Groove":
            case "K-Pop Groove":
                slideHeight.value = 10; slidePitch.value = -5; slideRoll.value = 12; slideYaw.value = 15;
                break;
            case "Mid Legs Air Wave":
                slideHeight.value = 10; slidePitch.value = 0; slideRoll.value = 0; slideYaw.value = 0;
                break;
            case "Air Celebration":
                slideHeight.value = 15; slidePitch.value = -12; slideRoll.value = 0; slideYaw.value = 0;
                break;
            case "Disco Boogie Dance":
                slideHeight.value = 10; slidePitch.value = 5; slideRoll.value = 10; slideYaw.value = 10;
                break;
            case "Twist & Shimmy":
                slideHeight.value = 0; slidePitch.value = 0; slideRoll.value = 15; slideYaw.value = 20;
                break;
            case "Hexapod Salsa":
                slideHeight.value = 5; slidePitch.value = 8; slideRoll.value = 18; slideYaw.value = 12;
                break;
            case "Robot Breakdance":
                slideHeight.value = -25; slidePitch.value = 15; slideRoll.value = 12; slideYaw.value = 25;
                break;
            case "Moonwalk Slide":
                slideHeight.value = -10; slidePitch.value = 18; slideRoll.value = 0; slideYaw.value = 0;
                break;
            case "Crab Walk Left":
                slideHeight.value = 0; slidePitch.value = 0; slideRoll.value = 0; slideYaw.value = 0;
                moveVector.fwd = 0; moveVector.strafe = -1.0; moveVector.turn = 0;
                break;
            case "Crab Walk Right":
                slideHeight.value = 0; slidePitch.value = 0; slideRoll.value = 0; slideYaw.value = 0;
                moveVector.fwd = 0; moveVector.strafe = 1.0; moveVector.turn = 0;
                break;
            case "Low Stance":
                slideHeight.value = -35; slidePitch.value = 0; slideRoll.value = 0; slideYaw.value = 0;
                break;
            case "High Stance":
                slideHeight.value = 35; slidePitch.value = 0; slideRoll.value = 0; slideYaw.value = 0;
                break;
            case "Beg":
                slideHeight.value = -10; slidePitch.value = -22; slideRoll.value = 0; slideYaw.value = 0;
                break;
            case "Bow / Respect":
                slideHeight.value = -20; slidePitch.value = 25; slideRoll.value = 0; slideYaw.value = 0;
                break;
            case "Stretch Stance":
                slideHeight.value = -15; slidePitch.value = 0; slideRoll.value = 0; slideYaw.value = 0; slideStance.value = 35;
                break;
            case "Sleep / Park":
                slideHeight.value = -40; slidePitch.value = 0; slideRoll.value = 0; slideYaw.value = 0; slideStance.value = -20;
                moveVector.fwd = 0; moveVector.strafe = 0; moveVector.turn = 0;
                break;
            case "Dance Sway":
                slideHeight.value = 10; slidePitch.value = 10; slideRoll.value = 15; slideYaw.value = 15;
                break;
            case "Curious Tilt":
                slideHeight.value = 15; slidePitch.value = -5; slideRoll.value = 18; slideYaw.value = 12;
                break;
            case "Greeting Wave":
                slideHeight.value = 10; slidePitch.value = -12; slideRoll.value = 15; slideYaw.value = 12;
                break;
            case "Attack / Aggressive":
                slideHeight.value = -15; slidePitch.value = 18; slideRoll.value = 0; slideYaw.value = 0;
                break;
        }
        updateBodyStateFromSliders();

        const calibPoseSelect = document.getElementById('calibPoseSelect');
        if (calibPoseSelect) {
            calibPoseSelect.value = poseName;
        }
    }

    function setupDPadControls() {
        const bindButton = (id, fwd, strafe, turn) => {
            const btn = document.getElementById(id);
            if (!btn) return;

            const start = (e) => {
                e.preventDefault();
                moveVector.fwd = fwd;
                moveVector.strafe = strafe;
                moveVector.turn = turn;
                btn.classList.add('active');
            };

            const end = (e) => {
                e.preventDefault();
                moveVector.fwd = 0;
                moveVector.strafe = 0;
                moveVector.turn = 0;
                btn.classList.remove('active');
            };

            btn.addEventListener('mousedown', start);
            btn.addEventListener('mouseup', end);
            btn.addEventListener('mouseleave', end);
            btn.addEventListener('touchstart', start);
            btn.addEventListener('touchend', end);
        };

        bindButton('btnFwd', 1, 0, 0);
        bindButton('btnBwd', -1, 0, 0);
        bindButton('btnLeft', 0, -1, 0);
        bindButton('btnRight', 0, 1, 0);
        bindButton('btnTurnL', 0, 0, -1);
        bindButton('btnTurnR', 0, 0, 1);

        document.getElementById('btnStop').addEventListener('click', () => {
            moveVector.fwd = 0;
            moveVector.strafe = 0;
            moveVector.turn = 0;
        });
    }

    function setupKeyboardListeners() {
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;
            activeKeys[e.key.toLowerCase()] = true;
        });

        window.addEventListener('keyup', (e) => {
            activeKeys[e.key.toLowerCase()] = false;
        });
    }

    function updateMoveVectorFromKeys() {
        let fwd = 0, strafe = 0, turn = 0;

        if (activeKeys['w'] || activeKeys['arrowup'])    fwd += 1;
        if (activeKeys['s'] || activeKeys['arrowdown'])  fwd -= 1;
        if (activeKeys['a'])                             strafe -= 1;
        if (activeKeys['d'])                             strafe += 1;
        if (activeKeys['q'] || activeKeys['arrowleft'])  turn -= 1;
        if (activeKeys['e'] || activeKeys['arrowright']) turn += 1;

        if (activeKeys[' ']) {
            fwd = 0; strafe = 0; turn = 0;
        }

        if (fwd !== 0 || strafe !== 0 || turn !== 0) {
            moveVector.fwd = fwd;
            moveVector.strafe = strafe;
            moveVector.turn = turn;
        }
    }

    function exportPythonCode() {
        const feetPositions = kinematics.updateGait(0, { fwd: 0, strafe: 0, turn: 0 }, kinematics.gaitType);
        const legResults = kinematics.computeLegTargets(bodyState, feetPositions);

        const angles = {};
        legResults.forEach((res, i) => {
            angles[i] = {
                coxa: Math.round((res.angles.coxa * 180) / Math.PI),
                femur: Math.round((res.angles.femur * 180) / Math.PI),
                tibia: Math.round((res.angles.tibia * 180) / Math.PI)
            };
        });

        fetch('/api/export-python', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ angles })
        })
        .then(res => res.blob())
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'hexapod_l298_sr04_control.py';
            document.body.appendChild(a);
            a.click();
            a.remove();
        })
        .catch(err => console.error('Failed to export code:', err));
    }

    function setupMp3MusicPlayer() {
        const mp3FileInput = document.getElementById('mp3FileInput');
        const btnUploadMp3 = document.getElementById('btnUploadMp3');
        const selectMp3Song = document.getElementById('selectMp3Song');
        const selectMusicDance = document.getElementById('selectMusicDance');
        const btnPlayMusic = document.getElementById('btnPlayMusic');
        const btnPauseMusic = document.getElementById('btnPauseMusic');
        const btnStopMusic = document.getElementById('btnStopMusic');
        const musicTrackName = document.getElementById('musicTrackName');
        const musicTimeVal = document.getElementById('musicTimeVal');
        const slideMusicProgress = document.getElementById('slideMusicProgress');
        const slideMusicVolume = document.getElementById('slideMusicVolume');
        const valMusicVolume = document.getElementById('valMusicVolume');

        if (!selectMp3Song) return;

        const musicAudio = new Audio();
        musicAudio.crossOrigin = "anonymous";

        let audioCtx = null;
        let analyser = null;
        let sourceNode = null;
        let isSeeking = false;
        let lastMotorState = false;

        const initAudioAnalyser = () => {
            if (audioCtx) return;
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                sourceNode = audioCtx.createMediaElementSource(musicAudio);
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 128;
                sourceNode.connect(analyser);
                analyser.connect(audioCtx.destination);
            } catch (e) {
                console.warn('Web Audio API music analyser init warning:', e);
            }
        };

        const loadAudioList = () => {
            fetch('/api/audio/list')
                .then(res => res.json())
                .then(data => {
                    selectMp3Song.innerHTML = '';
                    const files = data.files || [];
                    if (files.length === 0) {
                        const opt = document.createElement('option');
                        opt.value = '';
                        opt.textContent = 'No MP3 files in audio/ folder yet. Import one!';
                        selectMp3Song.appendChild(opt);
                    } else {
                        files.forEach((f, idx) => {
                            const opt = document.createElement('option');
                            opt.value = f;
                            opt.textContent = `🎵 ${f}`;
                            if (idx === 0) opt.selected = true;
                            selectMp3Song.appendChild(opt);
                        });
                        if (musicTrackName && files.length > 0) {
                            musicTrackName.textContent = `Track: ${selectMp3Song.value}`;
                        }
                    }
                })
                .catch(err => console.error('Failed to list audio files:', err));
        };

        loadAudioList();

        if (btnUploadMp3 && mp3FileInput) {
            btnUploadMp3.addEventListener('click', () => mp3FileInput.click());

            mp3FileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                btnUploadMp3.textContent = '⏳ Uploading MP3 to audio/ subfolder...';
                btnUploadMp3.disabled = true;

                const reader = new FileReader();
                reader.onload = (event) => {
                    const b64 = event.target.result.split(',')[1];
                    fetch('/api/audio/upload', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            filename: file.name,
                            data_b64: b64
                        })
                    })
                    .then(res => res.json())
                    .then(resData => {
                        btnUploadMp3.textContent = '📁 Import MP3 to static/audio/ Folder';
                        btnUploadMp3.disabled = false;
                        if (resData.success) {
                            console.log('MP3 imported successfully:', resData);
                            loadAudioList();
                            setTimeout(() => {
                                selectMp3Song.value = resData.filename;
                                if (musicTrackName) musicTrackName.textContent = `Track: ${resData.filename}`;
                            }, 200);
                        } else {
                            alert('Failed to upload MP3: ' + (resData.error || 'Unknown error'));
                        }
                    })
                    .catch(err => {
                        btnUploadMp3.textContent = '📁 Import MP3 to static/audio/ Folder';
                        btnUploadMp3.disabled = false;
                        alert('Upload error: ' + err.message);
                    });
                };
                reader.readAsDataURL(file);
            });
        }

        if (selectMp3Song) {
            selectMp3Song.addEventListener('change', () => {
                const file = selectMp3Song.value;
                if (file) {
                    if (musicTrackName) musicTrackName.textContent = `Track: ${file}`;
                    musicAudio.src = `/audio/${file}`;
                }
            });
        }

        if (btnPlayMusic) {
            btnPlayMusic.addEventListener('click', () => {
                const file = selectMp3Song.value;
                if (!file) {
                    alert('Please import or select an MP3 file first!');
                    return;
                }

                if (audioCtx && audioCtx.state === 'suspended') {
                    audioCtx.resume();
                }
                initAudioAnalyser();

                const currentSrc = musicAudio.src;
                if (!currentSrc || !currentSrc.endsWith(`/audio/${file}`)) {
                    musicAudio.src = `/audio/${file}`;
                }

                musicAudio.play().then(() => {
                    const danceStyle = selectMusicDance ? selectMusicDance.value : 'Alternating Front Leg Wave';
                    applyPresetPose(danceStyle);
                }).catch(err => console.error('Play music error:', err));
            });
        }

        if (btnPauseMusic) {
            btnPauseMusic.addEventListener('click', () => {
                musicAudio.pause();
                appAPI.setMouthEnergized(false);
                appAPI.setNeckPulsating(false);
            });
        }

        if (btnStopMusic) {
            btnStopMusic.addEventListener('click', () => {
                musicAudio.pause();
                musicAudio.currentTime = 0;
                appAPI.setMouthEnergized(false);
                appAPI.setNeckPulsating(false);
                applyPresetPose('Stand');
            });
        }

        if (slideMusicVolume) {
            slideMusicVolume.addEventListener('input', (e) => {
                const vol = parseInt(e.target.value, 10);
                musicAudio.volume = vol / 100;
                if (valMusicVolume) valMusicVolume.textContent = `${vol}%`;
            });
        }

        if (slideMusicProgress) {
            slideMusicProgress.addEventListener('mousedown', () => { isSeeking = true; });
            slideMusicProgress.addEventListener('mouseup', () => {
                isSeeking = false;
                if (musicAudio.duration) {
                    musicAudio.currentTime = (slideMusicProgress.value / 100) * musicAudio.duration;
                }
            });
            slideMusicProgress.addEventListener('input', () => {
                if (musicAudio.duration) {
                    const cur = (slideMusicProgress.value / 100) * musicAudio.duration;
                    if (musicTimeVal) musicTimeVal.textContent = `${formatTime(cur)} / ${formatTime(musicAudio.duration)}`;
                }
            });
        }

        musicAudio.addEventListener('timeupdate', () => {
            if (!isSeeking && musicAudio.duration) {
                const pct = (musicAudio.currentTime / musicAudio.duration) * 100;
                if (slideMusicProgress) slideMusicProgress.value = pct;
                if (musicTimeVal) musicTimeVal.textContent = `${formatTime(musicAudio.currentTime)} / ${formatTime(musicAudio.duration)}`;
            }
        });

        musicAudio.addEventListener('ended', () => {
            appAPI.setMouthEnergized(false);
            appAPI.setNeckPulsating(false);
            applyPresetPose('Stand');
        });

        const dataArray = new Uint8Array(64);

        const monitorMusicLipSync = () => {
            requestAnimationFrame(monitorMusicLipSync);

            if (!musicAudio.paused && analyser) {
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i];
                }
                const avg = sum / dataArray.length;
                const isAudible = avg > 8; // Vocal/beat energy threshold

                // Dynamically open hexapod mouth in proportion to music beat volume
                if (renderer) {
                    renderer.mouthEnergized = isAudible;
                    renderer.neckPulsating = isAudible;
                    if (renderer.lowerJawGroup) {
                        const jawAngle = Math.min(0.65, (avg / 120) * 0.65);
                        renderer.lowerJawGroup.rotation.x = jawAngle;
                    }
                }

                if (isAudible !== lastMotorState) {
                    lastMotorState = isAudible;
                    fetch('/api/motor/l298', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mouth: isAudible, neck: isAudible })
                    }).catch(e => {});
                }

                // Ensure active dance style continues playing
                const danceStyle = selectMusicDance ? selectMusicDance.value : 'Alternating Front Leg Wave';
                if (activePose !== danceStyle) {
                    applyPresetPose(danceStyle);
                }
            } else if (musicAudio.paused) {
                if (lastMotorState) {
                    lastMotorState = false;
                    fetch('/api/motor/l298', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mouth: false, neck: false })
                    }).catch(e => {});
                }
            }
        };

        monitorMusicLipSync();

        function formatTime(sec) {
            if (isNaN(sec) || !isFinite(sec)) return '0:00';
            const m = Math.floor(sec / 60);
            const s = Math.floor(sec % 60);
            return `${m}:${s < 10 ? '0' : ''}${s}`;
        }
    }
});
