import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const ASSETS = {
  garrosh: "assets/garrosh.glb",
  butcher: "assets/butcher.glb",
  meat: "assets/meat.glb",
  audioPrimary: "assets/greet2026.wav",
  audioFallback: "assets/greeting2026.wav",
  music: "assets/music.mp3",
};

const VIEW = {
  // If your models still look too big/small, tweak these.
  targetHeights: {
    garrosh: 2.2,
    butcher: 2.0,
  },
  // Many character GLBs face +Z; rotate PI to face into the scene (-Z).
  actorYaw: Math.PI,
  // Additional vertical offset of the camera target (in meters)
  targetYOffset: 0.0,
};

const MOVE = {
  walkSpeed: 0.55,
  runSpeed: 4.7,
  // Garrosh leads (more negative Z); Butcher follows behind.
  followerGapZ: 3.6,
  // Slight lane split so Garrosh is visible (not blocked behind Butcher).
  leaderX: -1.4,
  followerX: 1.4,
  wrapFollowerZ: -60,
  resetFollowerZ: 10,

  // Camera: farther behind + a bit above
  cameraBehind: 15.5,
  cameraUp: 5.2,
  cameraSide: 1.1,
  lookAhead: 2.6,
};

const ANIM = {
  walkTimeScale: 1.0,
  runTimeScale: 1.05,
  runTimeScaleSameClip: 1.15,
};

const CAMERA = {
  walk: {
    behind: MOVE.cameraBehind,
    up: MOVE.cameraUp,
    side: MOVE.cameraSide,
    lookAhead: MOVE.lookAhead,
    fov: 52,
  },
  run: {
    behind: 28.0,
    up: 9.0,
    side: 1.8,
    lookAhead: 9.0,
    fov: 68,
  },
  // Smoothness of the camera transition (higher = faster)
  blend: 0.06,
};

const ROAD = {
  width: 7.0,
  segLength: 14.0,
  segCount: 10,
};

const MEAT = {
  enabled: true,
  // Spawn only while running
  spawnPerSecond: 14,
  maxCount: 140,
  spawnHalfWidth: 6.5,
  spawnHeight: 14,
  spawnHeightJitter: 10,
  spawnAheadMin: 8,
  spawnAheadMax: 34,
  fallSpeedMin: 6.5,
  fallSpeedMax: 12.0,
  spinSpeedMin: -2.2,
  spinSpeedMax: 2.2,
  targetHeight: 0.55,
};

const MEAT_COUNTER = {
  enabled: true,
  max: 200,
};

const AUDIO = {
  enabled: true,
  volume: 0.9,
  musicVolume: 0.35,
};

// NOTE: I’m not hardcoding the full NIV verse text here.
// Paste your exact wording into the `lines` arrays below.
const DEFAULT_SCRIPT = [
  {
    ref: "Psalm 23:5 (NIV)",
    lines: [
      "You prepare a table before me",
      "in the presence of my enemies.",
      "my cup overflows",
    ],
    mode: "walk",
  },
  {
    ref: "Philippians 3:13–14 (NIV)",
    lines: [
      "Brothers and sisters, I do not consider myself yet to have taken hold of it.",
      "But one thing I do: Forgetting what is behind and straining toward what is ahead,",
      "I press on toward the goal to win the prize",
      "for which God has called me heavenward in Christ Jesus.",
    ],
    // On the final line (“…heavenward in Christ Jesus.”), switch both to run.
    mode: "walk_then_run_on_last_line",
  },
];

async function loadUserScript() {
  try {
    // Optional file (created by you): ./user-verses.js
    // eslint-disable-next-line no-undef
    const mod = await import("./user-verses.js");
    const script = mod?.SCRIPT;
    if (!Array.isArray(script) || script.length === 0) return null;
    return script;
  } catch {
    return null;
  }
}

const ui = {
  canvas: document.getElementById("c"),
  crawl: document.getElementById("crawl"),
  ref: document.getElementById("ref"),
  line: document.getElementById("line"),
  loader: document.getElementById("loader"),
  loaderText: document.getElementById("loaderText"),
  soundHint: document.getElementById("soundHint"),
  tapHint: document.getElementById("tapHint"),
  meatCounter: document.getElementById("meatCounter"),
  meatCountNum: document.getElementById("meatCountNum"),
  meatIcon: document.getElementById("meatIcon"),
  victory: document.getElementById("victory"),
};

const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

let verseAudio = null;
let verseAudioReady = false;
let verseAudioRequested = false;
let verseAudioEnded = false;

let musicAudio = null;
let musicReady = false;
let musicStarted = false;

let audioBlocked = false;

function setSoundHint(visible) {
  if (!ui.soundHint) return;
  ui.soundHint.classList.toggle("isHidden", !visible);
}

function setMeatCounterVisible(visible) {
  if (!ui.meatCounter) return;
  ui.meatCounter.classList.toggle("isHidden", !visible);
}

function setTapHintVisible(visible) {
  if (!ui.tapHint) return;
  ui.tapHint.classList.toggle("isHidden", !visible);
}

let tapHintTimer = 0;
let tapHintDismissed = false;
function showTapHint() {
  if (!MEAT_COUNTER.enabled) return;
  if (!ui.tapHint) return;
  if (tapHintDismissed) return;

  setTapHintVisible(true);
  if (tapHintTimer) window.clearTimeout(tapHintTimer);
  tapHintTimer = window.setTimeout(() => setTapHintVisible(false), 12000);
}

function dismissTapHint() {
  tapHintDismissed = true;
  if (tapHintTimer) window.clearTimeout(tapHintTimer);
  setTapHintVisible(false);
}

function setMeatCount(n) {
  if (!ui.meatCountNum) return;
  ui.meatCountNum.textContent = String(n);
}

let victoryShown = false;
function showVictory() {
  if (!ui.victory) return;
  ui.victory.classList.remove("isHidden");
  victoryShown = true;
}

let meatBumpTimer = 0;
function bumpMeatCounter() {
  if (!ui.meatCounter) return;
  ui.meatCounter.classList.add("bump");
  if (meatBumpTimer) window.clearTimeout(meatBumpTimer);
  meatBumpTimer = window.setTimeout(() => ui.meatCounter?.classList.remove("bump"), 140);
}

function onUserGesture() {
  if (!audioBlocked) return;
  attemptAudioPlayback();
}

function attemptAudioPlayback() {
  // If greeting audio exists and hasn't ended yet, prioritize it.
  if (verseAudioReady && !verseAudioEnded) playVerseAudio();
  else startMusicLoop();
}

function startMusicLoop() {
  if (!AUDIO.enabled || !musicReady || !musicAudio || musicStarted) return;
  try {
    const p = musicAudio.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        musicStarted = true;
        audioBlocked = false;
        setSoundHint(false);
      }).catch(() => {
        musicStarted = false;
        audioBlocked = true;
        setSoundHint(true);
      });
    } else {
      musicStarted = true;
      audioBlocked = false;
      setSoundHint(false);
    }
  } catch {
    musicStarted = false;
    audioBlocked = true;
    setSoundHint(true);
  }
}

async function setupMusic() {
  if (!AUDIO.enabled) return;
  if (!(await assetExists(ASSETS.music))) return;
  musicAudio = new Audio(ASSETS.music);
  musicAudio.preload = "auto";
  musicAudio.loop = true;
  musicAudio.volume = AUDIO.musicVolume;
  musicReady = true;
}

async function setupVerseAudio() {
  if (!AUDIO.enabled) return;
  let audioUrl = null;
  if (await assetExists(ASSETS.audioPrimary)) audioUrl = ASSETS.audioPrimary;
  else if (await assetExists(ASSETS.audioFallback)) audioUrl = ASSETS.audioFallback;
  if (!audioUrl) {
    // No greeting audio; still allow music if present.
    await setupMusic();
    return;
  }

  verseAudio = new Audio(audioUrl);
  verseAudio.preload = "auto";
  verseAudio.volume = AUDIO.volume;
  verseAudioReady = true;
  verseAudioEnded = false;

  // Prep the ending music.
  await setupMusic();

  // When greeting finishes, start looping music.
  verseAudio.addEventListener(
    "ended",
    () => {
      verseAudioEnded = true;
      startMusicLoop();
    },
    { passive: true }
  );

  // Mobile browsers may block autoplay.
  // We always retry on the first user gesture anywhere (no button).
  window.addEventListener("pointerdown", onUserGesture, { passive: true });
  window.addEventListener("touchstart", onUserGesture, { passive: true });
  window.addEventListener("mousedown", onUserGesture, { passive: true });
  window.addEventListener("keydown", onUserGesture, { passive: true });
}

function playVerseAudio() {
  if (!AUDIO.enabled || !verseAudioReady || !verseAudio) return;
  verseAudioRequested = true;
  try {
    verseAudio.currentTime = 0;
    const p = verseAudio.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        verseAudioEnded = false;
        audioBlocked = false;
        setSoundHint(false);
      }).catch(() => {
        audioBlocked = true;
        setSoundHint(true);
      });
    }
  } catch {
    audioBlocked = true;
    setSoundHint(true);
  }
}

function restartLineFlow() {
  if (prefersReducedMotion) return;
  ui.crawl?.classList.remove("flow");
  // Force reflow so the CSS animation restarts
  // eslint-disable-next-line no-unused-expressions
  ui.crawl?.offsetWidth;
  ui.crawl?.classList.add("flow");
}

function setText(ref, line) {
  ui.ref.textContent = ref;
  ui.line.textContent = line;
  restartLineFlow();
}

function setLoading(visible, text) {
  if (ui.loader) ui.loader.classList.toggle("isHidden", !visible);
  if (ui.loaderText && text) ui.loaderText.textContent = text;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickClip(clips, keywords) {
  if (!clips || clips.length === 0) return null;
  const lower = clips.map((c) => ({ c, n: String(c.name || "").toLowerCase() }));
  for (const kw of keywords) {
    const hit = lower.find((x) => x.n.includes(kw));
    if (hit) return hit.c;
  }
  return clips[0];
}

async function assetExists(url) {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

async function loadGLB(url) {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

/** Three.js scene */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd6ff);
scene.fog = new THREE.Fog(0x9fd6ff, 28, 140);

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);

const renderer = new THREE.WebGLRenderer({
  canvas: ui.canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

scene.add(new THREE.HemisphereLight(0xbfe7ff, 0x2f6b2f, 0.85));
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const sun = new THREE.DirectionalLight(0xffffff, 1.05);
sun.position.set(10, 16, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 80;
sun.shadow.camera.left = -22;
sun.shadow.camera.right = 22;
sun.shadow.camera.top = 22;
sun.shadow.camera.bottom = -22;
sun.shadow.bias = -0.00035;
scene.add(sun);

// Visible sun in the sky (purely visual)
const sunCore = new THREE.Mesh(
  new THREE.SphereGeometry(7.2, 32, 20),
  new THREE.MeshBasicMaterial({ color: 0xffd46b, fog: false })
);
// Keep it within the camera's far plane and inside the general look direction.
sunCore.position.set(-26, 46, -78);
scene.add(sunCore);

const sunHalo = new THREE.Mesh(
  new THREE.SphereGeometry(14.5, 32, 20),
  new THREE.MeshBasicMaterial({
    color: 0xfff0b5,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  })
);
sunHalo.position.copy(sunCore.position);
scene.add(sunHalo);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(260, 260),
  new THREE.MeshStandardMaterial({ color: 0x2f7a35, roughness: 1.0, metalness: 0.0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
ground.receiveShadow = true;
scene.add(ground);

// Endless road (recycled segments)
const roadGroup = new THREE.Group();
scene.add(roadGroup);
const roadSegments = [];

function makeRoadSegment() {
  const g = new THREE.Group();

  const asphalt = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD.width, 0.12, ROAD.segLength),
    // Worn dirt road
    new THREE.MeshStandardMaterial({ color: 0x7a613f, roughness: 1.0, metalness: 0.0 })
  );
  asphalt.position.y = 0.06;
  asphalt.receiveShadow = true;
  g.add(asphalt);

  // Long ruts + patches (no cross-road stripes)
  const rutMat = new THREE.MeshStandardMaterial({ color: 0x5c4a31, roughness: 1.0, metalness: 0.0 });
  const rutGeo = new THREE.BoxGeometry(0.55, 0.02, ROAD.segLength * 0.96);
  const rutOffsets = [-ROAD.width * 0.18, ROAD.width * 0.18];
  for (const x of rutOffsets) {
    const rut = new THREE.Mesh(rutGeo, rutMat);
    rut.receiveShadow = true;
    rut.position.set(x, 0.13, 0);
    g.add(rut);
  }

  const patchMat = new THREE.MeshStandardMaterial({ color: 0x6a5336, roughness: 1.0, metalness: 0.0 });
  for (let i = 0; i < 6; i++) {
    const w = 0.7 + Math.random() * 1.6;
    const l = 1.6 + Math.random() * 4.2;
    const patch = new THREE.Mesh(new THREE.BoxGeometry(w, 0.015, l), patchMat);
    patch.receiveShadow = true;
    patch.position.set((Math.random() - 0.5) * (ROAD.width * 0.8), 0.12, (Math.random() - 0.5) * (ROAD.segLength * 0.75));
    patch.rotation.y = (Math.random() - 0.5) * 0.22;
    g.add(patch);
  }

  return g;
}

for (let i = 0; i < ROAD.segCount; i++) {
  const seg = makeRoadSegment();
  seg.position.z = -i * ROAD.segLength;
  roadGroup.add(seg);
  roadSegments.push(seg);
}

const mixers = [];

const actors = {
  garrosh: { root: null, mixer: null, actions: { walk: null, run: null } },
  butcher: { root: null, mixer: null, actions: { walk: null, run: null } },
};

const meat = {
  proto: null,
  ok: false,
  group: new THREE.Group(),
  pool: [],
  spawnAcc: 0,
  spawning: false,
};
scene.add(meat.group);

let meatCount = 0;
let celebrated200 = false;

const FX = {
  enabled: true,
  birdsOnRunStart: true,
  angelBurstOnRunStart: true,
  victoryMeatRain: true,
};

const fx = {
  group: new THREE.Group(),
  birds: [],
  halos: [],
  burst: null,
  victoryRainUntil: 0,
  victoryRainAcc: 0,
};
scene.add(fx.group);

// --- Birds (simple wing flaps) ---
const birdGeo = new THREE.BoxGeometry(0.35, 0.03, 0.12);
const birdMat = new THREE.MeshBasicMaterial({ color: 0x0c0c0c });

function spawnBird({ x, y, z, vx, vz, ttl }) {
  const root = new THREE.Group();
  const left = new THREE.Mesh(birdGeo, birdMat);
  const right = new THREE.Mesh(birdGeo, birdMat);
  left.position.set(-0.22, 0, 0);
  right.position.set(0.22, 0, 0);
  root.add(left, right);

  root.position.set(x, y, z);
  root.rotation.y = Math.atan2(vx, vz);
  root.scale.setScalar(1.1 + Math.random() * 0.6);

  fx.group.add(root);
  fx.birds.push({ root, left, right, vx, vz, phase: Math.random() * Math.PI * 2, life: ttl, ttl });
}

function updateBirds(dt) {
  if (fx.birds.length === 0) return;
  for (let i = fx.birds.length - 1; i >= 0; i--) {
    const b = fx.birds[i];
    b.life -= dt;
    if (b.life <= 0) {
      fx.group.remove(b.root);
      fx.birds.splice(i, 1);
      continue;
    }
    b.phase += dt * 10.5;
    const flap = Math.sin(b.phase) * 0.55;
    b.left.rotation.z = flap;
    b.right.rotation.z = -flap;
    b.root.position.x += b.vx * dt;
    b.root.position.z += b.vz * dt;
    // Slight bob
    b.root.position.y += Math.sin(b.phase * 0.7) * dt * 0.6;
  }
}

function triggerBirdFlyover() {
  if (!FX.enabled || prefersReducedMotion || !FX.birdsOnRunStart) return;

  const followerZ = actors.butcher.root?.position.z ?? actors.garrosh.root?.position.z ?? camera.position.z;
  const z0 = followerZ - 34;
  const count = 9;
  for (let i = 0; i < count; i++) {
    const fromLeft = Math.random() < 0.5;
    const x = fromLeft ? -10.5 : 10.5;
    const y = 11.0 + Math.random() * 7.0;
    const z = z0 - Math.random() * 26;
    const vx = (fromLeft ? 1 : -1) * (5.2 + Math.random() * 4.8);
    const vz = -(1.5 + Math.random() * 2.5);
    const ttl = 2.6 + Math.random() * 1.2;
    spawnBird({ x, y, z, vx, vz, ttl });
  }
}

// --- Angel / halo + blast burst ---
const haloGeo = new THREE.RingGeometry(0.38, 0.58, 24);
const haloMat = new THREE.MeshBasicMaterial({
  color: 0xffd666,
  transparent: true,
  opacity: 0.0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

function spawnHaloAt(target, yOff = 2.35) {
  if (!target) return;
  const mesh = new THREE.Mesh(haloGeo, haloMat.clone());
  mesh.position.set(target.position.x, yOff, target.position.z);
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.setScalar(0.6);
  fx.group.add(mesh);
  fx.halos.push({ mesh, target, life: 1.15, ttl: 1.15, yOff });
}

function updateHalos(dt) {
  if (fx.halos.length === 0) return;
  for (let i = fx.halos.length - 1; i >= 0; i--) {
    const h = fx.halos[i];
    h.life -= dt;
    if (h.life <= 0) {
      fx.group.remove(h.mesh);
      fx.halos.splice(i, 1);
      continue;
    }

    const t = 1 - h.life / h.ttl;
    const fadeIn = Math.min(1, t / 0.18);
    const fadeOut = Math.min(1, (1 - t) / 0.35);
    const alpha = 0.85 * fadeIn * fadeOut;
    h.mesh.material.opacity = alpha;
    if (h.target) {
      h.mesh.position.x = h.target.position.x;
      h.mesh.position.z = h.target.position.z;
      h.mesh.position.y = h.yOff + 0.08 * Math.sin(t * Math.PI * 2);
    }
    const s = 0.6 + t * 0.8;
    h.mesh.scale.setScalar(s);
    h.mesh.rotation.z += dt * 1.8;
  }
}

function spawnRunBlast() {
  if (!FX.enabled || prefersReducedMotion) return;

  // Recreate each time (short-lived, simple)
  if (fx.burst) {
    fx.group.remove(fx.burst.points);
    fx.burst = null;
  }

  const count = 96;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const u = Math.random();
    const r = 0.15 + Math.random() * 0.55;
    const y = (Math.random() - 0.1) * 0.35;
    positions[i * 3 + 0] = Math.cos(a) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(a) * r;

    const sp = 2.6 + Math.random() * 5.4;
    velocities[i * 3 + 0] = Math.cos(a) * sp;
    velocities[i * 3 + 1] = (Math.random() * 1.1 + 0.2) * sp;
    velocities[i * 3 + 2] = Math.sin(a) * sp;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xfff0b5,
    size: 0.14,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);

  const followerZ = actors.butcher.root?.position.z ?? actors.garrosh.root?.position.z ?? camera.position.z;
  points.position.set(0, 2.0, followerZ - 6.0);
  fx.group.add(points);

  fx.burst = { points, velocities, life: 0.95, ttl: 0.95 };
}

function updateRunBlast(dt) {
  if (!fx.burst) return;
  fx.burst.life -= dt;
  if (fx.burst.life <= 0) {
    fx.group.remove(fx.burst.points);
    fx.burst = null;
    return;
  }

  const geo = fx.burst.points.geometry;
  const attr = geo.getAttribute("position");
  const p = attr.array;
  const v = fx.burst.velocities;
  for (let i = 0; i < p.length; i += 3) {
    p[i + 0] += v[i + 0] * dt;
    p[i + 1] += v[i + 1] * dt;
    p[i + 2] += v[i + 2] * dt;
    v[i + 0] *= 0.985;
    v[i + 1] *= 0.975;
    v[i + 2] *= 0.985;
  }
  attr.needsUpdate = true;

  const t = 1 - fx.burst.life / fx.burst.ttl;
  fx.burst.points.material.opacity = 0.9 * (1 - t);
}

function triggerRunStartFX() {
  if (!FX.enabled) return;
  triggerBirdFlyover();

  if (!prefersReducedMotion && FX.angelBurstOnRunStart) {
    spawnHaloAt(actors.garrosh.root);
    spawnHaloAt(actors.butcher.root);
    spawnRunBlast();
  }
}

// --- Victory meat rain ---
function startVictoryMeatRain(seconds = 3.6) {
  if (!FX.enabled || prefersReducedMotion || !FX.victoryMeatRain) return;
  fx.victoryRainUntil = last + Math.max(0.2, seconds);
  fx.victoryRainAcc = 0;
}

function updateVictoryMeatRain(dt) {
  if (fx.victoryRainUntil <= 0) return;
  if (last > fx.victoryRainUntil) {
    fx.victoryRainUntil = 0;
    return;
  }

  // Spawn above and slightly ahead of the leaders.
  const g = actors.garrosh.root;
  const b = actors.butcher.root;
  const followerZ = b?.position.z ?? 0;
  const leaderZ = g?.position.z ?? followerZ - MOVE.followerGapZ;

  fx.victoryRainAcc += dt * 46;
  while (fx.victoryRainAcc >= 1) {
    fx.victoryRainAcc -= 1;
    const x = (Math.random() - 0.5) * (ROAD.width * 1.15);
    const y = 16 + Math.random() * 10;
    const z = leaderZ - (12 + Math.random() * 22);
    spawnMeatAt(x, y, z, {
      mode: "fall",
      vy: 10 + Math.random() * 10,
      vx: (Math.random() - 0.5) * 0.8,
      vz: -(Math.random() * 1.6),
      life: 3.2 + Math.random() * 1.2,
    });
  }
}

const meatIcon3d = {
  renderer: null,
  scene: null,
  camera: null,
  root: null,
  ready: false,
};

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  const a = Math.ceil(min);
  const b = Math.floor(max);
  return Math.floor(a + Math.random() * (b - a + 1));
}

function normalizeToHeight(root, desiredHeight = 2.4) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const h = Math.max(0.0001, size.y);
  const s = desiredHeight / h;
  root.scale.setScalar(s);

  const box2 = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box2.getCenter(center);
  // Put feet on floor and center horizontally.
  root.position.y -= box2.min.y;
  root.position.x -= center.x;
  root.position.z -= center.z;
}

function objectSize(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  return { box, size, center };
}

function makeFallback(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 2.2, 1.0),
    new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.02, flatShading: true })
  );
  body.position.y = 1.1;
  g.add(body);
  return g;
}

function makeMeatFallback() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.45, 0.6),
    new THREE.MeshStandardMaterial({ color: 0xd46a5a, roughness: 0.85, metalness: 0.0 })
  );
  m.position.y = 0.25;
  g.add(m);
  return g;
}

async function loadMeat(url) {
  const exists = await assetExists(url);
  if (!exists) {
    meat.proto = makeMeatFallback();
    normalizeToHeight(meat.proto, MEAT.targetHeight);
    meat.ok = false;
    return;
  }

  try {
    const gltf = await loadGLB(url);
    const root = gltf.scene;
    normalizeToHeight(root, MEAT.targetHeight);
    meat.proto = root;
    meat.ok = true;
  } catch {
    meat.proto = makeMeatFallback();
    normalizeToHeight(meat.proto, MEAT.targetHeight);
    meat.ok = false;
  }
}

function setupMeatIcon3d() {
  if (!MEAT_COUNTER.enabled || !ui.meatIcon) return;
  if (meatIcon3d.ready) return;

  meatIcon3d.renderer = new THREE.WebGLRenderer({
    canvas: ui.meatIcon,
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  meatIcon3d.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  meatIcon3d.renderer.outputColorSpace = THREE.SRGBColorSpace;
  meatIcon3d.renderer.setClearColor(0x000000, 0);

  meatIcon3d.scene = new THREE.Scene();
  meatIcon3d.camera = new THREE.PerspectiveCamera(34, 1, 0.01, 50);

  meatIcon3d.scene.add(new THREE.HemisphereLight(0xffffff, 0x223322, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 0.95);
  dir.position.set(2, 3, 2);
  meatIcon3d.scene.add(dir);

  const root = (meat.proto ? meat.proto.clone(true) : makeMeatFallback());
  normalizeToHeight(root, 0.55);
  meatIcon3d.scene.add(root);
  meatIcon3d.root = root;

  meatIcon3d.camera.position.set(0.7, 0.55, 2.1);
  meatIcon3d.camera.lookAt(0, 0.35, 0);

  meatIcon3d.ready = true;
}

const meatTap = {
  raycaster: new THREE.Raycaster(),
  ndc: new THREE.Vector2(),
};

function tagMeatForPicking(root, item) {
  root.traverse((o) => {
    o.userData.meatItem = item;
  });
}

function collectMeatItem(item) {
  if (!MEAT_COUNTER.enabled) return;
  if (!item || !item.active) return;
  if (meatCount >= MEAT_COUNTER.max) return;

  dismissTapHint();

  item.active = false;
  item.mesh.visible = false;

  const add = Math.min(randInt(1, 30), MEAT_COUNTER.max - meatCount);
  meatCount += add;
  setMeatCount(meatCount);
  bumpMeatCounter();

  if (meatCount >= MEAT_COUNTER.max) {
    if (!celebrated200) {
      celebrated200 = true;
      showVictory();
      bumpMeatCounter();

      const g = actors.garrosh.root;
      const b = actors.butcher.root;
      const followerZ = b?.position.z ?? 0;
      const leaderZ = g?.position.z ?? followerZ - MOVE.followerGapZ;

      const burstCount = prefersReducedMotion ? 34 : 64;
      const doBurst = (count, spreadMul = 1) => {
        for (let i = 0; i < count; i++) {
          const x = (Math.random() - 0.5) * 6.5 * spreadMul;
          const y = 1.0 + Math.random() * 1.5;
          const z = leaderZ - (10 + Math.random() * 16);
          spawnMeatAt(x, y, z, {
            mode: "burst",
            vy: -(10 + Math.random() * 12),
            vx: (Math.random() - 0.5) * 3.6 * spreadMul,
            vz: -(Math.random() * 4.6),
            life: 2.6 + Math.random() * 0.9,
          });
        }
      };

      doBurst(burstCount, 1);
      if (!prefersReducedMotion) {
        window.setTimeout(() => doBurst(38, 1.15), 260);
        window.setTimeout(() => doBurst(34, 1.25), 520);
      }

      startVictoryMeatRain(4.0);
    }
  }
}

function collectClosestMeatFallback() {
  const any = meat.pool.find((p) => p.active);
  if (any) collectMeatItem(any);
}

function onCanvasTapCollect(e) {
  if (!MEAT_COUNTER.enabled) return;
  if (moveMode !== "run") return;
  if (meatCount >= MEAT_COUNTER.max) return;

  // Any tap attempt during run counts as "got it".
  dismissTapHint();

  const rect = ui.canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  meatTap.ndc.set(x * 2 - 1, -(y * 2 - 1));
  meatTap.raycaster.setFromCamera(meatTap.ndc, camera);

  const hits = meatTap.raycaster.intersectObjects(meat.group.children, true);
  if (hits.length > 0) {
    const item = hits[0].object?.userData?.meatItem;
    if (item) {
      collectMeatItem(item);
      return;
    }
  }

  // If you didn't tap exactly on a meat, still collect one (keeps the game fun on mobile).
  collectClosestMeatFallback();
}

function spawnMeatAt(x, y, z, opts = undefined) {
  if (!MEAT.enabled || !meat.proto) return;

  let item = meat.pool.find((p) => !p.active);
  if (!item) {
    if (meat.pool.length >= MEAT.maxCount) {
      // Reuse oldest
      item = meat.pool.shift();
      meat.pool.push(item);
    } else {
      const mesh = meat.proto.clone(true);
      meat.group.add(mesh);
      item = {
        mesh,
        vy: 9,
        vx: 0,
        vz: 0,
        life: 0,
        spin: new THREE.Vector3(),
        active: false,
        mode: "fall",
      };
      mesh.userData.__meatTagged = true;
      tagMeatForPicking(mesh, item);
      meat.pool.push(item);
    }
  }

  // Ensure reused pool items remain pickable.
  if (!item.mesh.userData.__meatTagged) {
    item.mesh.userData.__meatTagged = true;
    tagMeatForPicking(item.mesh, item);
  }

  item.active = true;
  item.mode = opts?.mode || "fall";
  item.vx = Number.isFinite(opts?.vx) ? opts.vx : 0;
  item.vz = Number.isFinite(opts?.vz) ? opts.vz : 0;
  item.life = Number.isFinite(opts?.life) ? opts.life : 0;
  item.vy = Number.isFinite(opts?.vy) ? opts.vy : randRange(MEAT.fallSpeedMin, MEAT.fallSpeedMax);
  item.spin.set(
    randRange(MEAT.spinSpeedMin, MEAT.spinSpeedMax),
    randRange(MEAT.spinSpeedMin, MEAT.spinSpeedMax),
    randRange(MEAT.spinSpeedMin, MEAT.spinSpeedMax)
  );

  const mesh = item.mesh;
  mesh.visible = true;
  mesh.position.set(x, y, z);
  mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
}

function updateMeat(dt) {
  if (!MEAT.enabled || !meat.proto) return;

  const g = actors.garrosh.root;
  const b = actors.butcher.root;
  const followerZ = b?.position.z ?? 0;
  const leaderZ = g?.position.z ?? followerZ - MOVE.followerGapZ;
  const zMid = (leaderZ + followerZ) * 0.5;

  if (meat.spawning) {
    meat.spawnAcc += dt * MEAT.spawnPerSecond;
    while (meat.spawnAcc >= 1) {
      meat.spawnAcc -= 1;
      const x = randRange(-MEAT.spawnHalfWidth, MEAT.spawnHalfWidth);
      const y = MEAT.spawnHeight + randRange(0, MEAT.spawnHeightJitter);
      const z = leaderZ - randRange(MEAT.spawnAheadMin, MEAT.spawnAheadMax);
      spawnMeatAt(x, y, z);
    }
  }

  const killY = -2;
  const behindZ = camera.position.z + 18;

  for (const item of meat.pool) {
    if (!item.active) continue;
    const mesh = item.mesh;
    mesh.position.y -= item.vy * dt;
    if (item.vx) mesh.position.x += item.vx * dt;
    if (item.vz) mesh.position.z += item.vz * dt;
    mesh.rotation.x += item.spin.x * dt;
    mesh.rotation.y += item.spin.y * dt;
    mesh.rotation.z += item.spin.z * dt;

    if (item.life && item.life > 0) {
      item.life -= dt;
      if (item.life <= 0) {
        item.active = false;
        mesh.visible = false;
        continue;
      }
    }

    // Cull when below ground or far behind the camera.
    if (
      mesh.position.y < killY ||
      mesh.position.y > 34 ||
      mesh.position.z > behindZ ||
      Math.abs(mesh.position.z - zMid) > 220
    ) {
      item.active = false;
      mesh.visible = false;
    }
  }
}

function setActorPoseAndCamera() {
  const g = actors.garrosh.root;
  const b = actors.butcher.root;

  // Place in a line: Garrosh ahead, Butcher behind.
  if (g) {
    g.position.set(MOVE.leaderX, 0, -MOVE.followerGapZ);
    g.rotation.y = VIEW.actorYaw;
  }
  if (b) {
    b.position.set(MOVE.followerX, 0, 0);
    b.rotation.y = VIEW.actorYaw;
  }

  // Initial follow camera (we keep updating it each frame).
  camera.position.set(0, MOVE.cameraUp, MOVE.cameraBehind);
  camera.lookAt(0, 1.6 + VIEW.targetYOffset, -MOVE.lookAhead);
}

const camRuntime = {
  behind: CAMERA.walk.behind,
  up: CAMERA.walk.up,
  side: CAMERA.walk.side,
  lookAhead: CAMERA.walk.lookAhead,
  fov: CAMERA.walk.fov,
};

function updateFollowCamera() {
  const g = actors.garrosh.root;
  const b = actors.butcher.root;
  if (!g && !b) return;

  const preset = moveMode === "run" ? CAMERA.run : CAMERA.walk;
  const k = CAMERA.blend;
  camRuntime.behind += (preset.behind - camRuntime.behind) * k;
  camRuntime.up += (preset.up - camRuntime.up) * k;
  camRuntime.side += (preset.side - camRuntime.side) * k;
  camRuntime.lookAhead += (preset.lookAhead - camRuntime.lookAhead) * k;
  camRuntime.fov += (preset.fov - camRuntime.fov) * k;

  if (Math.abs(camera.fov - camRuntime.fov) > 0.01) {
    camera.fov = camRuntime.fov;
    camera.updateProjectionMatrix();
  }

  // Follow from behind the Butcher (camera "after" both), look ahead of Garrosh.
  const followerZ = b?.position.z ?? 0;
  const leaderZ = g?.position.z ?? followerZ - MOVE.followerGapZ;
  const xMid = ((g?.position.x ?? 0) + (b?.position.x ?? 0)) * 0.5;
  const zMid = (leaderZ + followerZ) * 0.5;

  const desiredPos = new THREE.Vector3(xMid + camRuntime.side, camRuntime.up, followerZ + camRuntime.behind);
  camera.position.lerp(desiredPos, 0.08);

  const desiredTarget = new THREE.Vector3(xMid, 1.6 + VIEW.targetYOffset, zMid - camRuntime.lookAhead);
  camera.lookAt(desiredTarget);
}

let moveMode = null;
function updateForwardMotion(dt) {
  const speed = moveMode === "run" ? MOVE.runSpeed : MOVE.walkSpeed;
  const g = actors.garrosh.root;
  const b = actors.butcher.root;

  if (b) b.position.z -= speed * dt;
  if (g && b) g.position.z = b.position.z - MOVE.followerGapZ;
  else if (g) g.position.z -= speed * dt;

  // Keep their spacing constant and wrap using the follower (Butcher).
  if (g && b) {
    if (b.position.z < MOVE.wrapFollowerZ) {
      b.position.z = MOVE.resetFollowerZ;
      g.position.z = b.position.z - MOVE.followerGapZ;
    }
  }
}

function updateRoad() {
  // Recycle road segments based on the runner position (stable even when the camera zooms).
  const runnerZ = actors.butcher.root?.position.z ?? actors.garrosh.root?.position.z ?? camera.position.z;
  // We'll keep segments ahead (more negative) of the camera.
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const seg of roadSegments) {
    minZ = Math.min(minZ, seg.position.z);
    maxZ = Math.max(maxZ, seg.position.z);
  }

  // If a segment is far behind the runner, move it forward (more negative) to extend the road.
  for (const seg of roadSegments) {
    if (seg.position.z > runnerZ + ROAD.segLength * 1.2) {
      seg.position.z = minZ - ROAD.segLength;
      minZ = seg.position.z;
    }
  }
}

function fadeTo(actor, actionName, fade = 0.35) {
  const a = actor.actions[actionName];
  if (!a) return;
  for (const k of Object.keys(actor.actions)) {
    const other = actor.actions[k];
    if (other && other !== a && other.isRunning()) other.fadeOut(fade);
  }
  a.reset();
  a.fadeIn(fade);
  a.play();
}

function setAll(mode) {
  if (mode === moveMode) return;
  moveMode = mode;
  meat.spawning = MEAT.enabled && mode === "run";

  if (MEAT_COUNTER.enabled && mode === "run") {
    meatCount = 0;
    setMeatCount(0);
    setMeatCounterVisible(true);
    bumpMeatCounter();

    tapHintDismissed = false;
    showTapHint();
  }

  for (const key of ["garrosh", "butcher"]) {
    const actor = actors[key];
    if (!actor.root) continue;
    if (mode === "walk") {
      fadeTo(actor, "walk");
      if (actor.actions.walk) actor.actions.walk.setEffectiveTimeScale(ANIM.walkTimeScale);
    }
    if (mode === "run") {
      // If walk/run resolved to the same clipAction, just speed it up to avoid a hard reset.
      if (actor.actions.run && actor.actions.walk && actor.actions.run === actor.actions.walk) {
        actor.actions.run.setEffectiveTimeScale(ANIM.runTimeScaleSameClip);
        if (!actor.actions.run.isRunning()) actor.actions.run.play();
      } else {
        fadeTo(actor, "run");
        if (actor.actions.run) actor.actions.run.setEffectiveTimeScale(ANIM.runTimeScale);
      }
    }
  }

  if (mode === "run") triggerRunStartFX();
}

async function loadActor(key, url, fallbackColor) {
  const exists = await assetExists(url);
  if (!exists) {
    const root = makeFallback(fallbackColor);
    actors[key] = { root, mixer: null, actions: { walk: null, run: null } };
    scene.add(root);
    return { ok: false, clips: [] };
  }

  try {
    const gltf = await loadGLB(url);
    const root = gltf.scene;
    normalizeToHeight(root, VIEW.targetHeights[key] ?? 2.2);

    root.traverse((o) => {
      if (o && o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });

    const mixer = new THREE.AnimationMixer(root);
    mixers.push(mixer);

    const clips = gltf.animations || [];
    const walkClip = pickClip(clips, ["walk", "run", "idle", "move"]);
    const runClip = pickClip(clips, ["run", "sprint", "dash", "walk", "idle"]);

    const walk = walkClip ? mixer.clipAction(walkClip) : null;
    const run = runClip ? mixer.clipAction(runClip) : null;

    if (walk) walk.setLoop(THREE.LoopRepeat, Infinity);
    if (run) run.setLoop(THREE.LoopRepeat, Infinity);

    actors[key] = { root, mixer, actions: { walk, run } };
    scene.add(root);

    return { ok: true, clips: clips.map((c) => c.name) };
  } catch {
    const root = makeFallback(fallbackColor);
    actors[key] = { root, mixer: null, actions: { walk: null, run: null } };
    scene.add(root);
    return { ok: false, clips: [] };
  }
}

function resize() {
  const rect = ui.canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

let last = 0;
function frame(t) {
  const now = t * 0.001;
  const dt = Math.min(0.033, now - last);
  last = now;

  for (const m of mixers) m.update(dt);

  updateForwardMotion(dt);
  updateFollowCamera();
  updateRoad();
  updateMeat(dt);
  if (FX.enabled) {
    updateBirds(dt);
    updateHalos(dt);
    updateRunBlast(dt);
    updateVictoryMeatRain(dt);
  }

  renderer.render(scene, camera);

  if (meatIcon3d.ready && meatIcon3d.renderer && meatIcon3d.scene && meatIcon3d.camera && meatIcon3d.root) {
    meatIcon3d.root.rotation.y += dt * 1.2;
    meatIcon3d.root.rotation.x += dt * 0.4;
    meatIcon3d.renderer.render(meatIcon3d.scene, meatIcon3d.camera);
  }

  requestAnimationFrame(frame);
}

async function runScript(script) {
  // Basic cadence: show each line with a delay.
  for (const block of script) {
    // Set initial mode once per block (prevents restarting the walk loop each line).
    if (block.mode === "walk" || block.mode === "walk_then_run_on_last_line") setAll("walk");

    for (let i = 0; i < block.lines.length; i++) {
      const isLastLine = i === block.lines.length - 1;

      // Start the verse audio once, when the crawl begins.
      if (!verseAudioRequested) {
        playVerseAudio();
        // If there is no greeting audio but music exists, start music immediately.
        if (!verseAudioReady) startMusicLoop();
      }

      if (block.mode === "walk_then_run_on_last_line" && isLastLine) setAll("run");

      setText(block.ref, block.lines[i]);
      await sleep(5200);
    }
  }
}

async function boot() {
  resize();
  window.addEventListener("resize", resize);

  setLoading(true, "Loading…");
  setText("Loading…", "Preparing the scene.");

  await setupVerseAudio();

  const script = (await loadUserScript()) ?? DEFAULT_SCRIPT;

  setMeatCounterVisible(false);
  setTapHintVisible(false);
  meatCount = 0;
  setMeatCount(0);

  ui.canvas.addEventListener("pointerdown", onCanvasTapCollect, { passive: true });

  setLoading(true, "Loading Garrosh…");
  const g = await loadActor("garrosh", ASSETS.garrosh, 0xa78bfa);
  setLoading(true, "Loading Butcher…");
  const b = await loadActor("butcher", ASSETS.butcher, 0x6ee7ff);
  setLoading(true, "Loading meat…");
  await loadMeat(ASSETS.meat);
  setupMeatIcon3d();

  setLoading(true, "Starting…");

  setActorPoseAndCamera();

  // Start with walk-like anim
  setAll("walk");

  // (Hint/debug text removed from UI)

  requestAnimationFrame(frame);
  setLoading(false);
  setText("Happy New Year 2026", "Brothers and Sisters");
  await sleep(1600);

  // Run the verse text sequence
  runScript(script);
}

boot();
