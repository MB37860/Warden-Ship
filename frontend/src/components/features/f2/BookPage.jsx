import { useEffect, useMemo } from "react";
import * as THREE from "three";
import usePageTexture from "./usePageTexture";

const PAGE_WIDTH = 1.3;
const PAGE_HEIGHT = 1.9;
const PAGE_BASE_Y = 0.045;

function buildPageGeometry(side, mobile) {
  const segmentsX = mobile ? 8 : 14;
  const segmentsY = mobile ? 10 : 18;
  const geometry = new THREE.PlaneGeometry(
    PAGE_WIDTH,
    PAGE_HEIGHT,
    segmentsX,
    segmentsY,
  );
  const positions = geometry.attributes.position;

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const normalized =
      side === "right"
        ? (x + PAGE_WIDTH / 2) / PAGE_WIDTH
        : (PAGE_WIDTH / 2 - x) / PAGE_WIDTH;
    positions.setZ(
      index,
      Math.sin(normalized * Math.PI) * 0.025 + (1 - normalized) * 0.01,
    );
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function slotAtUv(layout, uv) {
  if (!uv) return null;
  return (
    layout.find(
      (slot) =>
        uv.x >= slot.uvX &&
        uv.x <= slot.uvX + slot.uvW &&
        uv.y >= slot.uvY &&
        uv.y <= slot.uvY + slot.uvH,
    ) ?? null
  );
}

export default function BookPage({
  side,
  artworks,
  pageIndex,
  classifications,
  imageCacheRef,
  mobile,
  emptyMessage,
  interactive = true,
  onArtworkSelect,
  selectedArtworkId,
}) {
  const geometry = useMemo(
    () => buildPageGeometry(side, mobile),
    [side, mobile],
  );
  const { texture, layout } = usePageTexture({
    artworks,
    pageIndex,
    classifications,
    imageCacheRef,
    mobile,
    emptyMessage,
    selectedArtworkId,
  });

  useEffect(() => () => geometry.dispose(), [geometry]);

  const handleClick = (event) => {
    if (!interactive) return;
    event.stopPropagation();
    const slot = slotAtUv(layout, event.uv);
    if (slot) onArtworkSelect?.(slot.id);
  };

  const staticX = side === "right" ? PAGE_WIDTH / 2 : -PAGE_WIDTH / 2;

  return (
    <group position={[staticX, PAGE_BASE_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh
        geometry={geometry}
        onClick={handleClick}
      >
        <meshStandardMaterial
          map={texture}
          color="#f2ead8"
          roughness={0.88}
          side={THREE.DoubleSide}
          emissive="#d5c3a0"
          emissiveIntensity={0.08}
        />
      </mesh>
    </group>
  );
}
