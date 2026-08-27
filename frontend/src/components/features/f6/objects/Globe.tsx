import ShipText from "../../../shared/ShipText";
import { animated, useSpring } from "@react-spring/three";
import { useState } from "react";
import { ORIGIN_REGIONS, SPRING_CONFIG } from "../../../../lib/f6Constants";
import { drawGlobeMap } from "../../../../lib/f6TextureBuilders";
import useCanvasTexture from "../../../../hooks/useCanvasTexture";
import usePointerCursor from "../../../../hooks/usePointerCursor";
import ParchmentTooltip from "../shared/ParchmentTooltip";

export default function Globe({ filters, setFilter, clearFilter, disabled = false, position = [1.05, -1.08, 1.2], rotation = [-0.08, 0, 0.03], scale = 0.84, standHeight = 0 }) {
  const [hovered, setHovered] = useState(false);
  const active = filters.origin.active;
  const selected = filters.origin.value.region;
  const globeTexture = useCanvasTexture(drawGlobeMap, [], 1024);
  usePointerCursor(hovered && !disabled);
  const spring = useSpring({
    scale: hovered ? 1.06 : active ? 1.03 : 1,
    glow: hovered || active ? 0.32 : 0.08,
    turn: selected ? ORIGIN_REGIONS.indexOf(selected) * 0.72 : 0,
    config: SPRING_CONFIG,
  });

  const chooseNextRegion = () => {
    if (disabled) return;
    if (!active || !selected) {
      setFilter("origin", { region: ORIGIN_REGIONS[0] }, true);
      return;
    }
    const index = ORIGIN_REGIONS.indexOf(selected);
    const next = ORIGIN_REGIONS[index + 1];
    if (!next) clearFilter("origin");
    else setFilter("origin", { region: next }, true);
  };

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <ParchmentTooltip
        visible={hovered && !disabled}
        title="Globe"
        hint={selected ? `origin filter · ${selected}` : "click to choose origin"}
        position={[0, 1.0, 0.42]}
      />
      <animated.group
        scale={spring.scale}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          setHovered(false);
        }}
        onClick={(event) => {
          event.stopPropagation();
          chooseNextRegion();
        }}
      >
        {/* Only the sphere spins to the chosen region; the brass rings stay
            fixed like a real globe's cage, so clicking no longer wobbles the
            whole assembly. */}
        <animated.mesh castShadow receiveShadow rotation-y={spring.turn}>
          <sphereGeometry args={[0.43, 32, 20]} />
          <animated.meshStandardMaterial
            map={globeTexture}
            color="#ffffff"
            roughness={0.72}
            emissive="#6ea5b8"
            emissiveIntensity={disabled ? 0.03 : spring.glow}
          />
        </animated.mesh>
        {[0.62, 1.56, 2.44].map((rotation) => (
          <mesh key={rotation} rotation={[0, rotation, 0]}>
            <torusGeometry args={[0.431, 0.006, 8, 64]} />
            <meshStandardMaterial color="#d4a017" roughness={0.45} metalness={0.65} />
          </mesh>
        ))}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.431, 0.006, 8, 64]} />
          <meshStandardMaterial color="#d4a017" roughness={0.45} metalness={0.65} />
        </mesh>
      </animated.group>
      <mesh castShadow position={[0, -0.54, 0]}>
        <cylinderGeometry args={[0.24, 0.3, 0.12, 28]} />
        <meshStandardMaterial color="#4a2810" roughness={0.68} emissive="#1a0800" emissiveIntensity={0.14} />
      </mesh>
      {standHeight > 0 ? (
        <>
          {/* column + foot reaching the desk, so the globe never floats */}
          <mesh castShadow position={[0, -0.6 - standHeight / 2, 0]}>
            <cylinderGeometry args={[0.05, 0.075, standHeight, 14]} />
            <meshStandardMaterial color="#4a2810" roughness={0.7} emissive="#1a0800" emissiveIntensity={0.1} />
          </mesh>
          <mesh castShadow position={[0, -0.6 - standHeight + 0.03, 0]}>
            <cylinderGeometry args={[0.3, 0.37, 0.07, 28]} />
            <meshStandardMaterial color="#3f2210" roughness={0.72} emissive="#160700" emissiveIntensity={0.1} />
          </mesh>
        </>
      ) : null}
      {/* Sits above the globe rather than under its base, clear of the sphere
          (top at y = 0.43) and of the stand below. */}
      <ShipText position={[0, 0.62, 0.1]} fontSize={0.06} color="#f5e6c8" anchorX="center" anchorY="middle">
        {disabled ? "RUN F6" : selected ? selected.toUpperCase() : "ORIGIN"}
      </ShipText>
    </group>
  );
}
