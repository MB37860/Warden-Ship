import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
} from "three";
import {
  buildCreativityReadings,
  ESTIMATED_YEAR_COLOR,
  ESTIMATED_YEAR_NOTE,
} from "../../../../utils/historicalAnalysis";
import {
  useHistoricalBuild,
  useHistoricalNodes,
} from "../../../../hooks/useHistoricalNodes";
import useWebGLAvailable from "../../../../hooks/useWebGLAvailable";
import { useRepeatingCanvasTexture } from "../../../../hooks/useCanvasTexture";
import { drawWoodGrainTexture } from "../../../../lib/f6TextureBuilders";
import { BRASS_MATERIAL, DARK_IRON_MATERIAL } from "../../../../lib/f6Constants";
import DustMotes from "../../f6/shared/DustMotes";
import CandleFlame from "../../f6/shared/CandleFlame";
import ParchmentTooltip from "../../f6/shared/ParchmentTooltip";
import usePointerCursor from "../../../../hooks/usePointerCursor";
import { useFullscreenImage } from "../../../shared/useFullscreenImage";
import BackButton from "../../../shared/BackButton";
import { BUILD_MESSAGES, LABELS, LOADING_MESSAGES } from "../../../../lib/uiCopy";
import styles from "./HistoryWallScene.module.css";

// =============================================================================
// One cabin scene, two maps. Every artwork is a ship standing out of a sea-chart
// on the wall. A toggle switches which map is plotted:
//   • Influence — ships placed by year × map-position, linked by sail-path
//     routes; click a ship to keep only its route, click again to view it.
//   • Creativity — ships placed by year × creativity (higher + brighter = more
//     creative), with a glowing tide line for the trend; click a ship to view.
// =============================================================================

const FLOOR_Y = -2.55;
const BACK_Z = -2.95;
const WALL_X = 3.3;
const ROOM_TOP = 2.75;
const DESK_TOP = -1.5;

const MAP_W = 5.6;
const MAP_H = 3.0;
const MAP_CY = 0.6;
const MAP_Z = BACK_Z + 0.16;
const SHIP_Z = BACK_Z + 0.3;
const MX = 0.45;
const MY = 0.4;
const MAX_EDGES = 80;
const MAX_SHIPS = 80;
const TREND_BUCKETS = 16;

// Creativity scoring defaults (the tunable "lens" panel has been removed).
const CREATIVITY_BETA = 0.56;
const CREATIVITY_DIMENSION = "overall";

const MIN_X = -MAP_W / 2 + MX;
const MAX_X = MAP_W / 2 - MX;
const MIN_Y = MAP_CY - MAP_H / 2 + MY;
const MAX_Y = MAP_CY + MAP_H / 2 - MY;

const SAIL_GEO = new BufferGeometry();
SAIL_GEO.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 0, 0.15, 0, 0.1, 0.02, 0], 3));
SAIL_GEO.computeVertexNormals();

const MAP_TITLES = {
  influence: "ROUTES OF INFLUENCE",
  creativity: "CREATIVITY CURRENTS",
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function percent(value) {
  return `${Math.round(clamp(value) * 100)}%`;
}

function hashUnit(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const v = Math.sin(Math.abs(hash) * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

function yearBounds(items) {
  const years = items.map((item) => item.year).filter(Number.isFinite);
  if (!years.length) return { min: 1400, max: 1900 };
  const min = Math.min(...years);
  const max = Math.max(...years);
  if (min === max) return { min: min - 50, max: max + 50 };
  return { min, max };
}

function yearToX(year, bounds) {
  const t = (year - bounds.min) / (bounds.max - bounds.min || 1);
  return MIN_X + clamp(t) * (MAX_X - MIN_X);
}

function creativityToY(value) {
  return MIN_Y + clamp(value) * (MAX_Y - MIN_Y);
}

// --- Influence graph --------------------------------------------------------
function buildShipNetwork(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set();
  const edges = [];
  nodes.forEach((newer) => {
    (newer.neighbors || []).forEach((neighbor) => {
      const earlier = byId.get(String(neighbor.id));
      if (!earlier || earlier.id === newer.id || earlier.year >= newer.year) return;
      const sim = clamp(neighbor.similarity);
      if (sim <= 0.08) return;
      const key = `${earlier.id}->${newer.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ id: key, from: earlier.id, to: newer.id, sim });
    });
  });
  edges.sort((a, b) => b.sim - a.sim);
  const topEdges = edges.slice(0, MAX_EDGES);
  const degree = new Map();
  topEdges.forEach((edge) => {
    degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
  });
  const shipIds = [...degree.keys()].sort((a, b) => degree.get(b) - degree.get(a)).slice(0, MAX_SHIPS);
  const shipIdSet = new Set(shipIds);
  const ships = nodes.filter((node) => shipIdSet.has(node.id));
  const keptEdges = topEdges.filter((e) => shipIdSet.has(e.from) && shipIdSet.has(e.to));
  const adjacency = new Map();
  ships.forEach((ship) => adjacency.set(ship.id, new Set()));
  keptEdges.forEach((edge) => {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  });
  return { ships, edges: keptEdges, adjacency, total: degree.size };
}

function relaxInfluencePositions(ships, bounds) {
  const points = ships.map((ship) => ({
    id: ship.id,
    node: ship,
    x: yearToX(ship.year, bounds),
    y: MIN_Y + clamp(ship.projectedY) * (MAX_Y - MIN_Y),
  }));
  const minDist = points.length > 48 ? 0.24 : 0.32;
  for (let iter = 0; iter < 60; iter += 1) {
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const dx = points[j].x - points[i].x;
        const dy = points[j].y - points[i].y;
        const d = Math.hypot(dx, dy) || 0.0001;
        if (d < minDist) {
          const push = (minDist - d) / 2;
          points[i].x -= (dx / d) * push;
          points[i].y -= (dy / d) * push;
          points[j].x += (dx / d) * push;
          points[j].y += (dy / d) * push;
        }
      }
    }
    points.forEach((p) => {
      p.x = clamp(p.x, MIN_X, MAX_X);
      p.y = clamp(p.y, MIN_Y, MAX_Y);
    });
  }
  const map = new Map();
  points.forEach((p) => map.set(p.id, { x: p.x, y: p.y, node: p.node }));
  return map;
}

function selectByCreativity(readings, keepId) {
  if (readings.length <= MAX_SHIPS) return readings;
  const sorted = [...readings].sort((a, b) => b.creativity - a.creativity);
  const keep = new Map();
  sorted.slice(0, Math.floor(MAX_SHIPS * 0.6)).forEach((r) => keep.set(r.id, r));
  const stride = readings.length / (MAX_SHIPS - keep.size);
  for (let i = 0; i < readings.length && keep.size < MAX_SHIPS; i += stride) {
    const r = readings[Math.floor(i)];
    if (r) keep.set(r.id, r);
  }
  const active = readings.find((r) => r.id === keepId);
  if (active) keep.set(active.id, active);
  return [...keep.values()];
}

function tidePoints(readings, bounds) {
  if (readings.length < 2) return [];
  const ordered = [...readings].sort((a, b) => a.year - b.year);
  const size = Math.max(1, Math.ceil(ordered.length / TREND_BUCKETS));
  const out = [];
  for (let i = 0; i < ordered.length; i += size) {
    const bucket = ordered.slice(i, i + size);
    const x = bucket.reduce((s, r) => s + yearToX(r.year, bounds), 0) / bucket.length;
    const y = creativityToY(bucket.reduce((s, r) => s + clamp(r.creativity), 0) / bucket.length);
    out.push([x, y, SHIP_Z - 0.06]);
  }
  return out;
}

function sailPathPoints(a, b) {
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(0.45, len * 0.16);
  const cx = midX + (-dy / len) * bow;
  const cy = midY + (dx / len) * bow;
  return Array.from({ length: 18 }, (_, i) => {
    const t = i / 17;
    const inv = 1 - t;
    return [
      inv * inv * a.x + 2 * inv * t * cx + t * t * b.x,
      inv * inv * a.y + 2 * inv * t * cy + t * t * b.y,
      MAP_Z + 0.03,
    ];
  });
}

// --- The wall chart ---------------------------------------------------------
function drawWallMap(ctx, canvas, title) {
  const w = canvas.width;
  const h = canvas.height;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#efe1bf");
  g.addColorStop(0.5, "#e4d1a2");
  g.addColorStop(1, "#d8c089");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(96,72,38,0.05)";
  ctx.lineWidth = 2;
  for (let y = 90; y < h - 70; y += 50) {
    ctx.beginPath();
    for (let x = 44; x <= w - 44; x += 18) {
      const oy = Math.sin(x * 0.03 + y) * 4;
      if (x === 44) ctx.moveTo(x, y + oy);
      else ctx.lineTo(x, y + oy);
    }
    ctx.stroke();
  }
  [
    [w * 0.84, h * 0.24, 56],
    [w * 0.16, h * 0.74, 42],
  ].forEach(([cx, cy, R]) => {
    ctx.strokeStyle = "rgba(90,64,30,0.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * w, cy + Math.sin(a) * w);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(90,64,30,0.5)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      const len = i % 2 ? R * 0.55 : R;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  });
  [
    [w * 0.22, h * 0.32, 58],
    [w * 0.72, h * 0.62, 78],
    [w * 0.52, h * 0.2, 38],
  ].forEach(([ix, iy, r], k) => {
    ctx.fillStyle = "rgba(150,128,78,0.45)";
    ctx.strokeStyle = "rgba(90,64,30,0.5)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 9) {
      const rr = r * (0.72 + 0.28 * Math.sin(a * 3 + k));
      const px = ix + Math.cos(a) * rr;
      const py = iy + Math.sin(a) * rr * 0.78;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });
  const vig = ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.62);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(70,44,16,0.3)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  const cw = w * 0.54;
  const chh = h * 0.1;
  const cxx = (w - cw) / 2;
  const cyy = h - chh - 34;
  ctx.fillStyle = "rgba(245,232,200,0.82)";
  ctx.strokeStyle = "rgba(74,47,20,0.6)";
  ctx.lineWidth = 3;
  ctx.fillRect(cxx, cyy, cw, chh);
  ctx.strokeRect(cxx, cyy, cw, chh);
  ctx.fillStyle = "rgba(58,36,16,0.85)";
  ctx.font = `700 ${Math.round(h * 0.048)}px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, w / 2, cyy + chh / 2);

  ctx.strokeStyle = "rgba(74,47,20,0.55)";
  ctx.lineWidth = 14;
  ctx.strokeRect(16, 16, w - 32, h - 32);
  ctx.strokeStyle = "rgba(120,84,40,0.5)";
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, w - 60, h - 60);
}

function WallChart({ title }) {
  const mapTex = useMemo(() => {
    const width = 1280;
    const height = Math.round(width * (MAP_H / MAP_W));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    drawWallMap(ctx, canvas, title);
    const texture = new CanvasTexture(canvas);
    texture.anisotropy = 8;
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [title]);
  useEffect(() => () => mapTex.dispose(), [mapTex]);
  return (
    <group position={[0, MAP_CY, MAP_Z]}>
      <mesh raycast={() => null} position={[0, 0, -0.08]}>
        <boxGeometry args={[MAP_W + 0.34, MAP_H + 0.34, 0.08]} />
        <meshStandardMaterial color="#3a2616" roughness={0.8} />
      </mesh>
      <mesh raycast={() => null} position={[0, 0, 0.01]}>
        <planeGeometry args={[MAP_W, MAP_H]} />
        <meshBasicMaterial map={mapTex} toneMapped={false} />
      </mesh>
    </group>
  );
}

// --- A ship marker (one artwork) --------------------------------------------
function ShipMarker({ node, x, y, focused, faded, glow, onClick }) {
  const [hovered, setHovered] = useState(false);
  usePointerCursor(hovered);
  // Ships whose year was invented fly a different colour, so a guessed date is
  // never mistaken for a real one.
  const color = node.estimated ? ESTIMATED_YEAR_COLOR : node.color || "#c9954f";
  const sailColor = focused ? "#ffe6b8" : color;
  const scale = focused ? 1.35 : hovered ? 1.15 : 1;
  const opacity = faded ? 0.22 : 1;
  const haloR = 0.06 + clamp(glow) * 0.16;

  return (
    <group position={[x, y, SHIP_Z]} scale={scale}>
      <mesh raycast={() => null} position={[0, 0, -(SHIP_Z - MAP_Z) + 0.02]}>
        <circleGeometry args={[0.04, 16]} />
        <meshBasicMaterial color={color} transparent opacity={opacity * 0.7} />
      </mesh>
      {glow > 0 ? (
        <mesh raycast={() => null} position={[0, 0.08, -0.02]}>
          <sphereGeometry args={[haloR, 14, 12]} />
          <meshBasicMaterial color={color} transparent opacity={(0.12 + clamp(glow) * 0.32) * opacity} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      ) : null}
      <mesh raycast={() => null}>
        <boxGeometry args={[0.05, 0.04, 0.17]} />
        <meshStandardMaterial color="#2a1a0e" roughness={0.7} transparent opacity={opacity} />
      </mesh>
      <mesh raycast={() => null} position={[0, 0, 0.105]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.028, 0.06, 4]} />
        <meshStandardMaterial color="#2a1a0e" roughness={0.7} transparent opacity={opacity} />
      </mesh>
      <mesh raycast={() => null} position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.005, 0.005, 0.2, 6]} />
        <meshStandardMaterial color="#3a2614" transparent opacity={opacity} />
      </mesh>
      <mesh raycast={() => null} geometry={SAIL_GEO} position={[-0.004, 0.03, 0]}>
        <meshBasicMaterial color={sailColor} transparent opacity={opacity * 0.96} side={2} />
      </mesh>
      <mesh
        position={[0, 0.08, 0.02]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick(node);
        }}
      >
        <boxGeometry args={[0.2, 0.3, 0.26]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {hovered ? (
        <ParchmentTooltip
          visible
          title={node.title}
          hint={`${glow > 0 ? `creativity ${percent(glow)} · ${node.year}` : node.dateLabel || String(node.year)}${node.estimated ? " · estimated" : ""}`}
          position={[0, 0.42, 0.1]}
        />
      ) : null}
    </group>
  );
}

function SceneLights() {
  return (
    <>
      <ambientLight intensity={0.34} color="#ffe2b8" />
      <hemisphereLight args={["#ffdca0", "#140c06", 0.3]} />
      <pointLight position={[0, 1.4, BACK_Z + 1.6]} intensity={1.1} color="#ffe6c4" distance={9} />
      <pointLight position={[-1.9, 1.4, BACK_Z + 1.4]} intensity={0.5} color="#ffb870" distance={7} />
      <pointLight position={[1.9, 1.4, BACK_Z + 1.4]} intensity={0.5} color="#ffb870" distance={7} />
      <spotLight position={[0, 4.2, 1.5]} angle={0.7} penumbra={0.5} intensity={1.4} color="#ffd49a" distance={16} />
      <pointLight position={[0, 0.4, 3.2]} intensity={0.4} color="#ffe6c4" distance={10} />
    </>
  );
}

function CabinRoom() {
  const wallTex = useRepeatingCanvasTexture(drawWoodGrainTexture, [], 512, [4, 3]);
  const floorTex = useRepeatingCanvasTexture(drawWoodGrainTexture, [], 512, [7, 5]);
  return (
    <group>
      <mesh raycast={() => null} position={[0, FLOOR_Y, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[9.4, 7]} />
        <meshStandardMaterial color="#43331f" roughness={0.9} map={floorTex} />
      </mesh>
      <mesh raycast={() => null} position={[0, 0.1, BACK_Z]}>
        <planeGeometry args={[9.4, 6]} />
        <meshStandardMaterial color="#2c1c10" roughness={0.94} map={wallTex} emissive="#241308" emissiveIntensity={0.14} />
      </mesh>
      {[-3.4, -2.0, 2.0, 3.6].map((x) => (
        <mesh key={`seam-${x}`} raycast={() => null} position={[x, 0.1, BACK_Z + 0.02]}>
          <boxGeometry args={[0.03, 5.6, 0.04]} />
          <meshStandardMaterial color="#120a04" roughness={0.8} />
        </mesh>
      ))}
      <mesh raycast={() => null} position={[0, FLOOR_Y + 0.16, BACK_Z + 0.06]}>
        <boxGeometry args={[9.4, 0.32, 0.12]} />
        <meshStandardMaterial color="#27190d" roughness={0.82} />
      </mesh>
      <mesh raycast={() => null} position={[-WALL_X, 0.1, -0.1]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[6.6, 6]} />
        <meshStandardMaterial color="#241710" roughness={0.94} map={wallTex} />
      </mesh>
      <mesh raycast={() => null} position={[WALL_X, 0.1, -0.1]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[6.6, 6]} />
        <meshStandardMaterial color="#241710" roughness={0.94} map={wallTex} />
      </mesh>
      <mesh raycast={() => null} position={[0, ROOM_TOP - 0.12, -1.6]}>
        <boxGeometry args={[9.4, 0.3, 0.34]} />
        <meshStandardMaterial color="#1c1109" roughness={0.85} />
      </mesh>

      {/* Ceiling — closes the cabin off overhead. Faces down into the room. */}
      <mesh raycast={() => null} position={[0, ROOM_TOP, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[9.4, 7]} />
        <meshStandardMaterial color="#1f1409" roughness={0.95} map={wallTex} />
      </mesh>
      {/* cross-beams so the ceiling reads as planked timber, not a flat lid */}
      {[-0.6, 1.2].map((z) => (
        <mesh key={`beam-${z}`} raycast={() => null} position={[0, ROOM_TOP - 0.14, z]}>
          <boxGeometry args={[9.4, 0.26, 0.3]} />
          <meshStandardMaterial color="#1a1008" roughness={0.88} />
        </mesh>
      ))}
    </group>
  );
}

function HangingLantern({ position }) {
  return (
    <group position={position}>
      <mesh raycast={() => null} position={[0, 1.15, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 2.3, 6]} />
        <meshStandardMaterial {...DARK_IRON_MATERIAL} />
      </mesh>
      <mesh raycast={() => null} position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 0.34, 12, 1, true]} />
        <meshStandardMaterial color="#ffcf86" transparent opacity={0.32} emissive="#ffae4a" emissiveIntensity={0.55} side={2} />
      </mesh>
      <CandleFlame position={[0, -0.05, 0]} scale={0.9} />
      <pointLight position={[0, 0, 0]} color="#ffb259" intensity={0.7} distance={3.6} />
    </group>
  );
}

function WallSconce({ position }) {
  return (
    <group position={position}>
      <mesh raycast={() => null} position={[0, -0.12, 0.04]}>
        <boxGeometry args={[0.07, 0.34, 0.08]} />
        <meshStandardMaterial color="#3a2614" roughness={0.8} />
      </mesh>
      <mesh raycast={() => null} position={[0, 0.04, 0.18]}>
        <cylinderGeometry args={[0.06, 0.075, 0.1, 12]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      <CandleFlame position={[0, 0.12, 0.18]} scale={0.7} />
      <pointLight position={[0, 0.14, 0.5]} color="#ffb259" intensity={0.6} distance={3.2} />
    </group>
  );
}

function DeskWithProps() {
  return (
    <group>
      <mesh raycast={() => null} position={[0, DESK_TOP - 0.09, 0.6]}>
        <boxGeometry args={[6.2, 0.18, 1.8]} />
        <meshStandardMaterial color="#6f4a26" roughness={0.82} emissive="#241405" emissiveIntensity={0.08} />
      </mesh>
      {[
        [-2.9, 1.3],
        [2.9, 1.3],
        [-2.9, 0.0],
        [2.9, 0.0],
      ].map(([x, z]) => (
        <mesh key={`${x}-${z}`} raycast={() => null} position={[x, (DESK_TOP - 0.18 + FLOOR_Y) / 2, z]}>
          <boxGeometry args={[0.18, DESK_TOP - 0.18 - FLOOR_Y, 0.18]} />
          <meshStandardMaterial color="#4a3119" roughness={0.85} />
        </mesh>
      ))}
      <group position={[-2.0, DESK_TOP, 0.7]} rotation={[0, 0.3, 0]}>
        {[["#6e2b22", 0.04], ["#2d4a33", 0.1], ["#2b3a5a", 0.15]].map(([c, yy], i) => (
          <mesh key={i} raycast={() => null} position={[0, yy, 0]} rotation={[0, i * 0.1, 0]}>
            <boxGeometry args={[0.44 - i * 0.03, 0.055, 0.3 - i * 0.02]} />
            <meshStandardMaterial color={c} roughness={0.78} />
          </mesh>
        ))}
      </group>
      <group position={[1.9, DESK_TOP, 0.5]}>
        <mesh raycast={() => null} position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.14, 0.16, 0.04, 18]} />
          <meshStandardMaterial {...BRASS_MATERIAL} roughness={0.4} />
        </mesh>
        <mesh raycast={() => null} position={[0, 0.14, 0]}>
          <cylinderGeometry args={[0.038, 0.04, 0.18, 14]} />
          <meshStandardMaterial color="#efe2c2" roughness={0.9} />
        </mesh>
        <CandleFlame position={[0, 0.26, 0]} scale={0.85} />
        <pointLight position={[0, 0.3, 0]} color="#ffae54" intensity={0.5} distance={2.4} />
      </group>
      <group position={[-0.9, DESK_TOP + 0.2, 1.0]}>
        <mesh raycast={() => null}>
          <sphereGeometry args={[0.17, 22, 16]} />
          <meshStandardMaterial color="#5f93a6" roughness={0.7} emissive="#163039" emissiveIntensity={0.12} />
        </mesh>
        <mesh raycast={() => null} rotation={[0.4, 0, 0]}>
          <torusGeometry args={[0.18, 0.008, 8, 40]} />
          <meshStandardMaterial {...BRASS_MATERIAL} />
        </mesh>
        <mesh raycast={() => null} position={[0, -0.22, 0]}>
          <cylinderGeometry args={[0.05, 0.085, 0.12, 16]} />
          <meshStandardMaterial color="#4a2810" roughness={0.7} />
        </mesh>
      </group>
      <group position={[1.15, DESK_TOP + 0.03, 0.9]} rotation={[0, -0.4, 0]}>
        <mesh raycast={() => null} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.06, 0.06, 0.62, 14]} />
          <meshStandardMaterial color="#e6d6a8" roughness={0.9} />
        </mesh>
        <mesh raycast={() => null} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.062, 0.01, 8, 24]} />
          <meshStandardMaterial color="#7a1f18" roughness={0.7} />
        </mesh>
      </group>
    </group>
  );
}

function ChartWorld({ mode, ships, edges, positions, tide, glowById, focusId, viewId, onShipClick, title }) {
  return (
    // No OceanSway here: its constant rocking read as the camera drifting.
    <group>
      <CabinRoom />
      <DeskWithProps />
      <HangingLantern position={[-2.9, 1.5, 1.4]} />
      <WallSconce position={[-3.05, MAP_CY + 0.25, BACK_Z + 0.12]} />
      <WallSconce position={[3.05, MAP_CY + 0.25, BACK_Z + 0.12]} />
      <WallChart title={title} />
      {mode === "influence"
        ? edges.map((edge) => {
            const a = positions.get(edge.from);
            const b = positions.get(edge.to);
            if (!a || !b) return null;
            const active = focusId && (edge.from === focusId || edge.to === focusId);
            return (
              <Line
                key={edge.id}
                points={sailPathPoints(a, b)}
                color={active ? "#9c5a1c" : "#6a4a28"}
                lineWidth={active ? 2.4 : 1.1}
                transparent
                opacity={focusId ? (active ? 0.92 : 0) : 0.16}
                dashed
                dashSize={0.08}
                gapSize={0.06}
              />
            );
          })
        : null}
      {mode === "creativity" && tide.length > 1 ? (
        <>
          <Line points={tide} color="#7fe0e0" lineWidth={2.4} transparent opacity={0.8} />
          <Line points={tide} color="#bdfdfd" lineWidth={7} transparent opacity={0.12} />
        </>
      ) : null}
      {ships.map((ship) => {
        const pos = positions.get(ship.id);
        if (!pos) return null;
        return (
          <ShipMarker
            key={ship.id}
            node={ship}
            x={pos.x}
            y={pos.y}
            focused={focusId === ship.id || viewId === ship.id}
            faded={Boolean(viewId) && mode === "creativity" && viewId !== ship.id}
            glow={glowById ? glowById.get(ship.id) || 0 : 0}
            onClick={onShipClick}
          />
        );
      })}
    </group>
  );
}

function ChartScene(props) {
  const webglAvailable = useWebGLAvailable();
  if (!webglAvailable) {
    return (
      <div className={styles.webglFallback} role="status">
        <strong>{props.title}</strong>
        <span>3D rendering is unavailable in this browser session.</span>
      </div>
    );
  }
  return (
    <Canvas
      shadows={false}
      dpr={[1, 1.6]}
      performance={{ min: 0.6 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      frameloop="always"
      camera={{ position: [0.5, 0.8, 4.6], fov: 46, near: 0.1, far: 40 }}
    >
      <color attach="background" args={["#0d0904"]} />
      <fog attach="fog" args={["#0d0805", 8, 18]} />
      <Suspense fallback={null}>
        <SceneLights />
        <DustMotes count={42} bounds={[7, 4.5, 3]} />
        <ChartWorld {...props} />
        {/* Camera is locked head-on to the chart: zoom is the only control. */}
        <OrbitControls
          enablePan={false}
          enableRotate={false}
          enableZoom
          target={[0, MAP_CY, BACK_Z]}
          minDistance={6}
          maxDistance={9}
          enableDamping
          dampingFactor={0.1}
        />
      </Suspense>
    </Canvas>
  );
}

export default function HistoryWallScene({
  initialMode = "influence",
  databaseName = "default",
  onBackToHistory,
}) {
  return (
    <HistoryWallSceneView
      key={`${databaseName}:${initialMode}`}
      initialMode={initialMode}
      databaseName={databaseName}
      onBackToHistory={onBackToHistory}
    />
  );
}

function HistoryWallSceneView({ initialMode, databaseName }) {
  const { nodes, loading, error, hasArtifact, reload } = useHistoricalNodes(databaseName);
  const build = useHistoricalBuild(databaseName, reload);
  const [mode, setMode] = useState(initialMode);
  const [focusId, setFocusId] = useState("");
  const [viewId, setViewId] = useState("");
  const { open: openFullscreen } = useFullscreenImage();

  const openNode = (node) => {
    if (!node) return;
    openFullscreen({
      images: [
        {
          src: node.thumb,
          label: node.title,
          caption: `${node.artist || "Unknown"} · ${node.dateLabel || node.year}${
            node.estimated ? ` · ${ESTIMATED_YEAR_NOTE}` : ""
          }`,
        },
      ],
      // Closing the viewer drops the selection, so the chart returns to normal
      // and any other ship can be clicked straight away.
      onClose: () => setViewId(""),
    });
  };

  const network = useMemo(() => buildShipNetwork(nodes), [nodes]);
  const readings = useMemo(
    () => buildCreativityReadings(nodes, CREATIVITY_BETA, CREATIVITY_DIMENSION),
    [nodes],
  );

  const chart = useMemo(() => {
    if (mode === "influence") {
      const bounds = yearBounds(network.ships);
      return {
        ships: network.ships,
        edges: network.edges,
        adjacency: network.adjacency,
        positions: relaxInfluencePositions(network.ships, bounds),
        tide: [],
        glowById: null,
        // Report against the whole dataset, not the already-filtered graph, so
        // the pill reads "62 of 100 ships" rather than hiding the 38 artworks
        // that have no link among the strongest MAX_EDGES routes.
        total: nodes.length,
        shown: network.ships.length,
      };
    }
    const bounds = yearBounds(readings);
    const chosen = selectByCreativity(readings, viewId);
    const positions = new Map();
    chosen.forEach((r) => {
      positions.set(r.id, {
        x: yearToX(r.year, bounds) + (hashUnit(`${r.id}`) - 0.5) * 0.05,
        y: creativityToY(r.creativity),
        node: r,
      });
    });
    return {
      ships: chosen,
      edges: [],
      adjacency: null,
      positions,
      tide: tidePoints(readings, bounds),
      glowById: new Map(chosen.map((r) => [r.id, clamp(r.creativity)])),
      total: readings.length,
      shown: chosen.length,
    };
  }, [mode, network, nodes, readings, viewId]);

  const focusSet = useMemo(() => {
    if (mode !== "influence" || !focusId) return null;
    const set = new Set([focusId]);
    chart.adjacency?.get(focusId)?.forEach((id) => set.add(id));
    return set;
  }, [mode, focusId, chart.adjacency]);

  const visibleShips = focusSet ? chart.ships.filter((s) => focusSet.has(s.id)) : chart.ships;
  const visibleEdges = focusSet ? chart.edges.filter((e) => e.from === focusId || e.to === focusId) : chart.edges;

  const focusNode = focusId ? chart.positions.get(focusId)?.node : null;

  const building = build.status.state === "starting" || build.status.state === "running";
  const showBuild = !loading && !nodes.length;
  const hasShips = chart.ships.length > 0;
  const title = MAP_TITLES[mode];
  const estimatedCount = useMemo(
    () => nodes.filter((node) => node.estimated).length,
    [nodes],
  );

  const switchMap = (next) => {
    if (next === mode) return;
    setMode(next);
    setFocusId("");
    setViewId("");
  };

  const handleShipClick = (node) => {
    if (mode === "creativity") {
      setViewId(node.id);
      openNode(node);
      return;
    }
    if (!focusId) {
      setFocusId(node.id);
      setViewId("");
    } else {
      setViewId(node.id);
      openNode(node);
    }
  };

  return (
    <main className={styles.root} aria-label="Historical reading wall">
      {hasShips ? (
        <ChartScene
          mode={mode}
          title={title}
          ships={visibleShips}
          edges={visibleEdges}
          positions={chart.positions}
          tide={chart.tide}
          glowById={chart.glowById}
          focusId={focusId}
          viewId={viewId}
          onShipClick={handleShipClick}
        />
      ) : (
        <div className={styles.emptyBackdrop} />
      )}

      {/* Map toggle */}
      <div className={styles.mapTabs}>
        <button
          type="button"
          className={mode === "creativity" ? styles.mapTabActive : styles.mapTab}
          onClick={() => switchMap("creativity")}
        >
          Creativity
        </button>
        <button
          type="button"
          className={mode === "influence" ? styles.mapTabActive : styles.mapTab}
          onClick={() => switchMap("influence")}
        >
          Influence
        </button>
      </div>

      <div className={styles.topNav}>
        <div className={styles.datasetPill}>
          <span className={`${styles.datasetDot} ${hasArtifact ? "" : styles.datasetDotOffline}`} />
          <b>
            {hasShips
              ? `Best ${chart.shown} images`
              : nodes.length
                ? "no readings"
                : "no chart yet"}
          </b>
        </div>

        {estimatedCount > 0 ? (
          <div className={styles.estimatedPill}>
            <span
              className={styles.estimatedDot}
              style={{ background: ESTIMATED_YEAR_COLOR }}
            />
            <b style={{ color: ESTIMATED_YEAR_COLOR }}>
              {estimatedCount} of {nodes.length} {ESTIMATED_YEAR_NOTE}
            </b>
          </div>
        ) : null}
      </div>

      {/* Influence route banner */}
      {mode === "influence" && focusId && focusNode ? (
        <div className={styles.pathBanner}>
          <BackButton
            variant="ghost"
            label={LABELS.showAllShips}
            className={styles.showAll}
            onClick={() => {
              setFocusId("");
              setViewId("");
            }}
          />
          <div className={styles.pathLabel}>
            <span>Route through</span>
            <strong>{focusNode.title}</strong>
            <small>{visibleShips.length} ships on this path · click one to view its painting</small>
          </div>
        </div>
      ) : null}

      {showBuild ? (
        <div className={styles.runOverlay}>
          <div className={styles.runCard}>
            <span>Navigator's Log</span>
            <h2>{building ? BUILD_MESSAGES.history : "This archive has no historical map"}</h2>
            <p>
              {building
                ? "The crew is dating every work and plotting it onto the chart."
                : error || "Build the F5 historical map for this dataset to plot the chart."}
            </p>
            {building ? (
              <div className={styles.runProgress}>
                <div>
                  <span>{build.status.message}</span>
                  <strong>{Math.round(Number(build.status.progress || 0))}%</strong>
                </div>
                <progress max="100" value={Number(build.status.progress || 0)} />
              </div>
            ) : null}
            {build.error ? <p className={styles.runError}>{build.error}</p> : null}
            <div className={styles.topNavRow}>
              <button type="button" className={styles.runButton} onClick={build.start} disabled={building}>
                {building ? "Building F5…" : "Build F5 Map"}
              </button>
              <button type="button" className={styles.chromeButton} onClick={reload} disabled={building}>
                Check again
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!loading && !showBuild && nodes.length && !hasShips ? (
        <div className={styles.notice}>
          {mode === "influence" ? "No forward-in-time resemblance routes were found." : "No creativity readings were found."}
        </div>
      ) : null}
      {loading ? <div className={styles.notice}>{LOADING_MESSAGES.history}</div> : null}
      {!loading && !showBuild && hasShips && !focusId ? (
        <div className={styles.touchHint}>
          {mode === "influence"
            ? "click a ship to follow its influence route"
            : "the higher & brighter the ship, the more creative · click a ship"}
        </div>
      ) : null}
    </main>
  );
}
