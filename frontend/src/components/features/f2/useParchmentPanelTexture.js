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

function hashText(text) {
  return Array.from(text).reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 17);
}

// The reading panel drawn on top of each chart. Its stroked edge is the inner
// boundary line, so any decoration underneath must stay inside it.
const PANEL_BOX = { x: 0.08, y: 0.12, w: 0.84, h: 0.74 };

function panelBoxBounds(width, height) {
  return {
    left: width * PANEL_BOX.x,
    top: height * PANEL_BOX.y,
    right: width * (PANEL_BOX.x + PANEL_BOX.w),
    bottom: height * (PANEL_BOX.y + PANEL_BOX.h),
  };
}

function drawParchmentBase(ctx, width, height, random, kind) {
  ctx.fillStyle = kind === "label" ? "#b89a62" : "#d8c59e";
  ctx.fillRect(0, 0, width, height);

  const wash = ctx.createRadialGradient(width * 0.46, height * 0.42, 8, width * 0.5, height * 0.5, width * 0.7);
  wash.addColorStop(0, kind === "label" ? "rgba(214, 181, 119, 0.12)" : "rgba(255, 244, 215, 0.2)");
  wash.addColorStop(1, kind === "label" ? "rgba(90, 50, 19, 0.3)" : "rgba(107, 67, 30, 0.2)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);

  for (let index = 0; index < 850; index += 1) {
    ctx.fillStyle = `rgba(92, 60, 27, ${0.02 + random() * 0.05})`;
    const radius = 0.4 + random() * 1.4;
    ctx.beginPath();
    ctx.arc(random() * width, random() * height, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = kind === "label" ? "rgba(90, 53, 24, 0.72)" : "rgba(76, 47, 21, 0.48)";
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, width - 16, height - 16);
}

function drawStyleChart(ctx, width, height) {
  const swatches = ["#9a6b32", "#556d77", "#7b3f35", "#677049", "#785e45", "#c2ad7a"];
  ctx.strokeStyle = "rgba(74, 46, 22, 0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width * 0.12, height * 0.23);
  ctx.lineTo(width * 0.88, height * 0.23);
  ctx.stroke();

  swatches.forEach((color, index) => {
    const x = width * 0.12 + index * width * 0.12;
    const y = height * 0.36 + (index % 2) * height * 0.17;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width * 0.085, height * 0.15);
    ctx.strokeStyle = "rgba(62, 37, 17, 0.55)";
    ctx.strokeRect(x, y, width * 0.085, height * 0.15);
  });

  ctx.strokeStyle = "rgba(62, 37, 17, 0.46)";
  ctx.lineWidth = 3;
  [0.18, 0.42, 0.66].forEach((y) => {
    ctx.beginPath();
    ctx.moveTo(width * 0.13, height * (y + 0.48));
    ctx.lineTo(width * (0.32 + y), height * (y + 0.48));
    ctx.stroke();
  });

  ctx.strokeStyle = "rgba(62, 37, 17, 0.34)";
  ctx.lineWidth = 2;
  [0.74, 0.82].forEach((y, index) => {
    ctx.beginPath();
    ctx.moveTo(width * 0.58, height * y);
    ctx.lineTo(width * (0.82 - index * 0.08), height * y);
    ctx.stroke();
  });
}

function drawGenreMap(ctx, width, height, random) {
  // Everything here must sit inside the reading panel's border, not just inside
  // the outer parchment frame.
  const box = panelBoxBounds(width, height);
  const margin = 10; // clears the panel's 3px stroke with room to spare
  const centerX = (box.left + box.right) / 2;
  const centerY = (box.top + box.bottom) / 2;
  const rings = 6;
  const maxRadius = Math.max(
    8,
    Math.min(
      centerX - box.left - margin,
      box.right - centerX - margin,
      centerY - box.top - margin,
      box.bottom - centerY - margin,
    ),
  );

  ctx.strokeStyle = "rgba(84, 60, 31, 0.22)";
  ctx.lineWidth = 2;
  for (let index = 0; index < rings; index += 1) {
    const radius = maxRadius * (0.2 + (0.8 * index) / (rings - 1));
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  const nodes = Array.from({ length: 7 }, () => ({
    x: width * (0.16 + random() * 0.68),
    y: height * (0.22 + random() * 0.58),
  }));

  ctx.strokeStyle = "rgba(80, 49, 20, 0.58)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  nodes.forEach((node, index) => {
    if (index === 0) ctx.moveTo(node.x, node.y);
    else ctx.lineTo(node.x, node.y);
  });
  ctx.stroke();

  nodes.forEach((node, index) => {
    ctx.fillStyle = index % 2 ? "#6e3c2b" : "#6d7043";
    ctx.beginPath();
    ctx.arc(node.x, node.y, index === 3 ? 8 : 6, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.strokeStyle = "rgba(80, 49, 20, 0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX, box.top + margin);
  ctx.lineTo(centerX, box.bottom - margin);
  ctx.moveTo(box.left + margin, centerY);
  ctx.lineTo(box.right - margin, centerY);
  ctx.stroke();

  ctx.fillStyle = "rgba(61, 38, 19, 0.62)";
  ctx.font = `600 ${Math.round(height * 0.06)}px Georgia`;
  ctx.fillText("P", width * 0.19, height * 0.24);
  ctx.fillText("L", width * 0.72, height * 0.28);
  ctx.fillText("S", width * 0.65, height * 0.76);
}

function drawManifest(ctx, width, height) {
  ctx.strokeStyle = "rgba(73, 45, 19, 0.5)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(width * 0.16, height * 0.24);
  ctx.lineTo(width * 0.84, height * 0.24);
  ctx.stroke();

  [0.36, 0.52, 0.68].forEach((y, index) => {
    ctx.fillStyle = index === 1 ? "rgba(121, 83, 44, 0.18)" : "rgba(255, 247, 223, 0.16)";
    ctx.fillRect(width * 0.14, height * y, width * 0.72, height * 0.09);
    ctx.strokeStyle = "rgba(73, 45, 19, 0.42)";
    ctx.strokeRect(width * 0.14, height * y, width * 0.72, height * 0.09);
    ctx.fillStyle = "rgba(61, 38, 19, 0.62)";
    ctx.fillRect(width * 0.2, height * (y + 0.034), width * (0.2 + index * 0.08), 5);
    ctx.fillRect(width * 0.58, height * (y + 0.034), width * 0.16, 5);
  });

  ctx.strokeStyle = "rgba(73, 45, 19, 0.45)";
  ctx.lineWidth = 4;
  ctx.strokeRect(width * 0.11, height * 0.16, width * 0.78, height * 0.67);

  ctx.fillStyle = "rgba(110, 69, 31, 0.2)";
  ctx.fillRect(width * 0.68, height * 0.18, width * 0.14, height * 0.12);
  ctx.strokeStyle = "rgba(73, 45, 19, 0.44)";
  ctx.lineWidth = 2;
  ctx.strokeRect(width * 0.68, height * 0.18, width * 0.14, height * 0.12);
}

function drawNote(ctx, width, height) {
  ctx.strokeStyle = "rgba(92, 60, 30, 0.22)";
  ctx.lineWidth = 2;
  for (let y = height * 0.22; y < height * 0.86; y += height * 0.16) {
    ctx.beginPath();
    ctx.moveTo(width * 0.12, y);
    ctx.lineTo(width * 0.88, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(58, 34, 17, 0.58)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(width * 0.16, height * 0.34);
  ctx.bezierCurveTo(width * 0.3, height * 0.26, width * 0.42, height * 0.42, width * 0.54, height * 0.31);
  ctx.bezierCurveTo(width * 0.64, height * 0.23, width * 0.74, height * 0.38, width * 0.82, height * 0.29);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(width * 0.17, height * 0.57);
  ctx.lineTo(width * 0.58, height * 0.53);
  ctx.lineTo(width * 0.78, height * 0.61);
  ctx.stroke();
}

function drawLabel(ctx, width, height, title) {
  ctx.fillStyle = "#22150b";
  ctx.font = `600 ${Math.round(height * 0.38)}px Georgia`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, width / 2, height / 2 + height * 0.03);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  words.forEach((word) => {
    const nextLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(nextLine).width <= maxWidth || !line) {
      line = nextLine;
      return;
    }
    lines.push(line);
    line = word;
  });
  if (line) lines.push(line);

  lines.slice(0, maxLines).forEach((item, index) => {
    const suffix = index === maxLines - 1 && lines.length > maxLines ? "..." : "";
    ctx.fillText(`${item}${suffix}`, x, y + index * lineHeight);
  });
}

function drawReading(ctx, width, height, reading) {
  if (!reading) return;

  const label = reading.label || "";
  const value = reading.value || "";
  const title = reading.title || "";
  const status = reading.status || "idle";
  const confidence = Number(reading.confidence || 0);

  ctx.save();
  const boxX = width * PANEL_BOX.x;
  const boxY = height * PANEL_BOX.y;
  const boxW = width * PANEL_BOX.w;
  const boxH = height * PANEL_BOX.h;
  ctx.fillStyle = "rgba(245, 225, 178, 0.72)";
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = "rgba(64, 38, 17, 0.58)";
  ctx.lineWidth = 3;
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#3a210d";
  ctx.font = `700 ${Math.round(height * 0.105)}px Georgia`;
  ctx.fillText(label.toUpperCase(), width / 2, height * 0.25);

  if (status === "loading") {
    ctx.fillStyle = "#5c3b1c";
    ctx.font = `italic ${Math.round(height * 0.1)}px Georgia`;
    ctx.fillText("reading...", width / 2, height * 0.52);
    ctx.strokeStyle = "rgba(85, 55, 25, 0.5)";
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(width * 0.26, height * 0.66);
    ctx.lineTo(width * 0.74, height * 0.66);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (status === "error") {
    ctx.fillStyle = "#5c2a19";
    ctx.font = `600 ${Math.round(height * 0.09)}px Georgia`;
    ctx.fillText("signal lost", width / 2, height * 0.52);
    ctx.restore();
    return;
  }

  ctx.fillStyle = "#22150b";
  ctx.font = `700 ${Math.round(height * 0.13)}px Georgia`;
  wrapText(ctx, value || "Select a painting", width / 2, height * 0.5, width * 0.72, height * 0.13, 2);

  if (title) {
    ctx.fillStyle = "rgba(61, 38, 19, 0.74)";
    ctx.font = `italic ${Math.round(height * 0.064)}px Georgia`;
    wrapText(ctx, title, width / 2, height * 0.76, width * 0.72, height * 0.07, 1);
  }

  if (confidence > 0) {
    const barX = width * 0.22;
    const barY = height * 0.88;
    const barW = width * 0.56;
    ctx.fillStyle = "rgba(64, 38, 17, 0.24)";
    ctx.fillRect(barX, barY, barW, height * 0.025);
    ctx.fillStyle = "rgba(86, 89, 45, 0.68)";
    ctx.fillRect(barX, barY, barW * Math.max(0.04, Math.min(1, confidence)), height * 0.025);
  }

  ctx.restore();
}

export default function useParchmentPanelTexture({ kind, title = "", seed = 0, width = 512, height = 256, reading = null }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const random = mulberry32(seed || hashText(`${kind}:${title}`));

    drawParchmentBase(ctx, width, height, random, kind);

    if (kind === "style") drawStyleChart(ctx, width, height);
    if (kind === "genre") drawGenreMap(ctx, width, height, random);
    if (kind === "manifest") drawManifest(ctx, width, height);
    if (kind === "note") drawNote(ctx, width, height);
    if (kind === "label") drawLabel(ctx, width, height, title);
    if (kind !== "label") drawReading(ctx, width, height, reading);

    const canvasTexture = new THREE.CanvasTexture(canvas);
    canvasTexture.colorSpace = THREE.SRGBColorSpace;
    canvasTexture.anisotropy = 4;
    return canvasTexture;
  }, [height, kind, reading, seed, title, width]);

  useEffect(() => () => texture.dispose(), [texture]);

  return texture;
}
