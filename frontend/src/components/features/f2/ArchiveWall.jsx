import { useMemo } from "react";
import useParchmentPanelTexture from "./useParchmentPanelTexture";

const plankColors = ["#120a06", "#180d07", "#140b06", "#1a0f08", "#150b06", "#190e08"];

function LabelPlaque({ title, position, width = 0.72 }) {
  const texture = useParchmentPanelTexture({ kind: "label", title, width: 512, height: 128 });

  return (
    <mesh position={position}>
      <planeGeometry args={[width, 0.14]} />
      <meshStandardMaterial map={texture} roughness={0.94} />
    </mesh>
  );
}

function Pin({ position }) {
  return (
    <mesh position={position}>
      <circleGeometry args={[0.045, 20]} />
      <meshStandardMaterial color="#6d4725" roughness={0.74} metalness={0.08} />
    </mesh>
  );
}

function StationPanel({ kind, position, size, label, reading }) {
  const texture = useParchmentPanelTexture({ kind, seed: label.length * 97, reading });
  const [width, height] = size;

  return (
    <group position={position}>
      <mesh position={[0, 0, -0.018]}>
        <boxGeometry args={[width + 0.12, height + 0.12, 0.055]} />
        <meshStandardMaterial color="#26160b" roughness={0.93} />
      </mesh>
      <mesh position={[0, 0, 0.018]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial map={texture} roughness={0.95} emissive="#241608" emissiveIntensity={0.03} />
      </mesh>
      <Pin position={[-width / 2 + 0.085, height / 2 - 0.08, 0.03]} />
      <Pin position={[width / 2 - 0.085, height / 2 - 0.08, 0.03]} />
      <LabelPlaque title={label} position={[0, -height / 2 - 0.19, 0.04]} width={Math.max(0.68, width * 0.62)} />
    </group>
  );
}

function ShelfDetails() {
  return (
    <group position={[0, -0.72, 0.08]}>
      <mesh>
        <boxGeometry args={[4.9, 0.08, 0.18]} />
        <meshStandardMaterial color="#231308" roughness={0.95} />
      </mesh>
      <group position={[-1.7, 0.22, 0]}>
        {[0, 0.18, 0.36].map((x, index) => (
          <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, index === 1 ? 0.08 : -0.05]}>
            <cylinderGeometry args={[0.075, 0.075, 0.48, 18]} />
            <meshStandardMaterial color={index === 1 ? "#a48556" : "#8c6c43"} roughness={0.95} />
          </mesh>
        ))}
      </group>
      <mesh position={[1.75, 0.2, 0]}>
        <boxGeometry args={[0.62, 0.34, 0.28]} />
        <meshStandardMaterial color="#211208" roughness={0.95} />
      </mesh>
      <mesh position={[1.75, 0.2, 0.145]}>
        <boxGeometry args={[0.46, 0.12, 0.018]} />
        <meshStandardMaterial color="#332012" roughness={0.95} />
      </mesh>
    </group>
  );
}

function DustMotes() {
  const positions = useMemo(() => {
    const values = new Float32Array(54);
    let seed = 41;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let index = 0; index < values.length; index += 3) {
      values[index] = -2.8 + random() * 5.6;
      values[index + 1] = -0.15 + random() * 1.9;
      values[index + 2] = 0.1 + random() * 0.16;
    }
    return values;
  }, []);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#d3ad69" size={0.028} transparent opacity={0.28} sizeAttenuation />
    </points>
  );
}

function getConfidence(classification, key) {
  return Number(classification?.confidence?.[key] || 0);
}

function buildPanelReadings(selectedArtwork, classification) {
  if (!selectedArtwork) {
    return {
      style: { label: "Style", value: "Select a painting", status: "idle" },
      genre: { label: "Genre", value: "Select a painting", status: "idle" },
      manifest: { label: "Author", value: "Select a painting", status: "idle" },
    };
  }

  const status = classification?.status || "loading";
  const title = selectedArtwork.title || selectedArtwork.artworkTitle || "";

  return {
    style: {
      label: "Style",
      value: classification?.style || "",
      title,
      status,
      confidence: getConfidence(classification, "style"),
    },
    genre: {
      label: "Genre",
      value: classification?.genre || "",
      title,
      status,
      confidence: getConfidence(classification, "genre"),
    },
    manifest: {
      label: "Author",
      value: classification?.artist || selectedArtwork.artist || "",
      title,
      status,
      confidence: getConfidence(classification, "artist"),
    },
  };
}

export default function ArchiveWall({ selectedArtwork = null, classification = null }) {
  const readings = buildPanelReadings(selectedArtwork, classification);

  return (
    <group position={[0, 0.25, -1.45]} scale={[0.93, 0.93, 0.93]}>
      <mesh>
        <boxGeometry args={[6.9, 2.25, 0.08]} />
        <meshStandardMaterial color="#100905" roughness={0.96} />
      </mesh>

      {plankColors.map((color, index) => (
        <mesh key={color + index} position={[0, -0.92 + index * 0.37, 0.045]}>
          <boxGeometry args={[6.72, 0.31, 0.025]} />
          <meshStandardMaterial color={color} roughness={0.97} />
        </mesh>
      ))}

      {[-3.12, -1.08, 1.08, 3.12].map((x) => (
        <mesh key={x} position={[x, 0, 0.08]}>
          <boxGeometry args={[0.18, 2.22, 0.06]} />
          <meshStandardMaterial color="#2a170c" roughness={0.95} />
        </mesh>
      ))}

      {[-1.08, 1.08].map((y) => (
        <mesh key={y} position={[0, y, 0.082]}>
          <boxGeometry args={[6.72, 0.14, 0.06]} />
          <meshStandardMaterial color="#211107" roughness={0.95} />
        </mesh>
      ))}

      <StationPanel kind="style" label="STYLE CHART" position={[-1.55, 0.45, 0.13]} size={[1.22, 0.72]} reading={readings.style} />
      <StationPanel kind="genre" label="GENRE MAP" position={[0, 0.5, 0.13]} size={[1.48, 0.84]} reading={readings.genre} />
      <StationPanel kind="manifest" label="CARGO MANIFEST" position={[1.55, 0.45, 0.13]} size={[1.22, 0.72]} reading={readings.manifest} />

      <ShelfDetails />
      <DustMotes />
    </group>
  );
}
