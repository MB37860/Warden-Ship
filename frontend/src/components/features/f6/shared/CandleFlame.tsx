import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { AdditiveBlending } from "three";

// A small additive-blended flame: a soft halo, a teardrop body and a hot core,
// all glowing rather than a flat cone. Reads as fire against the dark cabin.
export default function CandleFlame({ position = [0, 0, 0], scale = 1, active = true, castLight = true }) {
  const halo = useRef();
  const flame = useRef();
  const core = useRef();
  const light = useRef();

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const flicker = 0.85 + Math.sin(t * 11.7) * 0.09 + Math.sin(t * 23.1) * 0.05;
    const sway = Math.sin(t * 9.2) * 0.01 * scale;
    if (flame.current) {
      flame.current.scale.set(scale * 0.062 * flicker, scale * 0.155 * (1 + Math.sin(t * 15) * 0.06), scale * 0.062 * flicker);
      flame.current.position.set(sway, scale * 0.085, 0);
    }
    if (core.current) {
      core.current.scale.set(scale * 0.032 * flicker, scale * 0.092, scale * 0.032 * flicker);
      core.current.position.set(sway * 0.6, scale * 0.072, 0);
    }
    if (halo.current) {
      const h = scale * 0.2 * flicker;
      halo.current.scale.set(h, h * 1.15, h);
      halo.current.position.set(0, scale * 0.08, 0);
    }
    if (light.current) {
      light.current.intensity = active ? 0.5 + flicker * 0.3 : 0;
    }
  });

  return (
    <group position={position} visible={active}>
      {castLight && <pointLight ref={light} color="#ff8a2a" distance={2.4} intensity={0.7} castShadow={false} />}
      <mesh ref={halo} raycast={() => null}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color="#ff6a12" transparent opacity={0.16} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={flame} raycast={() => null}>
        <sphereGeometry args={[1, 16, 18]} />
        <meshBasicMaterial color="#ff8a1d" transparent opacity={0.75} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={core} raycast={() => null}>
        <sphereGeometry args={[1, 14, 14]} />
        <meshBasicMaterial color="#fff2b0" transparent opacity={0.95} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}
