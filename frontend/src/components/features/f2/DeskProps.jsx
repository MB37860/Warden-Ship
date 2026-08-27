const CANDLE_SCALE = 0.95;

// The right candle is identical to the left — same geometry, scale and rotation
// — it only sits further back, tucked between the left candle's depth and the
// compass.
function Candle({ position }) {
  return (
    <group position={position} rotation={[0, 0.18, 0]} scale={CANDLE_SCALE}>
      <mesh position={[0, 0.025, 0]}>
        <cylinderGeometry args={[0.2, 0.24, 0.05, 28]} />
        <meshStandardMaterial color="#4a321c" roughness={0.86} />
      </mesh>
      <mesh position={[0, 0.055, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.18, 0.028, 12, 28]} />
        <meshStandardMaterial color="#6a4722" roughness={0.8} metalness={0.08} />
      </mesh>
      <mesh position={[0, 0.215, 0]}>
        <cylinderGeometry args={[0.09, 0.11, 0.32, 22]} />
        <meshStandardMaterial color="#d8c59b" roughness={0.95} />
      </mesh>
      <mesh position={[0.06, 0.1, -0.08]} rotation={[0, 0, -0.16]}>
        <cylinderGeometry args={[0.022, 0.028, 0.16, 12]} />
        <meshStandardMaterial color="#cdb788" roughness={0.98} />
      </mesh>
      <mesh position={[0, 0.405, 0]} scale={[0.56, 0.95, 0.56]}>
        <sphereGeometry args={[0.075, 18, 18]} />
        <meshStandardMaterial color="#ffba63" emissive="#ff9d2f" emissiveIntensity={0.4} roughness={0.72} />
      </mesh>
      <mesh position={[-0.04, 0.12, 0.08]} rotation={[0, 0, 0.12]}>
        <cylinderGeometry args={[0.018, 0.024, 0.12, 12]} />
        <meshStandardMaterial color="#cdb788" roughness={0.98} />
      </mesh>
    </group>
  );
}

function Compass() {
  return (
    <group position={[0, 0.03, -0.06]} rotation={[0, 0.18, 0]}>
      <mesh position={[0, 0.025, 0]}>
        <cylinderGeometry args={[0.285, 0.305, 0.05, 40]} />
        <meshStandardMaterial color="#8a642f" roughness={0.72} metalness={0.14} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.053, 0]}>
        <circleGeometry args={[0.232, 40]} />
        <meshStandardMaterial color="#44311d" roughness={0.9} />
      </mesh>
      {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((angle) => (
        <mesh key={angle} position={[Math.sin(angle) * 0.205, 0.062, Math.cos(angle) * 0.205]} rotation={[0, angle, 0]}>
          <boxGeometry args={[0.018, 0.012, 0.06]} />
          <meshStandardMaterial color="#c5a05b" roughness={0.74} metalness={0.08} />
        </mesh>
      ))}
      <mesh position={[0, 0.068, 0]} rotation={[0, 0.48, 0]}>
        <boxGeometry args={[0.026, 0.014, 0.34]} />
        <meshStandardMaterial color="#d1b06a" roughness={0.7} metalness={0.12} />
      </mesh>
      <mesh position={[0, 0.069, 0]} rotation={[0, -0.74, 0]}>
        <boxGeometry args={[0.022, 0.014, 0.26]} />
        <meshStandardMaterial color="#6d2f24" roughness={0.84} />
      </mesh>
      <mesh position={[0, 0.078, 0]}>
        <sphereGeometry args={[0.035, 16, 16]} />
        <meshStandardMaterial color="#d1b06a" roughness={0.68} metalness={0.12} />
      </mesh>
    </group>
  );
}

export default function DeskProps() {
  return (
    <>
      <Candle position={[-2.25, 0.04, 0.65]} />
      <Candle position={[2.25, 0.04, -0.05]} />

      {/* Compass back at its original spot, in front of the right candle. */}
      <group position={[2.04, 0.03, 0.64]} rotation={[0, 0.16, 0]} scale={0.68}>
        <group position={[0.22, 0, 0.1]}>
          <Compass />
        </group>
      </group>
    </>
  );
}
