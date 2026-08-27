import { Line, RoundedBox } from "@react-three/drei";
import ShipText from "../../../shared/ShipText";
import { animated, useSpring } from "@react-spring/three";
import { useRef, useState } from "react";
import {
  CORK_MATERIAL,
  LIGHTNESS_LEVELS,
  SATURATION_LEVELS,
  SPRING_CONFIG,
  SWATCHES,
} from "../../../../lib/f6Constants";
import { clamp, isColorActive } from "../../../../lib/f6Filters";
import { drawClothSwatch } from "../../../../lib/f6TextureBuilders";
import useCanvasTexture from "../../../../hooks/useCanvasTexture";
import usePointerCursor from "../../../../hooks/usePointerCursor";
import IronPin from "../shared/IronPin";
import ParchmentTooltip from "../shared/ParchmentTooltip";

export default function DyeSwatchBoard({ filters, setFilter, clearFilter, disabled, counts, position = [-1.9, -1.42, 0.42], rotation = [-1.08, 0, -0.08], baseScale = 0.78 }) {
  const value = filters.color.value;
  const active = filters.color.active && isColorActive(value);
  const activeCount = active ? value.hues.length : 0;
  // The sliders qualify a pinned dye - "that teal, dark overall" - so they stay
  // inert until there is a dye for them to qualify.
  const bandsLive = value.hues.length > 0;
  const [hovered, setHovered] = useState(false);
  const satX = value.sat === "muted" ? -0.44 : value.sat === "vivid" ? 0.44 : 0;
  const lightX = value.light === "dark" ? -0.44 : value.light === "bright" ? 0.44 : 0;
  const boardSpring = useSpring({
    scale: disabled ? 0.97 : active || hovered ? 1.025 : 1,
    glow: disabled ? 0 : active ? 0.18 : hovered ? 0.08 : 0,
    config: SPRING_CONFIG,
  });

  return (
    <animated.group position={position} rotation={rotation} scale={boardSpring.scale.to((value) => value * baseScale)}>
      {active && !disabled ? <pointLight position={[0.2, 0.2, 0.55]} color="#ffaa44" intensity={0.7} distance={2} castShadow={false} /> : null}
      <RoundedBox
        args={[1.74, 1.72, 0.12]}
        radius={0.035}
        smoothness={4}
        castShadow
        receiveShadow
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <animated.meshStandardMaterial
          {...CORK_MATERIAL}
          color="#5c3418"
          roughness={0.7}
          emissive="#1a0a00"
          emissiveIntensity={active || hovered ? 0.3 : 0.1}
        />
      </RoundedBox>
      {SWATCHES.map((swatch, index) => {
        // One ring now that there are six cloths — twelve needed an inner ring
        // of two to fit. Starting at the top keeps the ring symmetrical about
        // the board's centre line.
        const angle = Math.PI / 2 + (index / SWATCHES.length) * Math.PI * 2;
        const radius = 0.5;
        // Old paintings do not use the whole hue circle — half of a typical
        // collection sits in one ochre band — so several dyes legitimately hold
        // nothing, and dyes are ANDed, so most of the rest hold nothing once a
        // cloth is pinned. The count is what this cloth would leave on the table.
        const count = counts ? counts[swatch[2]] || 0 : null;
        const selected = active && value.hues.includes(swatch[2]);
        // A pinned cloth stays live at a count of zero. Its own count is what the
        // board is showing, so a selection that has narrowed to nothing would
        // otherwise grey out every cloth on it and leave no way back.
        const empty = count === 0 && !selected;
        return (
          <ClothSwatch
            key={swatch[0]}
            swatch={swatch}
            index={index}
            count={count}
            position={[Math.cos(angle) * radius, Math.sin(angle) * radius * 0.78 + 0.12, 0.102 + index * 0.001]}
            rotation={[0, 0, angle + Math.PI / 2 + (index % 3 - 1) * 0.08]}
            selected={selected}
            pinnedCount={activeCount}
            disabled={empty}
            onSelect={() => {
              if (disabled || empty) return;
              const hues = value.hues.includes(swatch[2])
                ? value.hues.filter((hue) => hue !== swatch[2])
                : [...value.hues, swatch[2]];
              // Unpinning the last cloth leaves the board with nothing selected,
              // which is the instrument being off rather than a filter matching
              // everything. The bands go with it: they have nothing left to
              // qualify, and leaving them set would arm the sliders on a board
              // showing no dye.
              if (!hues.length) clearFilter("color");
              else setFilter("color", { ...value, hues }, true);
            }}
          />
        );
      })}
      <SwatchSlider
        label="Saturation"
        valueLabel={value.sat === "muted" ? "muted" : value.sat === "vivid" ? "vivid" : "balanced"}
        y={-0.50}
        beadX={satX}
        disabled={disabled || !bandsLive}
        colors={["#77736b", "#bd582c"]}
        onChange={(x) => {
          const sat = x < -0.16 ? SATURATION_LEVELS[0] : x > 0.16 ? SATURATION_LEVELS[2] : SATURATION_LEVELS[1];
          setFilter("color", { ...value, sat }, true);
        }}
      />
      <SwatchSlider
        label="Light"
        valueLabel={value.light === "dark" ? "dark" : value.light === "bright" ? "bright" : "middle"}
        y={-0.68}
        beadX={lightX}
        disabled={disabled || !bandsLive}
        colors={["#101010", "#f5e6c8"]}
        onChange={(x) => {
          const light = x < -0.16 ? LIGHTNESS_LEVELS[0] : x > 0.16 ? LIGHTNESS_LEVELS[2] : LIGHTNESS_LEVELS[1];
          setFilter("color", { ...value, light }, true);
        }}
      />
      <ShipText position={[0, 0.85, 0.108]} fontSize={0.09} color={disabled ? "#8a8374" : "#f5e6c8"} anchorX="center">
        DYER'S BOARD
      </ShipText>
      <ParchmentTooltip
        visible={hovered && !disabled}
        title="Dye Swatches"
        hint={activeCount > 1 ? `${activeCount} dyes · a painting must hold all` : "filter by color · pin cloths to narrow"}
        position={[1.05, 0.22, 0.35]}
      />
    </animated.group>
  );
}

function ClothSwatch({ swatch, index, count, position, rotation, selected, pinnedCount, disabled, onSelect }) {
  const [hovered, setHovered] = useState(false);
  usePointerCursor(hovered && !disabled);
  const texture = useCanvasTexture((ctx, canvas) => drawClothSwatch(ctx, canvas, swatch[1], swatch[0]), [swatch], 256);
  const spring = useSpring({
    z: selected ? position[2] + 0.14 : hovered ? position[2] + 0.06 : position[2],
    scale: disabled ? 0.82 : selected ? 1.12 : hovered ? 1.05 : 1,
    opacity: disabled ? 0.35 : 1,
    config: SPRING_CONFIG,
  });
  return (
    <animated.group position-x={position[0]} position-y={position[1]} position-z={spring.z} rotation={rotation} scale={spring.scale}>
      <ParchmentTooltip
        visible={hovered && !disabled}
        title={swatch[0]}
        hint={
          selected
            ? "pinned · click to unpin"
            : count == null
              ? "choose a hue"
              : pinnedCount
                ? `${count} of these also hold it`
                : `${count} painting${count === 1 ? "" : "s"}`
        }
        position={[0, 0.25, 0.2]}
      />
      <mesh
        castShadow
        receiveShadow
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
          onSelect();
        }}
      >
        <planeGeometry args={[0.4 + (index % 2) * 0.03, 0.28 + (index % 3) * 0.015, 8, 5]} />
        <meshStandardMaterial
          map={texture}
          color="#ffffff"
          roughness={0.62}
          metalness={0}
          bumpMap={texture}
          bumpScale={0.012}
          emissive={swatch[1]}
          emissiveIntensity={selected || hovered ? 0.16 : 0.05}
          transparent
          opacity={disabled ? 0.35 : 1}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
      <IronPin position={[0, 0.12, 0.04]} scale={0.68} active={selected || hovered} wax={selected ? "#ffaa44" : "#2a2a2a"} />
    </animated.group>
  );
}

function SwatchSlider({ label, valueLabel, y, beadX, colors, disabled, onChange }) {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const lastFilterUpdate = useRef(0);
  usePointerCursor((hovered || dragging) && !disabled);
  const bead = useSpring({ x: beadX, config: SPRING_CONFIG });

  const groupRef = useRef();
  const applyPointer = (event) => {
    if (disabled) return;
    const now = performance.now();
    if (now - lastFilterUpdate.current <= 80) return;
    lastFilterUpdate.current = now;
    // Convert the world-space hit to the slider's local frame so the track works
    // wherever the board is placed (no hardcoded world-x offset).
    const local = groupRef.current ? groupRef.current.worldToLocal(event.point.clone()) : event.point;
    onChange(clamp(local.x, -0.44, 0.44));
  };

  return (
    <group ref={groupRef} position={[0, y, 0.136]}>
      <mesh
        position={[0, 0, 0.035]}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          if (!dragging) setHovered(false);
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          setDragging(true);
          setHovered(false);
          event.target.setPointerCapture?.(event.pointerId);
          applyPointer(event);
        }}
        onPointerMove={(event) => {
          if (!dragging) return;
          event.stopPropagation();
          applyPointer(event);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          setDragging(false);
          event.target.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={(event) => {
          event.stopPropagation();
          setDragging(false);
        }}
      >
        <planeGeometry args={[1.18, 0.14]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Line
        points={[[-0.52, 0, 0], [0.52, 0, 0]]}
        color={disabled ? "#8a8374" : "#f5e6c8"}
        lineWidth={2.2}
      />
      <mesh position={[-0.28, 0, 0.01]}>
        <boxGeometry args={[0.46, 0.045, 0.012]} />
        <meshStandardMaterial color={colors[0]} roughness={0.65} emissive={colors[0]} emissiveIntensity={disabled ? 0 : 0.08} transparent opacity={disabled ? 0.3 : 1} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
      </mesh>
      <mesh position={[0.28, 0, 0.01]}>
        <boxGeometry args={[0.46, 0.045, 0.012]} />
        <meshStandardMaterial color={colors[1]} roughness={0.65} emissive={colors[1]} emissiveIntensity={disabled ? 0 : 0.08} transparent opacity={disabled ? 0.3 : 1} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
      </mesh>
      <animated.mesh
        castShadow
        position-x={bead.x}
        position-z={0.07}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onPointerDown={(event) => {
          event.stopPropagation();
          setDragging(true);
          setHovered(false);
          event.target.setPointerCapture?.(event.pointerId);
          applyPointer(event);
        }}
        onPointerMove={(event) => {
          if (!dragging) return;
          event.stopPropagation();
          applyPointer(event);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          setDragging(false);
          event.target.releasePointerCapture?.(event.pointerId);
        }}
      >
        <sphereGeometry args={[0.06, 20, 14]} />
        <meshStandardMaterial
          color={disabled ? "#6b5f45" : "#d4a017"}
          metalness={0.85}
          roughness={0.32}
          emissive="#6a4a00"
          emissiveIntensity={disabled ? 0 : hovered || dragging ? 0.3 : 0.16}
          transparent
          opacity={disabled ? 0.35 : 1}
        />
      </animated.mesh>
      <ShipText
        position={[0, -0.095, 0.02]}
        fontSize={0.043}
        color={disabled ? "#8a8374" : "#f5e6c8"}
        anchorX="center"
      >
        {label}: {disabled ? "pin a dye" : valueLabel}
      </ShipText>
    </group>
  );
}
