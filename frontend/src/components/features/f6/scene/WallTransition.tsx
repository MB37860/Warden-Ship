import { animated } from "@react-spring/three";
import { WOOD_MATERIAL } from "../../../../lib/f6Constants";

export default function WallTransition({ progress, woodTexture }) {
  const leftX = progress.to((p) => -0.8 - p * 1.35);
  const rightX = progress.to((p) => 0.8 + p * 1.35);
  const z = progress.to((p) => -0.5 + p * 0.05);

  return (
    <>
      <animated.group position-x={leftX} position-z={z}>
        {Array.from({ length: 3 }).map((_, index) => (
          <DoorPlank key={`left-${index}`} x={index * 0.32 - 0.32} texture={woodTexture} />
        ))}
      </animated.group>
      <animated.group position-x={rightX} position-z={z}>
        {Array.from({ length: 3 }).map((_, index) => (
          <DoorPlank key={`right-${index}`} x={index * 0.32 - 0.32} texture={woodTexture} />
        ))}
      </animated.group>
    </>
  );
}

function DoorPlank({ x, texture }) {
  return (
    <mesh raycast={() => null} castShadow receiveShadow position={[x, 0.18, 0]}>
      <boxGeometry args={[0.3, 4.35, 0.16]} />
      <meshStandardMaterial
        {...WOOD_MATERIAL}
        map={texture}
        bumpMap={texture}
        bumpScale={0.028}
      />
    </mesh>
  );
}
