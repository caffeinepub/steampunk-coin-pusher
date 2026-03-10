import { useGetHighScore, useSetHighScore } from "@/hooks/useQueries";
import { Canvas, type ThreeEvent, useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

// ── Types ─────────────────────────────────────────────────────────────────────
interface CoinData {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  ry: number;
  isGold: boolean;
  frozen: boolean;
}

interface GameState {
  coins: CoinData[];
  pusherZ: number;
  pusherDir: number;
  score: number;
  coinIdCounter: number;
  frame: number;
}

interface FloatItem {
  id: number;
  text: string;
  isGold: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const COIN_R = 0.45;
const COIN_FRICTION = 0.97;
const PUSHER_Z_MIN = -7.0;
const PUSHER_Z_MAX = 2.5;
const PUSHER_SPEED_FWD = 0.028;
const PUSHER_SPEED_BCK = 0.13;
const COLLECTION_Z = 7.6;
const BACK_WALL_Z = -7.5;
const LEFT_WALL_X = -6.5;
const RIGHT_WALL_X = 6.5;
const GOLD_CHANCE = 0.12;
const MAX_COINS = 100;

// ── Wood Texture ──────────────────────────────────────────────────────────────
function createWoodTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#7a4010";
  ctx.fillRect(0, 0, w, h);

  const grainCount = 28;
  for (let i = 0; i < grainCount; i++) {
    const y = (i / grainCount) * h;
    const isDark = i % 3 === 0;
    const isMid = i % 3 === 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 4) {
      const wave =
        Math.sin((x / w) * Math.PI * 4 + i * 1.3) * 3.5 +
        Math.sin((x / w) * Math.PI * 11 + i * 0.7) * 1.2;
      ctx.lineTo(x, y + wave);
    }
    ctx.strokeStyle = isDark ? "#4a2408" : isMid ? "#a05c20" : "#6a3610";
    ctx.lineWidth = isDark ? 1.8 : isMid ? 1.2 : 0.8;
    ctx.globalAlpha = isDark ? 0.55 : isMid ? 0.45 : 0.3;
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;

  const knots = [
    { x: 80, y: 55, rx: 11, ry: 7 },
    { x: 300, y: 30, rx: 9, ry: 6 },
    { x: 440, y: 85, rx: 13, ry: 8 },
  ];
  for (const k of knots) {
    ctx.beginPath();
    ctx.ellipse(k.x, k.y, k.rx + 3, k.ry + 3, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "#3a1a04";
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(k.x, k.y, k.rx, k.ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "#8a4e18";
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(30,10,2,0.25)");
  grad.addColorStop(0.2, "rgba(0,0,0,0)");
  grad.addColorStop(0.8, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(30,10,2,0.25)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 1);
  return texture;
}

// ── Coin Face Texture ─────────────────────────────────────────────────────────
function createCoinFaceTexture(isGold: boolean): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = isGold ? "#3a2200" : "#1a1a1a";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = isGold ? "#ffd700" : "#cccccc";
  ctx.lineWidth = 10;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r - 14, 0, Math.PI * 2);
  ctx.strokeStyle = isGold ? "#c8960a" : "#888888";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.font = "bold 110px serif";
  ctx.fillStyle = isGold ? "#ffe060" : "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("∞", cx, cy);

  return new THREE.CanvasTexture(canvas);
}

// ── Shared 3D Assets (module-level) ──────────────────────────────────────────
const coinGeom = new THREE.CylinderGeometry(COIN_R, COIN_R, 0.12, 24);

const regularFaceMat = new THREE.MeshStandardMaterial({
  map: createCoinFaceTexture(false),
  metalness: 0.7,
  roughness: 0.15,
});
const goldFaceMat = new THREE.MeshStandardMaterial({
  map: createCoinFaceTexture(true),
  metalness: 0.9,
  roughness: 0.05,
  emissive: new THREE.Color("#c8860a"),
  emissiveIntensity: 0.3,
});
const regularSideMat = new THREE.MeshStandardMaterial({
  color: "#d8d8d8",
  metalness: 1.0,
  roughness: 0.05,
});
const goldSideMat = new THREE.MeshStandardMaterial({
  color: "#ffe57a",
  metalness: 1.0,
  roughness: 0.05,
  emissive: new THREE.Color("#c8860a"),
  emissiveIntensity: 0.6,
});
const regularCoinMats: THREE.Material[] = [
  regularSideMat,
  regularFaceMat,
  regularFaceMat,
];
const goldCoinMats: THREE.Material[] = [goldSideMat, goldFaceMat, goldFaceMat];

const platformMat = new THREE.MeshStandardMaterial({
  color: "#1a0e08",
  roughness: 0.8,
  metalness: 0.4,
});
const wallMat = new THREE.MeshStandardMaterial({
  color: "#2a1808",
  roughness: 0.7,
  metalness: 0.5,
});
const woodTexture = createWoodTexture();
const pusherMat = new THREE.MeshStandardMaterial({
  map: woodTexture,
  color: "#c08040",
  roughness: 0.75,
  metalness: 0.0,
});
const collZoneMat = new THREE.MeshStandardMaterial({
  color: "#c49030",
  emissive: new THREE.Color("#c49030"),
  emissiveIntensity: 0.7,
  roughness: 0.2,
  metalness: 0.8,
});
const hiddenMat = new THREE.MeshBasicMaterial({
  visible: false,
  side: THREE.DoubleSide,
});

// ── Physics ───────────────────────────────────────────────────────────────────
function createSeedCoins(): CoinData[] {
  const coins: CoinData[] = [];
  let id = 0;
  const rows = 5;
  const cols = 9;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      coins.push({
        id: id++,
        x: -5.0 + c * 1.2 + (Math.random() - 0.5) * 0.3,
        z: -4.0 + r * 1.3 + (Math.random() - 0.5) * 0.3,
        vx: 0,
        vz: 0,
        ry: Math.random() * Math.PI * 2,
        isGold: Math.random() < GOLD_CHANCE,
        frozen: false,
      });
    }
  }
  return coins;
}

function runPhysics(state: GameState): CoinData[] {
  if (state.pusherDir === 1) {
    state.pusherZ += PUSHER_SPEED_FWD;
    if (state.pusherZ >= PUSHER_Z_MAX) state.pusherDir = -1;
  } else {
    state.pusherZ -= PUSHER_SPEED_BCK;
    if (state.pusherZ <= PUSHER_Z_MIN) state.pusherDir = 1;
  }

  const pusherFront = state.pusherZ + 0.4;
  const pusherBack = state.pusherZ - 0.4;

  for (const c of state.coins) {
    if (Math.abs(c.x) <= RIGHT_WALL_X) {
      const inContact = c.z - COIN_R < pusherFront && c.z + COIN_R > pusherBack;
      if (inContact) {
        if (c.frozen) {
          // Unfreeze when pusher makes contact during forward stroke
          if (state.pusherDir === 1) {
            c.frozen = false;
            c.z = pusherFront + COIN_R;
            c.vz = PUSHER_SPEED_FWD * 6 + 0.3;
          }
        } else if (state.pusherDir === 1) {
          c.z = pusherFront + COIN_R;
          c.vz = Math.max(c.vz, PUSHER_SPEED_FWD * 6 + 0.3);
        }
      }
    }
  }

  const toRemove = new Set<number>();
  for (const c of state.coins) {
    if (c.frozen) {
      // Frozen coins: only spin in place, no translation
      c.ry += 0.008;
      continue;
    }

    c.x += c.vx;
    c.z += c.vz;
    c.ry += 0.015;
    c.vx *= COIN_FRICTION;
    c.vz *= COIN_FRICTION;
    if (Math.abs(c.vx) < 0.001) c.vx = 0;
    if (Math.abs(c.vz) < 0.001) c.vz = 0;

    if (c.x - COIN_R < LEFT_WALL_X) {
      c.x = LEFT_WALL_X + COIN_R;
      c.vx = Math.abs(c.vx) * 0.5;
    }
    if (c.x + COIN_R > RIGHT_WALL_X) {
      c.x = RIGHT_WALL_X - COIN_R;
      c.vx = -Math.abs(c.vx) * 0.5;
    }
    if (c.z - COIN_R < BACK_WALL_Z) {
      c.z = BACK_WALL_Z + COIN_R;
      c.vz = Math.abs(c.vz) * 0.3;
    }
    if (c.z > COLLECTION_Z) toRemove.add(c.id);
  }

  // Coin-coin collisions (frozen coins act as immovable obstacles when hit by moving coins,
  // but moving coins can unfreeze frozen ones via chain push)
  for (let i = 0; i < state.coins.length; i++) {
    for (let j = i + 1; j < state.coins.length; j++) {
      const a = state.coins[i];
      const b = state.coins[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      const minD = COIN_R * 2;
      if (d2 < minD * minD && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        const ov = (minD - d) * 0.5;
        if (a.frozen && b.frozen) {
          // Both frozen: just separate positionally (stacking)
          a.x -= nx * ov;
          a.z -= nz * ov;
          b.x += nx * ov;
          b.z += nz * ov;
        } else if (a.frozen) {
          // Only b moves
          b.x += nx * ov * 2;
          b.z += nz * ov * 2;
          const dot = b.vx * nx + b.vz * nz;
          if (dot < 0) {
            b.vx -= dot * nx * 1.2;
            b.vz -= dot * nz * 1.2;
          }
        } else if (b.frozen) {
          // Only a moves
          a.x -= nx * ov * 2;
          a.z -= nz * ov * 2;
          const dot = a.vx * nx + a.vz * nz;
          if (dot > 0) {
            a.vx -= dot * nx * 1.2;
            a.vz -= dot * nz * 1.2;
          }
        } else {
          // Both moving
          a.x -= nx * ov;
          a.z -= nz * ov;
          b.x += nx * ov;
          b.z += nz * ov;
          const dvx = b.vx - a.vx;
          const dvz = b.vz - a.vz;
          const dot = dvx * nx + dvz * nz;
          if (dot < 0) {
            const imp = dot * 0.6;
            a.vx += imp * nx;
            a.vz += imp * nz;
            b.vx -= imp * nx;
            b.vz -= imp * nz;
          }
        }
      }
    }
  }

  const collected = state.coins.filter((c) => toRemove.has(c.id));
  state.coins = state.coins.filter((c) => !toRemove.has(c.id));
  return collected;
}

// ── 3D Sub-components ─────────────────────────────────────────────────────────
function Platform() {
  return (
    <group>
      <mesh receiveShadow castShadow material={platformMat}>
        <boxGeometry args={[14, 0.3, 16]} />
      </mesh>
      <mesh position={[-7.15, 0.45, 0]} castShadow material={wallMat}>
        <boxGeometry args={[0.3, 0.9, 16]} />
      </mesh>
      <mesh position={[7.15, 0.45, 0]} castShadow material={wallMat}>
        <boxGeometry args={[0.3, 0.9, 16]} />
      </mesh>
      <mesh position={[0, 0.45, -8.15]} castShadow material={wallMat}>
        <boxGeometry args={[14.6, 0.9, 0.3]} />
      </mesh>
      <mesh position={[0, 0.19, 7.7]} material={collZoneMat}>
        <boxGeometry args={[14, 0.08, 0.5]} />
      </mesh>
      {[-4, -2, 0, 2, 4].map((x) => (
        <mesh key={x} position={[x, 0.155, 0]}>
          <boxGeometry args={[0.03, 0.01, 15.8]} />
          <meshStandardMaterial color="#0e0805" roughness={1} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}

function RotatingGear({
  position,
  speed,
  size = 0.65,
}: {
  position: [number, number, number];
  speed: number;
  size?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.z += dt * speed;
  });
  return (
    <mesh ref={ref} position={position}>
      <torusGeometry args={[size, size * 0.26, 8, 14]} />
      <meshStandardMaterial
        color="#b07820"
        metalness={0.9}
        roughness={0.15}
        emissive="#5a3208"
        emissiveIntensity={0.25}
      />
    </mesh>
  );
}

function Decorations() {
  return (
    <group>
      <RotatingGear position={[-6.8, 1.05, -7.8]} speed={0.4} />
      <RotatingGear position={[6.8, 1.05, -7.8]} speed={-0.5} />
      <RotatingGear position={[-6.8, 1.05, 7.3]} speed={-0.38} />
      <RotatingGear position={[6.8, 1.05, 7.3]} speed={0.55} />
      <RotatingGear position={[0, 1.1, -8.1]} speed={0.3} size={0.45} />
      <RotatingGear position={[-3.5, 1.1, -8.1]} speed={-0.45} size={0.35} />
      <RotatingGear position={[3.5, 1.1, -8.1]} speed={0.5} size={0.35} />
      <mesh position={[-7.48, 1.15, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 15, 8]} />
        <meshStandardMaterial
          color="#5a3008"
          metalness={0.75}
          roughness={0.3}
        />
      </mesh>
      <mesh position={[7.48, 1.15, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 15, 8]} />
        <meshStandardMaterial
          color="#5a3008"
          metalness={0.75}
          roughness={0.3}
        />
      </mesh>
      {[-6, -2, 2, 6].map((z) => (
        <group key={z}>
          <mesh position={[-7.48, 1.15, z]}>
            <torusGeometry args={[0.11, 0.04, 6, 10]} />
            <meshStandardMaterial
              color="#8a5020"
              metalness={0.8}
              roughness={0.2}
            />
          </mesh>
          <mesh position={[7.48, 1.15, z]}>
            <torusGeometry args={[0.11, 0.04, 6, 10]} />
            <meshStandardMaterial
              color="#8a5020"
              metalness={0.8}
              roughness={0.2}
            />
          </mesh>
        </group>
      ))}
      <mesh position={[-3, 1.0, -8.15]}>
        <cylinderGeometry args={[0.13, 0.13, 1.5, 8]} />
        <meshStandardMaterial
          color="#6a3810"
          metalness={0.8}
          roughness={0.25}
        />
      </mesh>
      <mesh position={[3, 1.0, -8.15]}>
        <cylinderGeometry args={[0.13, 0.13, 1.5, 8]} />
        <meshStandardMaterial
          color="#6a3810"
          metalness={0.8}
          roughness={0.25}
        />
      </mesh>
    </group>
  );
}

function CameraLookAt() {
  const executed = useRef(false);
  useFrame(({ camera }) => {
    if (!executed.current) {
      camera.lookAt(0, 0, 0);
      executed.current = true;
    }
  });
  return null;
}

// ── Game Scene ────────────────────────────────────────────────────────────────
interface GameSceneProps {
  stateRef: React.MutableRefObject<GameState>;
  onScoreRef: React.MutableRefObject<
    (score: number, collected: CoinData[]) => void
  >;
  dropCoinRef: React.MutableRefObject<() => void>;
}

function GameScene({ stateRef, onScoreRef, dropCoinRef }: GameSceneProps) {
  const [coinsDisplay, setCoinsDisplay] = useState<CoinData[]>(() => {
    const seeds = createSeedCoins();
    stateRef.current.coins = seeds;
    stateRef.current.coinIdCounter = seeds.length;
    return seeds;
  });

  const coinMeshMap = useRef<Map<number, THREE.Mesh>>(new Map());
  const pusherRef = useRef<THREE.Mesh>(null);
  const coinsChangedRef = useRef(false);

  const spawnCoinAt = useCallback(
    (cx: number) => {
      const state = stateRef.current;
      if (state.coins.length >= MAX_COINS) return;
      // Find how many frozen coins are already stacked at this x region
      // Stack them slightly offset so they don't perfectly overlap
      const frozenAtBack = state.coins.filter(
        (c) => c.frozen && Math.abs(c.x - cx) < COIN_R * 3,
      );
      const stackOffset = frozenAtBack.length * 0.05;
      state.coins.push({
        id: state.coinIdCounter++,
        x: Math.max(
          LEFT_WALL_X + COIN_R + 0.05,
          Math.min(RIGHT_WALL_X - COIN_R - 0.05, cx),
        ),
        z: BACK_WALL_Z + COIN_R + 0.1 + stackOffset,
        vx: 0,
        vz: 0,
        ry: Math.random() * Math.PI * 2,
        isGold: Math.random() < GOLD_CHANCE,
        frozen: true,
      });
      coinsChangedRef.current = true;
    },
    [stateRef],
  );

  dropCoinRef.current = useCallback(() => {
    const randomX =
      LEFT_WALL_X +
      COIN_R +
      0.05 +
      Math.random() * (RIGHT_WALL_X - LEFT_WALL_X - (COIN_R + 0.05) * 2);
    spawnCoinAt(randomX);
  }, [spawnCoinAt]);

  const handleClick = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      spawnCoinAt(e.point.x);
    },
    [spawnCoinAt],
  );

  useFrame(() => {
    const state = stateRef.current;
    state.frame++;

    const collected = runPhysics(state);

    if (collected.length > 0) {
      coinsChangedRef.current = true;
      for (const c of collected) state.score += c.isGold ? 5 : 1;
      onScoreRef.current(state.score, collected);
    }

    if (pusherRef.current) {
      pusherRef.current.position.z = state.pusherZ;
    }
    for (const c of state.coins) {
      const m = coinMeshMap.current.get(c.id);
      if (m) {
        m.position.x = c.x;
        m.position.z = c.z;
        m.rotation.y = c.ry;
      }
    }

    if (coinsChangedRef.current) {
      setCoinsDisplay([...state.coins]);
      coinsChangedRef.current = false;
    }

    if (state.frame % 30 === 0) {
      onScoreRef.current(state.score, []);
    }
  });

  return (
    <>
      <CameraLookAt />

      <ambientLight intensity={0.45} color="#d4a060" />

      <directionalLight
        position={[4, 14, 8]}
        intensity={1.5}
        color="#e0c060"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5}
        shadow-camera-far={60}
        shadow-camera-left={-13}
        shadow-camera-right={13}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
      />

      <pointLight
        position={[0, 1.5, 7.8]}
        intensity={3}
        color="#c49030"
        distance={10}
        decay={2}
      />

      <pointLight
        position={[0, 4, -7]}
        intensity={0.9}
        color="#8a4e18"
        distance={13}
        decay={2}
      />

      <pointLight
        position={[-7, 2, 0]}
        intensity={0.5}
        color="#c07020"
        distance={8}
        decay={2}
      />
      <pointLight
        position={[7, 2, 0]}
        intensity={0.5}
        color="#c07020"
        distance={8}
        decay={2}
      />

      <Platform />

      <mesh
        ref={pusherRef}
        position={[0, 0.45, PUSHER_Z_MIN]}
        castShadow
        material={pusherMat}
      >
        <boxGeometry args={[13.5, 0.5, 0.8]} />
      </mesh>

      <Decorations />

      <mesh
        position={[0, 0.16, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={handleClick}
        material={hiddenMat}
      >
        <planeGeometry args={[14, 16]} />
      </mesh>

      {/* Coins */}
      {coinsDisplay.map((c) => (
        <mesh
          key={c.id}
          ref={(el) => {
            if (el) coinMeshMap.current.set(c.id, el);
            else coinMeshMap.current.delete(c.id);
          }}
          position={[c.x, 0.22, c.z]}
          rotation={[0, c.ry, 0]}
          geometry={coinGeom}
          material={c.isGold ? goldCoinMats : regularCoinMats}
          castShadow
          receiveShadow
        />
      ))}
    </>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────
let floatCounter = 0;

export function CoinPusherGame() {
  const stateRef = useRef<GameState>({
    coins: [],
    pusherZ: PUSHER_Z_MIN,
    pusherDir: 1,
    score: 0,
    coinIdCounter: 0,
    frame: 0,
  });

  const [displayScore, setDisplayScore] = useState(0);
  const [displayHigh, setDisplayHigh] = useState(0);
  const [floatItems, setFloatItems] = useState<FloatItem[]>([]);

  const { data: backendHigh } = useGetHighScore();
  const { mutate: saveHighScore } = useSetHighScore();
  const backendHighNum = backendHigh ? Number(backendHigh) : 0;

  useEffect(() => {
    setDisplayHigh((prev) => Math.max(prev, backendHighNum));
  }, [backendHighNum]);

  const onScoreRef = useRef<(score: number, collected: CoinData[]) => void>(
    () => {},
  );
  onScoreRef.current = (score: number, collected: CoinData[]) => {
    setDisplayScore(score);
    if (score > 0) {
      setDisplayHigh((prev) => {
        const newHigh = Math.max(prev, backendHighNum, score);
        if (score > backendHighNum && score > prev) saveHighScore(score);
        return newHigh;
      });
    }
    if (collected.length > 0) {
      const newFloats: FloatItem[] = collected.map((c) => ({
        id: floatCounter++,
        text: c.isGold ? "+5" : "+1",
        isGold: c.isGold,
      }));
      setFloatItems((prev) => [...prev.slice(-5), ...newFloats]);
      const count = newFloats.length;
      setTimeout(() => setFloatItems((prev) => prev.slice(count)), 1500);
    }
  };

  const dropCoinRef = useRef<() => void>(() => {});

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ background: "#0a0503", cursor: "crosshair" }}
    >
      {/* ── Title ── */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 flex flex-col items-center pt-2 z-10">
        <h1
          style={{
            fontFamily: "'Playfair Display', serif",
            color: "#d4a840",
            textShadow:
              "0 0 14px rgba(200,150,40,0.75), 0 0 30px rgba(180,120,20,0.4)",
            fontSize: "clamp(12px, 2vw, 20px)",
            letterSpacing: "0.14em",
            margin: 0,
            fontWeight: 700,
          }}
        >
          ⚙ STEAMPUNK COIN PUSHER ⚙
        </h1>
        <p
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            color: "rgba(180,140,60,0.6)",
            fontSize: "clamp(7px, 1vw, 10px)",
            margin: "2px 0 0",
            letterSpacing: "0.12em",
          }}
        >
          CLICK THE PLATFORM OR BUTTON TO DROP COINS
        </p>
      </div>

      {/* ── Score Panel ── */}
      <div
        data-ocid="game.score.panel"
        className="pointer-events-none absolute top-2 left-2 z-10"
        style={{
          background: "rgba(10,5,1,0.93)",
          border: "1.5px solid #906820",
          borderRadius: "3px",
          padding: "5px 14px 8px",
          boxShadow:
            "0 0 14px rgba(140,90,10,0.35), inset 0 1px 0 rgba(220,170,60,0.12)",
          minWidth: "120px",
        }}
      >
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            color: "#7a5a18",
            fontSize: "9px",
            letterSpacing: "0.18em",
          }}
        >
          SCORE
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            color: "#e0b840",
            fontSize: "22px",
            fontWeight: "bold",
            textShadow: "0 0 8px rgba(200,160,40,0.6)",
            lineHeight: 1.1,
          }}
        >
          {displayScore.toString().padStart(6, "0")}
        </div>
        <div style={{ position: "relative", height: "22px", marginTop: "2px" }}>
          {floatItems.map((fi) => (
            <span
              key={fi.id}
              style={{
                position: "absolute",
                left: "2px",
                top: 0,
                fontFamily: "'JetBrains Mono', monospace",
                color: fi.isGold ? "#ffe060" : "#e0c040",
                fontSize: fi.isGold ? "16px" : "14px",
                fontWeight: "bold",
                textShadow: fi.isGold
                  ? "0 0 10px rgba(255,210,40,0.95)"
                  : "0 0 8px rgba(200,160,40,0.75)",
                animation: "floatUp 1.5s ease-out forwards",
                pointerEvents: "none",
                whiteSpace: "nowrap",
              }}
            >
              {fi.text}
            </span>
          ))}
        </div>
      </div>

      {/* ── High Score Panel ── */}
      <div
        data-ocid="game.highscore.panel"
        className="pointer-events-none absolute top-2 right-2 z-10"
        style={{
          background: "rgba(10,5,1,0.93)",
          border: "1.5px solid #b07530",
          borderRadius: "3px",
          padding: "5px 14px 8px",
          textAlign: "right",
          boxShadow:
            "0 0 14px rgba(180,110,10,0.35), inset 0 1px 0 rgba(220,170,60,0.12)",
          minWidth: "120px",
        }}
      >
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            color: "#7a5a18",
            fontSize: "9px",
            letterSpacing: "0.18em",
          }}
        >
          HIGH SCORE
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            color: "#ffd060",
            fontSize: "22px",
            fontWeight: "bold",
            textShadow: "0 0 12px rgba(240,190,60,0.75)",
            lineHeight: 1.1,
          }}
        >
          {displayHigh.toString().padStart(6, "0")}
        </div>
      </div>

      {/* ── Drop Coin Button ── */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10">
        <button
          type="button"
          data-ocid="game.drop_coin.primary_button"
          onClick={() => dropCoinRef.current()}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            background: "linear-gradient(180deg, #c49030 0%, #8a5a10 100%)",
            border: "2px solid #e0b840",
            borderRadius: "4px",
            color: "#0a0503",
            fontSize: "clamp(11px, 1.5vw, 14px)",
            fontWeight: "bold",
            letterSpacing: "0.15em",
            padding: "10px 28px",
            cursor: "pointer",
            boxShadow:
              "0 0 18px rgba(196,144,48,0.55), inset 0 1px 0 rgba(255,220,100,0.3)",
            textShadow: "0 1px 2px rgba(255,220,80,0.4)",
            transition: "transform 0.08s, box-shadow 0.08s",
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = "scale(0.96)";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = "scale(1)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          ⚙ DROP COIN
        </button>
      </div>

      {/* ── 3D Canvas ── */}
      <div data-ocid="game.canvas_target" className="absolute inset-0">
        <Canvas
          shadows
          gl={{
            antialias: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.15,
          }}
          camera={{ position: [0, 14, 12], fov: 50, near: 0.1, far: 100 }}
        >
          <GameScene
            stateRef={stateRef}
            onScoreRef={onScoreRef}
            dropCoinRef={dropCoinRef}
          />
        </Canvas>
      </div>

      {/* ── Footer ── */}
      <div
        className="pointer-events-none absolute bottom-1 right-2 z-10"
        style={{
          color: "#c49030",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "9px",
          opacity: 0.28,
        }}
      >
        © {new Date().getFullYear()}. Built with ♥ using{" "}
        <a
          href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
          className="pointer-events-auto underline"
          target="_blank"
          rel="noreferrer"
          style={{ color: "#c49030" }}
        >
          caffeine.ai
        </a>
      </div>
    </div>
  );
}
