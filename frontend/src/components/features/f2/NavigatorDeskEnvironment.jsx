import ArchiveWall from "./ArchiveWall";
import DeskProps from "./DeskProps";
import useWoodTexture from "./useWoodTexture";

const BOOK_SAFE_ZONE = { width: 3.75, depth: 2.75, z: 0.34 };

function TableSurface() {
  const woodTexture = useWoodTexture();

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.065, 0]}>
        <planeGeometry args={[6.5, 4.2]} />
        <meshStandardMaterial map={woodTexture} color="#ffffff" roughness={0.95} />
      </mesh>
      {[-1.95, -0.65, 0.65, 1.95].map((x) => (
        <mesh key={x} position={[x, -0.061, 0]}>
          <boxGeometry args={[0.018, 0.004, 4.04]} />
          <meshStandardMaterial color="#120905" roughness={0.98} />
        </mesh>
      ))}
      <mesh position={[0, -0.105, 2.04]}>
        <boxGeometry args={[6.45, 0.09, 0.12]} />
        <meshStandardMaterial color="#120905" roughness={0.96} />
      </mesh>
      {[-3.18, 3.18].map((x) => (
        <mesh key={x} position={[x, -0.105, 0]}>
          <boxGeometry args={[0.11, 0.09, 4.08]} />
          <meshStandardMaterial color="#120905" roughness={0.96} />
        </mesh>
      ))}
    </group>
  );
}

function BookSafeZoneGuide() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.052, BOOK_SAFE_ZONE.z]}>
      <planeGeometry args={[BOOK_SAFE_ZONE.width, BOOK_SAFE_ZONE.depth]} />
      <meshBasicMaterial color="#ffcc66" transparent opacity={0.12} wireframe />
    </mesh>
  );
}

export default function NavigatorDeskEnvironment({
  debug = false,
  selectedArtwork = null,
  selectedClassification = null,
}) {
  return (
    <>
      <TableSurface />
      <ArchiveWall
        selectedArtwork={selectedArtwork}
        classification={selectedClassification}
      />
      <DeskProps />
      {debug ? <BookSafeZoneGuide /> : null}
    </>
  );
}
