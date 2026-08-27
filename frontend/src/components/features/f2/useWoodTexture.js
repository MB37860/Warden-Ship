import { useEffect, useMemo } from "react";
import * as THREE from "three";

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export default function useWoodTexture(seed = 1732) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    const random = mulberry32(seed);

    ctx.fillStyle = "#1a0f08";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const wash = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    wash.addColorStop(0, "rgba(75, 48, 29, 0.28)");
    wash.addColorStop(0.45, "rgba(58, 36, 21, 0.14)");
    wash.addColorStop(1, "rgba(13, 8, 4, 0.18)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    [152, 348, 548, 744, 892].forEach((x) => {
      ctx.strokeStyle = "rgba(8, 4, 2, 0.42)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();

      ctx.strokeStyle = "rgba(110, 72, 40, 0.12)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + 5, 0);
      ctx.lineTo(x + 5, canvas.height);
      ctx.stroke();
    });

    for (let index = 0; index < 72; index += 1) {
      const x = random() * canvas.width;
      const amplitude = 5 + random() * 22;
      const offset = random() * Math.PI * 2;
      ctx.strokeStyle = `rgba(126, 82, 46, ${0.035 + random() * 0.08})`;
      ctx.lineWidth = 0.8 + random() * 1.7;
      ctx.beginPath();
      for (let y = -20; y <= canvas.height + 20; y += 28) {
        const drift = Math.sin(y / 58 + offset) * amplitude;
        if (y === -20) {
          ctx.moveTo(x + drift, y);
        } else {
          ctx.lineTo(x + drift, y);
        }
      }
      ctx.stroke();
    }

    for (let index = 0; index < 34; index += 1) {
      const startX = random() * canvas.width;
      const startY = random() * canvas.height;
      const length = 28 + random() * 120;
      ctx.strokeStyle = `rgba(214, 169, 113, ${0.025 + random() * 0.05})`;
      ctx.lineWidth = 0.5 + random() * 1.2;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(startX + length, startY + (random() - 0.5) * 12);
      ctx.stroke();
    }

    for (let index = 0; index < 220; index += 1) {
      const x = random() * canvas.width;
      const y = random() * canvas.height;
      ctx.fillStyle = `rgba(0, 0, 0, ${0.02 + random() * 0.035})`;
      ctx.fillRect(x, y, 1 + random() * 2, 1 + random() * 2);
    }

    const canvasTexture = new THREE.CanvasTexture(canvas);
    canvasTexture.colorSpace = THREE.SRGBColorSpace;
    canvasTexture.anisotropy = 4;
    return canvasTexture;
  }, [seed]);

  useEffect(() => () => texture.dispose(), [texture]);

  return texture;
}
