import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import ShipText from "../shared/ShipText";
import { CatmullRomCurve3, Vector3 } from "three";
import useWebGLAvailable from "../../hooks/useWebGLAvailable";
import { useRepeatingCanvasTexture } from "../../hooks/useCanvasTexture";
import { drawWoodGrainTexture } from "../../lib/f6TextureBuilders";
import { BRASS_MATERIAL } from "../../lib/f6Constants";
import OceanSway from "../features/f6/shared/OceanSway";
import DustMotes from "../features/f6/shared/DustMotes";
import CandleFlame from "../features/f6/shared/CandleFlame";
import styles from "./Hallway.module.css";

// A sealed room hub reached from the ship door. Three doorways run flat down
// each side wall (chest room + the five archive features). The camera sits in
// the middle and the mouse rotates the view (drag to look around); the room is
// fully enclosed, so no angle ever shows past the walls. The WebGL fallback
// lists the same doors as buttons.
const CAMERA_POS = [0, 0.2, 5.0];
const WALL_X = 3.6;
const FLOOR_Y = -2.6;
const CEIL_Y = 3.0;
const FRONT_Z = 6.0;
const BACK_Z = -4.4;
const ROOM_LEN = FRONT_Z - BACK_Z; // depth of the box
const ROOM_MID_Z = (FRONT_Z + BACK_Z) / 2;
const WALL_H = CEIL_Y - FLOOR_Y;
const WALL_MID_Y = (CEIL_Y + FLOOR_Y) / 2;
const DOOR_Y = -0.55;

// Two doors down each side wall, then the back wall directly ahead carries the
// final two (Chart Table + Captain's Quarters), facing the camera head-on.
const DOORS = [
  { id: "room", label: "Chest Room", wall: "left", z: 1.0 },
  { id: "f2", label: "Logbook Gallery", wall: "right", z: 1.0 },
  { id: "f3", label: "Creativity Currents", wall: "left", z: -1.8 },
  { id: "f4", label: "Influence Routes", wall: "right", z: -1.8 },
  { id: "f5", label: "Chart Table", wall: "back", bx: -1.5 },
  { id: "f6", label: "Captain's Quarters", wall: "back", bx: 1.5 },
];

function doorTransform(door) {
  if (door.wall === "back") {
    return { position: [door.bx, DOOR_Y, BACK_Z + 0.12], yaw: 0 };
  }
  const isLeft = door.wall === "left";
  return {
    position: [isLeft ? -WALL_X + 0.08 : WALL_X - 0.08, DOOR_Y, door.z],
    yaw: isLeft ? Math.PI / 2 : -Math.PI / 2,
  };
}

// Candle sconces sit in the blank wall stretches, clear of the doorways: one
// ahead of the front door and one in the gap between the two side doors, plus a
// pair tucked into the back corners either side of the back doors.
const SIDE_SCONCE_Z = [2.4, -0.4];
const BACK_SCONCE_X = [-3.0, 3.0];

// Slight downward tilt so the camera frames the doors, plus how far the view
// drifts as the mouse moves. Kept small on purpose, and the room is sealed, so
// you never see past the walls.
const BASE_PITCH = -0.08;
const YAW_RANGE = 0.1;
const PITCH_RANGE = 0.06;

// The view follows the cursor a little — no clicking or dragging. The camera
// stays put and only its angle eases toward where the mouse is.
function MouseLook() {
  useFrame((state) => {
    const cam = state.camera;
    cam.rotation.order = "YXZ";
    const targetYaw = -state.pointer.x * YAW_RANGE;
    const targetPitch = BASE_PITCH + state.pointer.y * PITCH_RANGE;
    cam.rotation.y += (targetYaw - cam.rotation.y) * 0.06;
    cam.rotation.x += (targetPitch - cam.rotation.x) * 0.06;
    cam.rotation.z = 0;
  });

  return null;
}

// A wall-mounted candle sconce. Everything is modelled in local space with +z
// pointing into the room: a brass backplate sits flush against the wall, a
// bracket arm reaches out and a drip cup holds the wax candle, so the flame
// clearly hangs off the wall instead of floating in mid-air. The `yaw` rotates
// the whole bracket to face inward for whichever wall it's mounted on.
function Sconce({ position, yaw = 0 }) {
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {/* Oval brass backplate, pressed against the wall */}
      <mesh position={[0, 0.14, 0.02]} scale={[0.09, 0.24, 0.03]}>
        <sphereGeometry args={[1, 20, 20]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      {/* Finials top and bottom of the plate */}
      <mesh position={[0, 0.4, 0.03]}>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      <mesh position={[0, -0.14, 0.03]}>
        <coneGeometry args={[0.04, 0.09, 12]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      {/* Horizontal bracket arm reaching into the room */}
      <mesh position={[0, -0.01, 0.14]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.017, 0.017, 0.26, 10]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      {/* Diagonal scroll brace under the arm */}
      <mesh position={[0, 0.02, 0.13]} rotation={[Math.PI / 4, 0, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.22, 8]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      {/* Drip cup (bobeche) + candle cup at the end of the arm */}
      <mesh position={[0, 0.0, 0.26]}>
        <coneGeometry args={[0.07, 0.05, 14]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      <mesh position={[0, 0.05, 0.26]}>
        <cylinderGeometry args={[0.045, 0.055, 0.07, 14]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      {/* Wax candle */}
      <mesh position={[0, 0.24, 0.26]}>
        <cylinderGeometry args={[0.045, 0.05, 0.34, 16]} />
        <meshStandardMaterial
          color="#f4e7c6"
          roughness={0.5}
          emissive="#e0b870"
          emissiveIntensity={0.4}
        />
      </mesh>
      <CandleFlame position={[0, 0.42, 0.26]} scale={1.2} />
      <pointLight
        position={[0, 0.48, 0.34]}
        intensity={1.3}
        color="#ffbf7a"
        distance={7.5}
        decay={1.7}
      />
    </group>
  );
}

// A single candle sitting on a chandelier arm: a brass drip pan, cup, wax stick
// and flame. The flame carries no light of its own (`castLight={false}`) — the
// chandelier lights the room with one warm point light at its hub — so six of
// them don't blow the corridor's light budget.
function ChandelierCandle() {
  return (
    <group>
      <mesh position={[0, 0.0, 0]}>
        <coneGeometry args={[0.07, 0.045, 12]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.035, 0.045, 0.06, 12]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      <mesh position={[0, 0.17, 0]}>
        <cylinderGeometry args={[0.032, 0.036, 0.22, 12]} />
        <meshStandardMaterial
          color="#f4e7c6"
          roughness={0.5}
          emissive="#e0b870"
          emissiveIntensity={0.4}
        />
      </mesh>
      <CandleFlame position={[0, 0.32, 0]} scale={1.05} castLight={false} />
    </group>
  );
}

const CHANDELIER_ARMS = 6;

// A hanging brass chandelier: a canopy + rod down from the ceiling, a turned
// central baluster, a horizontal ring, and six S-curved arms each carrying a
// candle. One warm point light at the hub pools light onto the doors below.
function Chandelier({ position }) {
  // One S-curved arm, built once and instanced around the ring. Modelled in
  // local space sweeping out along +x, dipping down then curling up to the
  // candle at the tip.
  const armCurve = useMemo(
    () =>
      new CatmullRomCurve3([
        new Vector3(0.3, 0.0, 0),
        new Vector3(0.48, -0.18, 0),
        new Vector3(0.66, -0.15, 0),
        new Vector3(0.76, 0.05, 0),
        new Vector3(0.7, 0.24, 0),
      ]),
    [],
  );
  const armAngles = useMemo(
    () =>
      Array.from(
        { length: CHANDELIER_ARMS },
        (_, i) => (i / CHANDELIER_ARMS) * Math.PI * 2,
      ),
    [],
  );
  const localCeil = CEIL_Y - position[1]; // ceiling height in the group's frame

  return (
    <group position={position}>
      {/* Ceiling canopy + suspension rod */}
      <mesh position={[0, localCeil - 0.05, 0]}>
        <coneGeometry args={[0.14, 0.12, 16]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      <mesh position={[0, (localCeil + 0.34) / 2, 0]}>
        <cylinderGeometry args={[0.016, 0.016, localCeil - 0.34, 8]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>

      {/* Turned central baluster: top finial, column, ring, drop finial */}
      <mesh position={[0, 0.34, 0]}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      <mesh position={[0, 0.17, 0]}>
        <cylinderGeometry args={[0.05, 0.075, 0.28, 12]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      <mesh position={[0, 0.0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.34, 0.03, 12, 44]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      <mesh position={[0, -0.12, 0]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      <mesh position={[0, -0.26, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.06, 0.16, 12]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>

      {/* Six arms + candles */}
      {armAngles.map((angle, i) => (
        <group key={i} rotation={[0, angle, 0]}>
          <mesh>
            <tubeGeometry args={[armCurve, 48, 0.02, 8, false]} />
            <meshStandardMaterial {...BRASS_MATERIAL} />
          </mesh>
          <group position={[0.7, 0.24, 0]}>
            <ChandelierCandle />
          </group>
        </group>
      ))}

      {/* Warm pool of light from the massed candles */}
      <pointLight
        position={[0, 0.1, 0]}
        intensity={1.4}
        color="#ffca86"
        distance={12}
        decay={1.5}
      />
    </group>
  );
}

function Door({ door, hovered, onHover, onSelect }) {
  const isHovered = hovered === door.id;
  const { position, yaw } = doorTransform(door);

  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {/* Door frame */}
      <mesh position={[0, 0.1, -0.04]}>
        <boxGeometry args={[1.55, 2.85, 0.12]} />
        <meshStandardMaterial color="#3a2613" roughness={0.7} metalness={0} />
      </mesh>

      {/* Door panel — the interactive surface */}
      <mesh
        onPointerOver={(event) => {
          event.stopPropagation();
          onHover(door.id);
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          onHover(null);
        }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(door.id);
        }}
      >
        <boxGeometry args={[1.28, 2.55, 0.1]} />
        <meshStandardMaterial
          color={isHovered ? "#7a4f24" : "#4a3018"}
          emissive={isHovered ? "#d8a02a" : "#3a2410"}
          emissiveIntensity={isHovered ? 0.5 : 0.24}
          roughness={0.65}
          metalness={0}
        />
      </mesh>

      {/* Brass knob */}
      <mesh position={[0.46, -0.05, 0.08]}>
        <sphereGeometry args={[0.075, 16, 16]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>

      {/* Door label — anchored at its baseline so wrapped, two-line labels
          grow upward and every label keeps the same gap above the door. */}
      <ShipText
        position={[0, 1.62, 0.08]}
        fontSize={0.2}
        maxWidth={1.6}
        textAlign="center"
        anchorX="center"
        anchorY="bottom"
        color={isHovered ? "#ffe7b0" : "#d8b87a"}
        outlineWidth={0.006}
        outlineColor="#1a0d04"
      >
        {door.label}
      </ShipText>
    </group>
  );
}

function HallwayScene({ onSelect }) {
  const [hovered, setHovered] = useState(null);
  const wallTex = useRepeatingCanvasTexture(
    drawWoodGrainTexture,
    [],
    512,
    [4, 2],
  );
  const floorTex = useRepeatingCanvasTexture(
    drawWoodGrainTexture,
    [],
    512,
    [3, 8],
  );

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "auto";
    return () => {
      document.body.style.cursor = "auto";
    };
  }, [hovered]);

  return (
    <>
      <color attach="background" args={["#1c130a"]} />
      <fog attach="fog" args={["#2a1d10", 16, 34]} />

      <ambientLight intensity={0.9} color="#ffe7c4" />
      <hemisphereLight args={["#ffe9c8", "#4a3220", 0.7]} />
      <pointLight
        position={[0, 2.6, 2]}
        intensity={1.4}
        color="#ffd9a6"
        distance={22}
        decay={1.4}
      />
      <pointLight
        position={[0, 2.4, -4]}
        intensity={1.1}
        color="#ffc998"
        distance={18}
        decay={1.5}
      />

      <OceanSway>
        {/* Floor */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, FLOOR_Y, ROOM_MID_Z]}
        >
          <planeGeometry args={[WALL_X * 2, ROOM_LEN]} />
          <meshStandardMaterial
            map={floorTex}
            color="#7a5430"
            roughness={0.75}
          />
        </mesh>
        {/* Ceiling */}
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, CEIL_Y, ROOM_MID_Z]}>
          <planeGeometry args={[WALL_X * 2, ROOM_LEN]} />
          <meshStandardMaterial
            map={floorTex}
            color="#4a3220"
            roughness={0.85}
          />
        </mesh>
        {/* Side walls */}
        <mesh
          rotation={[0, Math.PI / 2, 0]}
          position={[-WALL_X, WALL_MID_Y, ROOM_MID_Z]}
        >
          <planeGeometry args={[ROOM_LEN, WALL_H]} />
          <meshStandardMaterial
            map={wallTex}
            color="#6b4a2a"
            roughness={0.82}
          />
        </mesh>
        <mesh
          rotation={[0, -Math.PI / 2, 0]}
          position={[WALL_X, WALL_MID_Y, ROOM_MID_Z]}
        >
          <planeGeometry args={[ROOM_LEN, WALL_H]} />
          <meshStandardMaterial
            map={wallTex}
            color="#6b4a2a"
            roughness={0.82}
          />
        </mesh>
        {/* Back wall */}
        <mesh position={[0, WALL_MID_Y, BACK_Z]}>
          <planeGeometry args={[WALL_X * 2, WALL_H]} />
          <meshStandardMaterial
            map={wallTex}
            color="#5a3d22"
            roughness={0.85}
          />
        </mesh>
        {/* Front wall (behind the camera, seals the room) */}
        <mesh rotation={[0, Math.PI, 0]} position={[0, WALL_MID_Y, FRONT_Z]}>
          <planeGeometry args={[WALL_X * 2, WALL_H]} />
          <meshStandardMaterial
            map={wallTex}
            color="#5a3d22"
            roughness={0.85}
          />
        </mesh>

        {/* Candle sconces in the blank wall stretches, clear of the doors */}
        {SIDE_SCONCE_Z.map((z) => (
          <group key={`side-${z}`}>
            <Sconce position={[-WALL_X + 0.05, 0.55, z]} yaw={Math.PI / 2} />
            <Sconce position={[WALL_X - 0.05, 0.55, z]} yaw={-Math.PI / 2} />
          </group>
        ))}
        {/* Candle sconces tucked into the back corners */}
        {BACK_SCONCE_X.map((x) => (
          <Sconce key={`back-${x}`} position={[x, 0.55, BACK_Z + 0.05]} yaw={0} />
        ))}

        {/* Centrepiece chandelier hanging over the corridor */}
        <Chandelier position={[0, 1.5, 0.6]} />

        {DOORS.map((door) => (
          <Door
            key={door.id}
            door={door}
            hovered={hovered}
            onHover={setHovered}
            onSelect={onSelect}
          />
        ))}

        <DustMotes count={80} bounds={[6, 4.4, 8]} />
      </OceanSway>

      <MouseLook />
    </>
  );
}

function HallwayFallback({ onSelect }) {
  return (
    <div className={styles.fallback}>
      <h2 className={styles.fallbackTitle}>Hallway</h2>
      <div className={styles.fallbackDoors}>
        {DOORS.map((door) => (
          <button
            key={door.id}
            type="button"
            className={styles.fallbackDoor}
            onClick={() => onSelect(door.id)}
          >
            {door.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Hallway({
  onEnterRoom,
  onOpenF2,
  onOpenF3,
  onOpenF4,
  onOpenF5,
  onOpenF6,
}) {
  const webglAvailable = useWebGLAvailable();
  const handlers = {
    room: onEnterRoom,
    f2: onOpenF2,
    f3: onOpenF3,
    f4: onOpenF4,
    f5: onOpenF5,
    f6: onOpenF6,
  };
  const select = (id) => handlers[id]?.();

  if (!webglAvailable) {
    return <HallwayFallback onSelect={select} />;
  }

  return (
    <div className={styles.root}>
      <Canvas
        dpr={[1, 1.6]}
        performance={{ min: 0.6 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ position: CAMERA_POS, fov: 58, near: 0.1, far: 40 }}
        onCreated={({ camera }) => {
          camera.rotation.order = "YXZ";
          camera.rotation.x = BASE_PITCH;
        }}
        fallback={<HallwayFallback onSelect={select} />}
      >
        <Suspense fallback={null}>
          <HallwayScene onSelect={select} />
        </Suspense>
      </Canvas>
      <p className={styles.hint}>Move the mouse to look · click a door</p>
    </div>
  );
}
