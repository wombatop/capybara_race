// --- Telegram init (если игра запущена как Mini App) ---
if (window.Telegram && Telegram.WebApp) {
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();
    Telegram.WebApp.setHeaderColor("#020715");
    Telegram.WebApp.setBackgroundColor("#020715");
}

// Глобальные переменные (инициализируем позже, после загрузки DOM)
let canvas;
let engine;
let scene;
let player;

let obstacles = [];
let mandarins = [];
let trees = []; // лес

// настройки "кольца" леса
const FOREST_LENGTH = 240;      // длина по Z
const FOREST_ROWS = 24;         // сколько "рядов" леса
const FOREST_SPACING_Z = 8;     // расстояние между рядами

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
            const zBase = row * FOREST_SPACING_Z + 12;

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
        if (Math.abs(dx) < 0.01) {
            player.position.x = targetX;
        } else {
            player.position.x += Math.sign(dx) * laneMoveSpeed * dt;
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
    const box = BABYLON.MeshBuilder.CreateBox("obstacle", {
        width: 1,
        height: 1.2,
        depth: 1
    }, scene);
    box.position.set(lane, 0.6, z);
    const mat = new BABYLON.StandardMaterial("obstacleMat", scene);
    mat.diffuseColor = new BABYLON.Color3(0.8, 0.2, 0.2);
    box.material = mat;
    obstacles.push(box);
}

function spawnMandarin(scene, z) {
    const lane = laneX[Math.floor(Math.random() * laneX.length)];
    const s = BABYLON.MeshBuilder.CreateSphere("mandarin", { diameter: 0.7 }, scene);
    s.position.set(lane, 0.5, z);
    const mat = new BABYLON.StandardMaterial("mandarinMat", scene);
    mat.diffuseColor = new BABYLON.Color3(1, 0.5, 0);
    mat.emissiveColor = new BABYLON.Color3(0.8, 0.4, 0);
    s.material = mat;
    mandarins.push(s);
}

function checkCollisions() {
    if (!player) return;

    for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        const dx = o.position.x - player.position.x;
        const dz = o.position.z - player.position.z;
        if (Math.abs(dx) < 0.8 && Math.abs(dz) < 1.2) {
            onGameOver();
            return;
        }
    }

    for (let i = mandarins.length - 1; i >= 0; i--) {
        const m = mandarins[i];
        const dx = m.position.x - player.position.x;
        const dz = m.position.z - player.position.z;
        if (Math.abs(dx) < 0.8 && Math.abs(dz) < 1.2) {
            score++;
            scoreLabel.textContent = "Мандарины: " + score;
            m.dispose();
            mandarins.splice(i, 1);
        }
    }
}

function onGameOver() {
    gameOver = true;

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

// ---- ИНИЦИАЛИЗАЦИЯ ПОСЛЕ ЗАГРУЗКИ DOM ----
window.addEventListener("DOMContentLoaded", () => {
    if (!window.BABYLON) {
        console.error("BABYLON не найден. Проверь подключение babylon.js до game.js");
        return;
    }

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

    const sceneInstance = createScene();

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
