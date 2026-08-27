import { Line } from "@react-three/drei";
import ShipText from "../../../shared/ShipText";
import { animated, useSpring } from "@react-spring/three";
import { useEffect, useMemo, useRef, useState } from "react";
import { DARK_IRON_MATERIAL, PALE_WOOD_MATERIAL, SPRING_CONFIG } from "../../../../lib/f6Constants";
import { drawPuppetFace } from "../../../../lib/f6TextureBuilders";
import useCanvasTexture from "../../../../hooks/useCanvasTexture";
import usePointerCursor from "../../../../hooks/usePointerCursor";
import { sectorForYaw, yawForSector } from "../../../../lib/f6Filters";
import ParchmentTooltip from "../shared/ParchmentTooltip";

const DRAG_RADIANS_PER_PIXEL = 0.012;
const DRAG_DEGREES_PER_PIXEL = (DRAG_RADIANS_PER_PIXEL * 180) / Math.PI;

const SECTOR_LABELS = {
  W: "Facing: hard left",
  NW: "Facing: three-quarter left",
  N: "Facing: front",
  NE: "Facing: three-quarter right",
  E: "Facing: hard right",
};

// The carving turns left and right only. Pitch is not measurable from a painted
// face reliably enough to select on, so the head does not offer an axis the
// filter cannot honour: a control that moves without changing the result is the
// same broken promise as a filter that ignores you.
function labelFromPose(yaw) {
  return SECTOR_LABELS[sectorForYaw(yaw)] || SECTOR_LABELS.N;
}

export default function CarvedPuppetHead({ filters, setFilter, clearFilter, disabled, position = [2.08, -1.08, 0.55], rotation = [0.02, 0, -0.03], scale = 0.82 }) {
  const active = filters.portrait.active;
  const selectedSector = filters.portrait.value.sector;
  const initial = useMemo(() => sectorPose(selectedSector), [selectedSector]);
  const [pose, setPose] = useState(initial);
  const [hovered, setHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef(false);
  const lastFilterUpdate = useRef(0);
  const faceTexture = useCanvasTexture(drawPuppetFace, [], 256);
  usePointerCursor((hovered || isDragging) && !disabled);

  useEffect(() => {
    if (dragging.current) return;
    setPose(active ? initial : { yaw: 0 });
  }, [active, initial]);

  const spring = useSpring({
    yaw: disabled ? 0 : pose.yaw,
    lift: active ? 0.06 : 0,
    glow: active || hovered ? 0.3 : 0.15,
    config: SPRING_CONFIG,
  });
  const updateFromPointer = (event) => {
    if (!dragging.current || disabled) return;
    const dx = event.nativeEvent?.movementX ?? event.movementX ?? 0;
    setPose((current) => {
      const next = {
        yaw: Math.max(-70, Math.min(70, current.yaw + dx * DRAG_DEGREES_PER_PIXEL)),
      };
      const now = performance.now();
      if (now - lastFilterUpdate.current > 80) {
        lastFilterUpdate.current = now;
        setFilter("portrait", { sector: sectorForYaw(next.yaw), portraitsOnly: true }, true);
      }
      return next;
    });
  };

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {active && !disabled ? <pointLight position={[0, 0.25, 0.65]} color="#ffaa44" intensity={0.7} distance={1.8} castShadow={false} /> : null}
      <mesh castShadow receiveShadow position={[0, -0.49, -0.08]}>
        <boxGeometry args={[0.92, 0.12, 0.32]} />
        <meshStandardMaterial color="#4a2810" roughness={0.7} emissive="#1a0800" emissiveIntensity={0.12} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, -0.34, -0.02]}>
        <cylinderGeometry args={[0.34, 0.4, 0.09, 48]} />
        <meshStandardMaterial color="#4a2810" roughness={0.68} emissive="#1a0800" emissiveIntensity={0.12} />
      </mesh>
      <YawArc yaw={pose.yaw} active={active || isDragging} />
      <mesh castShadow position={[0, -0.17, 0]}>
        <cylinderGeometry args={[0.035, 0.045, 0.42, 20]} />
        <meshStandardMaterial {...DARK_IRON_MATERIAL} color="#2a2a2a" metalness={0.9} roughness={0.62} emissive="#111111" emissiveIntensity={0.2} />
      </mesh>
      <mesh castShadow position={[0, 0.07, 0]}>
        <sphereGeometry args={[0.09, 24, 12]} />
        <meshStandardMaterial {...DARK_IRON_MATERIAL} color="#2a2a2a" metalness={0.9} roughness={0.62} emissive="#111111" emissiveIntensity={0.2} />
      </mesh>
      <animated.group
        position-y={spring.lift}
        rotation-y={spring.yaw.to((v) => (v * Math.PI) / 180)}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onPointerDown={(event) => {
          event.stopPropagation();
          dragging.current = true;
          setIsDragging(true);
          setHovered(false);
          event.target.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          event.stopPropagation();
          updateFromPointer(event);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          dragging.current = false;
          setIsDragging(false);
          event.target.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = false;
          setIsDragging(false);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          setPose({ yaw: 0 });
          clearFilter("portrait");
        }}
      >
        <ParchmentTooltip visible={hovered && !isDragging && !disabled} title="Carved Head" hint="filter portrait pose · drag head" position={[-0.92, 0.52, 0.3]} />
        <mesh castShadow receiveShadow position={[0, 0.32, 0]} scale={[0.82, 1.08, 0.76]}>
          <sphereGeometry args={[0.33, 32, 20]} />
          <animated.meshStandardMaterial
            {...PALE_WOOD_MATERIAL}
            map={faceTexture}
            color="#c8a87a"
            roughness={0.65}
            bumpScale={0.025}
            emissive="#2a1a05"
            emissiveIntensity={spring.glow}
          />
        </mesh>
        <mesh position={[0, 0.35, 0.22]} scale={[0.08, 0.18, 0.06]}>
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color="#a77b4f" roughness={0.65} emissive="#2a1a05" emissiveIntensity={0.1} />
        </mesh>
        <FeatureLine position={[-0.09, 0.39, 0.225]} />
        <FeatureLine position={[0.09, 0.39, 0.225]} />
        <mesh position={[0, 0.26, 0.24]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.012, 0.012, 0.16, 8]} />
          <meshStandardMaterial color="#6e4424" roughness={0.65} emissive="#2a1a05" emissiveIntensity={0.08} />
        </mesh>
      </animated.group>
      <ParchmentPoseLabel text={disabled ? "No face data" : active ? labelFromPose(pose.yaw) : labelFromPose(0)} />
    </group>
  );
}

function YawArc({ yaw, active }) {
  const points = useMemo(() => {
    const start = -Math.PI / 2;
    const end = start + (yaw * Math.PI) / 180;
    const steps = 18;
    return Array.from({ length: steps + 1 }, (_, index) => {
      const t = steps === 0 ? 0 : index / steps;
      const angle = start + (end - start) * t;
      return [Math.cos(angle) * 0.38, -0.285, Math.sin(angle) * 0.38 + 0.02];
    });
  }, [yaw]);

  return (
    <Line
      points={points}
      color={active ? "#ffaa44" : "#d4a017"}
      lineWidth={active ? 3 : 2}
      transparent
      opacity={active ? 0.95 : 0.55}
    />
  );
}

function FeatureLine({ position }) {
  return (
    <mesh position={position} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[0.008, 0.008, 0.1, 8]} />
      <meshStandardMaterial color="#6e4424" roughness={0.65} emissive="#2a1a05" emissiveIntensity={0.08} />
    </mesh>
  );
}

function ParchmentPoseLabel({ text }) {
  return (
    <group position={[0.52, -0.05, 0.12]} rotation={[0.04, 0, -0.08]}>
      <mesh castShadow receiveShadow>
        <planeGeometry args={[0.72, 0.23]} />
        <meshStandardMaterial color="#f5e6c8" roughness={0.62} emissive="#2a1600" emissiveIntensity={0.08} />
      </mesh>
      <ShipText position={[0, 0, 0.012]} fontSize={0.038} color="#1a0a00" anchorX="center" anchorY="middle" maxWidth={0.62}>
        {text}
      </ShipText>
    </group>
  );
}

function sectorPose(sector) {
  return { yaw: yawForSector(sector) };
}
