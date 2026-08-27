import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { AdditiveBlending } from "three";
import OceanSway from "../shared/OceanSway";
import DustMotes from "../shared/DustMotes";
import CandleFlame from "../shared/CandleFlame";
import DyeSwatchBoard from "../objects/DyeSwatchBoard";
import CarvedPuppetHead from "../objects/CarvedPuppetHead";
import ArticulatedMannequin from "../objects/ArticulatedMannequin";
import LineStructureBoard from "../objects/LineStructureBoard";
import Globe from "../objects/Globe";
import useWebGLAvailable from "../../../../hooks/useWebGLAvailable";
import { useRepeatingCanvasTexture } from "../../../../hooks/useCanvasTexture";
import { drawWoodGrainTexture } from "../../../../lib/f6TextureBuilders";
import { BRASS_MATERIAL, DARK_IRON_MATERIAL } from "../../../../lib/f6Constants";
import styles from "../CaptainsQuarters.module.css";

// --- Room envelope ----------------------------------------------------------
// Everything is built around a real cabin: a plank floor, a panelled back wall
// and two side walls that close the space in. The six instruments sit on the
// table top (DESK_TOP) and are pulled forward + tightened into a tidy panel so
// the whole interactive set reads at a glance.
const DESK_TOP = -1.5;
const FLOOR_Y = -2.55;
const BACK_Z = -2.95;
const WALL_X = 3.3;
const ROOM_TOP = 2.75;

// Five instruments laid out left→right as a readable panel: origin (globe) and
// colour (dye board) on the left, the line-structure board in the middle, and
// the two figure instruments — body (mannequin) then head — on the right.
const LAYOUT = {
  globe: {
    position: [0, -0.35, 0.2],
    rotation: [-0.05, 0.32, 0.0],
    scale: 0.95,
    // Column from the base down to the desk top, so the globe doesn't float.
    standHeight: 0.61,
  },
  dye: {
    position: [-1.55, -0.7, 0.76],
    rotation: [-0.9, 0.34, 0.2],
    baseScale: 0.82,
  },
  line: {
    position: [0, -0.68, 1.2],
    rotation: [-0.28, 0, 0.0],
    scale: 0.88,
    tilesPosition: [0, -1.42, 1.0],
    tilesRotation: [-1.57, 0, 0],
    tilesScale: 0.8,
  },
  mannequin: {
    // y puts the base disk's underside exactly on the desk surface
    // (-0.82 - 0.87 x 0.78 = -1.4986 vs desk top -1.498) instead of inside it.
    position: [1.62, -0.82, 0.32],
    rotation: [-0.02, -0.3, 0.02],
    scale: 0.78,
  },
  head: {
    position: [2.3, -0.74, 0.74],
    rotation: [0.02, -0.4, -0.02],
    scale: 0.84,
  },
};

// Camera pulled closer to the desk and angled down so the table surface (with
// the flat direction buttons in front) and the standing line model both read.
const CAMERA_POS = [0, 1.2, 3.7];
const CAMERA_LOOK = [0, -0.7, 0.7];

export default function QuartersScene(props) {
  const webglAvailable = useWebGLAvailable();

  if (!webglAvailable) {
    return <QuartersFallback />;
  }

  return (
    <Canvas
      shadows={false}
      dpr={[1, 1.6]}
      performance={{ min: 0.6 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      frameloop="always"
      camera={{ position: CAMERA_POS, fov: 51, near: 0.1, far: 40 }}
      fallback={<QuartersFallback />}
    >
      <color attach="background" args={["#0d0904"]} />
      <fog attach="fog" args={["#0d0805", 7.5, 17]} />
      <Suspense fallback={null}>
        <SceneLights />
        <QuartersContents {...props} />
      </Suspense>
    </Canvas>
  );
}

function QuartersFallback() {
  return (
    <div className={styles.webglFallback} role="status">
      <strong>Captain's Quarters</strong>
      <span>3D rendering is unavailable in this browser session.</span>
    </div>
  );
}

// Zoom is the only camera control: rotation and panning stay locked so the
// cabin always reads from its composed angle.
function CameraRig() {
  return (
    <OrbitControls
      enablePan={false}
      enableRotate={false}
      enableZoom
      target={CAMERA_LOOK}
      minDistance={2.1}
      maxDistance={5.2}
      enableDamping
      dampingFactor={0.1}
    />
  );
}

function SceneLights() {
  return (
    <>
      {/* low warm base so the cabin reads dark, never pitch black */}
      <ambientLight intensity={0.32} color="#ffe2b8" />
      <hemisphereLight args={["#ffdca0", "#140c06", 0.3]} />
      {/* warm key pooling down onto the desk */}
      <spotLight
        position={[0.4, 4.4, 3.0]}
        angle={0.62}
        penumbra={0.5}
        intensity={2.3}
        color="#ffd49a"
        distance={16}
      />
      {/* soft front fill so instruments stay readable */}
      <pointLight
        position={[0, 0.9, 3.4]}
        intensity={0.65}
        color="#ffe6c4"
        distance={11}
      />
      {/* warm bounce from the back-left of the cabin */}
      <pointLight
        position={[-1.9, 1.1, -1.4]}
        intensity={0.45}
        color="#ffb060"
        distance={7}
      />
      {/* cool moonlight spilling in from the central stern window */}
      <pointLight
        position={[0, 0.7, -2.1]}
        intensity={0.95}
        color="#86acdc"
        distance={9}
      />
      <pointLight
        position={[-3.0, 0.6, 0.4]}
        intensity={0.2}
        color="#88a6d8"
        distance={6}
      />
      {/* gentle warm wash so the back wall reads as a surface, not a void */}
      <pointLight
        position={[-1.4, 0.9, -2.4]}
        intensity={0.36}
        color="#ffb870"
        distance={6.5}
      />
      <pointLight
        position={[1.6, 0.7, -2.4]}
        intensity={0.32}
        color="#ffb870"
        distance={6}
      />
    </>
  );
}

// --- The cabin: floor, walls, beams, porthole -------------------------------
function CabinRoom() {
  const wallTex = useRepeatingCanvasTexture(
    drawWoodGrainTexture,
    [],
    512,
    [4, 3],
  );
  const floorTex = useRepeatingCanvasTexture(
    drawWoodGrainTexture,
    [],
    512,
    [7, 5],
  );

  return (
    <group>
      {/* plank floor */}
      <mesh
        raycast={() => null}
        position={[0, FLOOR_Y, 0.2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[9.4, 7]} />
        <meshStandardMaterial color="#43331f" roughness={0.9} map={floorTex} />
      </mesh>

      {/* back wall — panelled */}
      <mesh raycast={() => null} position={[0, 0.1, BACK_Z]}>
        <planeGeometry args={[9.4, 6]} />
        <meshStandardMaterial
          color="#2c1c10"
          roughness={0.94}
          map={wallTex}
          emissive="#241308"
          emissiveIntensity={0.14}
        />
      </mesh>
      {/* vertical plank seams on the back wall */}
      {[-3.4, -2.0, -0.6, 0.8, 2.2, 3.6].map((x) => (
        <mesh
          key={`seam-${x}`}
          raycast={() => null}
          position={[x, 0.1, BACK_Z + 0.02]}
        >
          <boxGeometry args={[0.03, 5.6, 0.04]} />
          <meshStandardMaterial color="#120a04" roughness={0.8} />
        </mesh>
      ))}
      {/* wainscot rail + baseboard */}
      <mesh raycast={() => null} position={[0, -0.55, BACK_Z + 0.05]}>
        <boxGeometry args={[9.4, 0.14, 0.1]} />
        <meshStandardMaterial
          color="#3a2616"
          roughness={0.78}
          emissive="#1a0d05"
          emissiveIntensity={0.08}
        />
      </mesh>
      <mesh raycast={() => null} position={[0, FLOOR_Y + 0.16, BACK_Z + 0.06]}>
        <boxGeometry args={[9.4, 0.32, 0.12]} />
        <meshStandardMaterial color="#27190d" roughness={0.82} />
      </mesh>

      {/* side walls */}
      <mesh
        raycast={() => null}
        position={[-WALL_X, 0.1, -0.1]}
        rotation={[0, Math.PI / 2, 0]}
      >
        <planeGeometry args={[6.6, 6]} />
        <meshStandardMaterial color="#241710" roughness={0.94} map={wallTex} />
      </mesh>
      <mesh
        raycast={() => null}
        position={[WALL_X, 0.1, -0.1]}
        rotation={[0, -Math.PI / 2, 0]}
      >
        <planeGeometry args={[6.6, 6]} />
        <meshStandardMaterial color="#241710" roughness={0.94} map={wallTex} />
      </mesh>

      {/* ceiling beams crossing overhead (mostly framing the top) */}
      <mesh raycast={() => null} position={[0, ROOM_TOP - 0.12, -1.6]}>
        <boxGeometry args={[9.4, 0.3, 0.34]} />
        <meshStandardMaterial color="#1c1109" roughness={0.85} />
      </mesh>
      <mesh raycast={() => null} position={[0, ROOM_TOP - 0.12, 0.2]}>
        <boxGeometry args={[9.4, 0.3, 0.34]} />
        <meshStandardMaterial color="#1c1109" roughness={0.85} />
      </mesh>

      <SternWindow position={[0, 0.6, BACK_Z + 0.06]} />
    </group>
  );
}

// A latticed galleon stern window: a wooden frame with muntins dividing it into
// small panes, a moonlit night sky and sea behind, and a sheet of glass on top.
function SternWindow({ position }) {
  const W = 1.45; // half width
  const H = 0.92; // half height
  const frame = "#241509";
  const cols = [-0.72, 0, 0.72];
  const rows = [-0.46, 0.46];

  const stars = [
    [-1.05, 0.62],
    [-0.78, 0.3],
    [-0.5, 0.7],
    [-0.2, 0.45],
    [0.15, 0.66],
    [0.5, 0.34],
    [0.85, 0.6],
    [1.1, 0.28],
    [-0.95, -0.05],
    [0.65, 0.05],
    [1.0, -0.1],
  ];

  return (
    <group position={position}>
      {/* dark recess so the window reads as set into the hull */}
      <mesh raycast={() => null} position={[0, 0, -0.12]}>
        <boxGeometry args={[W * 2 + 0.34, H * 2 + 0.34, 0.2]} />
        <meshStandardMaterial color="#0a0905" roughness={1} />
      </mesh>

      {/* night sky */}
      <mesh raycast={() => null} position={[0, 0.18, -0.05]}>
        <planeGeometry args={[W * 2, H * 2 - 0.5]} />
        <meshStandardMaterial
          color="#173557"
          emissive="#2a5b92"
          emissiveIntensity={0.95}
          roughness={1}
        />
      </mesh>
      {/* moonlit sea band along the bottom */}
      <mesh raycast={() => null} position={[0, -0.62, -0.05]}>
        <planeGeometry args={[W * 2, 0.62]} />
        <meshStandardMaterial
          color="#0f2236"
          emissive="#1c3a5a"
          emissiveIntensity={0.7}
          roughness={1}
        />
      </mesh>
      {/* moon + glow + reflection on the water (set in a clear pane) */}
      <mesh raycast={() => null} position={[0.36, 0.66, -0.045]}>
        <circleGeometry args={[0.24, 28]} />
        <meshBasicMaterial color="#f3f6fc" />
      </mesh>
      <mesh raycast={() => null} position={[0.36, 0.66, -0.046]}>
        <circleGeometry args={[0.44, 28]} />
        <meshBasicMaterial
          color="#bcd0ee"
          transparent
          opacity={0.4}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh raycast={() => null} position={[0.36, 0.66, -0.047]}>
        <circleGeometry args={[0.66, 28]} />
        <meshBasicMaterial
          color="#9fb6d8"
          transparent
          opacity={0.18}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh raycast={() => null} position={[0.36, -0.62, -0.045]}>
        <planeGeometry args={[0.26, 0.5]} />
        <meshBasicMaterial
          color="#cdd9ee"
          transparent
          opacity={0.32}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {stars.map(([x, y], i) => (
        <mesh key={i} raycast={() => null} position={[x, y, -0.045]}>
          <circleGeometry args={[0.012 + (i % 3) * 0.004, 8]} />
          <meshBasicMaterial color="#dfe7f5" />
        </mesh>
      ))}

      {/* glass sheet */}
      <mesh raycast={() => null} position={[0, 0, 0.0]}>
        <planeGeometry args={[W * 2, H * 2]} />
        <meshStandardMaterial
          color="#9ab6d8"
          transparent
          opacity={0.12}
          roughness={0.08}
          metalness={0.3}
        />
      </mesh>

      {/* outer wooden frame */}
      <mesh raycast={() => null} position={[0, H + 0.08, 0.04]}>
        <boxGeometry args={[W * 2 + 0.3, 0.18, 0.16]} />
        <meshStandardMaterial color={frame} roughness={0.82} />
      </mesh>
      <mesh raycast={() => null} position={[0, -H - 0.1, 0.04]}>
        <boxGeometry args={[W * 2 + 0.3, 0.22, 0.18]} />
        <meshStandardMaterial color={frame} roughness={0.82} />
      </mesh>
      <mesh raycast={() => null} position={[-W - 0.09, 0, 0.04]}>
        <boxGeometry args={[0.18, H * 2 + 0.3, 0.16]} />
        <meshStandardMaterial color={frame} roughness={0.82} />
      </mesh>
      <mesh raycast={() => null} position={[W + 0.09, 0, 0.04]}>
        <boxGeometry args={[0.18, H * 2 + 0.3, 0.16]} />
        <meshStandardMaterial color={frame} roughness={0.82} />
      </mesh>

      {/* muntins — the lattice that makes it read as a window */}
      {cols.map((x) => (
        <mesh key={`v${x}`} raycast={() => null} position={[x, 0, 0.03]}>
          <boxGeometry args={[0.05, H * 2, 0.1]} />
          <meshStandardMaterial color={frame} roughness={0.8} />
        </mesh>
      ))}
      {rows.map((y) => (
        <mesh key={`h${y}`} raycast={() => null} position={[0, y, 0.03]}>
          <boxGeometry args={[W * 2, 0.05, 0.1]} />
          <meshStandardMaterial color={frame} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

// --- The captain's table ----------------------------------------------------
function Desk() {
  return (
    <group>
      {/* table top */}
      <mesh raycast={() => null} position={[0, DESK_TOP - 0.09, 0.1]}>
        <boxGeometry args={[6.2, 0.18, 2.9]} />
        <meshStandardMaterial
          color="#6f4a26"
          roughness={0.82}
          emissive="#241405"
          emissiveIntensity={0.08}
        />
      </mesh>
      {/* lighter inlay so the surface doesn't read flat */}
      <mesh
        raycast={() => null}
        position={[0, DESK_TOP + 0.002, 0.1]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[5.9, 2.6]} />
        <meshStandardMaterial
          color="#855c33"
          roughness={0.76}
          emissive="#2a1606"
          emissiveIntensity={0.06}
        />
      </mesh>
      {/* front + back aprons */}
      <mesh raycast={() => null} position={[0, DESK_TOP - 0.26, 1.5]}>
        <boxGeometry args={[6.2, 0.22, 0.14]} />
        <meshStandardMaterial color="#5a3c1f" roughness={0.84} />
      </mesh>
      <mesh raycast={() => null} position={[0, DESK_TOP - 0.26, -1.3]}>
        <boxGeometry args={[6.2, 0.22, 0.14]} />
        <meshStandardMaterial color="#4f351b" roughness={0.84} />
      </mesh>
      {/* four legs reaching the floor */}
      {[
        [-2.9, 1.25],
        [2.9, 1.25],
        [-2.9, -1.05],
        [2.9, -1.05],
      ].map(([x, z]) => (
        <mesh
          key={`${x}-${z}`}
          raycast={() => null}
          position={[x, (DESK_TOP - 0.18 + FLOOR_Y) / 2, z]}
        >
          <boxGeometry args={[0.18, DESK_TOP - 0.18 - FLOOR_Y, 0.18]} />
          <meshStandardMaterial
            color="#4a3119"
            roughness={0.85}
            emissive="#1a0d04"
            emissiveIntensity={0.06}
          />
        </mesh>
      ))}
    </group>
  );
}

// --- Simple, characterful props ---------------------------------------------
function HangingLantern({ position }) {
  return (
    <group position={position}>
      {/* chain up to the beam */}
      <mesh raycast={() => null} position={[0, 1.15, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 2.3, 6]} />
        <meshStandardMaterial {...DARK_IRON_MATERIAL} />
      </mesh>
      {/* cap + base */}
      <mesh raycast={() => null} position={[0, 0.22, 0]}>
        <coneGeometry args={[0.17, 0.16, 8]} />
        <meshStandardMaterial {...BRASS_MATERIAL} roughness={0.45} />
      </mesh>
      <mesh raycast={() => null} position={[0, -0.18, 0]}>
        <cylinderGeometry args={[0.16, 0.14, 0.08, 10]} />
        <meshStandardMaterial {...BRASS_MATERIAL} roughness={0.45} />
      </mesh>
      {/* glass housing */}
      <mesh raycast={() => null} position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 0.34, 12, 1, true]} />
        <meshStandardMaterial
          color="#ffcf86"
          transparent
          opacity={0.32}
          emissive="#ffae4a"
          emissiveIntensity={0.55}
          side={2}
        />
      </mesh>
      {/* corner posts */}
      {[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) => (
        <mesh
          key={a}
          raycast={() => null}
          position={[Math.cos(a) * 0.135, 0.02, Math.sin(a) * 0.135]}
        >
          <boxGeometry args={[0.016, 0.36, 0.016]} />
          <meshStandardMaterial {...BRASS_MATERIAL} roughness={0.5} />
        </mesh>
      ))}
      <CandleFlame position={[0, -0.05, 0]} scale={0.9} />
      <pointLight
        position={[0, 0, 0]}
        color="#ffb259"
        intensity={0.85}
        distance={4.0}
      />
    </group>
  );
}

function DeskCandle({ position }) {
  return (
    <group position={position}>
      {/* brass dish + handle */}
      <mesh raycast={() => null} position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.14, 0.16, 0.04, 18]} />
        <meshStandardMaterial {...BRASS_MATERIAL} roughness={0.4} />
      </mesh>
      <mesh raycast={() => null} position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.05, 0.055, 0.06, 14]} />
        <meshStandardMaterial {...BRASS_MATERIAL} roughness={0.4} />
      </mesh>
      {/* candle stub */}
      <mesh raycast={() => null} position={[0, 0.14, 0]}>
        <cylinderGeometry args={[0.038, 0.04, 0.14, 14]} />
        <meshStandardMaterial color="#efe2c2" roughness={0.9} />
      </mesh>
      <CandleFlame position={[0, 0.24, 0]} scale={0.9} />
      <pointLight
        position={[0, 0.28, 0]}
        color="#ffae54"
        intensity={0.7}
        distance={2.8}
      />
    </group>
  );
}

function BookStack({ position, rotation = [0, 0, 0] }) {
  const books = [
    { w: 0.46, d: 0.32, h: 0.07, color: "#6e2b22", y: 0.035, rot: 0.0 },
    { w: 0.42, d: 0.3, h: 0.06, color: "#2d4a33", y: 0.1, rot: 0.12 },
    { w: 0.4, d: 0.28, h: 0.055, color: "#2b3a5a", y: 0.16, rot: -0.08 },
  ];
  return (
    <group position={position} rotation={rotation}>
      {books.map((b, i) => (
        <group key={i} position={[0, b.y, 0]} rotation={[0, b.rot, 0]}>
          <mesh raycast={() => null}>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial
              color={b.color}
              roughness={0.78}
              emissive="#150a04"
              emissiveIntensity={0.06}
            />
          </mesh>
          {/* page block */}
          <mesh raycast={() => null} position={[0, 0, 0]}>
            <boxGeometry args={[b.w - 0.02, b.h - 0.018, b.d + 0.012]} />
            <meshStandardMaterial color="#e6d6a8" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function RumBottle({ position }) {
  return (
    <group position={position}>
      <mesh raycast={() => null} position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.075, 0.085, 0.32, 16]} />
        <meshStandardMaterial
          color="#1f3a24"
          transparent
          opacity={0.62}
          roughness={0.18}
          metalness={0.1}
          emissive="#0a2410"
          emissiveIntensity={0.2}
        />
      </mesh>
      <mesh raycast={() => null} position={[0, 0.37, 0]}>
        <cylinderGeometry args={[0.028, 0.05, 0.12, 14]} />
        <meshStandardMaterial
          color="#1f3a24"
          transparent
          opacity={0.62}
          roughness={0.18}
        />
      </mesh>
      <mesh raycast={() => null} position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.05, 12]} />
        <meshStandardMaterial color="#3d2b1a" roughness={0.85} />
      </mesh>
      {/* paper label */}
      <mesh raycast={() => null} position={[0, 0.16, 0.082]}>
        <planeGeometry args={[0.1, 0.13]} />
        <meshStandardMaterial color="#d8c79a" roughness={0.9} />
      </mesh>
      {/* small tin cup beside it */}
      <mesh raycast={() => null} position={[0.18, 0.05, 0.04]}>
        <cylinderGeometry args={[0.05, 0.045, 0.1, 14]} />
        <meshStandardMaterial
          {...DARK_IRON_MATERIAL}
          color="#6b6b66"
          metalness={0.6}
          roughness={0.45}
        />
      </mesh>
    </group>
  );
}

function Spyglass({ position, rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh
        raycast={() => null}
        position={[0, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <cylinderGeometry args={[0.05, 0.055, 0.3, 16]} />
        <meshStandardMaterial {...BRASS_MATERIAL} roughness={0.4} />
      </mesh>
      <mesh
        raycast={() => null}
        position={[0.26, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <cylinderGeometry args={[0.04, 0.045, 0.26, 16]} />
        <meshStandardMaterial color="#5a3a18" roughness={0.7} />
      </mesh>
      <mesh
        raycast={() => null}
        position={[0.46, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <cylinderGeometry args={[0.032, 0.036, 0.2, 16]} />
        <meshStandardMaterial {...BRASS_MATERIAL} roughness={0.4} />
      </mesh>
    </group>
  );
}

function Inkpot({ position }) {
  return (
    <group position={position}>
      <mesh raycast={() => null} position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.07, 0.08, 0.1, 16]} />
        <meshStandardMaterial color="#1a1410" roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh raycast={() => null} position={[0, 0.105, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.012, 16]} />
        <meshStandardMaterial color="#05060a" roughness={0.3} />
      </mesh>
      {/* quill */}
      <mesh
        raycast={() => null}
        position={[0.03, 0.26, 0.02]}
        rotation={[0, 0, -0.5]}
      >
        <cylinderGeometry args={[0.004, 0.01, 0.34, 6]} />
        <meshStandardMaterial color="#e9e3d2" roughness={0.85} />
      </mesh>
    </group>
  );
}

function CoiledRope({ position }) {
  return (
    <group position={position} rotation={[Math.PI / 2, 0, 0]}>
      {[0.26, 0.2, 0.14].map((radius, index) => (
        <mesh
          key={radius}
          raycast={() => null}
          position={[0, 0, index * 0.018]}
        >
          <torusGeometry args={[radius, 0.028, 8, 36]} />
          <meshStandardMaterial
            color="#b79b68"
            roughness={0.7}
            emissive="#2a1a05"
            emissiveIntensity={0.06}
          />
        </mesh>
      ))}
    </group>
  );
}

function Barrel({ position }) {
  return (
    <group position={position}>
      <mesh raycast={() => null}>
        <cylinderGeometry args={[0.42, 0.36, 1.0, 18]} />
        <meshStandardMaterial
          color="#4a3018"
          roughness={0.82}
          emissive="#170c04"
          emissiveIntensity={0.06}
        />
      </mesh>
      {[-0.38, 0, 0.38].map((y) => (
        <mesh key={y} raycast={() => null} position={[0, y, 0]}>
          <cylinderGeometry args={[0.43, 0.43, 0.06, 18, 1, true]} />
          <meshStandardMaterial
            {...DARK_IRON_MATERIAL}
            color="#3a3a36"
            metalness={0.5}
            roughness={0.6}
          />
        </mesh>
      ))}
    </group>
  );
}

function CabinDressing() {
  return (
    <group>
      {/* desk-top props, kept to the corners so the instruments stay clear */}
      <BookStack position={[0.5, DESK_TOP, -1.0]} rotation={[0, -0.25, 0]} />
      <RumBottle position={[2.2, DESK_TOP, 1.3]} />
      <Spyglass
        position={[-1.35, DESK_TOP + 0.05, -1.0]}
        rotation={[0, 0.6, 0]}
      />
      <Inkpot position={[1.15, DESK_TOP, -0.72]} />
      {/* Clear of the lay figure: with the arms opening outwards the right
          hand now reaches about x = 2.14, which the candle used to stand in. */}
      <DeskCandle position={[2.55, DESK_TOP, -0.55]} />

      {/* floor + ceiling dressing for the room */}
      <Barrel position={[-2.8, FLOOR_Y + 0.5, -1.5]} />
      <CoiledRope position={[2.6, FLOOR_Y + 0.04, 1.55]} />
      <HangingLantern position={[-2.7, 0.6, 0.2]} />
    </group>
  );
}

function QuartersContents({
  filters,
  setFilter,
  clearFilter,
  availability,
  optionCounts,
  hasArchiveData,
  featureDataReady,
}) {
  return (
    <>
      <CameraRig />
      <DustMotes count={55} bounds={[7, 4.5, 3]} />
      <OceanSway>
        <CabinRoom />
        <Desk />
        <CabinDressing />
        <Globe
          filters={filters}
          setFilter={setFilter}
          clearFilter={clearFilter}
          disabled={hasArchiveData && !featureDataReady}
          {...LAYOUT.globe}
        />
        <DyeSwatchBoard
          filters={filters}
          setFilter={setFilter}
          clearFilter={clearFilter}
          disabled={hasArchiveData && !availability.color}
          counts={optionCounts?.hues}
          {...LAYOUT.dye}
        />
        <LineStructureBoard
          filters={filters}
          setFilter={setFilter}
          disabled={hasArchiveData && !availability.hough}
          {...LAYOUT.line}
        />
        <ArticulatedMannequin
          filters={filters}
          setFilter={setFilter}
          clearFilter={clearFilter}
          disabled={hasArchiveData && !availability.pose}
          counts={optionCounts?.poses}
          {...LAYOUT.mannequin}
        />
        <CarvedPuppetHead
          filters={filters}
          setFilter={setFilter}
          clearFilter={clearFilter}
          disabled={hasArchiveData && !availability.portrait}
          {...LAYOUT.head}
        />
      </OceanSway>
    </>
  );
}
