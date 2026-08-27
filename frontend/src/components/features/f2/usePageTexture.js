import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

const WIDTH = 1024;
const HEIGHT = 1400;
const PAGE_SLOTS = [
  { x: 80, y: 80, w: 864, h: 520 },
  { x: 80, y: 740, w: 864, h: 520 },
];

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let hash = 0;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function createSurface() {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, texture };
}

function fitCover(image, slot) {
  const sourceRatio = image.width / image.height;
  const targetRatio = slot.w / slot.h;
  let sx = 0;
  let sy = 0;
  let sw = image.width;
  let sh = image.height;
  if (sourceRatio > targetRatio) {
    sw = image.height * targetRatio;
    sx = (image.width - sw) / 2;
  } else {
    sh = image.width / targetRatio;
    sy = (image.height - sh) / 2;
  }
  return { sx, sy, sw, sh };
}

function insetSlot(slot, amount) {
  return {
    x: slot.x + amount,
    y: slot.y + amount,
    w: slot.w - amount * 2,
    h: slot.h - amount * 2,
  };
}

function drawCompassRose(ctx, cx, cy, radius, opacity = 0.07) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = "#2a1a0c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.moveTo(0, -radius * 1.3);
  ctx.lineTo(0, radius * 1.3);
  ctx.moveTo(-radius * 1.3, 0);
  ctx.lineTo(radius * 1.3, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -radius * 1.05);
  ctx.lineTo(radius * 0.22, -radius * 0.22);
  ctx.lineTo(0, -radius * 0.42);
  ctx.lineTo(-radius * 0.22, -radius * 0.22);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawImagePlaceholder(ctx, slot) {
  ctx.save();
  ctx.fillStyle = "rgba(150, 120, 80, 0.35)";
  ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
  drawCompassRose(ctx, slot.x + slot.w / 2, slot.y + slot.h / 2, 56, 0.1);
  ctx.restore();
}

function drawImageLost(ctx, slot) {
  ctx.save();
  ctx.strokeStyle = "rgba(106, 82, 61, 0.35)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(slot.x + 18, slot.y + 18);
  ctx.lineTo(slot.x + slot.w - 18, slot.y + slot.h - 18);
  ctx.moveTo(slot.x + slot.w - 18, slot.y + 18);
  ctx.lineTo(slot.x + 18, slot.y + slot.h - 18);
  ctx.stroke();
  ctx.fillStyle = "#4a3a2a";
  ctx.font = '20px "Caveat", cursive';
  ctx.textAlign = "center";
  ctx.fillText("Image lost to sea", slot.x + slot.w / 2, slot.y + slot.h / 2 + 8);
  ctx.restore();
}

function drawSelectedArtworkFrame(ctx, slot) {
  ctx.save();
  ctx.strokeStyle = "#f5c96a";
  ctx.lineWidth = 7;
  ctx.shadowColor = "rgba(245, 201, 106, 0.62)";
  ctx.shadowBlur = 18;
  ctx.strokeRect(slot.x + 4, slot.y + 4, slot.w - 8, slot.h - 8);
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(36, 19, 7, 0.75)";
  ctx.strokeRect(slot.x + 12, slot.y + 12, slot.w - 24, slot.h - 24);
  ctx.restore();
}

function drawDashedLine(ctx, x, y, width) {
  ctx.save();
  ctx.strokeStyle = "rgba(122, 106, 90, 0.48)";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.stroke();
  ctx.restore();
}

function toUvLayout(artwork, slot) {
  return {
    id: artwork.id,
    title: artwork.title,
    uvX: slot.x / WIDTH,
    uvY: 1 - (slot.y + slot.h) / HEIGHT,
    uvW: slot.w / WIDTH,
    uvH: slot.h / HEIGHT,
  };
}

export default function usePageTexture({
  artworks,
  pageIndex,
  classifications,
  imageCacheRef,
  mobile,
  emptyMessage,
  selectedArtworkId,
}) {
  const { invalidate } = useThree();
  const [{ canvas, texture }] = useState(createSurface);
  const frameRef = useRef(null);

  const layout = useMemo(
    () => artworks.map((artwork, index) => toUvLayout(artwork, PAGE_SLOTS[index])),
    [artworks],
  );

  useEffect(() => {
    const scheduleDraw = () => {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = window.requestAnimationFrame(() => {
        const ctx = canvas.getContext("2d");
        const random = mulberry32(pageIndex + 1);

        ctx.fillStyle = "#e6d9bf";
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        const dotCount = mobile ? 1000 : 3000;
        for (let index = 0; index < dotCount; index += 1) {
          const x = random() * WIDTH;
          const y = random() * HEIGHT;
          const radius = 0.55 + random() * 0.65;
          const alpha = 0.045 + random() * 0.045;
          ctx.fillStyle = `rgba(110, 82, 54, ${alpha})`;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.strokeStyle = "rgba(90, 60, 30, 0.18)";
        ctx.lineWidth = 0.6;
        for (let y = 76; y < HEIGHT - 40; y += 38) {
          ctx.beginPath();
          ctx.moveTo(54, y);
          ctx.lineTo(WIDTH - 54, y);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(80, 52);
        ctx.lineTo(80, HEIGHT - 52);
        ctx.stroke();

        artworks.forEach((artwork, index) => {
          const slot = PAGE_SLOTS[index];
          if (!slot) return;
          const photoFrame = slot;
          const imageSlot = insetSlot(slot, 18);
          const imageEntry = imageCacheRef.current.get(artwork.imageUrl);
          const rotationRandom = mulberry32(hashString(`${pageIndex}:${artwork.id}`));
          const angle = ((rotationRandom() * 4 - 2) * Math.PI) / 180;
          const centerX = slot.x + slot.w / 2;
          const centerY = slot.y + slot.h / 2;

          ctx.save();
          ctx.translate(centerX, centerY);
          ctx.rotate(angle);
          ctx.translate(-centerX, -centerY);

          ctx.shadowColor = "rgba(0,0,0,0.18)";
          ctx.shadowBlur = 12;
          ctx.shadowOffsetX = 7;
          ctx.shadowOffsetY = 8;
          ctx.fillStyle = "#f2e7cf";
          ctx.fillRect(photoFrame.x, photoFrame.y, photoFrame.w, photoFrame.h);
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          ctx.fillStyle = "rgba(72, 52, 30, 0.12)";
          ctx.fillRect(imageSlot.x - 6, imageSlot.y - 6, imageSlot.w + 12, imageSlot.h + 12);

          if (imageEntry?.status === "loaded") {
            const crop = fitCover(imageEntry.image, imageSlot);
            ctx.filter = "none";
            ctx.globalAlpha = 1;
            ctx.drawImage(
              imageEntry.image,
              crop.sx,
              crop.sy,
              crop.sw,
              crop.sh,
              imageSlot.x,
              imageSlot.y,
              imageSlot.w,
              imageSlot.h,
            );
            ctx.filter = "none";
          } else if (imageEntry?.status === "error") {
            drawImagePlaceholder(ctx, imageSlot);
            drawImageLost(ctx, imageSlot);
          } else {
            drawImagePlaceholder(ctx, imageSlot);
          }

          ctx.strokeStyle = "#5a4632";
          ctx.lineWidth = 2.5;
          ctx.strokeRect(imageSlot.x, imageSlot.y, imageSlot.w, imageSlot.h);
          if (artwork.id === selectedArtworkId) {
            drawSelectedArtworkFrame(ctx, imageSlot);
          }
          ctx.restore();

          const classification = classifications[artwork.id];
          const textX = slot.x + 8;
          const genreY = slot.y + slot.h + 32;
          const styleY = slot.y + slot.h + 62;
          const artistY = slot.y + slot.h + 92;
          ctx.textAlign = "left";
          ctx.fillStyle = "#241307";
          if (!classification || classification.status === "loading") {
            ctx.font = '26px "Caveat", cursive';
            ctx.fillText("Genre: reading log...", textX, genreY);
            ctx.font = '21px "Caveat", cursive';
            ctx.fillText("Style: reading log...", textX, styleY);
            drawDashedLine(ctx, textX, artistY - 8, slot.w * 0.35);
          } else {
            ctx.font = '26px "Caveat", cursive';
            ctx.fillText(`Genre: ${classification.genre || "unknown"}`, textX, genreY);
            ctx.font = '21px "Caveat", cursive';
            ctx.fillText(`Style: ${classification.style || "unknown"}`, textX, styleY);
            ctx.fillStyle = "#7a6a5a";
            ctx.font = 'italic 17px "Caveat", cursive';
            const confidence = classification.confidence?.artist || 0;
            const artist = classification.artist || "unknown";
            const artistLabel = confidence > 0.5 ? artist : `${artist} (?)`;
            ctx.fillText(`Artist: ${artistLabel}`, textX, artistY);
          }
        });

        if (emptyMessage) {
          ctx.save();
          ctx.fillStyle = "#2a1a0c";
          ctx.textAlign = "center";
          ctx.font = '34px "Caveat", cursive';
          ctx.fillText(emptyMessage, WIDTH / 2, HEIGHT / 2);
          ctx.restore();
        }

        ctx.fillStyle = "#5a4129";
        ctx.font = "italic 18px Georgia, serif";
        ctx.textAlign = "center";
        ctx.fillText(`— ${pageIndex + 1} —`, WIDTH / 2, HEIGHT - 34);

        if (pageIndex === 0) {
          drawCompassRose(ctx, WIDTH / 2, HEIGHT - 132, 42, 0.07);
        }

        texture.needsUpdate = true;
        invalidate();
      });
    };

    artworks.forEach((artwork) => {
      if (!artwork.imageUrl || imageCacheRef.current.has(artwork.imageUrl)) return;
      const image = new Image();
      image.crossOrigin = "anonymous";
      imageCacheRef.current.set(artwork.imageUrl, { status: "loading", image });
      image.onload = () => {
        imageCacheRef.current.set(artwork.imageUrl, { status: "loaded", image });
        scheduleDraw();
      };
      image.onerror = () => {
        imageCacheRef.current.set(artwork.imageUrl, { status: "error", image });
        scheduleDraw();
      };
      image.src = artwork.imageUrl;
    });

    scheduleDraw();
    return () => {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [artworks, canvas, classifications, emptyMessage, imageCacheRef, invalidate, mobile, pageIndex, selectedArtworkId, texture]);

  useEffect(
    () => () => {
      texture.dispose();
    },
    [texture],
  );

  return { texture, layout };
}
