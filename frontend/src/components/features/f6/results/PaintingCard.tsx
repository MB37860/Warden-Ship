import ShipText from "../../../shared/ShipText";
import { animated, useSpring } from "@react-spring/three";
import { useEffect, useState } from "react";
import { SRGBColorSpace, TextureLoader } from "three";
import { SPRING_CONFIG } from "../../../../lib/f6Constants";
import useCanvasTexture from "../../../../hooks/useCanvasTexture";
import usePointerCursor from "../../../../hooks/usePointerCursor";
import { drawParchmentLabel } from "../../../../lib/f6TextureBuilders";
import IronPin from "../shared/IronPin";

export function PaintingSurface({ record, width = 0.72, height = 0.54, detail = false, index = 0 }) {
  const fallbackSubtitle = record.artist || record.year || "";
  const fallback = useCanvasTexture((ctx, canvas) => drawParchmentLabel(ctx, canvas, record.title, fallbackSubtitle), [record.title, fallbackSubtitle], 512);
  const [texture, setTexture] = useState(null);

  useEffect(() => {
    if (!record.imageUrl) {
      let disposed = false;
      Promise.resolve().then(() => {
        if (!disposed) setTexture(null);
      });
      return () => {
        disposed = true;
      };
    }
    let disposed = false;
    const delay = Math.floor(index / 6) * 120;
    const timer = window.setTimeout(() => {
      const loader = new TextureLoader();
      loader.setCrossOrigin("anonymous");
      loader.load(
        record.imageUrl,
        (loaded) => {
          if (disposed) {
            loaded.dispose();
            return;
          }
          loaded.colorSpace = SRGBColorSpace;
          setTexture(loaded);
        },
        undefined,
        () => setTexture(null),
      );
    }, delay);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      setTexture((current) => {
        current?.dispose?.();
        return null;
      });
    };
  }, [record.imageUrl, index]);

  return (
    <mesh castShadow receiveShadow>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        map={texture || fallback}
        color={detail ? "#ffffff" : "#f3e6d2"}
        roughness={0.76}
        metalness={0}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  );
}

export default function PaintingCard({ record, index, filtersActive, onClick }) {
  const [hovered, setHovered] = useState(false);
  usePointerCursor(hovered);
  const spring = useSpring({
    z: hovered ? 0.22 : 0,
    scale: hovered ? 1.08 : 1,
    glow: hovered ? 0.18 : 0,
    labelLift: hovered ? 1 : 0,
    config: SPRING_CONFIG,
  });
  const col = index % 6;
  const row = Math.floor(index / 6);
  const x = -2.9 + col * 1.15;
  const y = 1.18 - row * 0.78;
  const rot = ((index * 37) % 7 - 3) * (Math.PI / 180);

  return (
    <animated.group position={[x, y, spring.z]} rotation={[0, 0, rot]} scale={spring.scale}>
      <group
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
          onClick(record);
        }}
      >
        <mesh position={[0, 0, -0.018]} castShadow receiveShadow>
          <planeGeometry args={[0.8, 0.62]} />
          <animated.meshStandardMaterial color="#170d06" roughness={0.9} emissive="#4a2400" emissiveIntensity={spring.glow} />
        </mesh>
        <PaintingSurface record={record} index={index} />
        {hovered ? <pointLight position={[0, 0.02, 0.36]} color="#ffaa44" intensity={0.42} distance={1.2} castShadow={false} /> : null}
        {[[-0.35, 0.27], [0.35, 0.27], [-0.35, -0.27], [0.35, -0.27]].map(([px, py]) => (
          <IronPin key={`${px}-${py}`} position={[px, py, 0.04]} scale={0.45} active wax="#2a2a2a" />
        ))}
        <animated.group position-y={spring.labelLift.to((v) => -0.34 + v * 0.08)} position-z={0.08}>
          <mesh>
            <planeGeometry args={[0.78, 0.19]} />
            <meshStandardMaterial color="#f5e6c8" roughness={0.9} transparent opacity={0.92} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
          </mesh>
          <ShipText position={[0, 0.035, 0.01]} fontSize={0.035} color="#1a0a00" anchorX="center" maxWidth={0.68}>
            {record.title}
          </ShipText>
          <ShipText position={[0, -0.055, 0.01]} fontSize={0.026} color="#5c3d1e" anchorX="center" maxWidth={0.68}>
            {record.artist || record.year || `${filtersActive} marks`}
          </ShipText>
        </animated.group>
      </group>
    </animated.group>
  );
}
