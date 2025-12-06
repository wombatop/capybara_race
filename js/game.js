// --- Telegram init (если игра запущена как Mini App) ---
if (window.Telegram && Telegram.WebApp) {
    Telegram.WebApp.ready();
    Telegram.WebApp.setHeaderColor("#020715");
    Telegram.WebApp.setBackgroundColor("#020715");
}

const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true);

const scoreLabel = document.getElementById("scoreLabel");
const distLabel = document.getElementById("distLabel");
const gameOverPanel = document.getElementById("gameOverPanel");
const finalScore = document.getElementById("finalScore");
const restartBtn = document.getElementById("restartBtn");

let scene;
let player;
let obstacles = [];
let mandarins = [];
let trees = [];                 // лес

// настройки "кольца" леса
const FOREST_LENGTH = 240;      // длина по Z
const FOREST_ROWS = 24;         // сколько "рядов" леса
const FOREST_SPACING_Z = 8;     // расстояние между рядами

let speed = 12;         // юнитов в секунду
let distance = 0;
let score = 0;
let gameOver = false;
const laneX = [-3, 0, 3];  // три "полосы" дороги

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
    // Трава: #7AC64A
    groundMat.diffuseColor = BABYLON.Color3.FromHexString("#7AC64A");
    groundMat.specularColor = new BABYLON.Color3(0, 0, 0);
    ground.material = groundMat;

    // ───── Дорога поверх травы ─────
    const road = BABYLON.MeshBuilder.CreateGround("road", {
        width: 10,       // сама дорога уже травы
        height: 200
    }, scene);
    road.position.z = 80;
    road.position.y = 0.01; // чуть выше, чтобы не мерцало
    const roadMat = new BABYLON.StandardMaterial("roadMat", scene);
    // Дорога: #3F464B
    roadMat.diffuseColor = BABYLON.Color3.FromHexString("#3F464B");
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
        line.position.x = 0; // по центру дороги

        const lm = new BABYLON.StandardMaterial("lineMat" + i, scene);
        // Разметка: светло-бежевый #F8F2DC
        lm.emissiveColor = BABYLON.Color3.FromHexString("#F8F2DC");
        lm.specularColor = new BABYLON.Color3(0, 0, 0);
        line.material = lm;
    }

    // ───── Деревья (billboard-плоскости с PNG ёлкой) ─────
    // Положи картинку дерева без фона в assets/tree.png
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

    // было 4.0 x 4.68 → сделаем меньше
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

    // Паттерны — несколько вариантов размещения деревьев в "ряду"
    // dx — дополнительный сдвиг от baseOffset, scale — базовый масштаб
    const patterns = [
        [{ dx: 0.5, scale: 1.0 }, { dx: 2.0, scale: 0.9 }, { dx: 3.2, scale: 1.1 }],
        [{ dx: 0.8, scale: 1.1 }, { dx: 2.8, scale: 0.95 }],
        [{ dx: 0.3, scale: 0.9 }, { dx: 1.6, scale: 1.2 }, { dx: 2.9, scale: 1.0 }, { dx: 3.5, scale: 0.85 }],
        [{ dx: 1.2, scale: 1.0 }, { dx: 2.4, scale: 1.05 }]
    ];

    for (let side of [-1, 1]) { // -1 = слева, 1 = справа
        for (let row = 0; row < FOREST_ROWS; row++) {
            const zBase = row * FOREST_SPACING_Z + 12;

            // выбираем случайный паттерн на этот ряд
            const pattern = patterns[Math.floor(Math.random() * patterns.length)];

            for (const def of pattern) {
                const jitterX = Math.random() * 0.7;     // небольшой разброс по ширине
                const jitterZ = Math.random() * 3.0;     // небольшой разброс по глубине

                const z = zBase + jitterZ;
                const x = side * (baseOffset + def.dx + jitterX);

                const tree = BABYLON.MeshBuilder.CreatePlane("tree", {
                    width: 4,
                    height: 6
                }, scene);

                tree.position.set(x, 3, z);
                tree.material = treeMat;
                tree.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;

                // базовый масштаб конкретного дерева (чуть рандома)
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

// деревья "едут" и масштабируются (далеко — маленькие, близко — крупные)
function moveTrees(dz) {
    const nearZ = 5;    // ближняя зона к камере
    const farZ = 120;   // дальняя зона (там деревья почти крошечные)

    for (const t of trees) {
        t.position.z -= dz;          // лес едет к игроку

        if (t.position.z < -20) {    // уехало за камеру
            t.position.z += FOREST_LENGTH; // перекидываем вперёд
        }

        // динамический масштаб по Z
        const base = (t.metadata && t.metadata.baseScale) ? t.metadata.baseScale : 1.0;
        const z = t.position.z;

        let scaleK;
        if (z <= nearZ) {
            scaleK = 1.4; // прям у камеры — крупнее
        } else if (z >= farZ) {
            scaleK = 0.4; // очень далеко — маленькие
        } else {
            const norm = (farZ - z) / (farZ - nearZ); // 1 у nearZ, 0 у farZ
            scaleK = 0.4 + norm * 1.0; // от 0.4 до 1.4
        }

        const s = base * scaleK;
        t.scaling.x = s;
        t.scaling.y = s;
        t.scaling.z = 1;
    }
}

// --- Управление: клавиатура + тач (левая/правая половина экрана) ---
function setupInput(scene, camera) {
    let targetLaneIndex = 1; // 0,1,2 — по laneX
    let isMovingLane = false;

    function moveToLane(index) {
        index = Math.max(0, Math.min(laneX.length - 1, index));
        targetLaneIndex = index;
        isMovingLane = true;
    }

    // Клавиатура
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

    // Тач / мышь
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
                if (Math.abs(delta) > 30) { // свайп
                    if (delta < 0) {
                        moveToLane(targetLaneIndex - 1);
                    } else {
                        moveToLane(targetLaneIndex + 1);
                    }
                    pointerX = x;
                }
                break;
        }
    });

    // Плавное смещение к полосе
    scene.onBeforeRenderObservable.add(() => {
        if (!player || gameOver) return;
        const dt = engine.getDeltaTime() / 1000;
        const targetX = laneX[targetLaneIndex];
        const dx = targetX - player.position.x;
        const laneMoveSpeed = 8; // скорость смены полосы
        if (Math.abs(dx) < 0.01) {
            player.position.x = targetX;
            isMovingLane = false;
        } else {
            player.position.x += Math.sign(dx) * laneMoveSpeed * dt;
        }

        // Камера слегка следит за игроком по X
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
}

function setupGameLoop(scene) {
    let obstacleTimer = 0;
    let mandarinTimer = 0;

    scene.onBeforeRenderObservable.add(() => {
        if (gameOver || !player) return;

        const dt = engine.getDeltaTime() / 1000; // секунды

        // "Движение вперёд": мир едет на нас
        const dz = speed * dt;
        distance += dz;
        distLabel.textContent = "Дистанция: " + distance.toFixed(0) + " м";

        // Лёгкое усложнение: скорость растёт
        speed += 0.3 * dt;

        // Лес
        moveTrees(dz);

        // Обновление врагов и мандаринов
        moveAndCleanupObjects(obstacles, dz);
        moveAndCleanupObjects(mandarins, dz);

        // Спавн
        obstacleTimer += dt;
        mandarinTimer += dt;

        if (obstacleTimer > 1.2) { // каждую ~секунду+
            spawnObstacle(scene, player.position.z + 60);
            obstacleTimer = 0;
        }
        if (mandarinTimer > 0.8) { // чаще мандаринки
            spawnMandarin(scene, player.position.z + 60);
            mandarinTimer = 0;
        }

        // Коллизии
        checkCollisions();
    });
}

function moveAndCleanupObjects(arr, dz) {
    for (let i = arr.length - 1; i >= 0; i--) {
        const obj = arr[i];
        obj.position.z -= dz; // мир движется к игроку
        if (obj.position.z < -15) { // далеко позади
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

    // Столкновение с препятствием — конец игры
    for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        const dx = o.position.x - player.position.x;
        const dz = o.position.z - player.position.z;
        if (Math.abs(dx) < 0.8 && Math.abs(dz) < 1.2) {
            onGameOver();
            return;
        }
    }

    // Подбор мандаринов
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
    finalScore.textContent = "Мандарины: " + score + " | Дистанция: " + distance.toFixed(0) + " м";
    gameOverPanel.style.display = "flex";

    if (window.Telegram && Telegram.WebApp && Telegram.WebApp.sendData) {
        const payload = {
            type: "game_over",
            score: score,
            distance: Math.round(distance)
        };
        Telegram.WebApp.sendData(JSON.stringify(payload));
    }
}

restartBtn.addEventListener("click", () => {
    resetGameVariables();
});

const sceneInstance = createScene();

engine.runRenderLoop(function () {
    sceneInstance.render();
});

window.addEventListener("resize", function () {
    engine.resize();
});
