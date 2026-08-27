import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";

function seededUnit(index: number, salt: number) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export default function DustMotes({ count = 120, bounds = [7.4, 4.6, 2.2] }) {
  const ref = useRef();
  const [width, height, depth] = bounds;
  const positions = useMemo(() => {
    const values = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      values[i * 3] = (seededUnit(i, 1) - 0.5) * width;
      values[i * 3 + 1] = (seededUnit(i, 2) - 0.5) * height;
      values[i * 3 + 2] = -0.1 + seededUnit(i, 3) * depth;
    }
    return values;
  }, [count, depth, height, width]);

  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.08) * 0.035;
    ref.current.position.y = Math.sin(state.clock.elapsedTime * 0.18) * 0.055;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#ffd17a" size={0.018} transparent opacity={0.28} depthWrite={false} />
    </points>
  );
}
