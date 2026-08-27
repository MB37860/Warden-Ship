import { useEffect, useState } from "react";
import PaintingCard from "./PaintingCard";
import PaintingDetail from "./PaintingDetail";
import ParchmentCard from "../shared/ParchmentCard";

export default function HoldPaintings({ records, activeFilterCount }) {
  const [focused, setFocused] = useState(null);
  const visible = records.slice(0, 36);

  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape") setFocused(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <group>
      {visible.length ? (
        visible.map((record, index) => (
          <PaintingCard
            key={record.key}
            record={record}
            index={index}
            filtersActive={activeFilterCount}
            onClick={setFocused}
          />
        ))
      ) : (
        <ParchmentCard
          title="No paintings match"
          subtitle="Captain"
          position={[0, 0.08, 0.18]}
          width={1.9}
          height={0.72}
        />
      )}
      <PaintingDetail record={focused} onClose={() => setFocused(null)} />
    </group>
  );
}
