import ShipText from "../../../shared/ShipText";
import type { ThreeEvent } from "@react-three/fiber";
import { animated, useSpring } from "@react-spring/three";
import { useState } from "react";
import { SPRING_CONFIG, WAVE_DIRECTIONS } from "../../../../lib/f6Constants";
import { isHoughActive } from "../../../../lib/f6Filters";
import usePointerCursor from "../../../../hooks/usePointerCursor";
import ParchmentTooltip from "../shared/ParchmentTooltip";

// Height fraction (0..1 of MAX_H) for each of the 9 rods in every state.
// Clicking the model repositions the rods into the next silhouette, so the
// shape itself reads as "how many straight lines" the painting has.
const HEIGHTS: Record<string, number[]> = {
  idle: [0.32, 0.4, 0.28, 0.36, 0.3, 0.36, 0.28, 0.4, 0.32], // calm resting row
  few: [0.95, 0.18, 0.18, 0.95, 0.18, 0.18, 0.95, 0.18, 0.18], // 3 tall peaks
  some: [0.9, 0.5, 0.28, 0.72, 0.4, 0.85, 0.3, 0.55, 0.92], // mixed
  many: [1, 1, 1, 1, 1, 1, 1, 1, 1], // all tall
};

const CYCLE: ReadonlyArray<"few" | "some" | "many"> = ["few", "some", "many"];
const CYCLE_INTENSITY: Record<string, number> = { few: 1, some: 5, many: 9 };

// "Most ..." rather than "Vertical": the filter returns the third of the loaded
// collection whose edges lean that way most, not paintings that are vertical in
// any absolute sense. Most paintings have no dominant direction at all.
const DIRECTION_LABELS: Record<string, string> = {
  vertical: "Most vertical",
  horizontal: "Most horizontal",
  diagonal: "Most diagonal",
};

const MAX_H = 0.62; // tallest a rod can reach (cylinder length)
const ROD_R = 0.032; // rod radius
const BAR_GAP = 0.108;

function densityBucket(
  intensity: number | null,
): "few" | "some" | "many" | null {
  if (intensity == null) return null;
  return intensity <= 3 ? "few" : intensity <= 6 ? "some" : "many";
}

export default function LineStructureBoard({
  filters,
  setFilter,
  disabled,
  position = [0, -1.0, 1.55] as [number, number, number],
  rotation = [-0.2, 0, 0] as [number, number, number],
  scale = 0.82,
  tilesPosition = [0, -1.46, 1.9] as [number, number, number],
  tilesRotation = [-1.2, 0, 0] as [number, number, number],
  tilesScale = 0.74,
}) {
  const value = filters.hough.value;
  const active = filters.hough.active && isHoughActive(value);
  const currentDensity = densityBucket(value.intensity);
  const [hovered, setHovered] = useState(false);
  usePointerCursor(hovered && !disabled);

  const spring = useSpring({
    s: disabled ? 0.97 : hovered ? 1.03 : 1.0,
    glow: disabled ? 0 : active ? 0.26 : hovered ? 0.13 : 0.05,
    config: SPRING_CONFIG,
  });

  const cycleNext = () => {
    if (disabled) return;
    if (!active || !currentDensity) {
      setFilter("hough", { ...value, intensity: CYCLE_INTENSITY.few }, true);
    } else {
      const idx = CYCLE.indexOf(currentDensity);
      if (idx < CYCLE.length - 1) {
        const next = CYCLE[idx + 1];
        setFilter(
          "hough",
          { ...value, intensity: CYCLE_INTENSITY[next] },
          true,
        );
      } else {
        setFilter(
          "hough",
          { ...value, intensity: null },
          value.directions.length > 0,
        );
      }
    }
  };

  // single-select direction so the rods have one clear orientation to show
  const selectDirection = (id: string) => {
    if (disabled) return;
    const directions = value.directions.includes(id) ? [] : [id];
    setFilter(
      "hough",
      { ...value, directions },
      value.intensity != null || directions.length > 0,
    );
  };

  const heights =
    active && currentDensity ? HEIGHTS[currentDensity] : HEIGHTS.idle;
  const direction = value.directions[0] || null;
  const hint =
    active && currentDensity
      ? { few: "Few lines", some: "Some lines", many: "Many lines" }[
          currentDensity
        ] + " — click to change"
      : "click to set line density";

  const cycleHandlers = {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (!disabled) setHovered(true);
    },
    onPointerOut: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHovered(false);
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      cycleNext();
    },
  };

  const firstX = -((9 - 1) * BAR_GAP) / 2;

  return (
    <group>
      {/* ════ the 3D line model — height = density, lean = direction ════ */}
      <animated.group
        position={position}
        rotation={rotation}
        scale={spring.s.to((s) => s * scale)}
      >
        {active && !disabled && (
          <pointLight
            position={[0, 0.55, 0.4]}
            color="#ffb347"
            intensity={0.95}
            distance={2.4}
            castShadow={false}
          />
        )}
        <ParchmentTooltip
          visible={hovered && !disabled}
          title="Line Structure"
          hint={hint}
          position={[0, 0.95, 0.2]}
        />

        {/* generous invisible hit volume so clicking the rods cycles density */}
        <mesh position={[0, MAX_H / 2 + 0.04, 0]} {...cycleHandlers}>
          <boxGeometry args={[1.05, MAX_H + 0.2, 0.3]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {/* polished base plinth */}
        <mesh
          castShadow
          receiveShadow
          position={[0, -0.11, 0]}
          {...cycleHandlers}
        >
          <boxGeometry args={[1.12, 0.16, 0.3]} />
          <animated.meshStandardMaterial
            color="#241710"
            roughness={0.5}
            metalness={0.25}
            emissive="#1a0d04"
            emissiveIntensity={spring.glow}
          />
        </mesh>
        {/* brass top plate the rods rise from */}
        <mesh raycast={() => null} position={[0, -0.026, 0]}>
          <boxGeometry args={[1.12, 0.03, 0.31]} />
          <meshStandardMaterial
            color="#c9971d"
            metalness={0.9}
            roughness={0.22}
            emissive="#3a2400"
            emissiveIntensity={0.25}
          />
        </mesh>
        {/* brass end caps */}
        {([-0.55, 0.55] as number[]).map((x) => (
          <mesh key={x} raycast={() => null} position={[x, -0.07, 0]}>
            <boxGeometry args={[0.03, 0.2, 0.32]} />
            <meshStandardMaterial
              color="#c9971d"
              metalness={0.9}
              roughness={0.22}
            />
          </mesh>
        ))}
        {/* engraved label */}
        <ShipText
          position={[0, -0.115, 0.156]}
          fontSize={0.05}
          letterSpacing={0.04}
          color={disabled ? "#7a7060" : "#e7cf9c"}
          anchorX="center"
          anchorY="middle"
        >
          LINE STRUCTURE
        </ShipText>

        {/* the 9 rods */}
        {heights.map((h, i) => (
          <Rod
            key={i}
            x={firstX + i * BAR_GAP}
            frac={h}
            angle={angleFor(i, direction)}
            active={active}
            {...cycleHandlers}
          />
        ))}
      </animated.group>

      {/* ════ direction buttons — laid flat on the table ════ */}
      <group
        position={tilesPosition}
        rotation={tilesRotation}
        scale={tilesScale}
      >
        <pointLight
          position={[0, 0.1, 0.55]}
          color="#ffd9a0"
          intensity={0.6}
          distance={2.4}
          castShadow={false}
        />
        {/* engraved brass plaque the tiles sit in */}
        <mesh receiveShadow raycast={() => null} position={[0, -0.04, -0.04]}>
          <boxGeometry args={[2.0, 0.74, 0.05]} />
          <meshStandardMaterial
            color="#33220f"
            roughness={0.55}
            metalness={0.3}
            emissive="#2a1605"
            emissiveIntensity={0.45}
          />
        </mesh>
        {/* brass frame edge */}
        <mesh raycast={() => null} position={[0, -0.04, -0.06]}>
          <boxGeometry args={[2.06, 0.8, 0.04]} />
          <meshStandardMaterial
            color="#b8860b"
            metalness={0.85}
            roughness={0.3}
            emissive="#3a2400"
            emissiveIntensity={0.3}
          />
        </mesh>
        <ShipText
          position={[0, 0.28, 0.02]}
          fontSize={0.088}
          letterSpacing={0.05}
          color="#ffe9bf"
          anchorX="center"
          anchorY="middle"
        >
          LINE DIRECTION
        </ShipText>
        {WAVE_DIRECTIONS.map(([id], index) => (
          <DirectionTile
            key={id}
            id={id}
            label={DIRECTION_LABELS[id]}
            selected={value.directions.includes(id)}
            disabled={disabled}
            position={[-0.5 + index * 0.5, -0.05, 0.02]}
            onClick={() => selectDirection(id)}
          />
        ))}
      </group>
    </group>
  );
}

// lean angle (radians, about the base) for each rod given the chosen direction
const MIXED_ANGLES = [-0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 0];
function angleFor(i: number, direction: string | null) {
  if (!direction || direction === "vertical") return 0;
  if (direction === "diagonal") return 0.66;
  if (direction === "horizontal") return 1.32;
  return MIXED_ANGLES[i % MIXED_ANGLES.length]; // mixed
}

// ── single rod — an elegant brass line anchored at its base ────────────────────

function Rod({
  x,
  frac,
  angle,
  active,
  onPointerOver,
  onPointerOut,
  onClick,
}: {
  x: number;
  frac: number;
  angle: number;
  active: boolean;
  onPointerOver: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut: (e: ThreeEvent<PointerEvent>) => void;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const tall = frac > 0.55;
  const spring = useSpring({
    rot: angle,
    scaleY: frac,
    midY: (MAX_H * frac) / 2 + ROD_R,
    emissive: active ? (tall ? 0.7 : 0.22) : 0.08,
    config: SPRING_CONFIG,
  });
  return (
    <animated.group position={[x, ROD_R, 0]} rotation-z={spring.rot}>
      <animated.mesh
        castShadow
        position-y={spring.midY}
        scale-y={spring.scaleY}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
        onClick={onClick}
      >
        <capsuleGeometry args={[ROD_R, MAX_H, 6, 16]} />
        <animated.meshStandardMaterial
          color={active ? "#e6b657" : "#8a6a3a"}
          emissive="#ff9410"
          emissiveIntensity={spring.emissive}
          roughness={0.28}
          metalness={0.55}
        />
      </animated.mesh>
    </animated.group>
  );
}

// ── direction tile ────────────────────────────────────────────────────────────

function DirectionTile({
  id,
  label,
  selected,
  disabled,
  position,
  onClick,
}: {
  id: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  position: [number, number, number];
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  usePointerCursor(hovered && !disabled);
  const spring = useSpring({
    scale: selected ? 1.1 : hovered ? 1.04 : 1,
    lift: selected ? 0.08 : hovered ? 0.04 : 0,
    glow: selected ? 0.42 : hovered ? 0.18 : 0.05,
    config: SPRING_CONFIG,
  });
  return (
    <animated.group
      position={position}
      scale={spring.scale}
      position-z={spring.lift.to((l) => position[2] + l)}
    >
      <mesh
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
          onClick();
        }}
      >
        <boxGeometry args={[0.38, 0.38, 0.08]} />
        <animated.meshStandardMaterial
          color={selected ? "#8a531f" : "#4a3016"}
          roughness={0.55}
          metalness={0.25}
          emissive="#ff7a1d"
          emissiveIntensity={spring.glow}
        />
      </mesh>
      <LineIcon id={id} selected={selected} />
      <ShipText
        position={[0, -0.27, 0.05]}
        fontSize={0.05}
        color={selected ? "#ffe6bf" : "#cdb88e"}
        anchorX="center"
      >
        {label}
      </ShipText>
    </animated.group>
  );
}

function LineIcon({ id, selected }: { id: string; selected: boolean }) {
  const color = selected ? "#fff2c8" : "#e6cf98";
  const bar = (
    key: number | string,
    pos: [number, number, number],
    size: [number, number, number],
    rot: [number, number, number] = [0, 0, 0],
  ) => (
    <mesh key={key} raycast={() => null} position={pos} rotation={rot}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={selected ? 0.4 : 0.2}
        roughness={0.5}
      />
    </mesh>
  );
  const z = 0.045;
  if (id === "vertical")
    return (
      <group position={[0, 0.02, 0]}>
        {([-0.09, 0, 0.09] as number[]).map((x) =>
          bar(x, [x, 0, z], [0.024, 0.22, 0.012]),
        )}
      </group>
    );
  if (id === "horizontal")
    return (
      <group position={[0, 0.02, 0]}>
        {([-0.09, 0, 0.09] as number[]).map((y) =>
          bar(y, [0, y, z], [0.22, 0.024, 0.012]),
        )}
      </group>
    );
  if (id === "diagonal")
    return (
      <group position={[0, 0.02, 0]}>
        {([-0.1, 0, 0.1] as number[]).map((d) =>
          bar(d, [d, 0, z], [0.024, 0.28, 0.012], [0, 0, Math.PI / 4]),
        )}
      </group>
    );
  return (
    <group position={[0, 0.02, 0]}>
      {([-0.07, 0.07] as number[]).map((x) =>
        bar(`v${x}`, [x, 0, z], [0.024, 0.22, 0.012]),
      )}
      {([-0.07, 0.07] as number[]).map((y) =>
        bar(`h${y}`, [0, y, z], [0.22, 0.024, 0.012]),
      )}
    </group>
  );
}
