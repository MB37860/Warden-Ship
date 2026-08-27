import useCanvasTexture from "../../../../hooks/useCanvasTexture";
import { drawParchmentLabel } from "../../../../lib/f6TextureBuilders";

export default function ParchmentCard({
  title,
  subtitle = "",
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  width = 1.2,
  height = 0.48,
}) {
  const texture = useCanvasTexture((ctx, canvas) => drawParchmentLabel(ctx, canvas, title, subtitle), [title, subtitle], 512);
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        map={texture}
        color="#f5e6c8"
        roughness={0.9}
        metalness={0}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  );
}
