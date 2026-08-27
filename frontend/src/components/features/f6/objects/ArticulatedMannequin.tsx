import ShipText from "../../../shared/ShipText";
import { animated, useSpring } from "@react-spring/three";
import { useState } from "react";
import { PALE_WOOD_MATERIAL, POSE_PRESETS, SPRING_CONFIG } from "../../../../lib/f6Constants";
import usePointerCursor from "../../../../hooks/usePointerCursor";
import ParchmentTooltip from "../shared/ParchmentTooltip";

export default function ArticulatedMannequin({ filters, setFilter, clearFilter, disabled, counts, position = [-2.1, -1.26, 1.24], rotation = [-0.08, 0, 0.04], scale = 0.82 }) {
  const selected = filters.pose.value || "armsDown";
  const active = filters.pose.active;
  const [hoveredFigure, setHoveredFigure] = useState(false);
  usePointerCursor(hoveredFigure && !disabled);
  const angles = poseAngles(active ? selected : null);
  const body = useSpring({
    lArm: angles.lArm,
    rArm: angles.rArm,
    lFore: angles.lFore,
    rFore: angles.rFore,
    lLeg: angles.lLeg,
    rLeg: angles.rLeg,
    lShin: angles.lShin,
    rShin: angles.rShin,
    torso: angles.torso,
    head: angles.head,
    lift: active ? 0.05 : 0,
    config: SPRING_CONFIG,
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {active && !disabled ? <pointLight position={[0, 0.35, 0.5]} color="#ffaa44" intensity={0.7} distance={1.8} castShadow={false} /> : null}
      {/* base disk sitting under the feet */}
      <mesh castShadow receiveShadow position={[0, -0.84, 0]}>
        <cylinderGeometry args={[0.24, 0.27, 0.06, 32]} />
        <meshStandardMaterial color="#8a5d32" roughness={0.65} emissive="#2a1a05" emissiveIntensity={0.12} />
      </mesh>
      {/* vertical rod from base to lower torso */}
      <mesh raycast={() => null} position={[0, -0.46, -0.02]}>
        <cylinderGeometry args={[0.018, 0.018, 0.72, 8]} />
        <meshStandardMaterial color="#5a3a18" roughness={0.55} metalness={0.3} emissive="#1a0a00" emissiveIntensity={0.1} />
      </mesh>
      <animated.group
        position-y={body.lift}
        rotation-z={body.torso}
        onPointerOver={() => setHoveredFigure(true)}
        onPointerOut={() => setHoveredFigure(false)}
        onClick={(event) => {
          event.stopPropagation();
          if (disabled) return;
          if (active) clearFilter("pose");
          else setFilter("pose", selected || "armsDown", true);
        }}
      >
        <ParchmentTooltip visible={hoveredFigure && !disabled} title="Body Pose Filter" hint="click the figure · choose a tile" position={[0, 0.78, 0.26]} />
        <Segment kind="box" position={[0, -0.02, 0.08]} scale={[0.2, 0.38, 0.1]} />
        <Segment kind="box" position={[0, 0.225, 0.08]} scale={[0.055, 0.12, 0.055]} />
        <animated.group position={[0, 0.29, 0.08]} rotation-z={body.head}>
          <Segment kind="sphere" position={[0, 0.12, 0]} scale={[0.14, 0.14, 0.14]} />
        </animated.group>
        <Limb shoulder={[-0.16, 0.08, 0.08]} upper={body.lArm} lower={body.lFore} side={-1} />
        <Limb shoulder={[0.16, 0.08, 0.08]} upper={body.rArm} lower={body.rFore} side={1} />
        <Leg hip={[-0.08, -0.22, 0.08]} upper={body.lLeg} lower={body.lShin} side={-1} />
        <Leg hip={[0.08, -0.22, 0.08]} upper={body.rLeg} lower={body.rShin} side={1} />
      </animated.group>
      {/* Tile tray tilted onto the desk in front of the figure (like the line
          board's tiles) — upright at the old depth its bottom row sat buried
          inside the tabletop. */}
      <group position={[0, -0.72, 0.42]} rotation={[-1.2, 0, 0]}>
        {POSE_PRESETS.map(([id, label], index) => {
          // A tile that matches nothing is dead wood: only about a fifth of
          // paintings yield a usable skeleton, so several presets have no
          // paintings at all in most collections. Grey them out rather than
          // letting the user find out by clicking.
          const empty = counts ? (counts[id] || 0) === 0 : false;
          return (
            <PoseTile
              key={id}
              index={index}
              label={label}
              count={counts ? counts[id] || 0 : null}
              selected={active && selected === id}
              disabled={disabled || empty}
              onClick={() => {
                if (disabled || empty) return;
                if (active && selected === id) clearFilter("pose");
                else setFilter("pose", id, true);
              }}
            />
          );
        })}
      </group>
    </group>
  );
}

function Segment({ kind, position, scale }) {
  return (
    <mesh castShadow receiveShadow position={position} scale={scale}>
      {kind === "sphere" ? <sphereGeometry args={[1, 18, 12]} /> : <boxGeometry args={[1, 1, 1]} />}
      <meshStandardMaterial {...PALE_WOOD_MATERIAL} color="#d4aa70" roughness={0.65} emissive="#2a1a05" emissiveIntensity={0.15} />
    </mesh>
  );
}

function Joint({ position }) {
  return (
    <mesh castShadow position={position}>
      <sphereGeometry args={[0.045, 12, 8]} />
      <meshStandardMaterial color="#7d5832" roughness={0.62} emissive="#1a0a00" emissiveIntensity={0.16} />
    </mesh>
  );
}

function Limb({ shoulder, upper, lower, side }) {
  return (
    <animated.group position={shoulder} rotation-z={upper}>
      <Joint position={[0, 0, 0]} />
      <Segment kind="box" position={[side * 0.045, -0.13, 0]} scale={[0.07, 0.25, 0.07]} />
      <animated.group position={[side * 0.07, -0.25, 0]} rotation-z={lower}>
        <Joint position={[0, 0, 0]} />
        <Segment kind="box" position={[side * 0.04, -0.12, 0]} scale={[0.06, 0.23, 0.06]} />
        <Segment kind="sphere" position={[side * 0.08, -0.25, 0]} scale={[0.045, 0.045, 0.045]} />
      </animated.group>
    </animated.group>
  );
}

function Leg({ hip, upper, lower, side }) {
  return (
    <animated.group position={hip} rotation-z={upper}>
      <Joint position={[0, 0, 0]} />
      <Segment kind="box" position={[side * 0.035, -0.16, 0]} scale={[0.075, 0.28, 0.075]} />
      <animated.group position={[side * 0.05, -0.29, 0]} rotation-z={lower}>
        <Joint position={[0, 0, 0]} />
        <Segment kind="box" position={[side * 0.035, -0.15, 0]} scale={[0.065, 0.27, 0.065]} />
        <Segment kind="box" position={[side * 0.08, -0.29, 0.03]} scale={[0.14, 0.045, 0.07]} />
      </animated.group>
    </animated.group>
  );
}

function PoseTile({ index, label, count, selected, disabled, onClick }) {
  const [hovered, setHovered] = useState(false);
  usePointerCursor(hovered && !disabled);
  const spring = useSpring({
    z: selected ? 0.1 : hovered ? 0.05 : 0,
    color: disabled ? "#4a4640" : selected ? "#c08b48" : hovered ? "#9a6835" : "#6d4422",
    config: SPRING_CONFIG,
  });
  const x = -0.52 + index * 0.52;
  const y = -0.04;
  return (
    <animated.group position-x={x} position-y={y} position-z={spring.z}>
      <mesh
        castShadow
        receiveShadow
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        <boxGeometry args={[0.46, 0.22, 0.05]} />
        <animated.meshStandardMaterial color={spring.color} roughness={0.65} emissive="#2a1a05" emissiveIntensity={hovered || selected ? 0.22 : 0.08} />
      </mesh>
      <ShipText position={[0, 0.038, 0.032]} fontSize={0.052} color="#f7ead2" anchorX="center" anchorY="middle" maxWidth={0.42} textAlign="center">
        {label}
      </ShipText>
      {count != null ? (
        <ShipText position={[0, -0.055, 0.032]} fontSize={0.036} color={count ? "#dcc08a" : "#8a8374"} anchorX="center" anchorY="middle">
          {count}
        </ShipText>
      ) : null}
    </animated.group>
  );
}


function poseAngles(id) {
  const pi = Math.PI;
  // Both arms rotate about z, and the left one hangs on the -x side, so a
  // POSITIVE angle swings it toward the midline and then across the chest. The
  // two sides therefore need opposite signs to open outwards: left negative,
  // right positive. They used to share the same sign, which is why raising the
  // arms folded them over the body — "arms lowered" escaped it only because its
  // angle is small enough for the crossing not to show.
  const outward = (magnitude, elbow) => ({
    lArm: -magnitude,
    rArm: magnitude,
    lFore: -elbow,
    rFore: elbow,
  });
  const base = {
    lArm: -0.18,
    rArm: 0.18,
    lFore: -0.08,
    rFore: 0.08,
    lLeg: 0.08,
    rLeg: -0.08,
    lShin: -0.08,
    rShin: 0.08,
    torso: 0,
    head: 0,
  };
  // The legs stay at rest in every preset: the filter cannot read them, so the
  // figure must not imply that moving them would change anything.
  //
  // pi*0.38 puts the hands level with the shoulders rather than pi*0.5: the
  // upper-arm and forearm offsets add lift, so a literal 90 degrees reads as
  // half-raised instead of straight out.
  if (id === "armsRaised") return { ...base, ...outward(pi * 0.78, 0.12) };
  if (id === "armsOut") return { ...base, ...outward(pi * 0.38, 0.06) };
  if (id === "armsDown") return { ...base, ...outward(0.12, 0.05) };
  return base;
}
