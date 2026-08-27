import { useState } from "react";
import { DARK_IRON_MATERIAL, WAX_MATERIAL } from "../../../../lib/f6Constants";
import usePointerCursor from "../../../../hooks/usePointerCursor";

export default function IronPin({
  position = [0, 0, 0],
  rotation = [Math.PI / 2, 0, 0],
  active = true,
  wax = "#8b0000",
  scale = 1,
  onClick,
}) {
  const [hovered, setHovered] = useState(false);
  const clickable = Boolean(onClick);
  usePointerCursor(clickable && hovered);

  return (
    <group
      position={position}
      rotation={active ? rotation : [rotation[0], rotation[1] + 0.75, rotation[2]]}
      scale={hovered && clickable ? scale * 1.15 : scale}
      onClick={onClick}
      onPointerOver={
        clickable
          ? (event) => {
              event.stopPropagation();
              setHovered(true);
            }
          : undefined
      }
      onPointerOut={
        clickable
          ? (event) => {
              event.stopPropagation();
              setHovered(false);
            }
          : undefined
      }
    >
      <mesh castShadow>
        <cylinderGeometry args={[0.018, 0.018, 0.14, 12]} />
        <meshStandardMaterial {...DARK_IRON_MATERIAL} roughness={0.82} />
      </mesh>
      <mesh castShadow position={[0, 0.078, 0]}>
        <sphereGeometry args={[0.036, 16, 8]} />
        <meshStandardMaterial
          {...WAX_MATERIAL}
          color={wax}
          emissive={active ? "#2a0800" : "#000000"}
          emissiveIntensity={hovered && clickable ? 0.38 : active ? 0.16 : 0}
        />
      </mesh>
    </group>
  );
}
