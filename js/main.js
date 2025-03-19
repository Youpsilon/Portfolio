// Variables globales
let scene, camera, renderer;
let player; // Modèle chargé depuis Blender
const speed = 2;
const cameraOffset = new THREE.Vector3(10, 6, 50);

// Mécanique du saut révisée avec physique réaliste
let isJumping = false;

let overlayVisible = false;

// Pour un saut réaliste, nous utilisons la gravité terrestre
const earthGravity = 22; // m/s²
const desiredJumpHeight = 2.5; // hauteur souhaitée en mètres
const jumpInitialVelocity = Math.sqrt(2 * earthGravity * desiredJumpHeight); // ~7.67 m/s
let jumpVelocityY = 0;

// Objet pour suivre l'état des touches
let keys = {};

// Variables pour l'animation de la caméra
let cameraMode = "follow"; // "follow" ou "sign"
let cameraAnimating = false;
let cameraAnimationStartTime = 0;
const cameraAnimationDuration = 1000; // durée en ms
let cameraStartPos = new THREE.Vector3();
let cameraTargetPos = new THREE.Vector3();
let cameraStartZoom = 4;
let cameraTargetZoom = 4;
let newCameraMode = "follow";

// Variables pour interpoler l'orientation (lookAt) de la caméra
let cameraStartLookAt = new THREE.Vector3();
let cameraTargetLookAt = new THREE.Vector3();

let jumpAction, jumpClip;
let jumpStartTime = 0;
let skyCylinder;

let sign;

let lastFrameTime = performance.now();
let mixer, idleAction, runAction, runClip;

// Pour la position de départ sur la route (pour le placement des lampadaires)
let startEdgeCenterLocal;

let composer;

// Variables pour la détection du pincement (zoom mobile)
let initialPinchDistance = null;
let initialCameraZoom; // Sera assignée après l'initialisation de la caméra

// Fonction utilitaire pour calculer la distance entre deux doigts
function getPinchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

// --- Gestion des boutons mobiles ---
// Ces écouteurs supposent que les éléments HTML avec les IDs "left", "right", "jump" et "run" existent.
document.getElementById("left").addEventListener("touchstart", function(e) {
    e.preventDefault();
    keys["ArrowLeft"] = true;
});
document.getElementById("left").addEventListener("touchend", function(e) {
    e.preventDefault();
    keys["ArrowLeft"] = false;
});

document.getElementById("right").addEventListener("touchstart", function(e) {
    e.preventDefault();
    keys["ArrowRight"] = true;
});
document.getElementById("right").addEventListener("touchend", function(e) {
    e.preventDefault();
    keys["ArrowRight"] = false;
});

document.getElementById("jump").addEventListener("touchstart", function(e) {
    e.preventDefault();
    if (!isJumping) {
        keys["Space"] = true;
    }
});
document.getElementById("jump").addEventListener("touchend", function(e) {
    e.preventDefault();
    keys["Space"] = false;
});

// Bouton Course (toggle)
let runEnabled = false;
document.getElementById("run").addEventListener("click", function(e) {
    e.preventDefault();
    runEnabled = !runEnabled;
    keys["ShiftLeft"] = runEnabled;
    this.classList.toggle("active", runEnabled);
});

// --- Initialisation et animation ---
init();
animate();

function init() {
    // Récupération des couleurs définies en CSS
    const rootStyles = getComputedStyle(document.documentElement);
    const bgColor = rootStyles.getPropertyValue('--bg-color').trim();

    // --- Scène ---
    scene = new THREE.Scene();

    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 500);
    camera.position.set(0, 20, 20);
    camera.lookAt(new THREE.Vector3(0, 0, 0));
    camera.zoom = 4; // Zoom initial
    camera.updateProjectionMatrix();
    initialCameraZoom = camera.zoom;

    // --- Renderer ---
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(bgColor);
    document.body.appendChild(renderer.domElement);

    composer = new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene, camera));

    // --- Gestion du zoom par pincement sur mobile ---
    renderer.domElement.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            initialPinchDistance = getPinchDistance(e.touches);
            initialCameraZoom = camera.zoom;
        }
    }, { passive: false });

    renderer.domElement.addEventListener('touchmove', function(e) {
        if (e.touches.length === 2 && initialPinchDistance !== null) {
            e.preventDefault();
            const currentDistance = getPinchDistance(e.touches);
            const scaleFactor = currentDistance / initialPinchDistance;
            camera.zoom = initialCameraZoom * scaleFactor;
            camera.zoom = Math.max(1, Math.min(10, camera.zoom));
            camera.updateProjectionMatrix();
        }
    }, { passive: false });

    renderer.domElement.addEventListener('touchend', function(e) {
        if (e.touches.length < 2) {
            initialPinchDistance = null;
        }
    });

    // --- Lumières ---
    const moonAmbient = new THREE.AmbientLight(0x666666, 1.5);
    scene.add(moonAmbient);

    const moonLight = new THREE.DirectionalLight(0x99aaff, 1.4);
    moonLight.position.set(-50, 60, -50);
    moonLight.castShadow = false;
    scene.add(moonLight);

    // --- Création de la route ---
    const roadLength = 200;
    const roadWidth = 5;
    const segmentsX = 20;
    const segmentsY = 1;
    const geometry = new THREE.PlaneGeometry(roadLength, roadWidth, segmentsX, segmentsY);
    geometry.translate(roadLength / 2, roadWidth / 2, 0);
    geometry.rotateX(-Math.PI / 2);
    geometry.rotateY(Math.PI / 4);
    const material = new THREE.MeshStandardMaterial({
        color: 0x592C0C,
        side: THREE.DoubleSide
    });
    const road = new THREE.Mesh(geometry, material);
    road.receiveShadow = true;
    scene.add(road);

    // --- Position initiale du joueur ---
    startEdgeCenterLocal = new THREE.Vector3(0, roadWidth / 2, 0);
    startEdgeCenterLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    startEdgeCenterLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
    startEdgeCenterLocal.y = 0;

    // --- Chargement du panneau cliquable (panneau.glb) ---
    const loaderPanel = new THREE.GLTFLoader();
    loaderPanel.load(
        'asset/models/panneau.glb', // Assurez-vous que le chemin est correct
        function (gltf) {
            sign = gltf.scene;
            // Optionnel : ajuster l'échelle, la position et la rotation
            sign.scale.set(0.5, 0.5, 0.5); // Adaptez selon la taille souhaitée
            sign.position.copy(startEdgeCenterLocal).add(new THREE.Vector3(5, 0, 0));
            sign.rotation.y = 3 *Math.PI / 4;
            scene.add(sign);
        },
        undefined,
        function (error) {
            console.error('Erreur de chargement du panneau :', error);
        }
    );


    // --- Chargement des modèles et animations ---
    const loader = new THREE.GLTFLoader();
    loader.load(
        'asset/models/renard-fixe.glb',
        function (gltf) {
            player = gltf.scene;
            player.scale.set(0.5, 0.5, 0.5);
            player.position.copy(startEdgeCenterLocal);
            player.rotation.y = -Math.PI / 4;
            player.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = false;
                }
            });
            scene.add(player);
            if (gltf.animations && gltf.animations.length) {
                mixer = new THREE.AnimationMixer(player);
                idleAction = mixer.clipAction(gltf.animations[0]);
                idleAction.play();
            }
        },
        undefined,
        function (error) {
            console.error('Erreur de chargement du modèle :', error);
        }
    );

    const loaderRun = new THREE.GLTFLoader();
    loaderRun.load(
        'asset/models/renard-run.glb',
        function (gltf) {
            if (gltf.animations && gltf.animations.length && mixer) {
                runClip = gltf.animations[0];
                runAction = mixer.clipAction(runClip);
                runAction.play();
                runAction.paused = true;
            }
        },
        undefined,
        function (error) {
            console.error('Erreur de chargement de l\'animation de course :', error);
        }
    );

    const loaderJump = new THREE.GLTFLoader();
    loaderJump.load(
        'asset/models/renard-jump.glb',
        function (gltf) {
            if (gltf.animations && gltf.animations.length && mixer) {
                jumpClip = gltf.animations[0];
                jumpAction = mixer.clipAction(jumpClip);
                jumpAction.loop = THREE.LoopOnce;
                jumpAction.clampWhenFinished = true;
            }
        },
        undefined,
        function (error) {
            console.error('Erreur de chargement de l\'animation de saut :', error);
        }
    );

    // --- Placement des arbres et lampadaires ---
    let roadDirection = new THREE.Vector3(1, 0, 0);
    roadDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
    let lateralDirection = roadDirection.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const manualTreePositions = [
        { offsetAlong: 5,    offsetLateral: 3,    rotY: 0.2,   scale: 0.8 },
        { offsetAlong: 7,    offsetLateral: 5,    rotY: -0.3,  scale: 1.1 },
        { offsetAlong: 10,   offsetLateral: -5,   rotY: 0.5,   scale: 0.9 },
        { offsetAlong: 11.6, offsetLateral: -4.5, rotY: 1.0,   scale: 1 },
        { offsetAlong: 18,   offsetLateral: 3.5,  rotY: -0.8,  scale: 1.2 },
        { offsetAlong: 16,   offsetLateral: 5,    rotY: 0.3,   scale: 0.8 },
        { offsetAlong: 18.8, offsetLateral: -4.0, rotY: 0.1,   scale: 1.0 },
        { offsetAlong: 26,   offsetLateral: 2.8,  rotY: 0.3,   scale: 0.95 },
        { offsetAlong: 27.3, offsetLateral: 5.5,  rotY: 0.0,   scale: 1.2 },
        { offsetAlong: 30,   offsetLateral: -3.2, rotY: 0.5,   scale: 0.9 },
        { offsetAlong: 36,   offsetLateral: 2.8,  rotY: -0.1,  scale: 1.0 },
        { offsetAlong: 37.5, offsetLateral: 4.5,  rotY: 0.4,   scale: 1.05 },
        { offsetAlong: 40,   offsetLateral: -3.8, rotY: 0.7,   scale: 0.85 },
        { offsetAlong: 41,   offsetLateral: -5.5, rotY: -0.4,  scale: 1.2 },
        { offsetAlong: 46,   offsetLateral: 4.0,  rotY: 0.3,   scale: 1.0 },
        { offsetAlong: 47.5, offsetLateral: 3.0,  rotY: -0.6,  scale: 1.1 },
        { offsetAlong: 51.6, offsetLateral: -5.2, rotY: 0.2,   scale: 0.9 },
        { offsetAlong: 60,   offsetLateral: 4.8,  rotY: 0.8,   scale: 1.3 },
        { offsetAlong: 61.6, offsetLateral: -3.5, rotY: -0.2,  scale: 1.0 },
        { offsetAlong: 65,   offsetLateral: 3.5,  rotY: 0.1,   scale: 1.0 },
        { offsetAlong: 68,   offsetLateral: -4.0, rotY: 0.2,   scale: 1.1 },
        { offsetAlong: 70,   offsetLateral: 4.2,  rotY: -0.3,  scale: 0.95 },
        { offsetAlong: 73,   offsetLateral: -3.8, rotY: 0.5,   scale: 1.0 },
        { offsetAlong: 76,   offsetLateral: 3.0,  rotY: 0.0,   scale: 1.05 },
        { offsetAlong: 79,   offsetLateral: -5.0, rotY: 0.3,   scale: 1.0 },
        { offsetAlong: 82,   offsetLateral: 4.5,  rotY: -0.2,  scale: 1.1 },
        { offsetAlong: 85,   offsetLateral: -4.5, rotY: 0.4,   scale: 0.9 },
        { offsetAlong: 88,   offsetLateral: 3.8,  rotY: 0.1,   scale: 1.0 },
        { offsetAlong: 91,   offsetLateral: -3.2, rotY: -0.1,  scale: 1.2 },
        { offsetAlong: 94,   offsetLateral: 4.0,  rotY: 0.2,   scale: 1.0 },
        { offsetAlong: 97,   offsetLateral: -4.0, rotY: 0.3,   scale: 1.1 },
        { offsetAlong: 103,  offsetLateral: 3.5,  rotY: -0.3,  scale: 0.95 },
        { offsetAlong: 105,  offsetLateral: -3.5, rotY: 0.4,   scale: 1.0 },
        { offsetAlong: 111,  offsetLateral: 4.2,  rotY: 0.0,   scale: 1.0 },
        { offsetAlong: 115,  offsetLateral: -4.5, rotY: 0.2,   scale: 1.1 },
        { offsetAlong: 122,  offsetLateral: 3.0,  rotY: -0.2,  scale: 0.9 },
        { offsetAlong: 125,  offsetLateral: 4.5,  rotY: 0.3,   scale: 1.0 },
        { offsetAlong: 129,  offsetLateral: -3.8, rotY: 0.1,   scale: 1.2 },
        { offsetAlong: 136,  offsetLateral: 3.8,  rotY: -0.4,  scale: 1.0 },
        { offsetAlong: 141,  offsetLateral: -4.0, rotY: 0.5,   scale: 1.1 },
        { offsetAlong: 144,  offsetLateral: 4.0,  rotY: 0.0,   scale: 1.0 },
        { offsetAlong: 153,  offsetLateral: -3.5, rotY: 0.3,   scale: 1.0 },
        { offsetAlong: 155,  offsetLateral: 4.2,  rotY: -0.2,  scale: 1.1 },
        { offsetAlong: 160,  offsetLateral: -4.5, rotY: 0.2,   scale: 0.95 },
        { offsetAlong: 163,  offsetLateral: 3.5,  rotY: 0.4,   scale: 1.0 },
        { offsetAlong: 170,  offsetLateral: -3.8, rotY: -0.1,  scale: 1.0 },
        { offsetAlong: 172,  offsetLateral: 4.0,  rotY: 0.1,   scale: 1.0 },
        { offsetAlong: 180,  offsetLateral: -4.0, rotY: 0.3,   scale: 1.1 },
        { offsetAlong: 185,  offsetLateral: 3.2,  rotY: -0.3,  scale: 0.9 },
        { offsetAlong: 200,  offsetLateral: -3.5, rotY: 0.0,   scale: 1.0 }
    ];

    manualTreePositions.forEach(item => {
        const tree = createTree();
        tree.position.copy(startEdgeCenterLocal)
            .add(roadDirection.clone().multiplyScalar(item.offsetAlong))
            .add(lateralDirection.clone().multiplyScalar(item.offsetLateral));
        tree.rotation.y = item.rotY;
        tree.scale.set(item.scale, item.scale, item.scale);
        scene.add(tree);
    });

    for (let d = 10; d < roadLength; d += 30) {
        const lampPost = createLampPost(d);
        scene.add(lampPost);
    }

    // --- Chargement du terrain ---
    const loaderTerrain = new THREE.GLTFLoader();
    loaderTerrain.load(
        'asset/models/plan.glb',
        function(gltf) {
            const terrain = gltf.scene;
            terrain.rotation.y = Math.PI / 4;
            terrain.position.set(0, -0.01, 0);
            terrain.scale.set(30, 30, 30);
            scene.add(terrain);
        },
        undefined,
        function(error) {
            console.error('Erreur de chargement du terrain plan.glb :', error);
        }
    );

    // --- Création du ciel ---
    function createStarryTexture(width, height, starCount) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#001';
        ctx.fillRect(0, 0, width, height);
        for (let i = 0; i < starCount; i++) {
            let x = Math.random() * width;
            let y = Math.random() * height;
            let radius = Math.random() * 0.8 + 0.4 ;
            let alpha = Math.random() * 0.8 + 0.2;
            ctx.fillStyle = `rgba(255,255,255,${alpha})`;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        return canvas;
    }
    function createSkyCylinder() {
        const radius = 400;
        const height = 400;
        const radialSegments = 32;
        const geometry = new THREE.CylinderGeometry(radius, radius, height, radialSegments, 1, true);
        const canvas = createStarryTexture(1024, 512, 2500);
        const skyTexture = new THREE.CanvasTexture(canvas);
        skyTexture.wrapS = THREE.RepeatWrapping;
        skyTexture.wrapT = THREE.RepeatWrapping;
        skyTexture.repeat.set(8, 4);
        const material = new THREE.MeshBasicMaterial({
            map: skyTexture,
            side: THREE.BackSide
        });
        const skyCylinder = new THREE.Mesh(geometry, material);
        skyCylinder.position.y = height / 2 - 50;
        skyCylinder.rotation.y = Math.PI / 4;
        return skyCylinder;
    }
    const skyCylinderMesh = createSkyCylinder();
    scene.add(skyCylinderMesh);

    // --- Événements généraux ---
    window.addEventListener("resize", onWindowResize, false);
    window.addEventListener("keydown", (e) => { keys[e.code] = true; }, false);
    window.addEventListener("keyup", (e) => { keys[e.code] = false; }, false);
    window.addEventListener("wheel", onMouseWheel, false);
    window.addEventListener("mousedown", onDocumentMouseDown, false);



    document.getElementById('closeOverlay').addEventListener('click', exitFocusMode);

}


function exitFocusMode() {
    // Masquer l'overlay immédiatement
    document.getElementById('infoOverlay').classList.add('hidden');
    overlayVisible = false;

    // Configurer la transition de retour de la caméra vers le mode "follow"
    cameraStartPos.copy(camera.position);
    cameraStartZoom = camera.zoom;
    cameraStartLookAt.copy(sign.position);
    cameraTargetPos.copy(player.position).add(cameraOffset);
    cameraTargetZoom = 4;
    cameraTargetLookAt.copy(player.position);
    cameraAnimationStartTime = performance.now();
    newCameraMode = "follow";
    cameraAnimating = true;
}


function createTree() {
    const treeGroup = new THREE.Group();
    const loader = new THREE.GLTFLoader();
    const treeModels = ['asset/models/arbre-1.glb', 'asset/models/arbre-2.glb'];
    const chosenModel = treeModels[Math.floor(Math.random() * treeModels.length)];
    loader.load(
        chosenModel,
        function(gltf) {
            const treeModel = gltf.scene;
            treeModel.scale.set(1, 1, 1);
            treeGroup.add(treeModel);
        },
        undefined,
        function(error) {
            console.error('Erreur de chargement du modèle d\'arbre :', error);
        }
    );
    return treeGroup;
}


function createLampPost(distance) {
    const lampPostGroup = new THREE.Group();
    const forward = new THREE.Vector3(Math.cos(Math.PI / 4), 0, -Math.sin(Math.PI / 4));
    const left = new THREE.Vector3(-Math.sin(Math.PI / 4), 0, -Math.cos(Math.PI / 4));
    const lateralOffset = 3;
    let position = new THREE.Vector3()
        .copy(startEdgeCenterLocal)
        .add(forward.clone().multiplyScalar(distance))
        .add(left.clone().multiplyScalar(lateralOffset));

    const loader = new THREE.GLTFLoader();
    loader.load('asset/models/lampadaire.glb', function(gltf) {
        const lampPostModel = gltf.scene;
        lampPostModel.scale.set(0.5, 0.5, 0.5);
        lampPostModel.rotation.y = -Math.PI / 4;
        lampPostModel.position.set(0.5, 0, 0);
        lampPostGroup.add(lampPostModel);

        const directLight = new THREE.PointLight(0xffffff, 1, 10);
        directLight.castShadow = true;
        directLight.shadow.mapSize.width = 256;
        directLight.shadow.mapSize.height = 256;

        directLight.shadow.camera.near = 0.5;
        directLight.shadow.camera.far = 50;
        directLight.position.set(3, 5, 0);
        lampPostModel.add(directLight);

        const bulbGeometry = new THREE.SphereGeometry(0.45, 50, 50);
        const bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffee88 });
        const bulbMesh = new THREE.Mesh(bulbGeometry, bulbMaterial);
        bulbMesh.position.set(2.52, 8.7, 0);
        lampPostModel.add(bulbMesh);
    });

    lampPostGroup.position.copy(position);
    return lampPostGroup;
}

function onMouseWheel(event) {
    camera.zoom += event.deltaY * -0.005;
    camera.zoom = Math.max(1, Math.min(10, camera.zoom));
    camera.updateProjectionMatrix();
}

function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    const d = 20;
    camera.left = -d * aspect;
    camera.right = d * aspect;
    camera.top = d;
    camera.bottom = -d;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onDocumentMouseDown(event) {
    event.preventDefault();
    const mouse = new THREE.Vector2();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    // Passage du second paramètre à true pour détecter les enfants de 'sign'
    const intersects = raycaster.intersectObject(sign, true);
    if (intersects.length > 0 && !cameraAnimating) {
        if (cameraMode === "follow") {
            cameraStartPos.copy(player.position).add(cameraOffset);
            cameraStartLookAt.copy(player.position);
            let signForward = new THREE.Vector3(0, 5, 1);
            signForward.applyQuaternion(sign.quaternion);
            const desiredDistance = 20;
            cameraTargetPos.copy(sign.position).sub(signForward.multiplyScalar(desiredDistance));
            cameraTargetPos.y = 3;
            cameraTargetLookAt.copy(sign.position);
            cameraAnimationStartTime = performance.now();
            newCameraMode = "sign";
            cameraAnimating = true;
        }
    }
}



function onRunFinished(event) {
    if (event.action === runAction) {
        runAction.paused = true;
        runAction.crossFadeTo(idleAction, 0.2, false);
        mixer.removeEventListener('finished', onRunFinished);
    }
}

function animate() {
    requestAnimationFrame(animate);
    let now = performance.now();
    let dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    if (mixer) {
        mixer.update(dt);
    }

    let moveSpeed = speed;
    if (keys["ShiftLeft"]) {
        moveSpeed = 4;
        if (mixer && runAction) {
            runAction.setEffectiveTimeScale(2);
        }
    } else {
        moveSpeed = speed;
        if (mixer && runAction) {
            runAction.setEffectiveTimeScale(1);
        }
    }

    if (mixer && idleAction && runAction) {
        if (keys["KeyA"] || keys["KeyD"] || keys["ArrowLeft"] || keys["ArrowRight"]) {
            if (runAction.paused) {
                idleAction.crossFadeTo(runAction, 0.2, false);
                runAction.paused = false;
                runAction.play();
                runAction.setLoop(THREE.LoopRepeat, Infinity);
                runAction.setEffectiveTimeScale(2);
            }
        } else {
            if (!runAction.paused) {
                runAction.stop();
                runAction.paused = true;
                idleAction.reset();
                idleAction.play();
            }
        }
    }

    if (cameraAnimating) {
        let t = (performance.now() - cameraAnimationStartTime) / cameraAnimationDuration;
        if (t >= 1) {
            t = 1;
            cameraAnimating = false;
            cameraMode = newCameraMode;
        }
        camera.position.lerpVectors(cameraStartPos, cameraTargetPos, t);
        camera.zoom = cameraStartZoom + t * (cameraTargetZoom - cameraStartZoom);
        camera.updateProjectionMatrix();
        let currentLookAt = new THREE.Vector3().lerpVectors(cameraStartLookAt, cameraTargetLookAt, t);
        camera.lookAt(currentLookAt);
    } else if (cameraMode === "follow" && player) {
        camera.position.copy(player.position).add(cameraOffset);
        camera.lookAt(player.position.clone().add(new THREE.Vector3(0, 2, 0)));
    }

    if (!cameraAnimating && cameraMode === "sign" && !overlayVisible) {
        document.getElementById('infoOverlay').classList.remove('hidden');
        overlayVisible = true;
    }


    if (player) {
        const forward = new THREE.Vector3(Math.cos(Math.PI / 4), 0, -Math.sin(Math.PI / 4));
        if (keys["ArrowRight"] || keys["KeyD"]) {
            player.position.add(forward.clone().multiplyScalar(moveSpeed * dt));
            player.rotation.y = -Math.PI / 4;
        }
        if (keys["ArrowLeft"] || keys["KeyA"]) {
            player.position.add(forward.clone().multiplyScalar(-moveSpeed * dt));
            player.rotation.y = -Math.PI / 4 + Math.PI;
        }

        // Gestion du saut révisée avec physique réaliste
        if (keys["Space"] && !isJumping) {
            isJumping = true;
            jumpVelocityY = jumpInitialVelocity;
            if (mixer && runAction && idleAction && jumpAction) {
                runAction.stop();
                idleAction.stop();
                jumpAction.reset();
                jumpAction.setEffectiveTimeScale(3);
                jumpAction.play();
            }
        }

        if (isJumping) {
            // Mise à jour de la vitesse verticale avec la gravité réelle
            jumpVelocityY -= earthGravity * dt;
            player.position.y += jumpVelocityY * dt;
            // Si le joueur retombe au sol (position y <= 0)
            if (player.position.y <= 0) {
                player.position.y = 0;
                isJumping = false;
                jumpVelocityY = 0;
                if (mixer && jumpAction) {
                    jumpAction.stop();
                }
                if (keys["KeyA"] || keys["KeyD"] || keys["ArrowLeft"] || keys["ArrowRight"]) {
                    runAction.reset();
                    runAction.play();
                } else {
                    idleAction.reset();
                    idleAction.play();
                }
            }
        }
    }
    renderer.render(scene, camera);
}

// À placer vers la fin de votre fonction init() ou dès que le DOM est prêt
document.getElementById('enterSite').addEventListener('click', function() {
    const landingPage = document.getElementById('landingPage');
    landingPage.classList.add('hidden');
});


