import { Html } from "@react-three/drei";

export default function ParchmentTooltip({
  visible,
  title,
  hint,
  position = [0, 0.42, 0.28],
  align = "center",
}) {
  if (!visible) return null;
  return (
    <Html position={position} center={align === "center"} occlude={false} style={{ pointerEvents: "none" }}>
      <div
        style={{
          width: "max-content",
          maxWidth: 160,
          border: "2px solid #5c3418",
          background: "#f5e6c8",
          color: "#3a1a00",
          padding: "7px 10px",
          fontFamily: "'Palatino Linotype', Georgia, serif",
          fontSize: 12,
          lineHeight: 1.25,
          textAlign: "left",
        }}
      >
        <strong style={{ display: "block", fontStyle: "italic", fontSize: 13 }}>{title}</strong>
        <span>{hint}</span>
      </div>
    </Html>
  );
}
