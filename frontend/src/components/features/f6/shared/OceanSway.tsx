import { useFrame } from "@react-three/fiber";
import { useRef } from "react";

export default function OceanSway({ children }) {
  const ref = useRef();
  useFrame((state) => {
    if (!ref.current) return;
    const phase = (state.clock.elapsedTime / 8) * Math.PI * 2;
    ref.current.rotation.z = Math.sin(phase) * 0.004;
    ref.current.rotation.x = Math.cos(phase * 0.85) * 0.0022;
  });
  return <group ref={ref}>{children}</group>;
}
