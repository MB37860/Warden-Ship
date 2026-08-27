import ShipText from "../../../shared/ShipText";
import { animated, useSpring } from "@react-spring/three";
import usePointerCursor from "../../../../hooks/usePointerCursor";
import { PaintingSurface } from "./PaintingCard";

export default function PaintingDetail({ record, onClose }) {
  usePointerCursor(Boolean(record));
  const spring = useSpring({
    scale: record ? 1 : 0.92,
    opacity: record ? 0.72 : 0,
    y: record ? 0.04 : -0.1,
    config: { tension: 145, friction: 18, mass: 0.9 },
  });
  if (!record) return null;
  return (
    <animated.group
      position={spring.y.to((y) => [0, y, 1.16])}
      scale={spring.scale}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <mesh position={[0, 0, -0.08]}>
        <planeGeometry args={[3.7, 2.78]} />
        <animated.meshStandardMaterial color="#050302" transparent opacity={spring.opacity} />
      </mesh>
      <mesh position={[0, -1.52, 0.02]}>
        <planeGeometry args={[2.65, 0.34]} />
        <meshStandardMaterial color="#f5e6c8" roughness={0.9} />
      </mesh>
      <PaintingSurface record={record} width={2.65} height={2.02} detail />
      <ShipText position={[0, -1.45, 0.05]} fontSize={0.075} color="#1a0a00" anchorX="center" maxWidth={2.35}>
        {record.title}
      </ShipText>
      <ShipText position={[0, -1.58, 0.05]} fontSize={0.052} color="#5c3d1e" anchorX="center" maxWidth={2.35}>
        {[record.artist, record.year].filter(Boolean).join(" - ") || "Click to return"}
      </ShipText>
    </animated.group>
  );
}
