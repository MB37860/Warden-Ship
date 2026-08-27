import { useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import useWebGLAvailable from "../../hooks/useWebGLAvailable";
import HoverMenu from "./HoverMenu";
import styles from "./Chest.module.css";
import cannonModel from "../../assets/models/cannon.glb";
import cannon2dImage from "../../assets/sprites/cannon.png";

const FLOOR_Y = -0.18;

function setupLongTaskObserver() {
  if (typeof window === "undefined" || window.__imageVaultLongTaskObserver) {
    return;
  }
  if (typeof PerformanceObserver === "undefined") {
    return;
  }

  try {
    window.__imageVaultLongTasks = [];
    const observer = new PerformanceObserver((list) => {
      window.__imageVaultLongTasks.push(
        ...list.getEntries().map((entry) => ({
          startTime: Math.round(entry.startTime),
          duration: Math.round(entry.duration),
          name: entry.name,
        })),
      );
      window.__imageVaultLongTasks = window.__imageVaultLongTasks.slice(-30);
    });
    observer.observe({ entryTypes: ["longtask"] });
    window.__imageVaultLongTaskObserver = observer;
  } catch {
    window.__imageVaultLongTaskObserver = "unsupported";
  }
}

function ScenePerformanceMonitor({ viewMode }) {
  const { gl, scene } = useThree();
  const frameCount = useRef(0);
  const totalFrameMs = useRef(0);
  const lastReport = useRef(0);

  useEffect(() => {
    lastReport.current = performance.now();
    setupLongTaskObserver();
  }, []);

  useFrame((state, delta) => {
    frameCount.current += 1;
    totalFrameMs.current += delta * 1000;

    const now = performance.now();
    if (now - lastReport.current < 3000) {
      return;
    }

    let meshCount = 0;
    scene.traverse((object) => {
      if (object.isMesh) {
        meshCount += 1;
      }
    });

    const avgFrameMs = totalFrameMs.current / Math.max(1, frameCount.current);
    const report = {
      view: viewMode,
      fps: Math.round(1000 / Math.max(1, avgFrameMs)),
      avgFrameMs: Number(avgFrameMs.toFixed(1)),
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      meshes: meshCount,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      longTasks: window.__imageVaultLongTasks?.slice(-5) || [],
    };

    window.__imageVaultPerf = report;
    if (import.meta.env.DEV) {
      console.info("[ImageVault perf]", report);
    }

    frameCount.current = 0;
    totalFrameMs.current = 0;
    lastReport.current = now;
  });

  return null;
}

function seededRandom(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function buildWoodTexture() {
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, "#734626");
  base.addColorStop(0.5, "#5b341b");
  base.addColorStop(1, "#3f2413");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y += 2) {
    const strength = 0.08 + seededRandom(y + 13) * 0.16;
    ctx.fillStyle = `rgba(20, 11, 6, ${strength})`;
    const drift = Math.sin(y * 0.035) * 14 + Math.sin(y * 0.011) * 8;
    ctx.fillRect(drift, y, size, 1);
  }

  for (let i = 0; i < 420; i += 1) {
    const x = seededRandom(i * 1.1 + 7) * size;
    const y = seededRandom(i * 1.7 + 31) * size;
    const alpha = 0.02 + seededRandom(i * 3.3 + 41) * 0.05;
    ctx.fillStyle = `rgba(245, 210, 160, ${alpha})`;
    ctx.fillRect(x, y, 1.2, 1.2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.2, 1.2);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function buildMetalTexture() {
  const size = 160;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, "#9f8356");
  base.addColorStop(0.45, "#78603c");
  base.addColorStop(1, "#56462f");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 360; i += 1) {
    const x = seededRandom(i * 4.21 + 3) * size;
    const y = seededRandom(i * 1.92 + 9) * size;
    const w = 2 + seededRandom(i * 2.11 + 21) * 5;
    const a = 0.03 + seededRandom(i * 3.17 + 51) * 0.12;
    ctx.fillStyle = `rgba(210, 190, 160, ${a})`;
    ctx.fillRect(x, y, w, 1);
  }

  for (let i = 0; i < 120; i += 1) {
    const x = seededRandom(i * 8.2 + 77) * size;
    const y = seededRandom(i * 5.7 + 17) * size;
    const r = 0.4 + seededRandom(i * 1.4 + 4) * 1.3;
    ctx.fillStyle = "rgba(60, 42, 24, 0.16)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3.2, 2.5);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function buildLeatherTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#442518";
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 220; i += 1) {
    const x = seededRandom(i * 2.3 + 2) * size;
    const y = seededRandom(i * 7.7 + 13) * size;
    const r = 0.3 + seededRandom(i * 0.7 + 19) * 1.8;
    const shade = 35 + Math.floor(seededRandom(i * 4.1 + 23) * 35);
    ctx.fillStyle = `hsla(19, 34%, ${shade}%, 0.16)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.2, 1.8);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function buildContactShadowTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.1,
    size / 2,
    size / 2,
    size * 0.5,
  );
  gradient.addColorStop(0, "rgba(0,0,0,0.68)");
  gradient.addColorStop(0.45, "rgba(0,0,0,0.34)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Sky visible through portholes – change this to taste (e.g. night: "#0a0d1a", dawn: "#ff7040", day: "#5090e0")
const PORTHOLE_SKY_COLOR = "#2a4a72"; // moonlit night sky – change to "#87ceeb" for day, "#ff7040" for dawn
const PORTHOLE_X_POSITIONS = [11, 18.5, 26];
const PORTHOLE_Y = 1.8;
const PORTHOLE_Z = 10;

function RoomShell() {
  const horizontalLevels = [1.2, 2.3, 3.4, 4.5, 5.6, 6.7];
  const verticalBack = [-8.2, -5.4, -2.7, 0, 2.7, 5.4, 8.2, 11.2, 14.2, 17.2, 20.2, 23.2, 26.2, 29.2];
  const sideDepth = [-10, -5, 0, 5, 10];
  const cannonPorts = PORTHOLE_X_POSITIONS; // driven by global constant

  return (
    <group>
      <mesh
        position={[10.1, -0.18, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[40, 20]} />
        <meshStandardMaterial
          color="#2e1b0c"
          roughness={0.95}
          metalness={0.05}
        />
      </mesh>

      {Array.from({ length: 13 }).map((_, index) => (
        <mesh
          key={`plank-${index}`}
          position={[10.1, -0.17, index * 1.6 - 9.6]}
          receiveShadow
        >
          <boxGeometry args={[40, 0.02, 0.06]} />
          <meshStandardMaterial
            color="#3f2a16"
            roughness={0.8}
            metalness={0.1}
          />
        </mesh>
      ))}

      <mesh position={[10.1, 4.3, -10]} receiveShadow>
        <boxGeometry args={[40, 9, 0.4]} />
        <meshStandardMaterial
          color="#1f130a"
          roughness={0.88}
          metalness={0.08}
        />
      </mesh>

      {/* Front wall at z=+10, split into segments around porthole holes.
           Hole radius 0.75, center y=1.8 → hole y: 1.05..2.55
           Hole x ±0.75: 10.25..11.75, 19.25..20.75, 25.25..26.75 */}
      {/* Bottom strip – full width below holes: y=-0.2..1.05 */}
      <mesh position={[10.1, 0.425, 10]} receiveShadow>
        <boxGeometry args={[40, 1.25, 0.4]} />
        <meshStandardMaterial color="#1f130a" roughness={0.88} metalness={0.08} />
      </mesh>
      {/* Top strip – full width above holes: y=2.55..8.8 */}
      <mesh position={[10.1, 5.675, 10]} receiveShadow>
        <boxGeometry args={[40, 6.25, 0.4]} />
        <meshStandardMaterial color="#1f130a" roughness={0.88} metalness={0.08} />
      </mesh>
      {/* Middle band – left of x=11 hole: x=-9.9..10.25 */}
      <mesh position={[0.175, 1.8, 10]} receiveShadow>
        <boxGeometry args={[20.15, 1.5, 0.4]} />
        <meshStandardMaterial color="#1f130a" roughness={0.88} metalness={0.08} />
      </mesh>
      {/* Middle band – between x=11 and x=18.5 holes: x=11.75..17.75 */}
      <mesh position={[14.75, 1.8, 10]} receiveShadow>
        <boxGeometry args={[6, 1.5, 0.4]} />
        <meshStandardMaterial color="#1f130a" roughness={0.88} metalness={0.08} />
      </mesh>
      {/* Middle band – between x=18.5 and x=26 holes: x=19.25..25.25 */}
      <mesh position={[22.25, 1.8, 10]} receiveShadow>
        <boxGeometry args={[6, 1.5, 0.4]} />
        <meshStandardMaterial color="#1f130a" roughness={0.88} metalness={0.08} />
      </mesh>
      {/* Middle band – right of x=26 hole: x=26.75..30.1 */}
      <mesh position={[28.425, 1.8, 10]} receiveShadow>
        <boxGeometry args={[3.35, 1.5, 0.4]} />
        <meshStandardMaterial color="#1f130a" roughness={0.88} metalness={0.08} />
      </mesh>

      <mesh
        position={[-9.8, 4.3, 0]}
        rotation={[0, Math.PI / 2, 0]}
        receiveShadow
      >
        <boxGeometry args={[20, 9, 0.4]} />
        <meshStandardMaterial
          color="#1a1008"
          roughness={0.9}
          metalness={0.08}
        />
      </mesh>

      <mesh
        position={[30, 4.3, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        receiveShadow
      >
        <boxGeometry args={[20, 9, 0.4]} />
        <meshStandardMaterial
          color="#1a1008"
          roughness={0.9}
          metalness={0.08}
        />
      </mesh>

      {[-7.7, -3.8, 0, 3.8, 7.7, 11.6, 14.6, 17.6, 20.6, 23.6, 27.6].map((x) => (
        <group key={`pillar-${x}`}>
          <mesh position={[x, 4.3, -9.5]} receiveShadow>
            <boxGeometry args={[0.22, 9, 0.45]} />
            <meshStandardMaterial color="#402714" roughness={0.65} metalness={0.18} />
          </mesh>
          <mesh position={[x, 4.3, 9.5]} receiveShadow>
            <boxGeometry args={[0.22, 9, 0.45]} />
            <meshStandardMaterial color="#402714" roughness={0.65} metalness={0.18} />
          </mesh>
        </group>
      ))}

      {horizontalLevels.map((y) => (
        <group key={`back-h-${y}`}>
          <mesh position={[10.1, y, -9.55]}>
            <boxGeometry args={[39.6, 0.03, 0.03]} />
            <meshStandardMaterial color="#090807" roughness={0.45} metalness={0.2} />
          </mesh>
          <mesh position={[10.1, y, 9.55]}>
            <boxGeometry args={[39.6, 0.03, 0.03]} />
            <meshStandardMaterial color="#090807" roughness={0.45} metalness={0.2} />
          </mesh>
        </group>
      ))}

      {verticalBack.map((x) => (
        <group key={`back-v-${x}`}>
          <mesh position={[x, 4.35, -9.55]}>
            <boxGeometry args={[0.03, 8.7, 0.03]} />
            <meshStandardMaterial color="#0d0b09" roughness={0.45} metalness={0.2} />
          </mesh>
          <mesh position={[x, 4.35, 9.55]}>
            <boxGeometry args={[0.03, 8.7, 0.03]} />
            <meshStandardMaterial color="#0d0b09" roughness={0.45} metalness={0.2} />
          </mesh>
        </group>
      ))}

      {horizontalLevels.map((y) => (
        <group key={`side-h-${y}`}>
          <mesh position={[-9.57, y, 0]} rotation={[0, Math.PI / 2, 0]}>
            <boxGeometry args={[20, 0.03, 0.03]} />
            <meshStandardMaterial
              color="#0a0908"
              roughness={0.45}
              metalness={0.2}
            />
          </mesh>
          <mesh position={[29.87, y, 0]} rotation={[0, -Math.PI / 2, 0]}>
            <boxGeometry args={[20, 0.03, 0.03]} />
            <meshStandardMaterial
              color="#0a0908"
              roughness={0.45}
              metalness={0.2}
            />
          </mesh>
        </group>
      ))}

      {sideDepth.map((z) => (
        <group key={`side-v-${z}`}>
          <mesh position={[-9.57, 4.35, z]}>
            <boxGeometry args={[0.03, 8.7, 0.03]} />
            <meshStandardMaterial
              color="#0f0d0b"
              roughness={0.45}
              metalness={0.2}
            />
          </mesh>
          <mesh position={[29.87, 4.35, z]}>
            <boxGeometry args={[0.03, 8.7, 0.03]} />
            <meshStandardMaterial
              color="#0f0d0b"
              roughness={0.45}
              metalness={0.2}
            />
          </mesh>
        </group>
      ))}

      {/* Cannon portholes recessed inside wall z=9.75, so ring sits in the wall thickness */}
      {cannonPorts.map((x) => (
        // Group centered at wall centre so the cylinder sits fully inside the wall (z=9.8..10.2)
        <group key={`cannon-port-${x}`} position={[x, PORTHOLE_Y, PORTHOLE_Z]}>
          {/* Cylindrical bore through the wall – open tube, double-sided so inner surface is visible */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.64, 0.64, 0.38, 48, 1, true]} />
            <meshStandardMaterial color="#08090b" roughness={0.98} metalness={0} side={2} />
          </mesh>

          {/* Closed exterior end-cap (the "bottom" of the hole) – sky coloured emissive disk */}
          <mesh position={[0, 0, 0.2]}>
            <circleGeometry args={[0.64, 48]} />
            <meshBasicMaterial color="#4a6e96" />
          </mesh>

          {/* Bronze iron ring at the interior (room-side) face framing the opening */}
          <mesh position={[0, 0, -0.19]}>
            <torusGeometry args={[0.70, 0.07, 14, 56]} />
            <meshStandardMaterial color="#7f633f" roughness={0.38} metalness={0.72} />
          </mesh>

          {/* Billboard glow – always faces camera so the bright daylight circle is visible at any angle */}
          <sprite position={[0, 0, 0.1]} scale={[1.1, 1.1, 1]}>
            <spriteMaterial color="#5a7fa8" opacity={0.88} transparent />
          </sprite>

          {/* Bronze iron ring at the exterior face */}
          <mesh position={[0, 0, 0.2]}>
            <torusGeometry args={[0.70, 0.07, 14, 56]} />
            <meshStandardMaterial color="#7f633f" roughness={0.38} metalness={0.72} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function ChestModel({ phase, hasZip, onHoverChange, onChestClick }) {
  const chestRef = useRef(null);
  const lidRef = useRef(null);
  const lockRef = useRef(null);
  const glowRef = useRef(null);
  const cargoGroupRef = useRef(null);
  const strutRefLeft = useRef(null);
  const strutRefRight = useRef(null);
  const pistonRefLeft = useRef(null);
  const pistonRefRight = useRef(null);
  const openT = useRef(0);
  const cargoT = useRef(0);
  const targetOpen = phase === "idle" ? 0 : 1;
  const woodTexture = useMemo(() => buildWoodTexture(), []);
  const metalTexture = useMemo(() => buildMetalTexture(), []);
  const leatherTexture = useMemo(() => buildLeatherTexture(), []);
  const contactShadowTexture = useMemo(() => buildContactShadowTexture(), []);

  useEffect(() => {
    return () => {
      woodTexture.dispose();
      metalTexture.dispose();
      leatherTexture.dispose();
      contactShadowTexture.dispose();
    };
  }, [woodTexture, metalTexture, leatherTexture, contactShadowTexture]);

  const cornerPlates = useMemo(
    () => [
      [1.19, 0.24, 0.79],
      [-1.19, 0.24, 0.79],
      [1.19, 0.24, -0.79],
      [-1.19, 0.24, -0.79],
    ],
    [],
  );

  const rivets = useMemo(() => {
    const points = [];
    const xs = [-1.12, -0.36, 0.36, 1.12];
    const ys = [0.34, 0.92];
    for (const x of xs) {
      for (const y of ys) {
        points.push([x, y, 0.78]);
      }
    }
    return points;
  }, []);

  const rivetHeads = useMemo(
    () =>
      rivets.map((position, index) => ({
        position,
        slotRotation: seededRandom(index + 81) * Math.PI,
        depthOffset: (seededRandom(index + 133) - 0.5) * 0.005,
      })),
    [rivets],
  );

  const cornerPlateTweaks = useMemo(
    () =>
      cornerPlates.map((position, index) => ({
        position,
        rz: (seededRandom(index + 171) - 0.5) * 0.08,
        ry: (seededRandom(index + 211) - 0.5) * 0.04,
      })),
    [cornerPlates],
  );

  const handleConfigs = useMemo(
    () => [
      {
        side: "left",
        x: -1.36,
        y: 0.586,
        z: -0.012,
        tilt: 0.058,
        ringScale: 1.03,
        ringOffsetY: -0.048,
      },
    ],
    [],
  );

  const cargoCards = useMemo(
    () => [
      { x: -0.5, y: 0.06, z: -0.22, rx: 0.08, ry: 0.3, s: 0.9, seed: 1 },
      { x: -0.14, y: 0.11, z: -0.08, rx: -0.12, ry: 0.42, s: 1, seed: 2 },
      { x: 0.24, y: 0.07, z: -0.2, rx: 0.14, ry: -0.25, s: 0.95, seed: 3 },
    ],
    [],
  );

  useFrame((state, delta) => {
    if (!chestRef.current || !lidRef.current || !lockRef.current) {
      return;
    }

    openT.current = THREE.MathUtils.damp(openT.current, targetOpen, 4.2, delta);

    const liftPhase = THREE.MathUtils.smoothstep(openT.current, 0.02, 0.22);
    const swingPhase = THREE.MathUtils.smoothstep(openT.current, 0.14, 1);
    const overshoot = Math.sin(swingPhase * Math.PI) * 0.08;

    lidRef.current.position.y = 1.1 + liftPhase * 0.07;
    lidRef.current.rotation.x = -(
      swingPhase * 1.3 +
      overshoot * (1 - swingPhase * 0.4)
    );

    chestRef.current.position.y = FLOOR_Y;
    chestRef.current.rotation.y =
      Math.sin(state.clock.elapsedTime * 0.3) * 0.01;

    const unlockPop = Math.sin(liftPhase * Math.PI);
    lockRef.current.position.y = -unlockPop * 0.035;
    lockRef.current.rotation.x = unlockPop * 0.14;

    const hingeAngle = lidRef.current.rotation.x;
    const strutAngle = 0.16 - hingeAngle * 0.58;
    const pistonAngle = 0.34 - hingeAngle * 0.78;

    if (strutRefLeft.current && strutRefRight.current) {
      strutRefLeft.current.rotation.z = strutAngle;
      strutRefRight.current.rotation.z = -strutAngle;
    }

    if (pistonRefLeft.current && pistonRefRight.current) {
      pistonRefLeft.current.rotation.z = pistonAngle;
      pistonRefRight.current.rotation.z = -pistonAngle;

      const slide = THREE.MathUtils.clamp(openT.current * 0.13, 0, 0.13);
      pistonRefLeft.current.position.y = 0.94 + slide;
      pistonRefRight.current.position.y = 0.94 + slide;
    }

    const archiveActive = phase === "opening" || phase === "ready";
    const cargoTarget = hasZip ? swingPhase : 0;
    cargoT.current = THREE.MathUtils.damp(
      cargoT.current,
      cargoTarget,
      3.4,
      delta,
    );

    if (cargoGroupRef.current) {
      cargoGroupRef.current.position.y =
        0.39 +
        cargoT.current * 0.16 +
        Math.sin(state.clock.elapsedTime * 1.6) * 0.01;
      cargoGroupRef.current.rotation.y = state.clock.elapsedTime * 0.12;
      const cargoScale = 0.35 + cargoT.current * 0.72;
      cargoGroupRef.current.scale.set(cargoScale, cargoScale, cargoScale);
      cargoGroupRef.current.visible = cargoT.current > 0.04;
    }

    if (!glowRef.current) {
      return;
    }

    const t = state.clock.elapsedTime;
    const candleFlicker =
      0.68 +
      Math.sin(t * 7.4) * 0.16 +
      Math.sin(t * 13.7 + 0.8) * 0.09 +
      Math.sin(t * 29.1 + 2.3) * 0.05;
    const glowPulse = archiveActive ? candleFlicker * 0.28 * swingPhase : 0;
    glowRef.current.material.emissiveIntensity = archiveActive
      ? 0.55 + swingPhase * 1.75 + glowPulse
      : 0.12 + cargoT.current * 0.34;
    glowRef.current.material.opacity =
      0.1 + cargoT.current * (0.42 + candleFlicker * 0.08);
  });

  return (
    <group
      ref={chestRef}
      onPointerOver={() => onHoverChange(true)}
      onPointerOut={() => onHoverChange(false)}
      onPointerDown={(event) => {
        event.stopPropagation();
        onChestClick();
      }}
      castShadow
    >
      <mesh
        position={[0, 0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[3.4, 2.4]} />
        <meshStandardMaterial
          color="#100c08"
          map={contactShadowTexture}
          roughness={1}
          metalness={0}
          transparent
          opacity={0.86}
          depthWrite={false}
        />
      </mesh>

      <mesh
        position={[0, 0.013, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <ringGeometry args={[1.15, 1.62, 60]} />
        <meshStandardMaterial
          color="#1a130d"
          roughness={0.92}
          metalness={0.04}
          transparent
          opacity={0.34}
        />
      </mesh>

      {[
        [1.08, 0.06, 0.55],
        [-1.08, 0.06, 0.55],
        [1.08, 0.06, -0.55],
        [-1.08, 0.06, -0.55],
      ].map((position, index) => (
        <mesh
          key={`foot-${index}`}
          position={position}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[0.26, 0.12, 0.24]} />
          <meshPhysicalMaterial
            color="#2d1a0f"
            map={woodTexture}
            roughness={0.8}
            metalness={0.08}
            clearcoat={0.12}
          />
        </mesh>
      ))}

      <mesh position={[0, 0.17, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.62, 0.16, 1.54]} />
        <meshPhysicalMaterial
          color="#3b2414"
          map={woodTexture}
          roughness={0.75}
          metalness={0.09}
          clearcoat={0.2}
          clearcoatRoughness={0.72}
        />
      </mesh>

      {[
        [0, 0.64, 0.64, 2.56, 0.82, 0.18],
        [0, 0.64, -0.64, 2.56, 0.82, 0.18],
        [1.15, 0.64, 0, 0.1, 0.82, 1.26],
        [-1.15, 0.64, 0, 0.1, 0.82, 1.26],
      ].map((wall, index) => (
        <mesh
          key={`body-wall-${index}`}
          position={[wall[0], wall[1], wall[2]]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[wall[3], wall[4], wall[5]]} />
          <meshPhysicalMaterial
            color="#664024"
            map={woodTexture}
            roughness={0.68}
            metalness={0.08}
            clearcoat={0.24}
            clearcoatRoughness={0.64}
          />
        </mesh>
      ))}

      {[
        [0, 1.05, 0.67, 2.58, 0.06, 0.16],
        [0, 1.05, -0.67, 2.58, 0.06, 0.16],
        [1.25, 1.05, 0, 0.08, 0.06, 1.34],
        [-1.25, 1.05, 0, 0.08, 0.06, 1.34],
      ].map((rim, index) => (
        <mesh
          key={`top-rim-${index}`}
          position={[rim[0], rim[1], rim[2]]}
          castShadow
        >
          <boxGeometry args={[rim[3], rim[4], rim[5]]} />
          <meshPhysicalMaterial
            color="#7e502f"
            map={woodTexture}
            roughness={0.56}
            metalness={0.06}
            clearcoat={0.25}
            clearcoatRoughness={0.55}
          />
        </mesh>
      ))}

      <mesh position={[0, 1.115, 0.63]} castShadow>
        <boxGeometry args={[2.5, 0.014, 0.12]} />
        <meshStandardMaterial
          color="#23170e"
          roughness={0.93}
          metalness={0.04}
        />
      </mesh>

      <mesh position={[0, 1.115, -0.63]} castShadow>
        <boxGeometry args={[2.5, 0.014, 0.12]} />
        <meshStandardMaterial
          color="#23170e"
          roughness={0.93}
          metalness={0.04}
        />
      </mesh>

      <mesh position={[1.16, 1.115, 0]} castShadow>
        <boxGeometry args={[0.18, 0.014, 1.14]} />
        <meshStandardMaterial
          color="#23170e"
          roughness={0.93}
          metalness={0.04}
        />
      </mesh>

      <mesh position={[-1.16, 1.115, 0]} castShadow>
        <boxGeometry args={[0.18, 0.014, 1.14]} />
        <meshStandardMaterial
          color="#23170e"
          roughness={0.93}
          metalness={0.04}
        />
      </mesh>

      <mesh position={[0, 1.12, 0.788]} castShadow>
        <boxGeometry args={[2.48, 0.012, 0.012]} />
        <meshStandardMaterial
          color="#16100b"
          roughness={0.96}
          metalness={0.02}
        />
      </mesh>

      {[
        [0, 1.095, 0.785, 2.6, 0.016, 0.018],
        [0, 1.095, -0.785, 2.6, 0.016, 0.018],
        [1.305, 1.095, 0, 0.018, 0.016, 1.52],
        [-1.305, 1.095, 0, 0.018, 0.016, 1.52],
      ].map((edge, index) => (
        <mesh
          key={`edge-wear-${index}`}
          position={[edge[0], edge[1], edge[2]]}
          castShadow
        >
          <boxGeometry args={[edge[3], edge[4], edge[5]]} />
          <meshStandardMaterial
            color="#b48c63"
            roughness={0.28}
            metalness={0.52}
            transparent
            opacity={0.78}
          />
        </mesh>
      ))}

      <mesh position={[0, 0.64, 0.77]} castShadow>
        <boxGeometry args={[2.6, 0.86, 0.07]} />
        <meshStandardMaterial
          color="#8b744f"
          map={metalTexture}
          roughness={0.4}
          metalness={0.72}
        />
      </mesh>

      <mesh position={[0, 0.64, -0.77]} castShadow>
        <boxGeometry args={[2.6, 0.86, 0.07]} />
        <meshStandardMaterial
          color="#6f5939"
          map={metalTexture}
          roughness={0.42}
          metalness={0.68}
        />
      </mesh>

      <mesh position={[1.29, 0.64, 0]} castShadow>
        <boxGeometry args={[0.08, 0.88, 1.5]} />
        <meshStandardMaterial
          color="#8a724c"
          map={metalTexture}
          roughness={0.4}
          metalness={0.72}
        />
      </mesh>

      <mesh position={[-1.29, 0.64, 0]} castShadow>
        <boxGeometry args={[0.08, 0.88, 1.5]} />
        <meshStandardMaterial
          color="#8a724c"
          map={metalTexture}
          roughness={0.4}
          metalness={0.72}
        />
      </mesh>

      {cornerPlateTweaks.map((plate, index) => (
        <group
          key={`corner-plate-${index}`}
          position={plate.position}
          rotation={[0, plate.ry, plate.rz]}
        >
          <mesh castShadow>
            <boxGeometry args={[0.22, 0.22, 0.08]} />
            <meshStandardMaterial
              color="#7d6745"
              map={metalTexture}
              roughness={0.45}
              metalness={0.62}
            />
          </mesh>

          {[
            [-0.06, -0.06, 0.045],
            [0.06, -0.06, 0.045],
            [-0.06, 0.06, 0.045],
            [0.06, 0.06, 0.045],
          ].map((screw, screwIndex) => (
            <mesh
              key={`corner-screw-${index}-${screwIndex}`}
              position={screw}
              castShadow
            >
              <cylinderGeometry args={[0.013, 0.013, 0.012, 10]} />
              <meshStandardMaterial
                color="#d1d7dd"
                roughness={0.22}
                metalness={0.98}
              />
            </mesh>
          ))}
        </group>
      ))}

      {handleConfigs.map((config) => (
        <group
          key={`side-handle-${config.side}`}
          position={[config.x, config.y, config.z]}
          rotation={[0, 0, config.tilt]}
        >
          <mesh
            position={[0, 0.102, 0.01]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
          >
            <cylinderGeometry args={[0.052, 0.045, 0.095, 16]} />
            <meshStandardMaterial
              color="#8b7350"
              map={metalTexture}
              roughness={0.42}
              metalness={0.7}
              envMapIntensity={1.18}
            />
          </mesh>

          <mesh
            position={[0, -0.098, -0.01]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
          >
            <cylinderGeometry args={[0.049, 0.043, 0.09, 16]} />
            <meshStandardMaterial
              color="#877050"
              map={metalTexture}
              roughness={0.44}
              metalness={0.68}
              envMapIntensity={1.15}
            />
          </mesh>

          <mesh position={[0, 0.004, 0]} castShadow>
            <capsuleGeometry args={[0.039, 0.22, 6, 16]} />
            <meshStandardMaterial
              color="#6f5739"
              map={metalTexture}
              roughness={0.5}
              metalness={0.6}
              envMapIntensity={1.05}
            />
          </mesh>

          <mesh
            rotation={[0.12, Math.PI / 2, 0]}
            position={[0, config.ringOffsetY, 0]}
            scale={[config.ringScale, 0.92, 1]}
            castShadow
          >
            <torusGeometry args={[0.17, 0.023, 12, 34]} />
            <meshStandardMaterial
              color="#b3bcc5"
              roughness={0.32}
              metalness={0.92}
              envMapIntensity={1.25}
            />
          </mesh>
        </group>
      ))}

      {[
        [-1.3, 0.57, 0.12],
        [-1.32, 0.52, -0.1],
        [1.3, 0.56, -0.11],
        [1.32, 0.52, 0.13],
      ].map((position, index) => (
        <mesh key={`handle-wear-${index}`} position={position} castShadow>
          <sphereGeometry args={[0.01, 8, 8]} />
          <meshStandardMaterial
            color="#3a2c1f"
            roughness={0.88}
            metalness={0.05}
            transparent
            opacity={0.62}
          />
        </mesh>
      ))}

      {[-0.58, 0.58].map((x) => (
        <mesh
          key={`leather-${x}`}
          position={[x, 0.64, 0.79]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[0.24, 0.82, 0.028]} />
          <meshStandardMaterial
            color="#4f2f1e"
            map={leatherTexture}
            roughness={0.9}
            metalness={0.05}
          />
        </mesh>
      ))}

      <group position={[0, 1.1, -0.74]} ref={lidRef}>
        <mesh position={[0, 0.26, 0.74]} castShadow receiveShadow>
          <boxGeometry args={[2.56, 0.52, 1.48]} />
          <meshStandardMaterial
            color="#704425"
            map={woodTexture}
            roughness={0.65}
            metalness={0.08}
          />
        </mesh>

        <mesh position={[0, 0.53, 0.74]} castShadow>
          <boxGeometry args={[2.4, 0.08, 1.3]} />
          <meshStandardMaterial
            color="#83512e"
            map={woodTexture}
            roughness={0.6}
            metalness={0.06}
          />
        </mesh>

        <mesh position={[0, 0.26, 1.49]} castShadow>
          <boxGeometry args={[2.64, 0.54, 0.07]} />
          <meshStandardMaterial
            color="#8f744c"
            map={metalTexture}
            roughness={0.42}
            metalness={0.68}
          />
        </mesh>

        {[-0.86, 0, 0.86].map((x) => (
          <mesh key={`lid-band-${x}`} position={[x, 0.26, 0.74]} castShadow>
            <boxGeometry args={[0.08, 0.54, 1.52]} />
            <meshStandardMaterial
              color="#8d734f"
              map={metalTexture}
              roughness={0.42}
              metalness={0.66}
            />
          </mesh>
        ))}

        {[-1.16, 1.16].map((x) => (
          <mesh
            key={`lid-chain-anchor-${x}`}
            position={[x, 0.18, 0.12]}
            castShadow
          >
            <cylinderGeometry args={[0.02, 0.02, 0.08, 12]} />
            <meshStandardMaterial
              color="#c9d1d9"
              roughness={0.2}
              metalness={0.98}
            />
          </mesh>
        ))}
      </group>

      {[-1.16, 1.16].map((x) => (
        <group key={`strut-${x}`}>
          <mesh
            position={[x, 0.77, -0.56]}
            rotation={[0.1, 0, x > 0 ? -0.24 : 0.24]}
            castShadow
            ref={x < 0 ? strutRefLeft : strutRefRight}
          >
            <cylinderGeometry args={[0.018, 0.018, 0.58, 12]} />
            <meshStandardMaterial
              color="#aeb7c0"
              roughness={0.22}
              metalness={0.97}
            />
          </mesh>
          <mesh
            position={[x, 0.94, -0.69]}
            rotation={[0.64, 0, x > 0 ? -0.3 : 0.3]}
            castShadow
            ref={x < 0 ? pistonRefLeft : pistonRefRight}
          >
            <cylinderGeometry args={[0.013, 0.013, 0.44, 12]} />
            <meshStandardMaterial
              color="#c8cfd6"
              roughness={0.18}
              metalness={0.99}
            />
          </mesh>
          <mesh position={[x, 0.63, -0.42]} castShadow>
            <sphereGeometry args={[0.024, 12, 12]} />
            <meshStandardMaterial
              color="#d8dee5"
              roughness={0.15}
              metalness={1}
            />
          </mesh>
        </group>
      ))}

      {[-0.92, 0, 0.92].map((x) => (
        <mesh key={`hinge-${x}`} position={[x, 1.09, -0.79]} castShadow>
          <cylinderGeometry args={[0.046, 0.046, 0.2, 18]} />
          <meshStandardMaterial
            color="#99a2ab"
            roughness={0.28}
            metalness={0.94}
            envMapIntensity={1.25}
          />
        </mesh>
      ))}

      {[-0.92, 0, 0.92].map((x) => (
        <mesh key={`hinge-screw-${x}`} position={[x, 1.09, -0.69]} castShadow>
          <cylinderGeometry args={[0.017, 0.017, 0.03, 10]} />
          <meshStandardMaterial color="#d1d8df" roughness={0.2} metalness={1} />
        </mesh>
      ))}

      <group ref={lockRef}>
        <mesh position={[0, 0.55, 0.89]} castShadow>
          <boxGeometry args={[0.46, 0.34, 0.12]} />
          <meshStandardMaterial
            color="#88663b"
            map={metalTexture}
            roughness={0.44}
            metalness={0.63}
          />
        </mesh>

        {[-0.13, 0.13].map((x) => (
          <mesh key={`lock-screw-${x}`} position={[x, 0.55, 0.96]} castShadow>
            <cylinderGeometry args={[0.016, 0.016, 0.03, 10]} />
            <meshStandardMaterial
              color="#d8dde3"
              roughness={0.18}
              metalness={1}
            />
          </mesh>
        ))}

        <mesh position={[0, 0.56, 0.96]} castShadow>
          <cylinderGeometry args={[0.084, 0.084, 0.08, 20]} />
          <meshStandardMaterial
            color="#70859d"
            roughness={0.28}
            metalness={0.94}
          />
        </mesh>

        <mesh position={[0, 0.65, 0.95]} castShadow>
          <torusGeometry args={[0.115, 0.032, 12, 34]} />
          <meshStandardMaterial
            color="#bcc5ce"
            roughness={0.23}
            metalness={0.97}
          />
        </mesh>
      </group>

      {rivetHeads.map((rivet, index) => (
        <group key={`rivet-${index}`} position={rivet.position}>
          <mesh position={[0, 0, rivet.depthOffset]} castShadow>
            <cylinderGeometry args={[0.032, 0.032, 0.014, 18]} />
            <meshStandardMaterial
              color="#c3cad1"
              roughness={0.24}
              metalness={0.96}
            />
          </mesh>
          <mesh
            position={[0, 0, 0.01 + rivet.depthOffset]}
            rotation={[0, 0, rivet.slotRotation]}
          >
            <boxGeometry args={[0.032, 0.004, 0.006]} />
            <meshStandardMaterial
              color="#44515d"
              roughness={0.74}
              metalness={0.18}
            />
          </mesh>
        </group>
      ))}

      <group position={[0, 0.42, 0]}>
        <mesh position={[0, -0.19, 0]} receiveShadow>
          <boxGeometry args={[2.3, 0.05, 1.22]} />
          <meshStandardMaterial
            color="#070605"
            roughness={0.99}
            metalness={0.03}
          />
        </mesh>

        <mesh position={[0, 0.03, 0.64]}>
          <boxGeometry args={[2.26, 0.4, 0.035]} />
          <meshStandardMaterial
            color="#120d09"
            roughness={0.96}
            metalness={0.05}
          />
        </mesh>

        <mesh position={[0, 0.03, -0.64]}>
          <boxGeometry args={[2.26, 0.4, 0.035]} />
          <meshStandardMaterial
            color="#120d09"
            roughness={0.96}
            metalness={0.05}
          />
        </mesh>

        <mesh position={[1.13, 0.03, 0]}>
          <boxGeometry args={[0.03, 0.4, 1.3]} />
          <meshStandardMaterial
            color="#120d09"
            roughness={0.96}
            metalness={0.05}
          />
        </mesh>

        <mesh position={[-1.13, 0.03, 0]}>
          <boxGeometry args={[0.03, 0.4, 1.3]} />
          <meshStandardMaterial
            color="#120d09"
            roughness={0.96}
            metalness={0.05}
          />
        </mesh>

        <mesh position={[0, -0.04, 0]}>
          <cylinderGeometry args={[0.82, 0.92, 0.42, 44, 1, true]} />
          <meshStandardMaterial
            color="#050607"
            roughness={1}
            metalness={0}
            transparent
            opacity={0.42}
            side={THREE.DoubleSide}
          />
        </mesh>

        <mesh position={[0, -0.163, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2.14, 1.14]} />
          <meshBasicMaterial
            color="#000000"
            transparent
            opacity={0.28}
            depthWrite={false}
          />
        </mesh>

        <mesh position={[1.04, 0.03, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[1.26, 0.42]} />
          <meshBasicMaterial
            color="#000000"
            transparent
            opacity={0.2}
            depthWrite={false}
          />
        </mesh>

        <mesh position={[-1.04, 0.03, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[1.26, 0.42]} />
          <meshBasicMaterial
            color="#000000"
            transparent
            opacity={0.2}
            depthWrite={false}
          />
        </mesh>

        <mesh position={[0, 0.03, 0.595]}>
          <planeGeometry args={[2.12, 0.42]} />
          <meshBasicMaterial
            color="#000000"
            transparent
            opacity={0.16}
            depthWrite={false}
          />
        </mesh>

        <mesh position={[0, 0.03, -0.595]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[2.12, 0.42]} />
          <meshBasicMaterial
            color="#000000"
            transparent
            opacity={0.16}
            depthWrite={false}
          />
        </mesh>
      </group>

      <group ref={cargoGroupRef} position={[0, 0.34, 0]}>
        <mesh ref={glowRef} position={[0, -0.02, 0]}>
          <cylinderGeometry args={[0.56, 0.74, 0.2, 32, 1, true]} />
          <meshStandardMaterial
            color="#4a2c15"
            emissive="#ffb766"
            emissiveIntensity={0.22}
            roughness={0.34}
            metalness={0.24}
            transparent
            opacity={0.2}
            side={THREE.DoubleSide}
          />
        </mesh>

        <mesh position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.12, 0.7, 42]} />
          <meshStandardMaterial
            color="#e8ad63"
            emissive="#ffb356"
            emissiveIntensity={0.5}
            transparent
            opacity={0.46}
            side={THREE.DoubleSide}
          />
        </mesh>

        {cargoCards.map((card) => (
          <mesh
            key={`cargo-card-${card.seed}`}
            position={[card.x, card.y, card.z]}
            rotation={[card.rx, card.ry, 0]}
            scale={[card.s, card.s, 1]}
            castShadow
          >
            <boxGeometry args={[0.22, 0.14, 0.018]} />
            <meshStandardMaterial
              color={card.seed % 2 === 0 ? "#f3f6ff" : "#d9ecff"}
              emissive={card.seed % 2 === 0 ? "#6eb6ff" : "#57cff0"}
              emissiveIntensity={0.48}
              roughness={0.3}
              metalness={0.12}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function SideCannons({ active, onHoverChange, onFire }) {
  // Ungrouped: each cannon at its own absolute world position, all same Z=0.
  // X positions track PORTHOLE_X_POSITIONS so cannons stay aligned with the hull holes.
  const cannonPositions = useMemo(
    () => PORTHOLE_X_POSITIONS.map((x) => ({ x, z: 5.5 })),
    [],
  );
  const { scene } = useGLTF(cannonModel);
  const [hoveredIndex, setHoveredIndex] = useState(null);

  // Per-cannon deep clone with cloned materials so emissive tweaks affect
  // only the hovered cannon (default <Clone> shares materials across instances).
  const cannonScenes = useMemo(() => {
    return cannonPositions.map(() => {
      const cloned = scene.clone(true);
      cloned.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        // Defensive: some glTF exporters set a no-op raycast on certain meshes
        // and leave frustumCulled true with a stale bounding sphere, which can
        // make the cannon nearest the FOV edge silently miss pointer events.
        child.frustumCulled = false;
        child.raycast = THREE.Mesh.prototype.raycast;
        if (child.geometry) {
          child.geometry.computeBoundingSphere();
          child.geometry.computeBoundingBox();
        }
        if (!child.material) return;
        child.material = Array.isArray(child.material)
          ? child.material.map((m) => m.clone())
          : child.material.clone();
        const mat = child.material;
        // DoubleSide lets the raycaster register hits from grazing/oblique
        // angles too — cannon 1 is closest to the camera and viewed from a
        // sharp side angle, so single-sided faces can be skipped.
        mat.side = THREE.DoubleSide;
        if (mat.emissive) {
          child.userData.originalEmissive = mat.emissive.clone();
          child.userData.originalEmissiveIntensity = mat.emissiveIntensity ?? 0;
        }
      });
      return cloned;
    });
  }, [scene, cannonPositions]);

  useEffect(() => {
    cannonScenes.forEach((cloned, index) => {
      const hot = hoveredIndex === index;
      cloned.traverse((child) => {
        if (!child.isMesh || !child.material || !child.material.emissive) return;
        if (hot) {
          child.material.emissive.set("#ffd28c");
          child.material.emissiveIntensity = 0.06;
        } else if (child.userData.originalEmissive) {
          child.material.emissive.copy(child.userData.originalEmissive);
          child.material.emissiveIntensity =
            child.userData.originalEmissiveIntensity;
        }
      });
    });
  }, [hoveredIndex, cannonScenes]);

  const onOver = (index) => (event) => {
    event.stopPropagation();
    if (!active) return;
    setHoveredIndex(index);
    onHoverChange(true);
  };
  const onOut = (index) => (event) => {
    event.stopPropagation();
    setHoveredIndex((prev) => (prev === index ? null : prev));
    onHoverChange(false);
  };
  const onDown = (index) => (event) => {
    event.stopPropagation();
    if (active) onFire(index);
  };

  return (
    <>
      {cannonPositions.map(({ x, z }, index) => {
        const hot = hoveredIndex === index;
        return (
          <group key={`cannon-${index}`} position={[x, 0.56, z]}>
            {/* Carriage base: 1.1 long in Z, 0.58 wide in X */}
            <mesh position={[-0.26, -0.25, 0]} receiveShadow>
              <boxGeometry args={[0.58, 0.14, 1.1]} />
              <meshStandardMaterial
                color="#5f3a22"
                roughness={0.77}
                metalness={0.05}
              />
            </mesh>

            {/* Front and back wheels (spread in Z) */}
            <mesh position={[-0.41, -0.2, 0.34]} castShadow>
              <cylinderGeometry args={[0.1, 0.1, 0.1, 16]} />
              <meshStandardMaterial
                color="#5f3a22"
                roughness={0.76}
                metalness={0.05}
              />
            </mesh>
            <mesh position={[-0.41, -0.2, -0.34]} castShadow>
              <cylinderGeometry args={[0.1, 0.1, 0.1, 16]} />
              <meshStandardMaterial
                color="#5f3a22"
                roughness={0.76}
                metalness={0.05}
              />
            </mesh>

            {/* Cannon 3D model – hover surface = lightup surface */}
            <group
              position={[-0.02, -0.04, 0.03]}
              rotation={[0, Math.PI / 2, 0]}
              onPointerOver={onOver(index)}
              onPointerOut={onOut(index)}
              onPointerDown={onDown(index)}
            >
              <primitive object={cannonScenes[index]} scale={0.125} />
            </group>

            {/* Aim ring + a torus clickbox at the exact same place/shape */}
            <group position={[0.56, 0.81, 0]}>
              <mesh visible={active}>
                <torusGeometry args={[0.24, 0.02, 16, 38]} />
                <meshBasicMaterial
                  color={hot ? "#ffd28c" : "#d29959"}
                  transparent
                  opacity={hot ? 0.78 : 0.4}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
              {active ? (
                <mesh
                  onPointerOver={onOver(index)}
                  onPointerOut={onOut(index)}
                  onPointerDown={onDown(index)}
                >
                  {/* Same torus radius — slightly thicker tube so the ring is easy to grab */}
                  <torusGeometry args={[0.24, 0.06, 12, 38]} />
                  <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                </mesh>
              ) : null}
            </group>
          </group>
        );
      })}
    </>
  );
}

function CameraRig({ parallax, viewMode }) {
  const modeBlend = useRef(0);

  useFrame((state, delta) => {
    modeBlend.current = THREE.MathUtils.damp(
      modeBlend.current,
      viewMode === "cannons" ? 1 : 0,
      3.2,
      delta,
    );

    const chestX = (parallax?.x ?? 0) * 0.9;
    const chestY = 2.18 + (parallax?.y ?? 0) * 0.46;
    const chestZ = 6.15;

    // Cannon view: slightly off-axis (~95°) from side-on. Camera raised 2 units,
    // shifted 1 unit in -Z so the view has a slight diagonal toward the back wall.
    const cannonX = 3.5 + (parallax?.x ?? 0) * 0.15;
    const cannonY = 3.65 + (parallax?.y ?? 0) * 0.12;
    const cannonZ = -1.0;

    const blend = modeBlend.current;
    const camera = state.camera;

    const targetX = THREE.MathUtils.lerp(chestX, cannonX, blend);
    const targetY = THREE.MathUtils.lerp(chestY, cannonY, blend);
    const targetZ = THREE.MathUtils.lerp(chestZ, cannonZ, blend);

    // Look-at: chest centre → centre cannon at front wall (x=18.5, z=+4.3)
    const lookX = THREE.MathUtils.lerp(0, 18.5, blend);
    const lookY = THREE.MathUtils.lerp(0.58, 1.38, blend);
    const lookZ = THREE.MathUtils.lerp(0, 4.3, blend);

    camera.position.x = THREE.MathUtils.damp(
      camera.position.x,
      targetX,
      3,
      delta,
    );
    camera.position.y = THREE.MathUtils.damp(
      camera.position.y,
      targetY,
      3,
      delta,
    );
    camera.position.z = THREE.MathUtils.damp(
      camera.position.z,
      targetZ,
      3,
      delta,
    );
    camera.lookAt(lookX, lookY, lookZ);
  });

  return null;
}

// Directional spotlight that beams through a porthole into the gun deck
function PortholeSpotLight({ x }) {
  const lightRef = useRef();
  useEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    const target = new THREE.Object3D();
    const parent = light.parent;
    // Aim inward along -Z from outside the porthole wall
    target.position.set(x, PORTHOLE_Y, 0);
    parent?.add(target);
    light.target = target;
    target.updateMatrixWorld();
    return () => { parent?.remove(target); };
  }, [x]);
  return (
    <spotLight
      ref={lightRef}
      position={[x, PORTHOLE_Y, PORTHOLE_Z + 0.4]}
      angle={0.464}
      penumbra={0.45}
      intensity={180}
      distance={55}
      color={PORTHOLE_SKY_COLOR}
      castShadow={false}
    />
  );
}

function RoomLanternLighting({ phase, hasZip }) {
  const active = phase !== "idle" || hasZip;

  return (
    <>
      <ambientLight intensity={active ? 0.38 : 0.28} color="#f0dfc3" />
      <hemisphereLight
        intensity={active ? 0.55 : 0.42}
        color="#ffe8be"
        groundColor="#8b6040"
      />
      <directionalLight
        position={[3.2, 5.4, 4.6]}
        intensity={0.35}
        color="#ffe0a8"
      />
      {/* Lanterns fixed in world space: above chest (x=0) + above each cannon bay, all y=4.5 z=0 */}
      {[0, ...PORTHOLE_X_POSITIONS].map((x) => (
        <pointLight
          key={`lantern-${x}`}
          position={[x, 4.5, 0]}
          intensity={active ? 18 : 12}
          distance={14}
          decay={2}
          color="#ffbd73"
        />
      ))}
      {/* Tight beam spotlights through each porthole from outside */}
      {PORTHOLE_X_POSITIONS.map((x) => (
        <PortholeSpotLight key={`port-spot-${x}`} x={x} />
      ))}
      {/* Soft fill light from each porthole to bathe the room in sky colour */}
      {PORTHOLE_X_POSITIONS.map((x) => (
        <pointLight
          key={`port-fill-${x}`}
          position={[x, PORTHOLE_Y, PORTHOLE_Z + 0.4]}
          intensity={25}
          distance={28}
          decay={2}
          color={PORTHOLE_SKY_COLOR}
        />
      ))}
    </>
  );
}

// -- DEBUG axis helpers --
// -- end debug --

function Scene3D({
  phase,
  hasZip,
  parallax,
  viewMode,
  onHoverChange,
  onCannonsHoverChange,
  onFireCannons,
  onChestClick,
}) {
  return (
    <>
      <fog attach="fog" args={["#070402", 7, 38]} />
      <RoomLanternLighting phase={phase} hasZip={hasZip} />

      <RoomShell />
      {/* Always mounted so it doesn't vanish mid-transition */}
      <SideCannons
        active={viewMode === "cannons"}
        onHoverChange={onCannonsHoverChange}
        onFire={onFireCannons}
      />
      <ChestModel
        phase={phase}
        hasZip={hasZip}
        onHoverChange={onHoverChange}
        onChestClick={onChestClick}
      />
      <CameraRig parallax={parallax} viewMode={viewMode} />
      <ScenePerformanceMonitor viewMode={viewMode} />
    </>
  );
}

function CannonToggleButton({ isAimed, onClick }) {
  const label = isAimed ? "Fire broadside cannons" : "Turn to gun deck";

  return (
    <button
      type="button"
      className={`${styles.cannonButton} ${isAimed ? styles.cannonButtonAimed : ""}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <img
        src={cannon2dImage}
        alt=""
        draggable={false}
        className={styles.cannonIcon}
      />
      {/* Warm glow over the muzzle opening, brightens on hover / while armed */}
      <span className={styles.cannonMuzzleGlow} aria-hidden="true" />
    </button>
  );
}

function Chest({
  phase,
  parallax,
  menuOpen,
  onChestClick,
  onFireCannons,
  hasZip,
  onChooseFile,
  onChooseDataset,
  cinematicView = null,
  cinematicMode = false,
}) {
  const [viewMode, setViewMode] = useState("chest");
  const isWebGLAvailable = useWebGLAvailable();
  const activeViewMode = cinematicView || viewMode;
  const isCannonView = activeViewMode === "cannons";

  const handleCannonButtonClick = () => {
    if (isCannonView) {
      onFireCannons?.();
      return;
    }
    setViewMode("cannons");
  };

  return (
    <div className={styles.sceneWrap}>
      {isWebGLAvailable ? (
        <Canvas
          dpr={[0.75, 1]}
          camera={{ position: [0, 2.35, 6.15], fov: 42, near: 0.1, far: 60 }}
          gl={{ antialias: false, powerPreference: "low-power", alpha: false }}
        >
          <Scene3D
            phase={phase}
            hasZip={hasZip}
            parallax={parallax}
            viewMode={isCannonView ? "cannons" : "chest"}
            onHoverChange={() => {}}
            onCannonsHoverChange={() => {}}
            onFireCannons={() => onFireCannons?.()}
            onChestClick={onChestClick}
          />
        </Canvas>
      ) : (
        <div className={styles.chestFallback}>
          <div className={styles.chestFallbackBadge}>
            WebGL Unavailable - Lightweight Mode
          </div>
          <div className={styles.chestFallbackRoom}>
            <div
              className={styles.chestFallbackChest}
              onClick={onChestClick}
              role="button"
              tabIndex={0}
            >
              <div className={styles.chestFallbackLid} />
              <div className={styles.chestFallbackBody} />
            </div>

            {isCannonView ? (
              <div className={styles.chestFallbackCannons}>
                <div className={styles.fallbackCannonsRow}>
                  {[0, 1, 2].map((index) => (
                    <div
                      key={`fallback-cannon-${index}`}
                      className={styles.fallbackCannon}
                    >
                      <span className={styles.fallbackCannonBarrel} />
                      <span className={styles.fallbackCannonWheelLeft} />
                      <span className={styles.fallbackCannonWheelRight} />
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className={styles.fallbackFireButton}
                  onClick={() => onFireCannons?.()}
                >
                  Fire Cannon
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {!cinematicMode ? (
        <CannonToggleButton
          isAimed={isCannonView}
          onClick={handleCannonButtonClick}
        />
      ) : null}

      <AnimatePresence>
        {!cinematicMode && !isCannonView && menuOpen ? (
          <HoverMenu
            hasZip={hasZip}
            onChooseFile={onChooseFile}
            onChooseDataset={onChooseDataset}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default Chest;
