// --- Telegram init (если игра запущена как Mini App) ---
if (window.Telegram && Telegram.WebApp) {
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();
    Telegram.WebApp.setHeaderColor("#020715");
    Telegram.WebApp.setBackgroundColor("#020715");
}

// ───────── ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ─────────
let canvas;
let engine;
let scene;
let player;

let obstacles = [];
let mandarins = [];
let trees = []; // лес

// настройки "кольца" леса
const FOREST_ROWS = 32;          // больше рядов
const FOREST_SPACING_Z = 6;      // ряды ближе друг к другу
const FOREST_LENGTH = FOREST_ROWS * FOREST_SPACING_Z; // 32 * 6 = 192

let speed = 12;         // юнитов в секунду
let distance = 0;
let score = 0;
let gameOver = false;
const laneX = [-3, 0, 3];  // три "полосы" дороги

// UI ссылки
let scoreLabel;
let distLabel;
let bestLabel;
let gameOverPanel;
let finalScore;
let restartBtn;

// ---- ЗВУКИ (HTML5 Audio) ----
let sfxEngine = null;
let sfxForest = null;
let sfxPickup = null;
let sfxCrash = null;
let audioUnlocked = false; // для мобильных браузеров

// ---- ЛОКАЛЬНЫЕ РЕКОРДЫ ----
const BEST_RUN_KEY = "capybara_best_run";

function loadBestRun() {
    try {
        const raw = localStorage.getItem(BEST_RUN_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        console.warn("Не удалось прочитать рекорд:", e);
        return null;
    }
}

function updateBestRunLabel(best) {
    if (!bestLabel || !best) return;
    bestLabel.textContent =
        "Рекорд: " + best.score + " / " + best.distance + " м";
}

/**
 * Сохраняет рекорд, если он лучше предыдущего.
 * Возвращает true, если это новый рекорд.
 */
function saveBestRun(score, distance) {
    const current = {
        score: score,
        distance: Math.round(distance)
    };

    let isNewRecord = false;

    try {
        const raw = localStorage.getItem(BEST_RUN_KEY);
        let best = raw ? JSON.parse(raw) : null;

        if (!best) {
            best = current;
            isNewRecord = true;
        } else {
            if (
                current.score > best.score ||
                (current.score === best.score && current.distance > best.distance)
            ) {
                best = current;
                isNewRecord = true;
            }
        }

        localStorage.setItem(BEST_RUN_KEY, JSON.stringify(best));
        updateBestRunLabel(best);
    } catch (e) {
        console.warn("Не удалось сохранить рекорд:", e);
    }

    return isNewRecord;
}

// ---- ИНИЦИАЛИЗАЦИЯ ЗВУКОВ (HTML5 Audio) ----
function initSounds() {
    const base = "assets/sounds/";

    // Двигатель
    sfxEngine = new Audio(base + "kart.mp3");
    sfxEngine.loop = true;
    sfxEngine.volume = 0.45;

    // Лес
    sfxForest = new Audio(base + "pixel.mp3");
    sfxForest.loop = true;
    sfxForest.volume = 0.2;

    // Сбор мандарина
    sfxPickup = new Audio(base + "mandarin_pickup.mp3");
    sfxPickup.loop = false;
    sfxPickup.volume = 0.9;

    // Удар металла о дерево
    sfxCrash = new Audio(base + "boom.mp3");
    sfxCrash.loop = false;
    sfxCrash.volume = 1.0;
}

// Разрешить звук после первого взаимодействия пользователя
function unlockAudioIfNeeded() {
    if (audioUnlocked) return;
    console.log("unlockAudioIfNeeded — trying to unlock");

    audioUnlocked = true;

    if (sfxForest) {
        sfxForest.play().catch(err => console.warn("forest play error:", err));
    }
    if (sfxEngine && !gameOver) {
        sfxEngine.play().catch(err => console.warn("engine play error:", err));
    }
}

// ---- СЦЕНА ----
function createScene() {
    scene = new BABYLON.Scene(engine);

    // Цвета неба
    const SKY_TOP = BABYLON.Color3.FromHexString("#8AC6FF");   // светлый голубой
    const SKY_BOTTOM = BABYLON.Color3.FromHexString("#64A8F2"); // тёмный голубой

    // Базовый цвет фона (если skybox не отрисуется)
    scene.clearColor = new BABYLON.Color4(
        SKY_BOTTOM.r,
        SKY_BOTTOM.g,
        SKY_BOTTOM.b,
        1.0
    );

    // Туман под цвет нижней части неба
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.014;
    scene.fogColor = SKY_BOTTOM;

    // ───── Небо ─────
    const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: 1000 }, scene);
    let skyMat;

    if (BABYLON.GradientMaterial) {
        skyMat = new BABYLON.GradientMaterial("skyMat", scene);
        skyMat.topColor = SKY_TOP;
        skyMat.bottomColor = SKY_BOTTOM;
        skyMat.offset = 0.5;
        skyMat.smoothness = 1.0;
    } else {
        skyMat = new BABYLON.StandardMaterial("skyMat", scene);
        skyMat.diffuseColor = SKY_BOTTOM;
        skyMat.emissiveColor = SKY_BOTTOM;
    }

    skyMat.backFaceCulling = false;
    skybox.material = skyMat;
    skybox.infiniteDistance = true;

    // ───── Камера ─────
    const camera = new BABYLON.FreeCamera("camera", new BABYLON.Vector3(0, 6, -12), scene);
    camera.setTarget(new BABYLON.Vector3(0, 1, 10));

    // ───── Свет ─────
    const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
    light.intensity = 0.9;

    // --- ЗВУКИ ---
    initSounds();

    // ───── Трава (земля по бокам от дороги) ─────
    const ground = BABYLON.MeshBuilder.CreateGround("ground", {
        width: 30,       // шире дороги
        height: 200
    }, scene);
    ground.position.z = 80;
    const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
    groundMat.diffuseColor = BABYLON.Color3.FromHexString("#7AC64A"); // трава
    groundMat.specularColor = new BABYLON.Color3(0, 0, 0);
    ground.material = groundMat;

    // ───── Дорога поверх травы ─────
    const road = BABYLON.MeshBuilder.CreateGround("road", {
        width: 10,
        height: 200
    }, scene);
    road.position.z = 80;
    road.position.y = 0.01; // чуть выше, чтобы не мерцало
    const roadMat = new BABYLON.StandardMaterial("roadMat", scene);
    roadMat.diffuseColor = BABYLON.Color3.FromHexString("#3F464B"); // асфальт
    roadMat.specularColor = new BABYLON.Color3(0, 0, 0);
    road.material = roadMat;

    // ───── Разметка на дороге ─────
    for (let i = 0; i < 20; i++) {
        const line = BABYLON.MeshBuilder.CreateBox("line" + i, {
            width: 0.25,
            height: 0.02,
            depth: 2.5
        }, scene);
        line.position.y = 0.02;
        line.position.z = i * 10;
        line.position.x = 0;

        const lm = new BABYLON.StandardMaterial("lineMat" + i, scene);
        lm.emissiveColor = BABYLON.Color3.FromHexString("#F8F2DC");
        lm.specularColor = new BABYLON.Color3(0, 0, 0);
        line.material = lm;
    }

    // ───── Деревья (billboard-плоскости с PNG ёлкой) ─────
    const treeTex = new BABYLON.Texture("assets/tree.png", scene);
    const treeMat = new BABYLON.StandardMaterial("treeMat", scene);
    treeMat.diffuseTexture = treeTex;
    treeMat.diffuseTexture.hasAlpha = true;
    treeMat.backFaceCulling = false;
    treeMat.specularColor = new BABYLON.Color3(0, 0, 0);

    // ───── Мандарин (спрайт) ─────
    const mandarinTex = new BABYLON.Texture("assets/orange.png", scene);
    const mandarinMat = new BABYLON.StandardMaterial("mandarinMat", scene);
    mandarinMat.diffuseTexture = mandarinTex;
    mandarinMat.diffuseTexture.hasAlpha = true;
    mandarinMat.backFaceCulling = false;
    mandarinMat.specularColor = new BABYLON.Color3(0, 0, 0);
    mandarinMat.emissiveColor = new BABYLON.Color3(1, 1, 1);

    scene.mandarinMaterial = mandarinMat;

    // ───── Препятствия (спрайты) ─────
    const obsNames = ["cone", "log", "rock", "stump"];
    scene.obstacleMaterials = [];

    obsNames.forEach(name => {
        const tex = new BABYLON.Texture("assets/" + name + ".png", scene);
        const mat = new BABYLON.StandardMaterial("obsMat_" + name, scene);
        mat.diffuseTexture = tex;
        mat.diffuseTexture.hasAlpha = true;
        mat.backFaceCulling = false;
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
        scene.obstacleMaterials.push(mat);
    });

    // Лес
    createForest(scene, treeMat);

    // ───── Капибара (уменьшенная) ─────
    const capyTex = new BABYLON.Texture("assets/capybara.png", scene);

    const capyMat = new BABYLON.StandardMaterial("capyMat", scene);
    capyMat.diffuseTexture = capyTex;
    capyMat.diffuseTexture.hasAlpha = true;
    capyMat.backFaceCulling = false;
    capyMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    capyMat.specularColor = new BABYLON.Color3(0, 0, 0);

    player = BABYLON.MeshBuilder.CreatePlane("capybara", {
        width: 2.6,
        height: 3.0
    }, scene);
    player.position = new BABYLON.Vector3(0, 1.2, 0);
    player.material = capyMat;
    player.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;

    // Управление и гейм-луп
    setupInput(scene, camera);
    resetGameVariables();
    setupGameLoop(scene);

    return scene;
}

// ───────── ЛЕС: паттерны деревьев + плотное заполнение ─────────
function createForest(scene, treeMat) {
    trees = [];

    const roadWidth = 10;
    const baseOffset = roadWidth / 2 + 2; // отступ от края дороги

    const patterns = [
        [{ dx: 0.5, scale: 1.0 }, { dx: 2.0, scale: 0.9 }, { dx: 3.2, scale: 1.1 }],
        [{ dx: 0.8, scale: 1.1 }, { dx: 2.8, scale: 0.95 }],
        [{ dx: 0.3, scale: 0.9 }, { dx: 1.6, scale: 1.2 }, { dx: 2.9, scale: 1.0 }, { dx: 3.5, scale: 0.85 }],
        [{ dx: 1.2, scale: 1.0 }, { dx: 2.4, scale: 1.05 }]
    ];

    for (let side of [-1, 1]) {
        for (let row = 0; row < FOREST_ROWS; row++) {
            const zBase = row * FOREST_SPACING_Z - 20;

            const pattern = patterns[Math.floor(Math.random() * patterns.length)];

            for (const def of pattern) {
                const jitterX = Math.random() * 0.7;
                const jitterZ = Math.random() * 3.0;

                const z = zBase + jitterZ;
                const x = side * (baseOffset + def.dx + jitterX);

                const tree = BABYLON.MeshBuilder.CreatePlane("tree", {
                    width: 4,
                    height: 6
                }, scene);

                tree.position.set(x, 3, z);
                tree.material = treeMat;
                tree.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;

                const baseScale = def.scale * (0.85 + Math.random() * 0.4);
                tree.metadata = tree.metadata || {};
                tree.metadata.baseScale = baseScale;

                tree.scaling.x = baseScale;
                tree.scaling.y = baseScale;
                tree.scaling.z = 1;

                trees.push(tree);
            }
        }
    }
}

function moveTrees(dz) {
    const nearZ = 5;
    const farZ = 120;

    for (const t of trees) {
        t.position.z -= dz;

        if (t.position.z < -20) {
            t.position.z += FOREST_LENGTH;
        }

        const base = (t.metadata && t.metadata.baseScale) ? t.metadata.baseScale : 1.0;
        const z = t.position.z;

        let scaleK;
        if (z <= nearZ) {
            scaleK = 1.4;
        } else if (z >= farZ) {
            scaleK = 0.4;
        } else {
            const norm = (farZ - z) / (farZ - nearZ);
            scaleK = 0.4 + norm * 1.0;
        }

        const s = base * scaleK;
        t.scaling.x = s;
        t.scaling.y = s;
        t.scaling.z = 1;
    }
}

// --- Управление: клавиатура + тач ---
function setupInput(scene, camera) {
    let targetLaneIndex = 1;

    function moveToLane(index) {
        index = Math.max(0, Math.min(laneX.length - 1, index));
        targetLaneIndex = index;
        unlockAudioIfNeeded(); // любое действие разблокирует звук
    }

    scene.onKeyboardObservable.add((kbInfo) => {
        if (gameOver) return;
        if (kbInfo.type === BABYLON.KeyboardEventTypes.KEYDOWN) {
            if (kbInfo.event.key === "ArrowLeft" || kbInfo.event.key === "a" || kbInfo.event.key === "A") {
                moveToLane(targetLaneIndex - 1);
            }
            if (kbInfo.event.key === "ArrowRight" || kbInfo.event.key === "d" || kbInfo.event.key === "D") {
                moveToLane(targetLaneIndex + 1);
            }
        }
    });

    let pointerDown = false;
    let pointerX = 0;

    scene.onPointerObservable.add((pointerInfo) => {
        switch (pointerInfo.type) {
            case BABYLON.PointerEventTypes.POINTERDOWN:
                pointerDown = true;
                pointerX = pointerInfo.event.clientX;
                unlockAudioIfNeeded();
                break;
            case BABYLON.PointerEventTypes.POINTERUP:
                pointerDown = false;
                break;
            case BABYLON.PointerEventTypes.POINTERMOVE:
                if (!pointerDown || gameOver) break;
                const x = pointerInfo.event.clientX;
                const delta = x - pointerX;
                if (Math.abs(delta) > 30) {
                    if (delta < 0) moveToLane(targetLaneIndex - 1);
                    else moveToLane(targetLaneIndex + 1);
                    pointerX = x;
                }
                break;
        }
    });

    scene.onBeforeRenderObservable.add(() => {
        if (!player || gameOver) return;
        const dt = engine.getDeltaTime() / 1000;
        const targetX = laneX[targetLaneIndex];
        const dx = targetX - player.position.x;
        const laneMoveSpeed = 8;

        // Fix: clamp movement to avoid overshooting and oscillation
        const moveStep = laneMoveSpeed * dt;

        if (Math.abs(dx) <= moveStep) {
            player.position.x = targetX;
        } else {
            player.position.x += Math.sign(dx) * moveStep;
        }

        camera.position.x = BABYLON.Scalar.Lerp(camera.position.x, player.position.x, 0.1);
        camera.setTarget(new BABYLON.Vector3(camera.position.x, 1, 10));
    });
}

function resetGameVariables() {
    obstacles.forEach(o => o.dispose());
    mandarins.forEach(m => m.dispose());
    obstacles = [];
    mandarins = [];
    speed = 12;
    distance = 0;
    score = 0;
    gameOver = false;
    if (player) {
        player.position.x = 0;
        player.position.z = 0;
    }
    scoreLabel.textContent = "Мандарины: 0";
    distLabel.textContent = "Дистанция: 0 м";
    gameOverPanel.style.display = "none";

    const best = loadBestRun();
    if (best) {
        updateBestRunLabel(best);
    }

    // перезапускаем лупы, если звук уже разблокирован
    if (audioUnlocked) {
        if (sfxForest && sfxForest.paused) sfxForest.play().catch(() => { });
        if (sfxEngine && sfxEngine.paused) sfxEngine.play().catch(() => { });
    }
}

function setupGameLoop(scene) {
    let obstacleTimer = 0;
    let mandarinTimer = 0;

    scene.onBeforeRenderObservable.add(() => {
        if (gameOver || !player) return;

        const dt = engine.getDeltaTime() / 1000;

        const dz = speed * dt;
        distance += dz;
        distLabel.textContent = "Дистанция: " + distance.toFixed(0) + " м";

        speed += 0.3 * dt;

        moveTrees(dz);
        moveAndCleanupObjects(obstacles, dz);
        moveAndCleanupObjects(mandarins, dz);

        obstacleTimer += dt;
        mandarinTimer += dt;

        if (obstacleTimer > 1.2) {
            spawnObstacle(scene, player.position.z + 60);
            obstacleTimer = 0;
        }
        if (mandarinTimer > 0.8) {
            spawnMandarin(scene, player.position.z + 60);
            mandarinTimer = 0;
        }

        checkCollisions();
    });
}

function moveAndCleanupObjects(arr, dz) {
    for (let i = arr.length - 1; i >= 0; i--) {
        const obj = arr[i];
        obj.position.z -= dz;
        if (obj.position.z < -15) {
            obj.dispose();
            arr.splice(i, 1);
        }
    }
}

function spawnObstacle(scene, z) {
    const lane = laneX[Math.floor(Math.random() * laneX.length)];

    if (!scene.obstacleMaterials || scene.obstacleMaterials.length === 0) return;
    const mat = scene.obstacleMaterials[Math.floor(Math.random() * scene.obstacleMaterials.length)];

    const obs = BABYLON.MeshBuilder.CreatePlane("obstacle", { width: 2.4, height: 2.4 }, scene);
    obs.position.set(lane, 1.2, z);

    obs.material = mat;

    if (mat.name === "obsMat_log") {
        obs.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
        obs.rotation.y = 0;
    } else {
        obs.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
    }

    const scale = 0.9 + Math.random() * 0.4;
    obs.scaling.setAll(scale);

    obstacles.push(obs);
}

function spawnMandarin(scene, z) {
    const lane = laneX[Math.floor(Math.random() * laneX.length)];
    const s = BABYLON.MeshBuilder.CreatePlane("mandarin", { width: 1.0, height: 1.0 }, scene);
    s.position.set(lane, 0.8, z);

    if (scene.mandarinMaterial) {
        s.material = scene.mandarinMaterial;
    }

    s.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
    mandarins.push(s);
}

function checkCollisions() {
    if (!player) return;

    // препятствия
    for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        const dx = o.position.x - player.position.x;
        const dz = o.position.z - player.position.z;
        if (Math.abs(dx) < 0.96 && Math.abs(dz) < 1.2) {
            onGameOver();
            return;
        }
    }

    // мандарины
    for (let i = mandarins.length - 1; i >= 0; i--) {
        const m = mandarins[i];
        const dx = m.position.x - player.position.x;
        const dz = m.position.z - player.position.z;
        if (Math.abs(dx) < 0.8 && Math.abs(dz) < 1.2) {
            score++;
            scoreLabel.textContent = "Мандарины: " + score;

            if (sfxPickup) {
                sfxPickup.currentTime = 0;
                sfxPickup.play().catch(() => { });
            }

            m.dispose();
            mandarins.splice(i, 1);
        }
    }
}

function onGameOver() {
    gameOver = true;

    // Останавливаем двигатель, но оставляем лес
    if (sfxEngine && !sfxEngine.paused) {
        sfxEngine.pause();
        sfxEngine.currentTime = 0;
    }

    if (sfxCrash) {
        sfxCrash.currentTime = 0;
        sfxCrash.play().catch(() => { });
    }

    const isRecord = saveBestRun(score, distance);

    let text =
        "Мандарины: " + score +
        " | Дистанция: " + distance.toFixed(0) + " м";

    if (isRecord) {
        text += "\nНовый рекорд! 🏆";
    }

    finalScore.textContent = text;
    gameOverPanel.style.display = "flex";
}

// ---- PRELOADING ASSETS ----
async function preloadAssets(scene) {
    const assets = [
        "assets/capybara.png",
        "assets/cone.png",
        "assets/log.png",
        "assets/orange.png",
        "assets/rock.png",
        "assets/stump.png",
        "assets/tree.png"
    ];

    const soundAssets = [
        { type: 'engine', file: 'assets/sounds/kart.mp3' },
        { type: 'forest', file: 'assets/sounds/pixel.mp3' },
        { type: 'pickup', file: 'assets/sounds/mandarin_pickup.mp3' },
        { type: 'crash', file: 'assets/sounds/boom.mp3' }
    ];

    const promises = [];

    // Preload textures
    assets.forEach(url => {
        promises.push(new Promise((resolve, reject) => {
            const img = new Image();
            img.src = url;
            img.onload = resolve;
            img.onerror = () => {
                console.warn("Failed to load texture:", url);
                resolve(); // Continue anyway to avoid blocking
            };
        }));
    });

    // Initialize sounds earlier but wait for canplaythrough
    // Note: Audio API doesn't always fire canplaythrough on mobile without interaction,
    // so we'll just init them and use a short timeout/promise wrapper for "enough" loading.

    // Переносим инициализацию звуков сюда, чтобы загрузить их
    const base = "assets/sounds/";

    // Helpers
    const loadAudio = (url, loop, vol) => {
        return new Promise((resolve) => {
            const audio = new Audio(url);
            audio.loop = loop;
            audio.volume = vol;
            // Просто ждем, когда браузер скажет что метаданные есть или можно играть
            // Если слишком долго — таймаут
            const onLoaded = () => {
                resolve(audio);
                audio.removeEventListener('canplaythrough', onLoaded);
            };
            audio.addEventListener('canplaythrough', onLoaded);
            audio.load(); // Force load

            // Fallback timeout 2s
            setTimeout(() => resolve(audio), 2000);
        });
    };

    // Загружаем звуки параллельно
    const pEngine = loadAudio(base + "kart.mp3", true, 0.45).then(a => sfxEngine = a);
    const pForest = loadAudio(base + "pixel.mp3", true, 0.2).then(a => sfxForest = a);
    const pPickup = loadAudio(base + "mandarin_pickup.mp3", false, 0.9).then(a => sfxPickup = a);
    const pCrash = loadAudio(base + "boom.mp3", false, 1.0).then(a => sfxCrash = a);

    promises.push(pEngine, pForest, pPickup, pCrash);

    // Wait all
    await Promise.all(promises);
}

// ---- ИНИЦИАЛИЗАЦИЯ ПОСЛЕ ЗАГРУЗКИ DOM ----
window.addEventListener("DOMContentLoaded", async () => {
    if (!window.BABYLON) {
        console.error("BABYLON не найден. Проверь подключение babylon.js до game.js");
        return;
    }

    const loadingScreen = document.getElementById("loadingScreen");
    const loadingText = document.getElementById("loadingText");

    canvas = document.getElementById("renderCanvas");
    if (!canvas) {
        console.error("Не найден canvas с id='renderCanvas'");
        return;
    }

    scoreLabel = document.getElementById("scoreLabel");
    distLabel = document.getElementById("distLabel");
    bestLabel = document.getElementById("bestLabel");
    gameOverPanel = document.getElementById("gameOverPanel");
    finalScore = document.getElementById("finalScore");
    restartBtn = document.getElementById("restartBtn");

    engine = new BABYLON.Engine(canvas, true);

    // Загружаем ресурсы
    if (loadingText) loadingText.textContent = "Загрузка ресурсов...";

    // Создаем пустую сцену временно или пока не нужно
    // Но нам нужен scene для текстур? Нет, Image() мы грузим отдельно.
    // А вот BABYLON.Texture требует сцену.
    // Но мы пока просто предзагрузили Image в кэш браузера.

    await preloadAssets();

    // Скрываем лоадер
    if (loadingScreen) {
        loadingScreen.style.opacity = "0";
        setTimeout(() => {
            loadingScreen.style.display = "none";
        }, 500);
    }

    const sceneInstance = createScene();

    // Инициализируем звуки (глобальные переменные уже заполнены в preloadAssets)
    // initSounds(); -> больше не нужна, так как мы создали объекты аудио в preloadAssets

    const initialBest = loadBestRun();
    if (initialBest) {
        updateBestRunLabel(initialBest);
    }

    restartBtn.addEventListener("click", () => {
        resetGameVariables();
    });

    engine.runRenderLoop(function () {
        sceneInstance.render();
    });

    window.addEventListener("resize", function () {
        engine.resize();
    });
});
