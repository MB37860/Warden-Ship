import BookPage from "./BookPage";

const DESKTOP_BOOK_SCALE = [1.22, 1, 1.22];
const MOBILE_BOOK_SCALE = [1.08, 1, 1.08];

export default function BookMesh({
  leftArtworks,
  rightArtworks,
  spreadIndex,
  classifications,
  imageCacheRef,
  mobile,
  onArtworkSelect,
  selectedArtworkId,
  isEmpty,
}) {
  return (
    <group
      position={[0, 0.04, 0.34]}
      scale={mobile ? MOBILE_BOOK_SCALE : DESKTOP_BOOK_SCALE}
    >
      {/* Book cover */}
      <mesh position={[0, -0.035, 0]}>
        <boxGeometry args={[2.9, 0.07, 2.1]} />
        <meshStandardMaterial color="#1e0f07" roughness={0.92} metalness={0} />
      </mesh>

      {/* Spine */}
      <mesh position={[0, 0.01, 0]}>
        <boxGeometry args={[0.13, 0.09, 2.1]} />
        <meshStandardMaterial color="#1e0f07" roughness={0.92} metalness={0} />
      </mesh>

      {/* Cover border strips */}
      <mesh position={[0, 0.008, -0.965]}>
        <boxGeometry args={[2.66, 0.01, 0.04]} />
        <meshStandardMaterial color="#2a1509" roughness={0.92} metalness={0} />
      </mesh>
      <mesh position={[0, 0.008, 0.965]}>
        <boxGeometry args={[2.66, 0.01, 0.04]} />
        <meshStandardMaterial color="#2a1509" roughness={0.92} metalness={0} />
      </mesh>
      <mesh position={[-1.31, 0.008, 0]}>
        <boxGeometry args={[0.04, 0.01, 1.9]} />
        <meshStandardMaterial color="#2a1509" roughness={0.92} metalness={0} />
      </mesh>
      <mesh position={[1.31, 0.008, 0]}>
        <boxGeometry args={[0.04, 0.01, 1.9]} />
        <meshStandardMaterial color="#2a1509" roughness={0.92} metalness={0} />
      </mesh>
      <mesh position={[0, 0.011, -0.62]}>
        <boxGeometry args={[0.78, 0.012, 0.22]} />
        <meshStandardMaterial color="#2a1509" roughness={0.92} metalness={0} />
      </mesh>

      <BookPage
        side="left"
        artworks={leftArtworks}
        pageIndex={spreadIndex * 2}
        classifications={classifications}
        imageCacheRef={imageCacheRef}
        mobile={mobile}
        emptyMessage={null}
        onArtworkSelect={onArtworkSelect}
        selectedArtworkId={selectedArtworkId}
      />

      <BookPage
        side="right"
        artworks={rightArtworks}
        pageIndex={spreadIndex * 2 + 1}
        classifications={classifications}
        imageCacheRef={imageCacheRef}
        mobile={mobile}
        emptyMessage={isEmpty ? "The hold is empty." : null}
        onArtworkSelect={onArtworkSelect}
        selectedArtworkId={selectedArtworkId}
      />
    </group>
  );
}
