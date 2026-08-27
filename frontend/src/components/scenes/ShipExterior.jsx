import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import useWebGLAvailable from "../../hooks/useWebGLAvailable";
import NightSky from "../shared/NightSky";
import styles from "./ShipExterior.module.css";
import pirateShipModel from "../../assets/models/pirate-ship.glb";
import islandModel from "../../assets/models/island.glb";

const CANNON_ARC_PEAK = 6;
const CANNON_DURATION = 12.5;
const CANNON_TARGET = new THREE.Vector3(120, 0, 20);
const SEA_ROTATION = [-Math.PI / 2, 0, -0.99];
const SEA_POSITION = [0, -0.62, 0];
const SEA_MATRIX = new THREE.Matrix4().makeRotationFromEuler(
  new THREE.Euler(...SEA_ROTATION),
);
const SEA_INVERSE_MATRIX = SEA_MATRIX.clone().invert();
const SEA_WORLD_POSITION = new THREE.Vector3(...SEA_POSITION);
const SHIP_DRAFT_CLEARANCE = 0.72;
const SHIP_BASE_POSITION = [1, -0.18, 6.8];
const SHIP_BASE_ROTATION_X = 0.05;
const SHIP_BASE_ROTATION_Y = -0.99;
const SHIP_BASE_ROTATION_Z = 0.02;
const SHIP_LENGTH_SAMPLE = 5.6;
const SHIP_BEAM_SAMPLE = 2.2;
const SHIP_PITCH_GAIN = 1.85;
const SHIP_MAX_PITCH = 0.13;
const SHIP_PITCH_RESPONSE = 0.24;
const SHIP_HEAVE_RESPONSE = 0.16;
const CINEMATIC_TARGET = new THREE.Vector3(1, 0.92, 6.8);
const CINEMATIC_DURATION = 52;
const WINDOW_ANCHOR_UPDATE_INTERVAL = 0.08;
const GERSTNER_WAVES = [
  {
    direction: [0.16, 0.99],
    amplitude: 0.18,
    wavelength: 18,
    speed: 1.22,
    steepness: 0.52,
  },
  {
    direction: [-0.44, 0.9],
    amplitude: 0.1,
    wavelength: 9.5,
    speed: 0.86,
    steepness: 0.34,
  },
  {
    direction: [0.82, 0.57],
    amplitude: 0.055,
    wavelength: 5.2,
    speed: 1.55,
    steepness: 0.24,
  },
  {
    direction: [-0.72, 0.69],
    amplitude: 0.035,
    wavelength: 3.4,
    speed: 1.86,
    steepness: 0.16,
  },
].map((wave) => {
  const length = Math.hypot(wave.direction[0], wave.direction[1]);
  return {
    ...wave,
    direction: [wave.direction[0] / length, wave.direction[1] / length],
  };
});
const GERSTNER_SHADER_CALLS = GERSTNER_WAVES.map(
  (wave) => `
            addGerstnerWave(
              basePosition,
              vec2(${wave.direction[0].toFixed(6)}, ${wave.direction[1].toFixed(6)}),
              ${wave.amplitude.toFixed(6)},
              ${wave.wavelength.toFixed(6)},
              ${wave.speed.toFixed(6)},
              ${(wave.steepness / GERSTNER_WAVES.length).toFixed(6)},
              uTime,
              nextPosition,
              tangentX,
              tangentY,
              crest
            );`,
).join("\n");
const OCEAN_IMAGE_MODULES = import.meta.glob(
  "../../assets/AGIQA-3K/*.{jpg,jpeg,png,webp}",
  {
    eager: true,
    import: "default",
    query: "?url",
  },
);
// The images are scattered as blue noise (a Poisson-disk distribution) rather
// than a grid, so there are no rows, columns, or lanes — just an organic sea.
// Every image still keeps at least OCEAN_IMAGE_MIN_DISTANCE from every other,
// and the scatter is generated *periodic* in the drift direction, so the whole
// field can drift at one shared speed and wrap seamlessly while preserving that
// spacing forever. With the image size clamped so its bounding circle (plus the
// sway travel) fits inside half the min-distance, neighbours can never overlap.
const OCEAN_IMAGE_DOMAIN_WIDTH = 108;
const OCEAN_DRIFT_MIN_Y = -30;
const OCEAN_IMAGE_DRIFT_RANGE = 90;
const OCEAN_DRIFT_MAX_Y = OCEAN_DRIFT_MIN_Y + OCEAN_IMAGE_DRIFT_RANGE;
const OCEAN_IMAGE_MIN_DISTANCE = 3.65;
const OCEAN_IMAGE_SWAY_AMPLITUDE = 0.18;
const OCEAN_IMAGE_SCATTER_SEED = 0x9e3779b9;
// Keep these clamps so the largest plane's bounding circle (hypot(w/2, h/2))
// plus the sway travel stays within OCEAN_IMAGE_MIN_DISTANCE / 2. Smaller planes
// let the scatter pack tighter, which is what makes the sea feel dense.
const OCEAN_IMAGE_MIN_WIDTH = 1.2;
const OCEAN_IMAGE_MAX_WIDTH = 2.35;
const OCEAN_IMAGE_MIN_HEIGHT = 1.26;
const OCEAN_IMAGE_MAX_HEIGHT = 1.48;
const OCEAN_DRIFT_SPEED = 3.3;
const OCEAN_IMAGE_FADE_MARGIN = 20;
const OCEAN_IMAGE_SURFACE_OFFSET = 0.055;
// One segment (a flat quad, 4 vertices) is enough: the planes are ~2 units
// wide and ride the wave via their centre position, so the extra subdivisions
// only added per-frame CPU wave-sampling and geometry re-uploads for no visible
// gain. 5x3 -> 1x1 is 6x fewer vertices to deform each frame.
const OCEAN_IMAGE_SEGMENTS_X = 1;
const OCEAN_IMAGE_SEGMENTS_Y = 1;
const OCEAN_IMAGE_UPDATE_INTERVAL = 1 / 30;
// The source art is 512x512; on screen each plane is only ~60px, so we downscale
// every ocean texture to this size on load. Without mipmaps a 512x512 RGBA
// texture costs ~1 MB of VRAM each (~560 MB for the whole sea, which thrashes
// laptop/integrated GPUs and causes stutter); 128x128 is ~16x smaller (~35 MB).
const OCEAN_IMAGE_TEXTURE_SIZE = 128;

// Deterministic PRNG so the scatter is identical on every mount.
function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bridson's Poisson-disk sampling, made periodic along Y (a cylinder) so the
// pattern tiles seamlessly under vertical drift. Returns points in
// x ∈ [-width/2, width/2], y ∈ [0, height), each at least `radius` from the
// others (with the Y distance measured around the wrap).
function generatePeriodicPoissonPoints({ width, height, radius, seed }) {
  const random = createSeededRandom(seed);
  const cellSize = radius / Math.SQRT2;
  const columns = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const grid = new Array(columns * rows).fill(-1);
  const points = [];
  const active = [];
  const halfWidth = width / 2;
  const radiusSquared = radius * radius;

  const wrappedYDistance = (a, b) => {
    const delta = Math.abs(a - b);
    return Math.min(delta, height - delta);
  };
  const cellIndex = (x, y) => {
    const column = Math.min(
      columns - 1,
      Math.floor((x + halfWidth) / cellSize),
    );
    let row = Math.floor(y / cellSize) % rows;
    if (row < 0) row += rows;
    return row * columns + column;
  };
  const fits = (x, y) => {
    if (x < -halfWidth || x > halfWidth) return false;
    const column = Math.min(
      columns - 1,
      Math.floor((x + halfWidth) / cellSize),
    );
    const row = Math.floor(y / cellSize);
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const nx = column + dx;
        if (nx < 0 || nx >= columns) continue;
        let ny = (row + dy) % rows;
        if (ny < 0) ny += rows;
        const neighbor = grid[ny * columns + nx];
        if (neighbor >= 0) {
          const point = points[neighbor];
          const ddx = x - point.x;
          const ddy = wrappedYDistance(y, point.y);
          if (ddx * ddx + ddy * ddy < radiusSquared) return false;
        }
      }
    }
    return true;
  };
  const addPoint = (x, y) => {
    points.push({ x, y });
    active.push(points.length - 1);
    grid[cellIndex(x, y)] = points.length - 1;
  };

  addPoint((random() - 0.5) * width, random() * height);
  while (active.length > 0) {
    const activeIndex = Math.floor(random() * active.length);
    const origin = points[active[activeIndex]];
    let placed = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const distance = radius * (1 + random());
      const x = origin.x + Math.cos(angle) * distance;
      let y = origin.y + Math.sin(angle) * distance;
      y = ((y % height) + height) % height;
      if (fits(x, y)) {
        addPoint(x, y);
        placed = true;
        break;
      }
    }
    if (!placed) active.splice(activeIndex, 1);
  }

  return points;
}

const OCEAN_IMAGE_POINTS = generatePeriodicPoissonPoints({
  width: OCEAN_IMAGE_DOMAIN_WIDTH,
  height: OCEAN_IMAGE_DRIFT_RANGE,
  radius: OCEAN_IMAGE_MIN_DISTANCE,
  seed: OCEAN_IMAGE_SCATTER_SEED,
});
const OCEAN_IMAGE_TARGET_COUNT = OCEAN_IMAGE_POINTS.length;
const OCEAN_IMAGE_SORTED_URLS = Object.entries(OCEAN_IMAGE_MODULES)
  .sort(([left], [right]) =>
    left.localeCompare(right, undefined, { numeric: true }),
  )
  .map(([, url]) => url);
// Sample evenly across the whole archive so the sea shows a varied mix instead
// of one model's first N frames.
const OCEAN_IMAGE_URLS = (() => {
  const total = OCEAN_IMAGE_SORTED_URLS.length;
  if (total <= OCEAN_IMAGE_TARGET_COUNT) {
    return OCEAN_IMAGE_SORTED_URLS;
  }
  const stride = total / OCEAN_IMAGE_TARGET_COUNT;
  return Array.from(
    { length: OCEAN_IMAGE_TARGET_COUNT },
    (_, index) => OCEAN_IMAGE_SORTED_URLS[Math.floor(index * stride)],
  );
})();
const OCEAN_IMAGE_MAX_OPACITY = 0.86;

function wrapRange(value, min, max) {
  const range = max - min;
  return ((((value - min) % range) + range) % range) + min;
}

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function seededUnit(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function oceanLocalToWorld(localPosition, target) {
  return target
    .copy(localPosition)
    .applyMatrix4(SEA_MATRIX)
    .add(SEA_WORLD_POSITION);
}

function worldPointToOceanLocal(worldPoint, target) {
  return target
    .copy(worldPoint)
    .setY(SEA_POSITION[1])
    .sub(SEA_WORLD_POSITION)
    .applyMatrix4(SEA_INVERSE_MATRIX);
}

function sampleOceanSurface(
  localX,
  localY,
  elapsedTime,
  targetPosition = new THREE.Vector3(),
  targetNormal = null,
) {
  let x = localX;
  let y = localY;
  let z = 0;
  let tangentXX = 1;
  let tangentXY = 0;
  let tangentXZ = 0;
  let tangentYX = 0;
  let tangentYY = 1;
  let tangentYZ = 0;

  for (let index = 0; index < GERSTNER_WAVES.length; index += 1) {
    const wave = GERSTNER_WAVES[index];
    const directionX = wave.direction[0];
    const directionY = wave.direction[1];
    const frequency = (Math.PI * 2) / wave.wavelength;
    const phase =
      frequency *
      (directionX * localX + directionY * localY - wave.speed * elapsedTime);
    const sinPhase = Math.sin(phase);
    const cosPhase = Math.cos(phase);
    const steepness = wave.steepness / GERSTNER_WAVES.length;
    const horizontalDisplacement = steepness * wave.amplitude * cosPhase;
    const derivative = steepness * wave.amplitude * frequency * sinPhase;
    const heightDerivative = wave.amplitude * frequency * cosPhase;

    x += directionX * horizontalDisplacement;
    y += directionY * horizontalDisplacement;
    z += wave.amplitude * sinPhase;

    tangentXX -= directionX * directionX * derivative;
    tangentXY -= directionX * directionY * derivative;
    tangentXZ += directionX * heightDerivative;
    tangentYX -= directionX * directionY * derivative;
    tangentYY -= directionY * directionY * derivative;
    tangentYZ += directionY * heightDerivative;
  }

  targetPosition.set(x, y, z);

  if (targetNormal) {
    targetNormal
      .set(
        tangentXY * tangentYZ - tangentXZ * tangentYY,
        tangentXZ * tangentYX - tangentXX * tangentYZ,
        tangentXX * tangentYY - tangentXY * tangentYX,
      )
      .normalize();
  }

  return targetPosition;
}

function tuneShipMaterial(material) {
  if (!material || !material.color) return;

  const materialName = (material.name || "").toLowerCase();
  const isSail = materialName.includes("sail");

  // The source GLB stores several hull/sail materials almost pure black,
  // so we remap them to physically plausible base values.
  const luminance =
    0.2126 * material.color.r +
    0.7152 * material.color.g +
    0.0722 * material.color.b;

  if (luminance < 0.001) {
    material.color.set(isSail ? "#ceb88f" : "#4f3722");
  } else if (luminance < 0.12) {
    const lift = Math.min(0.12 / luminance, 5.5);
    material.color.multiplyScalar(lift);
  }

  if ("metalness" in material && typeof material.metalness === "number") {
    material.metalness = Math.min(material.metalness, 0.22);
  }

  if ("roughness" in material && typeof material.roughness === "number") {
    material.roughness = THREE.MathUtils.clamp(material.roughness, 0.4, 0.82);
  }

  material.needsUpdate = true;
}

function ShipHull({ onWindowAnchorFrame, onMuzzleReady, shipGroupRef }) {
  const hullRef = useRef(null);
  const shipPrimitiveRef = useRef(null);
  const windowAnchorLocalRef = useRef(new THREE.Vector3(-520, 230, 400));
  const { scene } = useGLTF(pirateShipModel);
  const shipScene = useMemo(() => scene.clone(true), [scene]);
  const { camera, size } = useThree();
  const selectedWindowOffsetLocal = useMemo(
    () => new THREE.Vector3(180, -180, 0),
    [],
  );
  const localWindowCenter = useMemo(() => new THREE.Vector3(), []);
  const localWindowCorners = useMemo(
    () => [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
    ],
    [],
  );
  const worldCorner = useMemo(() => new THREE.Vector3(), []);
  const ndcCorner = useMemo(() => new THREE.Vector3(), []);
  const worldBox = useMemo(() => new THREE.Box3(), []);
  const shipBasePosition = useMemo(
    () => new THREE.Vector3(...SHIP_BASE_POSITION),
    [],
  );
  const shipForward = useMemo(
    () =>
      new THREE.Vector3(0, 0, 1).applyEuler(
        new THREE.Euler(0, SHIP_BASE_ROTATION_Y, 0),
      ),
    [],
  );
  const shipRight = useMemo(
    () =>
      new THREE.Vector3(1, 0, 0).applyEuler(
        new THREE.Euler(0, SHIP_BASE_ROTATION_Y, 0),
      ),
    [],
  );
  const shipSampleWorld = useMemo(() => new THREE.Vector3(), []);
  const seaLocalCenter = useMemo(() => new THREE.Vector3(), []);
  const seaLocalBow = useMemo(() => new THREE.Vector3(), []);
  const seaLocalStern = useMemo(() => new THREE.Vector3(), []);
  const seaLocalPort = useMemo(() => new THREE.Vector3(), []);
  const seaLocalStarboard = useMemo(() => new THREE.Vector3(), []);
  const seaSample = useMemo(() => new THREE.Vector3(), []);
  const seaWorldSample = useMemo(() => new THREE.Vector3(), []);
  const lastWindowAnchorRef = useRef({
    isVisible: false,
    points: "",
    sentAt: -Infinity,
  });

  useEffect(() => {
    let windowCandidate = null;
    let doorCandidate = null;
    let muzzleCandidate = null;
    shipScene.traverse((node) => {
      if (!node.isMesh || !node.material) return;

      node.castShadow = true;
      node.receiveShadow = true;

      const nodeTag =
        `${node.name || ""} ${node.material?.name || ""}`.toLowerCase();
      if (!doorCandidate && nodeTag.includes("mat.5")) {
        doorCandidate = node;
      }

      if (
        !windowCandidate &&
        (nodeTag.includes("window") || nodeTag.includes("mat.7"))
      ) {
        windowCandidate = node;
      }

      const isCannon = nodeTag.includes("cannon") || nodeTag.includes("gun");
      const isMuzzle =
        nodeTag.includes("muzzle") ||
        nodeTag.includes("barrel") ||
        nodeTag.includes("tip");

      if (isCannon && isMuzzle) {
        node.userData = { ...node.userData, type: "cannon", muzzleTip: true };
      }

      if (!muzzleCandidate && node.userData?.muzzleTip) {
        muzzleCandidate = node;
      } else if (!muzzleCandidate && isCannon && nodeTag.includes("barrel")) {
        muzzleCandidate = node;
      } else if (!muzzleCandidate && isCannon) {
        muzzleCandidate = node;
      }

      if (Array.isArray(node.material)) {
        node.material = node.material.map((material) => {
          const clonedMaterial = material.clone();
          tuneShipMaterial(clonedMaterial);
          return clonedMaterial;
        });
      } else {
        const clonedMaterial = node.material.clone();
        tuneShipMaterial(clonedMaterial);
        node.material = clonedMaterial;
      }
    });

    const entryCandidate = doorCandidate || windowCandidate;

    if (entryCandidate) {
      shipScene.updateMatrixWorld(true);
      worldBox.setFromObject(entryCandidate);
      const worldCenter = worldBox.getCenter(new THREE.Vector3());
      windowAnchorLocalRef.current.copy(worldCenter);
      shipScene.worldToLocal(windowAnchorLocalRef.current);
    }

    if (muzzleCandidate && onMuzzleReady) {
      onMuzzleReady(muzzleCandidate);
    }
  }, [onMuzzleReady, shipScene, worldBox]);

  useFrame((state) => {
    if (!hullRef.current) return;
    const elapsed = state.clock.elapsedTime;
    worldPointToOceanLocal(hullRef.current.position, seaLocalCenter);

    sampleOceanSurface(seaLocalCenter.x, seaLocalCenter.y, elapsed, seaSample);
    oceanLocalToWorld(seaSample, seaWorldSample);
    const centerHeight = seaWorldSample.y;

    shipSampleWorld
      .copy(hullRef.current.position)
      .addScaledVector(shipForward, SHIP_LENGTH_SAMPLE);
    worldPointToOceanLocal(shipSampleWorld, seaLocalBow);

    shipSampleWorld
      .copy(hullRef.current.position)
      .addScaledVector(shipForward, -SHIP_LENGTH_SAMPLE);
    worldPointToOceanLocal(shipSampleWorld, seaLocalStern);

    shipSampleWorld
      .copy(hullRef.current.position)
      .addScaledVector(shipRight, -SHIP_BEAM_SAMPLE);
    worldPointToOceanLocal(shipSampleWorld, seaLocalPort);

    shipSampleWorld
      .copy(hullRef.current.position)
      .addScaledVector(shipRight, SHIP_BEAM_SAMPLE);
    worldPointToOceanLocal(shipSampleWorld, seaLocalStarboard);

    sampleOceanSurface(seaLocalBow.x, seaLocalBow.y, elapsed, seaSample);
    const bowHeight = oceanLocalToWorld(seaSample, seaWorldSample).y;
    sampleOceanSurface(seaLocalStern.x, seaLocalStern.y, elapsed, seaSample);
    const sternHeight = oceanLocalToWorld(seaSample, seaWorldSample).y;
    sampleOceanSurface(seaLocalPort.x, seaLocalPort.y, elapsed, seaSample);
    const portHeight = oceanLocalToWorld(seaSample, seaWorldSample).y;
    sampleOceanSurface(
      seaLocalStarboard.x,
      seaLocalStarboard.y,
      elapsed,
      seaSample,
    );
    const starboardHeight = oceanLocalToWorld(seaSample, seaWorldSample).y;
    const averageLengthHeight = (bowHeight + sternHeight) * 0.5;
    const wavePitch = -Math.atan2(
      bowHeight - sternHeight,
      SHIP_LENGTH_SAMPLE * 2,
    );
    const targetPitch = THREE.MathUtils.clamp(
      wavePitch * SHIP_PITCH_GAIN,
      -SHIP_MAX_PITCH,
      SHIP_MAX_PITCH,
    );
    const bowClearanceHeight =
      bowHeight +
      SHIP_DRAFT_CLEARANCE +
      SHIP_LENGTH_SAMPLE * Math.sin(targetPitch);
    const sternClearanceHeight =
      sternHeight +
      SHIP_DRAFT_CLEARANCE -
      SHIP_LENGTH_SAMPLE * Math.sin(targetPitch);
    const targetHeight = Math.max(
      centerHeight * 0.35 + averageLengthHeight * 0.65 + SHIP_DRAFT_CLEARANCE,
      bowClearanceHeight,
      sternClearanceHeight,
    );
    const targetRoll = THREE.MathUtils.clamp(
      (starboardHeight - portHeight) * 0.075,
      -0.045,
      0.045,
    );

    hullRef.current.position.y = THREE.MathUtils.lerp(
      hullRef.current.position.y,
      targetHeight,
      SHIP_HEAVE_RESPONSE,
    );
    hullRef.current.position.x = THREE.MathUtils.lerp(
      hullRef.current.position.x,
      shipBasePosition.x,
      0.025,
    );
    hullRef.current.position.z = THREE.MathUtils.lerp(
      hullRef.current.position.z,
      shipBasePosition.z,
      0.025,
    );

    hullRef.current.rotation.x = THREE.MathUtils.lerp(
      hullRef.current.rotation.x,
      SHIP_BASE_ROTATION_X + targetPitch,
      SHIP_PITCH_RESPONSE,
    );
    hullRef.current.rotation.z = THREE.MathUtils.lerp(
      hullRef.current.rotation.z,
      SHIP_BASE_ROTATION_Z + targetRoll,
      0.055,
    );

    if (!shipPrimitiveRef.current || !onWindowAnchorFrame) return;
    const lastWindowAnchor = lastWindowAnchorRef.current;

    if (elapsed - lastWindowAnchor.sentAt < WINDOW_ANCHOR_UPDATE_INTERVAL) {
      return;
    }

    localWindowCenter
      .copy(windowAnchorLocalRef.current)
      .add(selectedWindowOffsetLocal);

    const halfWidthLocal = 145;
    const halfHeightLocal = 210;
    localWindowCorners[0].set(
      localWindowCenter.x - halfWidthLocal,
      localWindowCenter.y - halfHeightLocal,
      localWindowCenter.z,
    );
    localWindowCorners[1].set(
      localWindowCenter.x + halfWidthLocal,
      localWindowCenter.y - halfHeightLocal,
      localWindowCenter.z,
    );
    localWindowCorners[2].set(
      localWindowCenter.x + halfWidthLocal,
      localWindowCenter.y + halfHeightLocal,
      localWindowCenter.z,
    );
    localWindowCorners[3].set(
      localWindowCenter.x - halfWidthLocal,
      localWindowCenter.y + halfHeightLocal,
      localWindowCenter.z,
    );

    const projectedCorners = localWindowCorners.map((corner) => {
      worldCorner
        .copy(corner)
        .applyMatrix4(shipPrimitiveRef.current.matrixWorld);
      ndcCorner.copy(worldCorner).project(camera);

      return {
        x: (ndcCorner.x * 0.5 + 0.5) * size.width,
        y: (-ndcCorner.y * 0.5 + 0.5) * size.height,
        z: ndcCorner.z,
      };
    });

    const isVisible = projectedCorners.every(
      (corner) =>
        corner.z > -1 &&
        corner.z < 1 &&
        corner.x >= -20 &&
        corner.x <= size.width + 20 &&
        corner.y >= -20 &&
        corner.y <= size.height + 20,
    );

    const points = projectedCorners
      .map((corner) => `${corner.x.toFixed(0)},${corner.y.toFixed(0)}`)
      .join(" ");

    const shouldSendWindowAnchor =
      isVisible !== lastWindowAnchor.isVisible ||
      points !== lastWindowAnchor.points;

    if (shouldSendWindowAnchor) {
      lastWindowAnchor.points = points;
      lastWindowAnchor.isVisible = isVisible;
      lastWindowAnchor.sentAt = elapsed;
      onWindowAnchorFrame({ points, isVisible });
    } else {
      lastWindowAnchor.sentAt = elapsed;
    }
  });

  const setHullRef = useCallback(
    (node) => {
      hullRef.current = node;
      if (shipGroupRef) {
        shipGroupRef.current = node;
      }
    },
    [shipGroupRef],
  );

  return (
    <group
      ref={setHullRef}
      position={SHIP_BASE_POSITION}
      rotation={[
        SHIP_BASE_ROTATION_X,
        SHIP_BASE_ROTATION_Y,
        SHIP_BASE_ROTATION_Z,
      ]}
      scale={0.001}
    >
      <primitive ref={shipPrimitiveRef} object={shipScene} />
    </group>
  );
}

function DistantIsland() {
  const { scene } = useGLTF(islandModel);
  const islandScene = useMemo(() => {
    const model = scene.clone(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = 12 / Math.max(size.y, 0.001);
    model.scale.setScalar(scale);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.set(
      -center.x * scale,
      -bounds.min.y * scale,
      -center.z * scale,
    );
    return model;
  }, [scene]);

  return (
    <primitive
      object={islandScene}
      position={[CANNON_TARGET.x, CANNON_TARGET.y - 0.58, CANNON_TARGET.z]}
      rotation={[0, (4 * Math.PI) / 3 + 0.05, 0]}
    />
  );
}

function CannonSequence({ isActive, muzzleRef, shipGroupRef, onComplete }) {
  const { camera, scene } = useThree();
  const sequenceRef = useRef({
    active: false,
    completed: false,
    startedAt: 0,
    muzzleWorld: new THREE.Vector3(),
  });
  const ballRef = useRef(null);
  const ballTextureRef = useRef(null);
  const ballTrailLightRef = useRef(null);
  const flashRef = useRef(null);
  const smokeRef = useRef([]);
  const trailRef = useRef(null);
  const target = useMemo(() => CANNON_TARGET.clone(), []);
  const shipWorld = useMemo(() => new THREE.Vector3(), []);
  const lookAtTarget = useMemo(() => new THREE.Vector3(), []);
  const desiredCamera = useMemo(() => new THREE.Vector3(), []);
  const muzzleOffset = useMemo(() => new THREE.Vector3(-1.2, 0.8, 2.2), []);
  const wideOffset = useMemo(() => new THREE.Vector3(-1.8, 10.0, 17.5), []);
  const ballOffset = useMemo(() => new THREE.Vector3(-3, 6, 5), []);

  const createCannonballTexture = useCallback(() => {
    const size = 64;
    const data = new Uint8Array(size * size);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.floor(90 + Math.random() * 165);
    }
    const texture = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 3);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  }, []);

  const cleanupObjects = useCallback(() => {
    if (ballRef.current) {
      scene.remove(ballRef.current);
      ballRef.current.geometry.dispose();
      ballRef.current.material.dispose();
      ballRef.current = null;
    }

    if (ballTextureRef.current) {
      ballTextureRef.current.dispose();
      ballTextureRef.current = null;
    }

    if (ballTrailLightRef.current) {
      scene.remove(ballTrailLightRef.current);
      ballTrailLightRef.current = null;
    }

    if (trailRef.current) {
      scene.remove(trailRef.current.line);
      trailRef.current.line.geometry.dispose();
      trailRef.current.line.material.dispose();
      trailRef.current = null;
    }

    smokeRef.current.forEach(({ mesh }) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    smokeRef.current = [];

    if (flashRef.current) {
      scene.remove(flashRef.current.light);
      flashRef.current = null;
    }
  }, [scene]);

  useEffect(() => cleanupObjects, [cleanupObjects]);

  useEffect(() => {
    if (!isActive) {
      sequenceRef.current.active = false;
      sequenceRef.current.completed = false;
      return;
    }

    return undefined;
  }, [isActive]);

  const startSequence = useCallback(
    (clockTime) => {
      sequenceRef.current.active = true;
      sequenceRef.current.completed = false;
      sequenceRef.current.startedAt = clockTime;
      const muzzleWorld = sequenceRef.current.muzzleWorld;
      if (muzzleRef.current) {
        muzzleRef.current.getWorldPosition(muzzleWorld);
      } else if (shipGroupRef?.current) {
        shipGroupRef.current.getWorldPosition(muzzleWorld);
        muzzleWorld.x += 1.2;
        muzzleWorld.y += 0.3;
        muzzleWorld.z += 0.8;
      } else {
        muzzleWorld.set(1.8, 0.1, 7.2);
      }

      if (ballTextureRef.current) {
        ballTextureRef.current.dispose();
      }
      const ballTexture = createCannonballTexture();
      ballTextureRef.current = ballTexture;

      const ballGeometry = new THREE.SphereGeometry(0.07, 24, 24);
      const ballMaterial = new THREE.MeshStandardMaterial({
        color: "#2a2a2a",
        emissive: "#0a0a0a",
        emissiveIntensity: 0.05,
        roughness: 0.5,
        metalness: 0.85,
        bumpMap: ballTexture,
        bumpScale: 0.08,
        roughnessMap: ballTexture,
        metalnessMap: ballTexture,
      });
      const ballMesh = new THREE.Mesh(ballGeometry, ballMaterial);
      ballMesh.position.copy(muzzleWorld);
      scene.add(ballMesh);
      ballRef.current = ballMesh;

      const flashLight = new THREE.PointLight("#ffcc66", 28, 30, 2.1);
      flashLight.position.copy(muzzleWorld);
      scene.add(flashLight);
      flashRef.current = { light: flashLight, age: 0 };

      const smokeMaterial = new THREE.MeshStandardMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.85,
        roughness: 1,
        metalness: 0,
        depthWrite: false,
      });

      const smokeParticles = Array.from({ length: 14 }, () => {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.22, 12, 12),
          smokeMaterial.clone(),
        );
        mesh.position.copy(muzzleWorld);
        mesh.position.add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.4,
            Math.random() * 0.15,
            (Math.random() - 0.5) * 0.4,
          ),
        );
        scene.add(mesh);
        return {
          mesh,
          age: 0,
          velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 0.45,
            0.4 + Math.random() * 0.35,
            (Math.random() - 0.5) * 0.45,
          ),
        };
      });

      smokeMaterial.dispose();

      smokeRef.current = smokeParticles;

      return true;
    },
    [createCannonballTexture, muzzleRef, scene, shipGroupRef],
  );

  useFrame((state, delta) => {
    if (!isActive) {
      return;
    }

    if (!sequenceRef.current.active) {
      startSequence(state.clock.elapsedTime);
      return;
    }

    if (sequenceRef.current.completed) {
      return;
    }

    const elapsed = state.clock.elapsedTime - sequenceRef.current.startedAt;
    const t = Math.min(elapsed / CANNON_DURATION, 1);
    const tEased = t * t * (3 - 2 * t);
    const muzzleWorld = sequenceRef.current.muzzleWorld;

    if (ballRef.current) {
      const nextX = THREE.MathUtils.lerp(muzzleWorld.x, target.x, tEased);
      const nextZ = THREE.MathUtils.lerp(muzzleWorld.z, target.z, tEased);
      const baseY = THREE.MathUtils.lerp(muzzleWorld.y, target.y, tEased);
      const arcY = baseY + CANNON_ARC_PEAK * Math.sin(tEased * Math.PI);
      ballRef.current.position.set(nextX, arcY, nextZ);
      if (!ballTrailLightRef.current) {
        const trailLight = new THREE.PointLight("#d8d8d8", 3.0, 12, 2);
        scene.add(trailLight);
        ballTrailLightRef.current = trailLight;
      }
      ballTrailLightRef.current.position.copy(ballRef.current.position);
    }

    smokeRef.current.forEach((particle) => {
      particle.age += delta;
      particle.mesh.position.addScaledVector(particle.velocity, delta);
      particle.mesh.material.opacity = Math.max(1 - particle.age / 2.8, 0);
      particle.mesh.visible = particle.mesh.material.opacity > 0.01;
    });

    if (flashRef.current) {
      flashRef.current.age += delta;
      const flashProgress = Math.min(flashRef.current.age / 0.55, 1);
      flashRef.current.light.intensity = 28 * (1 - flashProgress);
    }

    if (ballRef.current) {
      const phaseTime = elapsed;
      if (phaseTime < 4 && shipGroupRef?.current) {
        shipGroupRef.current.getWorldPosition(shipWorld);
        desiredCamera.copy(shipWorld).add(wideOffset);
        lookAtTarget.copy(ballRef.current.position);
        camera.position.lerp(desiredCamera, 0.03);
        camera.lookAt(lookAtTarget);
      } else if (phaseTime < 8) {
        desiredCamera.copy(ballRef.current.position).add(muzzleOffset);
        lookAtTarget.copy(ballRef.current.position);
        camera.position.lerp(desiredCamera, 0.06);
        camera.lookAt(lookAtTarget);
      } else {
        desiredCamera.copy(ballRef.current.position).add(ballOffset);
        lookAtTarget.copy(ballRef.current.position);
        camera.position.lerp(desiredCamera, 0.07);
        camera.lookAt(lookAtTarget);
      }
    }

    if (elapsed >= 4.8 && !sequenceRef.current.completed) {
      if (ballRef.current && ballRef.current.visible) {
        ballRef.current.visible = false;
        if (ballTrailLightRef.current) {
          scene.remove(ballTrailLightRef.current);
          ballTrailLightRef.current = null;
        }
      }
      sequenceRef.current.completed = true;
      Promise.resolve().then(() => onComplete?.());
    }
  });

  return null;
}

function OceanImageDrift() {
  const textures = useLoader(THREE.TextureLoader, OCEAN_IMAGE_URLS);
  const meshRefs = useRef([]);
  const lastImageUpdateRef = useRef(-Infinity);
  const { gl } = useThree();
  const centerPosition = useMemo(() => new THREE.Vector3(), []);
  const vertexPosition = useMemo(() => new THREE.Vector3(), []);

  const driftItems = useMemo(
    () =>
      textures.map((texture, index) => {
        // Each image takes one blue-noise point; no rows or columns.
        const point = OCEAN_IMAGE_POINTS[index % OCEAN_IMAGE_POINTS.length];
        const aspect =
          texture.image?.width && texture.image?.height
            ? texture.image.width / texture.image.height
            : 1;
        const height =
          OCEAN_IMAGE_MIN_HEIGHT +
          seededUnit(index * 13.47) *
            (OCEAN_IMAGE_MAX_HEIGHT - OCEAN_IMAGE_MIN_HEIGHT);

        return {
          texture,
          x: point.x,
          y: OCEAN_DRIFT_MIN_Y + point.y,
          phase: index * 0.73,
          swayPhase: seededUnit(index * 8.11) * Math.PI * 2,
          speed: OCEAN_DRIFT_SPEED,
          width: THREE.MathUtils.clamp(
            height * aspect,
            OCEAN_IMAGE_MIN_WIDTH,
            OCEAN_IMAGE_MAX_WIDTH,
          ),
          height,
          tilt: THREE.MathUtils.degToRad((seededUnit(index * 29.91) - 0.5) * 7),
        };
      }),
    [textures],
  );

  useEffect(() => {
    const anisotropy = gl.capabilities.getMaxAnisotropy();
    textures.forEach((texture) => {
      // Downscale the 512x512 source into a small canvas so the GPU only ever
      // stores OCEAN_IMAGE_TEXTURE_SIZE^2 per image (~16x less VRAM). The planes
      // are tiny on screen, so there is no visible loss.
      const source = texture.image;
      if (source && source.width > OCEAN_IMAGE_TEXTURE_SIZE) {
        const canvas = document.createElement("canvas");
        canvas.width = OCEAN_IMAGE_TEXTURE_SIZE;
        canvas.height = OCEAN_IMAGE_TEXTURE_SIZE;
        const context = canvas.getContext("2d");
        if (context) {
          context.drawImage(source, 0, 0, OCEAN_IMAGE_TEXTURE_SIZE, OCEAN_IMAGE_TEXTURE_SIZE);
          texture.image = canvas;
        }
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, anisotropy);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.offset.set(0, 0);
      texture.repeat.set(1, 1);
      texture.needsUpdate = true;
    });
  }, [gl, textures]);

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime;

    if (elapsed - lastImageUpdateRef.current < OCEAN_IMAGE_UPDATE_INTERVAL) {
      return;
    }

    lastImageUpdateRef.current = elapsed;

    driftItems.forEach((item, index) => {
      const mesh = meshRefs.current[index];
      if (!mesh) return;

      const localY = wrapRange(
        item.y - elapsed * item.speed,
        OCEAN_DRIFT_MIN_Y,
        OCEAN_DRIFT_MAX_Y,
      );
      // Gentle bounded sway only — no position-dependent pull toward centre, so
      // the guaranteed column spacing is never compressed away.
      const localX =
        item.x +
        Math.sin(elapsed * 0.33 + item.swayPhase) * OCEAN_IMAGE_SWAY_AMPLITUDE;
      const surfacePosition = sampleOceanSurface(
        localX,
        localY,
        elapsed,
        centerPosition,
      );
      const edgeFade =
        smoothstep(
          OCEAN_DRIFT_MIN_Y,
          OCEAN_DRIFT_MIN_Y + OCEAN_IMAGE_FADE_MARGIN,
          localY,
        ) *
        (1 -
          smoothstep(
            OCEAN_DRIFT_MAX_Y - OCEAN_IMAGE_FADE_MARGIN,
            OCEAN_DRIFT_MAX_Y,
            localY,
          ));
      mesh.material.opacity = OCEAN_IMAGE_MAX_OPACITY * edgeFade;
      mesh.visible = edgeFade > 0.01;

      if (!mesh.visible) {
        return;
      }

      const tilt = item.tilt + Math.sin(elapsed * 0.42 + item.phase) * 0.03;
      const tiltCos = Math.cos(tilt);
      const tiltSin = Math.sin(tilt);
      const positionAttribute = mesh.geometry.attributes.position;
      const basePositions = mesh.geometry.userData.basePositions;

      if (!basePositions) {
        mesh.geometry.userData.basePositions = Float32Array.from(
          positionAttribute.array,
        );
        return;
      }

      mesh.position.copy(surfacePosition);

      for (
        let vertexIndex = 0;
        vertexIndex < positionAttribute.count;
        vertexIndex += 1
      ) {
        const attributeIndex = vertexIndex * 3;
        const offsetX = basePositions[attributeIndex];
        const offsetY = basePositions[attributeIndex + 1];
        const sampleX = localX + offsetX * tiltCos - offsetY * tiltSin;
        const sampleY = localY + offsetX * tiltSin + offsetY * tiltCos;

        sampleOceanSurface(sampleX, sampleY, elapsed, vertexPosition);
        positionAttribute.array[attributeIndex] =
          vertexPosition.x - surfacePosition.x;
        positionAttribute.array[attributeIndex + 1] =
          vertexPosition.y - surfacePosition.y;
        positionAttribute.array[attributeIndex + 2] =
          vertexPosition.z - surfacePosition.z + OCEAN_IMAGE_SURFACE_OFFSET;
      }

      positionAttribute.needsUpdate = true;
    });
  });

  if (!driftItems.length) {
    return null;
  }

  return (
    <group rotation={SEA_ROTATION} position={SEA_POSITION}>
      {driftItems.map((item, index) => (
        <mesh
          key={item.texture.uuid}
          ref={(node) => {
            meshRefs.current[index] = node;
            if (
              node?.geometry?.attributes?.position &&
              !node.geometry.userData.basePositions
            ) {
              node.geometry.userData.basePositions = Float32Array.from(
                node.geometry.attributes.position.array,
              );
            }
          }}
          position={[item.x, item.y, 0.06]}
        >
          <planeGeometry
            args={[
              item.width,
              item.height,
              OCEAN_IMAGE_SEGMENTS_X,
              OCEAN_IMAGE_SEGMENTS_Y,
            ]}
          />
          <meshBasicMaterial
            map={item.texture}
            color="#fff7df"
            transparent
            opacity={OCEAN_IMAGE_MAX_OPACITY}
            side={THREE.DoubleSide}
            depthTest
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function SeaLayer() {
  const waterMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uDeepColor: { value: new THREE.Color("#0a2740") },
          uShallowColor: { value: new THREE.Color("#258ca8") },
          uHighlightColor: { value: new THREE.Color("#b8ecff") },
          uFoamColor: { value: new THREE.Color("#cfeff4") },
        },
        vertexShader: `
          uniform float uTime;
          varying vec2 vUv;
          varying float vWave;
          varying float vCrest;
          varying float vSlope;

          void addGerstnerWave(
            vec2 basePosition,
            vec2 direction,
            float amplitude,
            float wavelength,
            float speed,
            float steepness,
            float time,
            inout vec3 nextPosition,
            inout vec3 tangentX,
            inout vec3 tangentY,
            inout float crest
          ) {
            float frequency = 6.28318530718 / wavelength;
            float phase =
              frequency * (dot(direction, basePosition) - speed * time);
            float sinPhase = sin(phase);
            float cosPhase = cos(phase);
            float horizontalDisplacement = steepness * amplitude * cosPhase;
            float derivative =
              steepness * amplitude * frequency * sinPhase;
            float heightDerivative = amplitude * frequency * cosPhase;

            nextPosition.xy += direction * horizontalDisplacement;
            nextPosition.z += amplitude * sinPhase;

            tangentX.x -= direction.x * direction.x * derivative;
            tangentX.y -= direction.x * direction.y * derivative;
            tangentX.z += direction.x * heightDerivative;
            tangentY.x -= direction.x * direction.y * derivative;
            tangentY.y -= direction.y * direction.y * derivative;
            tangentY.z += direction.y * heightDerivative;
            crest += smoothstep(0.72, 1.0, sinPhase) * amplitude;
          }

          void main() {
            vUv = uv;

            vec2 basePosition = position.xy;
            vec3 nextPosition = position;
            vec3 tangentX = vec3(1.0, 0.0, 0.0);
            vec3 tangentY = vec3(0.0, 1.0, 0.0);
            float crest = 0.0;

${GERSTNER_SHADER_CALLS}

            vec3 surfaceNormal = normalize(cross(tangentX, tangentY));
            vWave = nextPosition.z;
            vCrest = crest;
            vSlope = 1.0 - surfaceNormal.z;

            gl_Position = projectionMatrix * modelViewMatrix * vec4(nextPosition, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform vec3 uDeepColor;
          uniform vec3 uShallowColor;
          uniform vec3 uHighlightColor;
          uniform vec3 uFoamColor;

          varying vec2 vUv;
          varying float vWave;
          varying float vCrest;
          varying float vSlope;

          void main() {
            float distanceGlow = smoothstep(0.05, 0.92, vUv.y);
            float currentLines =
              sin(vUv.y * 64.0 + uTime * 2.2 + sin(vUv.x * 11.0) * 0.7);
            float brokenLineMask =
              0.55 + 0.45 * sin(vUv.x * 21.0 + sin(vUv.y * 9.0) * 0.8);
            float surfaceMotion = smoothstep(0.62, 0.98, currentLines) * brokenLineMask;

            vec3 color = mix(uDeepColor, uShallowColor, distanceGlow * 0.72);
            color += uHighlightColor * surfaceMotion * 0.11;
            color += uHighlightColor * smoothstep(0.035, 0.16, vWave) * 0.12;
            color += uFoamColor * smoothstep(0.025, 0.11, vCrest) * 0.22;
            color += uFoamColor * smoothstep(0.045, 0.16, vSlope) * 0.14;

            gl_FragColor = vec4(color, 1.0);
          }
        `,
      }),
    [],
  );
  const waterMaterialRef = useRef(waterMaterial);

  useEffect(() => {
    waterMaterialRef.current = waterMaterial;
  }, [waterMaterial]);

  useFrame((state) => {
    waterMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <group>
      <mesh rotation={SEA_ROTATION} position={SEA_POSITION} receiveShadow>
        <planeGeometry args={[420, 320, 220, 160]} />
        <primitive object={waterMaterial} attach="material" />
      </mesh>
      <mesh rotation={SEA_ROTATION} position={[0, -0.61, 0]}>
        <planeGeometry args={[420, 320]} />
        <meshBasicMaterial
          color="#9cd9ea"
          transparent
          opacity={0.035}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function CameraSideLight() {
  const keyLightRef = useRef(null);
  const fillLightRef = useRef(null);
  const { camera } = useThree();

  const sideOffset = useMemo(() => new THREE.Vector3(3.4, 1.8, 0), []);
  const fillOffset = useMemo(() => new THREE.Vector3(1.6, 0.9, -3.5), []);
  const shipFocus = useMemo(() => new THREE.Vector3(1, 0.9, 1.8), []);
  const worldSideOffset = useMemo(() => new THREE.Vector3(), []);
  const worldFillOffset = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!keyLightRef.current) return;

    worldSideOffset.copy(sideOffset).applyQuaternion(camera.quaternion);
    keyLightRef.current.position.copy(camera.position).add(worldSideOffset);
    keyLightRef.current.target.position.copy(shipFocus);
    keyLightRef.current.target.updateMatrixWorld();

    if (fillLightRef.current) {
      worldFillOffset.copy(fillOffset).applyQuaternion(camera.quaternion);
      fillLightRef.current.position.copy(camera.position).add(worldFillOffset);
    }
  });

  return (
    <>
      <directionalLight ref={keyLightRef} intensity={2.6} color="#ffc982" />
      <pointLight
        ref={fillLightRef}
        intensity={1.35}
        color="#ffd8a0"
        distance={48}
        decay={1.6}
      />
    </>
  );
}

function CinematicCamera({ active }) {
  const { camera } = useThree();
  const startTimeRef = useRef(null);
  const desiredPosition = useMemo(() => new THREE.Vector3(), []);
  const lookTarget = useMemo(() => CINEMATIC_TARGET.clone(), []);

  useFrame((state) => {
    if (!active) {
      startTimeRef.current = null;
      return;
    }

    if (startTimeRef.current === null) {
      startTimeRef.current = state.clock.elapsedTime;
    }

    const elapsed = state.clock.elapsedTime - startTimeRef.current;
    const progress = (elapsed % CINEMATIC_DURATION) / CINEMATIC_DURATION;
    const orbit = progress * Math.PI * 2 - 0.55;
    const radius = 13.3 + Math.sin(elapsed * 0.33) * 0.55;
    const height = 2.15 + Math.sin(elapsed * 0.42 + 0.8) * 0.28;

    desiredPosition.set(
      CINEMATIC_TARGET.x + Math.sin(orbit) * radius,
      height,
      CINEMATIC_TARGET.z + Math.cos(orbit) * radius,
    );

    lookTarget.set(
      CINEMATIC_TARGET.x,
      CINEMATIC_TARGET.y + Math.sin(elapsed * 0.36) * 0.12,
      CINEMATIC_TARGET.z,
    );

    camera.position.lerp(desiredPosition, 0.035);
    camera.lookAt(lookTarget);
  });

  return null;
}

function ShipExterior({
  onEnterWindow,
  uploadedCount,
  isFiringCannons = false,
  onCannonSequenceComplete,
  cinematicMode = null,
}) {
  const [isWindowHovered, setWindowHovered] = useState(false);
  const [isEntering, setEntering] = useState(false);
  const [localCinematic, setLocalCinematic] = useState(false);
  const [windowHotspot, setWindowHotspot] = useState({
    points: "",
    isVisible: false,
  });
  const isWebGLAvailable = useWebGLAvailable();
  const cannonMuzzleRef = useRef(null);
  const shipGroupRef = useRef(null);

  const handleMuzzleReady = useCallback((mesh) => {
    cannonMuzzleRef.current = mesh;
  }, []);

  const windowButtonPosition = useMemo(() => {
    if (!windowHotspot.points) return null;

    const corners = windowHotspot.points
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(",").map(Number))
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

    if (!corners.length) return null;

    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const left = xs.reduce((sum, x) => sum + x, 0) / xs.length;
    const top = ys.reduce((sum, y) => sum + y, 0) / ys.length;
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);

    return {
      left,
      top,
      scale: Math.max(0.92, Math.min(1.22, Math.min(width, height) / 84)),
    };
  }, [windowHotspot.points]);

  const handleWindowAnchorFrame = useCallback((nextState) => {
    setWindowHotspot((previous) => {
      if (
        previous.points === nextState.points &&
        previous.isVisible === nextState.isVisible
      ) {
        return previous;
      }

      return nextState;
    });
  }, []);

  useEffect(() => {
    if (!isEntering) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      onEnterWindow();
    }, 920);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isEntering, onEnterWindow]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        event.target?.isContentEditable
      ) {
        return;
      }

      if (event.key.toLowerCase() === "c" && cinematicMode === null) {
        setLocalCinematic((previous) => (isFiringCannons ? false : !previous));
      } else if (event.key === "Escape") {
        setLocalCinematic(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [cinematicMode, isFiringCannons]);

  const requestedCinematic =
    cinematicMode === null ? localCinematic : cinematicMode;
  const activeCinematic = requestedCinematic && !isFiringCannons;
  const showDeckUi = !isFiringCannons && !activeCinematic;

  return (
    <div
      className={`${styles.shipRoot} ${activeCinematic ? styles.cinematicMode : ""}`}
    >
      {isWebGLAvailable ? (
        <Canvas
          dpr={[1, 1.25]}
          camera={{ position: [2.1, 2.0, 14.2], fov: 34, near: 0.1, far: 200 }}
          gl={{ antialias: false, powerPreference: "default", alpha: false }}
        >
          <color attach="background" args={["#08192d"]} />
          <fog attach="fog" args={["#08192d", 20, 160]} />
          <NightSky
            radius={74}
            starCount={260}
            minStarY={0.005}
            moonPosition={[38, 13, -35]}
            topColor="#071326"
            horizonColor="#174061"
            moonColor="#f4dfab"
            warmSkyStrength={0.68}
            warmHorizonColor="#f08a38"
            warmBandColor="#df5f4a"
          />

          {/* Warm ambient to keep the full hull readable */}
          <ambientLight intensity={1.35} color="#ffd08a" />

          <hemisphereLight
            args={["#ffe2b3", "#102746", 0.66]}
            position={[0, 12, 0]}
          />

          {/* Key light follows the camera side so the ship stays lit from the viewer direction */}
          <CameraSideLight />

          <directionalLight
            position={[-8, 12, 7]}
            intensity={1.15}
            color="#c7ddff"
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
          />

          {/* Soft opposite fill keeps some depth in the silhouette */}
          <directionalLight
            position={[-7, 2, -9]}
            intensity={0.48}
            color="#e28b4d"
          />

          <SeaLayer />
          <OceanImageDrift />
          <DistantIsland />
          <ShipHull
            onWindowAnchorFrame={handleWindowAnchorFrame}
            onMuzzleReady={handleMuzzleReady}
            shipGroupRef={shipGroupRef}
          />
          <CannonSequence
            isActive={isFiringCannons}
            muzzleRef={cannonMuzzleRef}
            shipGroupRef={shipGroupRef}
            onComplete={onCannonSequenceComplete}
          />
          <CinematicCamera active={activeCinematic} />
          <OrbitControls
            target={[1, 0.7, 6.8]}
            enablePan={false}
            enableZoom
            minDistance={7.5}
            maxDistance={22}
            minPolarAngle={Math.PI * 0.24}
            maxPolarAngle={Math.PI * 0.48}
            enabled={!isFiringCannons && !activeCinematic}
          />
        </Canvas>
      ) : (
        <div className={styles.webglNotice}>
          <h2 className={styles.webglNoticeTitle}>WebGL unavailable</h2>
          <p className={styles.webglNoticeText}>
            Your browser cannot render the 3D ship scene on this device.
          </p>
          <p className={styles.webglNoticeHint}>
            Enable hardware acceleration or try a newer browser.
          </p>
        </div>
      )}

      {showDeckUi && (
        <div className={styles.headerBlock}>
          <h1 className={styles.title}>The Warden</h1>
          <p className={styles.counter}>{uploadedCount} images</p>
        </div>
      )}

      {showDeckUi && isWebGLAvailable && (
        <>
          <svg
            className={styles.windowOverlay}
            width="100%"
            height="100%"
            style={{ pointerEvents: "none" }}
          >
            <polygon
              className={`${styles.windowOverlayPolygon} ${isWindowHovered ? styles.windowOverlayPolygonActive : ""}`}
              points={windowHotspot.points}
              onMouseEnter={() => setWindowHovered(true)}
              onMouseLeave={() => setWindowHovered(false)}
              onClick={() => setEntering(true)}
            />
          </svg>

          {windowHotspot.isVisible && windowButtonPosition && (
            <button
              type="button"
              className={styles.windowHotspotButton}
              style={{
                left: `${windowButtonPosition.left}px`,
                top: `${windowButtonPosition.top}px`,
                "--window-scale": windowButtonPosition.scale,
              }}
              onMouseEnter={() => setWindowHovered(true)}
              onMouseLeave={() => setWindowHovered(false)}
              onClick={() => setEntering(true)}
            >
              Enter Cabin
            </button>
          )}

          <div className={styles.tips}>Click the door · C for tour</div>
        </>
      )}

      {showDeckUi && (
        <div
          className={`${styles.windowZoom} ${isEntering ? styles.windowZoomActive : ""}`}
        />
      )}
    </div>
  );
}

useGLTF.preload(islandModel);
export default ShipExterior;
