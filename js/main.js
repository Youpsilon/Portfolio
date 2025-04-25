// Variables globales
let scene, camera, renderer;
let player; // Modèle chargé depuis Blender
const speed = 2;
const cameraOffset = new THREE.Vector3(10, 6, 50);
let isJumping = false;
let panels = [];
let overlayVisible = false;
const earthGravity = 22;
const desiredJumpHeight = 2.5;
const jumpInitialVelocity = Math.sqrt(2 * earthGravity * desiredJumpHeight);
let jumpVelocityY = 0;
let keys = {};
let cameraMode = "follow";
let cameraAnimating = false;
let cameraAnimationStartTime = 0;
const cameraAnimationDuration = 1000;
let cameraStartPos = new THREE.Vector3();
let cameraTargetPos = new THREE.Vector3();
let cameraStartZoom = 4;
let cameraTargetZoom = 4;
let newCameraMode = "follow";
let cameraStartLookAt = new THREE.Vector3();
let cameraTargetLookAt = new THREE.Vector3();
let jumpAction, jumpClip;
let lastFrameTime = performance.now();
let mixer, idleAction, runAction, runClip;
let startEdgeCenterLocal;
let composer;
let initialPinchDistance = null;
let initialCameraZoom;
let isTeleporting = false;
let teleportStartPos = new THREE.Vector3();
let teleportTargetPos = new THREE.Vector3();
let teleportProgress = 0;
const teleportDuration = 1.5; // Durée du déplacement
let teleportDelay = 0; // Temps écoulé pour le délai
const teleportDelayDuration = 0.1; // 200 ms de délai


const navigationDestinations = [
    { id: "about-me", label: "À propos de moi", offsetAlong: 10, offsetLateral: -3 },
    { id: "projects", label: "Projets", offsetAlong: 30, offsetLateral: -3 },
    { id: "contact", label: "Contacts", offsetAlong: 50, offsetLateral: -3 },
];

// Fonctions
function createNavigationPanel(destination) {
    const loaderPanel = new THREE.GLTFLoader();
    loaderPanel.load(
        'asset/models/panneau.glb',
        function (gltf) {
            const panel = gltf.scene;
            panel.scale.set(0.5, 0.5, 0.5);
            const roadDirection = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
            const lateralDirection = roadDirection.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
            panel.position.copy(startEdgeCenterLocal)
                .add(roadDirection.clone().multiplyScalar(destination.offsetAlong))
                .add(lateralDirection.clone().multiplyScalar(destination.offsetLateral));
            panel.rotation.y = 3 * Math.PI / 4;
            panel.userData.destination = destination;
            scene.add(panel);
            panels.push(panel);
            console.log(`Panneau ${destination.id} créé à la position :`, panel.position);

            const panelForward = new THREE.Vector3(0, 0, 1).applyQuaternion(panel.quaternion);
            const teleportOffset = -1;
            let teleportPos = panel.position.clone().add(panelForward.multiplyScalar(teleportOffset));
            const roadStart = startEdgeCenterLocal.clone();
            const vectorFromStart = teleportPos.clone().sub(roadStart);
            const projectionAlongRoad = vectorFromStart.dot(roadDirection);
            teleportPos = roadStart.clone().add(roadDirection.clone().multiplyScalar(projectionAlongRoad));
            teleportPos.y = 0;
            destination.teleportPos = teleportPos;
            destination.cameraPos = destination.teleportPos.clone().add(cameraOffset);
        },
        undefined,
        function(error) {
            console.error('Erreur de chargement du panneau pour la navigation :', error);
        }
    );
}

function createNavigationPanels() {
    navigationDestinations.forEach(dest => createNavigationPanel(dest));
}

function teleportTo(destination) {
    // Étape 1 : Disparition avec fumée
    const startSmoke = createSmokeEffect(player.position);
    player.visible = false;
    if (!window.activeSmokes) window.activeSmokes = [];
    window.activeSmokes.push(startSmoke);

    // Initialiser la téléportation avec délai
    isTeleporting = true;
    teleportStartPos.copy(player.position);
    teleportTargetPos.copy(destination.teleportPos);
    teleportProgress = 0;
    teleportDelay = 0; // Réinitialiser le délai
}

function onDocumentMouseDown(event) {
    // Ignorer les clics si un modal est ouvert
    if (overlayVisible) {
        return;
    }

    // Vérifier si le clic est sur un élément du menu
    const menu = document.getElementById('menu');
    const target = event.target;
    if (menu.contains(target)) {
        return; // Ne pas interférer avec les clics sur le menu
    }

    event.preventDefault(); // Bloquer pour les panneaux
    const mouse = new THREE.Vector2();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(panels, true);
    console.log('Intersections avec panels :', intersects);
    if (intersects.length > 0 && !cameraAnimating) {
        let clickedObject = intersects[0].object;
        let destination = null;
        let panelRoot = null;

        while (clickedObject && !destination) {
            destination = clickedObject.userData && clickedObject.userData.destination;
            if (destination) panelRoot = clickedObject;
            clickedObject = clickedObject.parent;
        }

        if (destination && cameraMode === "follow" && panelRoot) {
            cameraStartPos.copy(player.position).add(cameraOffset);
            cameraStartLookAt.copy(player.position);
            let panelForward = new THREE.Vector3(0, 0, -1).applyQuaternion(panelRoot.quaternion);
            const desiredDistance = 5;
            cameraTargetPos.copy(panelRoot.position).add(panelForward.multiplyScalar(desiredDistance));
            cameraTargetPos.y = 1;
            cameraTargetLookAt.copy(panelRoot.position);
            cameraTargetLookAt.y = 1;
            cameraStartZoom = camera.zoom;
            cameraTargetZoom = 3;
            cameraAnimationStartTime = performance.now();
            newCameraMode = "sign";
            cameraAnimating = true;
            showOverlay(`overlay-${destination.id}`);
        }
    }
}
document.addEventListener('mousedown', onDocumentMouseDown, false);

function showOverlay(overlayId) {
    document.querySelectorAll('.overlay').forEach(overlay => overlay.classList.add('hidden'));
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        overlay.classList.remove('hidden');
        overlayVisible = true;
        // Désactiver le raycasting pour les panneaux
        panels.forEach(panel => {
            panel.traverse(child => {
                child.raycastEnabled = false; // Désactiver temporairement
            });
        });
        // Désactiver les contrôles clavier pour le joueur
        keys = {}; // Réinitialiser les touches
    }
}

function getPinchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function init() {
    const rootStyles = getComputedStyle(document.documentElement);
    const bgColor = rootStyles.getPropertyValue('--bg-color').trim();
    scene = new THREE.Scene();

    document.querySelectorAll('.closeOverlay').forEach(button => button.addEventListener('click', exitFocusMode));

    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 500);
    camera.position.set(0, 20, 20);
    camera.lookAt(new THREE.Vector3(0, 0, 0));
    camera.zoom = 4;
    camera.updateProjectionMatrix();
    initialCameraZoom = camera.zoom;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(bgColor);
    document.body.appendChild(renderer.domElement);

    composer = new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene, camera));

    // Listener pour le bouton du menu déroulant
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', (event) => {
            event.stopPropagation(); // Empêche le clic de descendre jusqu’à onDocumentMouseDown
            const menuContent = document.querySelector('.menu-content');
            menuContent.classList.toggle('open');
        });
    }

    // Listener pour les items du menu
    document.querySelectorAll('#menu li').forEach(item => {
        item.addEventListener('click', (event) => {
            event.stopPropagation(); // Empêche le clic de descendre
            const destinationId = item.getAttribute('data-destination');
            const destination = navigationDestinations.find(dest => dest.id === destinationId); // Utilise navigationDestinations
            if (destination) teleportTo(destination); // Correction ici : juste teleportTo
            document.querySelector('.menu-content')?.classList.remove('open'); // Ferme le menu après clic
        });
    });

    renderer.domElement.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            initialPinchDistance = getPinchDistance(e.touches);
            initialCameraZoom = camera.zoom;
        }
    }, { passive: false });

    renderer.domElement.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && initialPinchDistance !== null) {
            e.preventDefault();
            const currentDistance = getPinchDistance(e.touches);
            const scaleFactor = currentDistance / initialPinchDistance;
            camera.zoom = initialCameraZoom * scaleFactor;
            camera.zoom = Math.max(1, Math.min(10, camera.zoom));
            camera.updateProjectionMatrix();
        }
    }, { passive: false });

    renderer.domElement.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) initialPinchDistance = null;
    });


    const leftBtn = document.getElementById("left");
    if (leftBtn) {
        leftBtn.addEventListener("touchstart", (e) => { e.preventDefault(); keys["ArrowLeft"] = true; });
        leftBtn.addEventListener("touchend", (e) => { e.preventDefault(); keys["ArrowLeft"] = false; });
    }
    const rightBtn = document.getElementById("right");
    if (rightBtn) {
        rightBtn.addEventListener("touchstart", (e) => { e.preventDefault(); keys["ArrowRight"] = true; });
        rightBtn.addEventListener("touchend", (e) => { e.preventDefault(); keys["ArrowRight"] = false; });
    }
    const jumpBtn = document.getElementById("jump");
    if (jumpBtn) {
        jumpBtn.addEventListener("touchstart", (e) => { e.preventDefault(); if (!isJumping) keys["Space"] = true; });
        jumpBtn.addEventListener("touchend", (e) => { e.preventDefault(); keys["Space"] = false; });
    }
    let runEnabled = false;
    const runBtn = document.getElementById("run");
    if (runBtn) {
        runBtn.addEventListener("click", (e) => {
            e.preventDefault();
            runEnabled = !runEnabled;
            keys["ShiftLeft"] = runEnabled;
            runBtn.classList.toggle("active", runEnabled);
        });
    }

    const moonAmbient = new THREE.AmbientLight(0x666666, 1.5);
    scene.add(moonAmbient);
    const moonLight = new THREE.DirectionalLight(0x99aaff, 1.4);
    moonLight.position.set(-50, 60, -50);
    moonLight.castShadow = false;
    scene.add(moonLight);

    createNavigationPanels();

    // Initialiser raycastEnabled pour les panneaux
    panels.forEach(panel => {
        panel.traverse(child => {
            child.raycastEnabled = true; // Actif par défaut
        });
    });

    const roadLength = 200;
    const roadWidth = 5;
    const segmentsX = 20;
    const segmentsY = 1;
    const geometry = new THREE.PlaneGeometry(roadLength, roadWidth, segmentsX, segmentsY);
    geometry.translate(roadLength / 2, roadWidth / 2, 0);
    geometry.rotateX(-Math.PI / 2);
    geometry.rotateY(Math.PI / 4);
    const material = new THREE.MeshStandardMaterial({ color: 0x592C0C, side: THREE.DoubleSide });
    const road = new THREE.Mesh(geometry, material);
    road.receiveShadow = true;
    scene.add(road);

    startEdgeCenterLocal = new THREE.Vector3(0, roadWidth / 2, 0);
    startEdgeCenterLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    startEdgeCenterLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
    startEdgeCenterLocal.y = 0;

    const loader = new THREE.GLTFLoader();
    loader.load('asset/models/renard-fixe.glb', (gltf) => {
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
    }, undefined, (error) => console.error('Erreur de chargement du modèle :', error));

    const loaderRun = new THREE.GLTFLoader();
    loaderRun.load('asset/models/renard-run.glb', (gltf) => {
        if (gltf.animations && gltf.animations.length && mixer) {
            runClip = gltf.animations[0];
            runAction = mixer.clipAction(runClip);
            runAction.play();
            runAction.paused = true;
        }
    }, undefined, (error) => console.error('Erreur de chargement de l\'animation de course :', error));

    const loaderJump = new THREE.GLTFLoader();
    loaderJump.load('asset/models/renard-jump.glb', (gltf) => {
        if (gltf.animations && gltf.animations.length && mixer) {
            jumpClip = gltf.animations[0];
            jumpAction = mixer.clipAction(jumpClip);
            jumpAction.loop = THREE.LoopOnce;
            jumpAction.clampWhenFinished = true;
        }
    }, undefined, (error) => console.error('Erreur de chargement de l\'animation de saut :', error));

    for (let d = 10; d < roadLength; d += 30) {
        const lampPost = createLampPost(d);
        scene.add(lampPost);
    }

    const loaderTerrain = new THREE.GLTFLoader();
    loaderTerrain.load('asset/models/plan.glb', (gltf) => {
        const terrain = gltf.scene;
        terrain.rotation.y = Math.PI / 4;
        terrain.position.set(0, -0.01, 0);
        terrain.scale.set(30, 30, 30);
        scene.add(terrain);
    }, undefined, (error) => console.error('Erreur de chargement du terrain :', error));

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
            let radius = Math.random() * 0.8 + 0.4;
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
        const material = new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide });
        const skyCylinder = new THREE.Mesh(geometry, material);
        skyCylinder.position.y = height / 2 - 50;
        skyCylinder.rotation.y = Math.PI / 4;
        return skyCylinder;
    }
    const skyCylinderMesh = createSkyCylinder();
    scene.add(skyCylinderMesh);

    window.addEventListener("resize", onWindowResize, false);
    window.addEventListener("keydown", (e) => { keys[e.code] = true; }, false);
    window.addEventListener("keyup", (e) => { keys[e.code] = false; }, false);
    window.addEventListener("wheel", onMouseWheel, false);
    window.addEventListener("mousedown", onDocumentMouseDown, false);

    document.getElementById('enterSite').addEventListener('click', () => {
        document.getElementById('landingPage').classList.add('hidden');
    });

    document.querySelectorAll('.project-title').forEach(button => {
        button.addEventListener('click', () => {
            const projectItem = button.parentElement;
            const isOpen = projectItem.classList.contains('open');

            // Ferme tous les autres projets
            document.querySelectorAll('.project-item').forEach(item => {
                item.classList.remove('open');
            });

            // Ouvre ou ferme le projet cliqué
            if (!isOpen) {
                projectItem.classList.add('open');
            }
        });
    });

    document.getElementById('enterSite').addEventListener('click', () => {
        document.getElementById('landingPage').classList.add('hidden');
    });

    emailjs.init("ydlixLM12lzNIierY"); // Remplace "user_123456789" par ta Public Key

    // Gérer la soumission du formulaire
    document.getElementById('contact-form').addEventListener('submit', function(event) {
        event.preventDefault();

        const form = event.target;
        const formMessage = document.getElementById('form-message');

        // Désactiver le bouton pendant l'envoi
        const submitButton = form.querySelector('.submit-button');
        submitButton.disabled = true;
        submitButton.textContent = 'Envoi...';

        // Envoyer l'email via EmailJS
        emailjs.sendForm('service_y0730wn', 'template_zqd9gls', form)
            .then(() => {
                formMessage.textContent = 'Message envoyé avec succès !';
                formMessage.className = 'form-message success';
                form.reset();
            })
            .catch((error) => {
                formMessage.textContent = 'Erreur lors de l’envoi. Veuillez réessayer.';
                formMessage.className = 'form-message error';
                console.error('EmailJS error:', error);
            })
            .finally(() => {
                submitButton.disabled = false;
                submitButton.textContent = 'Envoyer';
            });
    });

    // Gestion du clic sur les images des projets
    document.querySelectorAll('.enigme-img, .project-img').forEach(img => {
        img.addEventListener('click', () => {
            const overlayImage = document.getElementById('overlay-image');
            const enlargedImage = document.getElementById('enlarged-image');
            enlargedImage.src = img.src;
            enlargedImage.alt = img.alt;
            overlayImage.classList.remove('hidden');
            overlayVisible = true;
            // Désactiver le raycasting pour les panneaux
            panels.forEach(panel => {
                panel.traverse(child => {
                    child.raycastEnabled = false;
                });
            });
        });
    });

    // Fermer le modal image
    const closeImageOverlay = () => {
        const overlayImage = document.getElementById('overlay-image');
        overlayImage.classList.add('hidden');
        // Vérifier si d'autres modals sont ouverts (projects, about-me, contact)
        const otherOverlaysOpen = Array.from(document.querySelectorAll('.overlay:not(#overlay-image)')).some(overlay => !overlay.classList.contains('hidden'));
        overlayVisible = otherOverlaysOpen;
        // Réactiver le raycasting si aucun modal n'est ouvert
        if (!overlayVisible) {
            panels.forEach(panel => {
                panel.traverse(child => {
                    child.raycastEnabled = true;
                });
            });
        }
    };

    document.querySelector('.close-image-overlay').addEventListener('click', closeImageOverlay);

    // Fermer le modal image au clic sur le fond
    document.getElementById('overlay-image').addEventListener('click', (event) => {
        if (event.target === document.getElementById('overlay-image')) {
            closeImageOverlay();
        }
    });

    // Fermer le modal image avec la touche Échap
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !document.getElementById('overlay-image').classList.contains('hidden')) {
            closeImageOverlay();
        }
    });

    // Remplacer le gestionnaire global .overlay pour exclure #overlay-image
    document.querySelectorAll('.overlay:not(#overlay-image)').forEach(overlay => {
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                exitFocusMode();
            }
        });
    });
}

function exitFocusMode() {
    document.querySelectorAll('.overlay').forEach(overlay => overlay.classList.add('hidden'));
    overlayVisible = false;
    // Réactiver le raycasting pour les panneaux
    panels.forEach(panel => {
        panel.traverse(child => {
            child.raycastEnabled = true; // Réactiver
        });
    });
    cameraStartPos.copy(camera.position);
    cameraStartZoom = camera.zoom;
    cameraStartLookAt.copy(cameraTargetLookAt);
    cameraTargetPos.copy(player.position).add(cameraOffset);
    cameraTargetZoom = 4;
    cameraTargetLookAt.copy(player.position).add(new THREE.Vector3(0, 2, 0));
    cameraAnimationStartTime = performance.now();
    newCameraMode = "follow";
    cameraAnimating = true;
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
    loader.load('asset/models/lampadaire.glb', (gltf) => {
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
    if (!overlayVisible) {
        camera.zoom += event.deltaY * -0.005;
        camera.zoom = Math.max(1, Math.min(10, camera.zoom));
        camera.updateProjectionMatrix();
    }
}

function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function createSmokeEffect(position) {
    const particleCount = 50;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const lifetimes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = position.x + (Math.random() - 0.5) * 2;
        positions[i * 3 + 1] = position.y + Math.random() * 2;
        positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 2;
        velocities[i * 3] = (Math.random() - 0.5) * 0.5;
        velocities[i * 3 + 1] = Math.random() * 1;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
        lifetimes[i] = Math.random() * 1 + 0.5;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));

    // Récupérer la couleur violette du CSS
    const rootStyles = getComputedStyle(document.documentElement);
    const purpleColor = rootStyles.getPropertyValue('--purple')?.trim() || '#BB86FC'; // Fallback si non défini

    const material = new THREE.PointsMaterial({
        color: purpleColor,
        size: 0.5,
        map: createCircleTexture(), // Texture ronde
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
    });

    const smoke = new THREE.Points(geometry, material);
    smoke.userData = { time: 0, maxLifetime: 1.5 };
    scene.add(smoke);
    return smoke;
}
function updateSmokeEffect(smoke, dt) {
    smoke.userData.time += dt;
    const positions = smoke.geometry.attributes.position.array;
    const velocities = smoke.geometry.attributes.velocity.array;
    const lifetimes = smoke.geometry.attributes.lifetime.array;

    for (let i = 0; i < lifetimes.length; i++) {
        if (lifetimes[i] > 0) {
            positions[i * 3] += velocities[i * 3] * dt;     // X
            positions[i * 3 + 1] += velocities[i * 3 + 1] * dt; // Y
            positions[i * 3 + 2] += velocities[i * 3 + 2] * dt; // Z
            lifetimes[i] -= dt;
            if (lifetimes[i] <= 0) {
                positions[i * 3 + 1] = -1000; // Cacher hors de vue
            }
        }
    }

    smoke.geometry.attributes.position.needsUpdate = true;
    smoke.geometry.attributes.lifetime.needsUpdate = true;

    // Supprimer la fumée quand elle est finie
    if (smoke.userData.time >= smoke.userData.maxLifetime) {
        scene.remove(smoke);
        smoke.geometry.dispose();
        smoke.material.dispose();
        return false; // Indique que l’effet est terminé
    }
    return true; // Effet en cours
}

function createCircleTexture() {
    const size = 32; // Taille de la texture
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; // Blanc, la couleur sera appliquée via le matériau
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    return new THREE.CanvasTexture(canvas);
}

function animate() {
    requestAnimationFrame(animate);
    let now = performance.now();
    let dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    if (mixer) mixer.update(dt);

    let moveSpeed = speed;
    if (keys["ShiftLeft"]) {
        moveSpeed = 4;
        if (mixer && runAction) runAction.setEffectiveTimeScale(2);
    } else {
        moveSpeed = speed;
        if (mixer && runAction) runAction.setEffectiveTimeScale(1);
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
            if (cameraMode === "follow" && player) {
                camera.position.copy(player.position).add(cameraOffset);
                camera.zoom = cameraTargetZoom;
                camera.lookAt(player.position.clone().add(new THREE.Vector3(0, 2, 0)));
                camera.updateProjectionMatrix();
            }
        } else {
            camera.position.lerpVectors(cameraStartPos, cameraTargetPos, t);
            camera.zoom = cameraStartZoom + t * (cameraTargetZoom - cameraStartZoom);
            camera.updateProjectionMatrix();
            let currentLookAt = new THREE.Vector3().lerpVectors(cameraStartLookAt, cameraTargetLookAt, t);
            camera.lookAt(currentLookAt);
        }
    } else if (cameraMode === "follow" && player) {
        camera.position.copy(player.position).add(cameraOffset);
        camera.lookAt(player.position.clone().add(new THREE.Vector3(0, 2, 0)));
    }

    // Gérer la téléportation
    if (isTeleporting) {
        // Gérer le délai initial
        teleportDelay += dt;
        if (teleportDelay < teleportDelayDuration) {
            // Attendre que le délai soit écoulé
        } else {
            // Commencer le déplacement après le délai
            teleportProgress += dt / teleportDuration;
            if (teleportProgress >= 1) {
                teleportProgress = 1;
                isTeleporting = false;
                player.position.copy(teleportTargetPos);
                player.visible = true;
                const endSmoke = createSmokeEffect(player.position);
                if (!window.activeSmokes) window.activeSmokes = [];
                window.activeSmokes.push(endSmoke);
            } else {
                // Easing quadratique : lent au début, rapide à la fin
                const easedProgress = teleportProgress * teleportProgress; // t²
                player.position.lerpVectors(teleportStartPos, teleportTargetPos, easedProgress);
            }
        }
    }

    if (window.activeSmokes) {
        window.activeSmokes = window.activeSmokes.filter(smoke => updateSmokeEffect(smoke, dt));
    }

    if (player && !isTeleporting) {
        const forward = new THREE.Vector3(Math.cos(Math.PI / 4), 0, -Math.sin(Math.PI / 4));
        if (keys["ArrowRight"] || keys["KeyD"]) {
            player.position.add(forward.clone().multiplyScalar(moveSpeed * dt));
            player.rotation.y = -Math.PI / 4;
        }
        if (keys["ArrowLeft"] || keys["KeyA"]) {
            player.position.add(forward.clone().multiplyScalar(-moveSpeed * dt));
            player.rotation.y = -Math.PI / 4 + Math.PI;
        }

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
            jumpVelocityY -= earthGravity * dt;
            player.position.y += jumpVelocityY * dt;
            if (player.position.y <= 0) {
                player.position.y = 0;
                isJumping = false;
                jumpVelocityY = 0;
                if (mixer && jumpAction) jumpAction.stop();
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

document.addEventListener('DOMContentLoaded', () => {
    init();
    animate();
});