import { Canvas } from "@react-three/fiber";
import {
  Line,
  OrbitControls,
  PerspectiveCamera,
} from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { getF5Coords } from "../../../api/f5Api";
import { getPipelineStatus } from "../../../api/pipelineApi";
import {
  ESTIMATED_YEAR_COLOR,
  ESTIMATED_YEAR_NOTE,
  UNDATED_NOTE,
  isEstimatedYear,
  yearCertaintyBand,
} from "../../../utils/historicalAnalysis";
import {
  getArtworkArtistName,
  getArtworkDisplayName,
} from "../../../utils/artworkNames";
import { useRepeatingCanvasTexture } from "../../../hooks/useCanvasTexture";
import { drawWoodGrainTexture } from "../../../lib/f6TextureBuilders";
import { useFullscreenImage } from "../../shared/useFullscreenImage";
import { BRASS_MATERIAL } from "../../../lib/f6Constants";
import styles from "./HistoryTable.module.css";

const ERAS = [
  { id: "medieval", label: "Before 1400", color: "#7d8f8a", until: 1399 },
  { id: "renaissance", label: "Renaissance", color: "#c89b43", until: 1599 },
  { id: "baroque", label: "Baroque", color: "#a75f42", until: 1749 },
  { id: "academy", label: "1750-1879", color: "#5f9bad", until: 1879 },
  { id: "modern", label: "Modern", color: "#747fb8", until: 1945 },
  { id: "contemporary", label: "After 1945", color: "#72a66a", until: 2026 },
];

// Works the pipeline could not date at all. They keep their place on the style
// map — the map is built from what a painting looks like, not from when it was
// made — but they are never dropped into a century they have no claim to.
const UNDATED_ERA = { id: "undated", label: "Undated", color: "#8a7f72", until: null };
const ERA_BANDS = [...ERAS, UNDATED_ERA];

const MAP_BOUNDS = {
  x: 3.76,
  z: 1.92,
};

const ROUTE_STEPS = 18;
const MAP_WIDTH = MAP_BOUNDS.x * 2;
const MAP_HEIGHT = MAP_BOUNDS.z * 2;
const MAP_TEXTURE_WIDTH = 2048;
const MAX_ROUTE_LINES = 150;
const MAP_THUMBNAIL_SIZE = 160;
const MAX_THUMBNAIL_LOADS = 5;
const thumbnailTextureCache = new Map();
const thumbnailLoadQueue = [];
let activeThumbnailLoads = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function makeRoutePoints(start, end, index) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const distance = Math.hypot(dx, dz) || 1;
  const bend = clamp(distance * 0.11, 0.12, 0.34) * (index % 2 === 0 ? 1 : -1);
  const normalX = -dz / distance;
  const normalZ = dx / distance;
  const control = {
    x: (start.x + end.x) / 2 + normalX * bend,
    z: (start.z + end.z) / 2 + normalZ * bend,
  };

  return Array.from({ length: ROUTE_STEPS }, (_, step) => {
    const t = step / (ROUTE_STEPS - 1);
    const inv = 1 - t;
    return [
      inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
      0.035,
      inv * inv * start.z + 2 * inv * t * control.z + t * t * end.z,
    ];
  });
}

function buildEraRegions(nodes, mapWidth, mapHeight, markerSize) {
  const regionMargin = clamp(markerSize * 2.55, 0.34, 0.58);

  return ERA_BANDS.map((era) => {
    const eraNodes = nodes.filter((node) => node.era.id === era.id);
    if (!eraNodes.length) return null;

    const centerX = eraNodes.reduce((sum, node) => sum + node.x, 0) / eraNodes.length;
    const centerZ = eraNodes.reduce((sum, node) => sum + node.z, 0) / eraNodes.length;
    const minX = Math.min(...eraNodes.map((node) => node.x));
    const maxX = Math.max(...eraNodes.map((node) => node.x));
    const minZ = Math.min(...eraNodes.map((node) => node.z));
    const maxZ = Math.max(...eraNodes.map((node) => node.z));
    const minRegionWidth = markerSize * 4.2;
    const minRegionHeight = markerSize * 3.8;
    const centerAdjustedMinX = Math.min(minX, centerX - minRegionWidth / 2);
    const centerAdjustedMaxX = Math.max(maxX, centerX + minRegionWidth / 2);
    const centerAdjustedMinZ = Math.min(minZ, centerZ - minRegionHeight / 2);
    const centerAdjustedMaxZ = Math.max(maxZ, centerZ + minRegionHeight / 2);
    const left = clamp(centerAdjustedMinX - regionMargin, -mapWidth / 2 + 0.1, mapWidth / 2 - 0.1);
    const right = clamp(centerAdjustedMaxX + regionMargin, -mapWidth / 2 + 0.1, mapWidth / 2 - 0.1);
    const top = clamp(centerAdjustedMinZ - regionMargin * 0.78, -mapHeight / 2 + 0.1, mapHeight / 2 - 0.1);
    const bottom = clamp(centerAdjustedMaxZ + regionMargin * 0.78, -mapHeight / 2 + 0.1, mapHeight / 2 - 0.1);
    const radiusX = Math.max((right - left) / 2, minRegionWidth / 2);
    const radiusZ = Math.max((bottom - top) / 2, minRegionHeight / 2);
    const path = [
      { x: left, z: top },
      { x: centerX, z: top - seededUnit(era.id, "top") * markerSize * 0.16 },
      { x: right, z: top },
      { x: right + seededUnit(era.id, "right") * markerSize * 0.16, z: centerZ },
      { x: right, z: bottom },
      { x: centerX, z: bottom + seededUnit(era.id, "bottom") * markerSize * 0.16 },
      { x: left, z: bottom },
      { x: left - seededUnit(era.id, "left") * markerSize * 0.16, z: centerZ },
    ].map((point) => ({
      x: clamp(point.x, -mapWidth / 2 + 0.1, mapWidth / 2 - 0.1),
      z: clamp(point.z, -mapHeight / 2 + 0.1, mapHeight / 2 - 0.1),
    }));

    return {
      ...era,
      count: eraNodes.length,
      x: clamp(centerX, -mapWidth / 2 + radiusX * 0.2, mapWidth / 2 - radiusX * 0.2),
      z: clamp(centerZ, -mapHeight / 2 + radiusZ * 0.2, mapHeight / 2 - radiusZ * 0.2),
      radiusX,
      radiusZ,
      path,
    };
  }).filter(Boolean);
}

function packNodesOnChart(sourceNodes) {
  if (!sourceNodes.length) {
    return {
      nodes: [],
      mapWidth: MAP_WIDTH,
      mapHeight: MAP_HEIGHT,
      markerSize: 0.3,
      initialZoom: 92,
      regions: [],
    };
  }

  const count = sourceNodes.length;
  const mapWidth = Math.max(MAP_WIDTH, Math.sqrt(count) * 1.08);
  const mapHeight = Math.max(MAP_HEIGHT, Math.sqrt(count) * 0.68);
  const markerSize = clamp(0.24 - Math.log10(Math.max(count, 1)) * 0.055, 0.065, 0.18);
  const gap = markerSize * 0.7;
  const margin = markerSize * 2.8;
  const cellSize = (markerSize + gap) * 2.5;
  const iterations = clamp(Math.round(80 + count * 0.35), 90, 210);

  const points = sourceNodes.map((node, index) => {
    const seed = `${node.id}:${index}:organic-layout`;
    const chronologyX = count === 1
      ? 0
      : -mapWidth / 2 + margin + (index / (count - 1)) * (mapWidth - margin * 2);
    const desiredX = clamp(
      ((node.x / MAP_BOUNDS.x) * (mapWidth / 2 - margin)) * 0.34 +
        chronologyX * 0.66 +
        (seededUnit(seed, "jitter-x") - 0.5) * markerSize * 1.1,
      -mapWidth / 2 + margin,
      mapWidth / 2 - margin,
    );
    const desiredZ = clamp(
      (node.z / MAP_BOUNDS.z) * (mapHeight / 2 - margin) +
        (seededUnit(seed, "jitter-z") - 0.5) * markerSize * 2.2,
      -mapHeight / 2 + margin,
      mapHeight / 2 - margin,
    );

    return {
      ...node,
      desiredX,
      desiredZ,
      chronologyX,
      x: desiredX,
      z: desiredZ,
      radius: markerSize * 0.72,
      mapSize: markerSize,
    };
  });

  const desiredMinX = Math.min(...points.map((point) => point.desiredX));
  const desiredMaxX = Math.max(...points.map((point) => point.desiredX));
  const desiredMinZ = Math.min(...points.map((point) => point.desiredZ));
  const desiredMaxZ = Math.max(...points.map((point) => point.desiredZ));
  const desiredCenterX = (desiredMinX + desiredMaxX) / 2;
  const desiredCenterZ = (desiredMinZ + desiredMaxZ) / 2;
  const desiredRangeX = Math.max(0.01, desiredMaxX - desiredMinX);
  const desiredRangeZ = Math.max(0.01, desiredMaxZ - desiredMinZ);
  const spreadX = clamp((mapWidth * 0.68) / desiredRangeX, 1, count < 24 ? 3.2 : 2.35);
  const spreadZ = clamp((mapHeight * 0.64) / desiredRangeZ, 1, count < 24 ? 3.2 : 2.35);

  points.forEach((point) => {
    point.desiredX = clamp(
      ((point.desiredX - desiredCenterX) * spreadX) * 0.6 + point.chronologyX * 0.4,
      -mapWidth / 2 + margin,
      mapWidth / 2 - margin,
    );
    point.desiredZ = clamp(
      (point.desiredZ - desiredCenterZ) * spreadZ,
      -mapHeight / 2 + margin,
      mapHeight / 2 - margin,
    );
    point.x = point.desiredX;
    point.z = point.desiredZ;
  });

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const buckets = new Map();
    points.forEach((point, index) => {
      const gx = Math.floor((point.x + mapWidth / 2) / cellSize);
      const gz = Math.floor((point.z + mapHeight / 2) / cellSize);
      const key = `${gx}:${gz}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(index);
    });

    points.forEach((point, index) => {
      const gx = Math.floor((point.x + mapWidth / 2) / cellSize);
      const gz = Math.floor((point.z + mapHeight / 2) / cellSize);
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          const neighbors = buckets.get(`${gx + ox}:${gz + oz}`) || [];
          neighbors.forEach((neighborIndex) => {
            if (neighborIndex <= index) return;
            const other = points[neighborIndex];
            const dx = other.x - point.x;
            const dz = other.z - point.z;
            const distance = Math.hypot(dx, dz) || 0.001;
            const minDistance = point.radius + other.radius + gap;
            if (distance >= minDistance) return;
            const push = (minDistance - distance) * 0.52;
            const nx = dx / distance;
            const nz = dz / distance;
            point.x -= nx * push;
            point.z -= nz * push;
            other.x += nx * push;
            other.z += nz * push;
          });
        }
      }
    });

    points.forEach((point) => {
      const gravity = iteration < iterations * 0.72 ? 0.015 : 0.006;
      point.x = clamp(
        point.x + (point.chronologyX - point.x) * (gravity * 1.9),
        -mapWidth / 2 + margin,
        mapWidth / 2 - margin,
      );
      point.z = clamp(
        point.z + (point.desiredZ - point.z) * gravity,
        -mapHeight / 2 + margin,
        mapHeight / 2 - margin,
      );
    });
  }

  const nodes = points.map((point) => {
    const node = { ...point };
    delete node.desiredX;
    delete node.desiredZ;
    delete node.chronologyX;
    delete node.radius;
    return node;
  }).sort(byYear);
  const initialZoom =
    count > 350
      ? 34
      : count > 180
        ? 42
        : count > 90
          ? 52
          : count > 40
            ? 72
            : count > 20
              ? 94
              : 112;

  return {
    nodes,
    mapWidth,
    mapHeight,
    markerSize,
    initialZoom,
    regions: buildEraRegions(nodes, mapWidth, mapHeight, markerSize),
  };
}

function hashValue(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededUnit(seed, index) {
  const value = Math.sin(hashValue(`${seed}:${index}`) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function getEra(year) {
  if (year == null) return UNDATED_ERA;
  return ERAS.find((era) => year <= era.until) || ERAS.at(-1);
}

function readYear(image) {
  const parsed = Number(image?.year ?? image?.metadata?.year);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// Undated works sort after every dated one instead of scrambling the order.
function byYear(left, right) {
  if (left.year == null) return right.year == null ? 0 : 1;
  if (right.year == null) return -1;
  return left.year - right.year;
}

function formatStylePathLabel(label) {
  return String(label || "Open style path").replace(/^Route\b/i, "Style path");
}

function collectImageKeys(item) {
  const keys = [
    item?.id,
    item?._id,
    item?.fileId,
    item?.file_id,
    item?.filename,
    item?.fileName,
    item?.path,
    item?.imageUrl,
    item?.image_url,
    item?.thumb,
  ].filter(Boolean).map(String);
  const imageUrl = String(item?.imageUrl || item?.image_url || item?.thumb || "");
  const fileMatch = imageUrl.match(/\/api\/image\/image\/([^?/#]+)/);
  if (fileMatch?.[1]) keys.push(fileMatch[1]);
  return keys;
}

function getItemDatabaseName(item) {
  const rawUrl = String(item?.imageUrl || item?.image_url || item?.thumb || "");
  const query = rawUrl.split("?")[1] || "";
  if (!query) return "";

  try {
    return new URLSearchParams(query).get("db_name") || "";
  } catch {
    return "";
  }
}

function mapBackendNode(coord, index) {
  const year = readYear(coord);
  const era = getEra(year);
  const rawX = Number(coord.x);
  const rawY = Number(coord.y);
  const rawZ = Number(coord.z);
  const x = clamp((Number.isFinite(rawX) ? rawX : 0) * 3.55, -MAP_BOUNDS.x, MAP_BOUNDS.x);
  const z = clamp((Number.isFinite(rawY) ? rawY : 0) * -2.15, -MAP_BOUNDS.z, MAP_BOUNDS.z);
  const height = 0.38 + ((Number.isFinite(rawZ) ? rawZ : 0) + 1) * 0.18;
  return {
    id: coord.id || `f5-node-${index}`,
    fileId: coord.file_id || "",
    path: coord.path || "",
    filename: coord.filename || "",
    label: getArtworkDisplayName(coord, `Painting ${index + 1}`),
    artist: getArtworkArtistName(coord, ""),
    thumb: coord.thumb || coord.image_url || null,
    imageUrl: coord.image_url || coord.thumb || null,
    year,
    dateLabel: coord.date_label || (year == null ? "undated" : `${year}`),
    yearSource: coord.year_source || "unknown",
    yearConfidence: Number.isFinite(Number(coord.year_confidence)) ? Number(coord.year_confidence) : null,
    estimated: year != null && isEstimatedYear(coord.year_source),
    undated: year == null,
    era: coord.era_id ? ERA_BANDS.find((item) => item.id === coord.era_id) || era : era,
    clusterId: coord.cluster_id ?? "backend",
    clusterLabel: formatStylePathLabel(coord.cluster_label),
    color: (coord.era_id ? ERA_BANDS.find((item) => item.id === coord.era_id) : era)?.color || era.color,
    pathColor: coord.cluster_color || era.color,
    x,
    y: height,
    z,
    size: 0.34 + Number(coord.bridge_score || 0) * 0.18,
    bridgeScore: Number(coord.bridge_score || 0),
    distinctiveness: Number(coord.distinctiveness || 0),
    neighbors: Array.isArray(coord.neighbors) ? coord.neighbors : [],
  };
}

function ChartTableBase({ mapWidth, mapHeight }) {
  const tableWidth = mapWidth + 0.9;
  const tableHeight = mapHeight + 0.72;
  const plankCount = Math.max(8, Math.ceil(tableWidth / 0.9));

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.055, 0]} receiveShadow>
        <planeGeometry args={[tableWidth, tableHeight]} />
        <meshStandardMaterial color="#3a2415" roughness={0.86} />
      </mesh>
      {Array.from({ length: plankCount }, (_, index) => {
        const x = -tableWidth / 2 + (index / Math.max(plankCount - 1, 1)) * tableWidth;
        return (
          <Line
            key={`table-plank-${index}`}
            points={[[x, -0.048, -tableHeight / 2], [x, -0.048, tableHeight / 2]]}
            color="#1d1009"
            transparent
            opacity={0.32}
            lineWidth={1.2}
          />
        );
      })}
      <Line
        points={[
          [-tableWidth / 2, -0.04, -tableHeight / 2],
          [tableWidth / 2, -0.04, -tableHeight / 2],
          [tableWidth / 2, -0.04, tableHeight / 2],
          [-tableWidth / 2, -0.04, tableHeight / 2],
          [-tableWidth / 2, -0.04, -tableHeight / 2],
        ]}
        color="#6c4322"
        transparent
        opacity={0.9}
        lineWidth={3}
      />
    </group>
  );
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((char) => char + char).join("")
    : value;
  const numeric = Number.parseInt(normalized, 16);
  return {
    r: (numeric >> 16) & 255,
    g: (numeric >> 8) & 255,
    b: numeric & 255,
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function worldToTexture(x, z, mapWidth, mapHeight, width, height) {
  return {
    x: ((x + mapWidth / 2) / mapWidth) * width,
    y: ((z + mapHeight / 2) / mapHeight) * height,
  };
}

function drawSmoothPath(ctx, points) {
  if (!points.length) return;
  ctx.beginPath();
  const first = points[0];
  ctx.moveTo(first.x, first.y);
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  ctx.closePath();
}

function createChartMapTexture(nodes, regions, routeLines, mapWidth, mapHeight) {
  if (typeof document === "undefined") return null;

  const aspect = mapHeight / mapWidth;
  const width = MAP_TEXTURE_WIDTH;
  const height = Math.round(MAP_TEXTURE_WIDTH * aspect);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const parchment = ctx.createLinearGradient(0, 0, width, height);
  parchment.addColorStop(0, "#ecd59b");
  parchment.addColorStop(0.52, "#d5b874");
  parchment.addColorStop(1, "#c8a762");
  ctx.fillStyle = parchment;
  ctx.fillRect(0, 0, width, height);

  for (let index = 0; index < 1800; index += 1) {
    const seed = `paper-grain-${index}`;
    const x = seededUnit(seed, "x") * width;
    const y = seededUnit(seed, "y") * height;
    const radius = 0.55 + seededUnit(seed, "r") * 2.4;
    ctx.fillStyle = seededUnit(seed, "light") > 0.56
      ? "rgba(255, 238, 184, 0.12)"
      : "rgba(92, 58, 25, 0.08)";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const stainGradient = ctx.createRadialGradient(width * 0.28, height * 0.46, 20, width * 0.28, height * 0.46, width * 0.34);
  stainGradient.addColorStop(0, "rgba(82, 119, 105, 0.14)");
  stainGradient.addColorStop(0.68, "rgba(82, 119, 105, 0.06)");
  stainGradient.addColorStop(1, "rgba(82, 119, 105, 0)");
  ctx.fillStyle = stainGradient;
  ctx.fillRect(0, 0, width, height);

  const secondStain = ctx.createRadialGradient(width * 0.72, height * 0.58, 8, width * 0.72, height * 0.58, width * 0.2);
  secondStain.addColorStop(0, "rgba(118, 83, 34, 0.18)");
  secondStain.addColorStop(1, "rgba(118, 83, 34, 0)");
  ctx.fillStyle = secondStain;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = "rgba(96, 69, 35, 0.16)";
  ctx.lineWidth = 1;
  const gridColumns = Math.max(8, Math.ceil(mapWidth / 1.05));
  const gridRows = Math.max(7, Math.ceil(mapHeight / 0.72));
  for (let index = 0; index <= gridColumns; index += 1) {
    const x = (index / gridColumns) * width;
    ctx.beginPath();
    ctx.moveTo(x, 36);
    ctx.lineTo(x, height - 36);
    ctx.stroke();
  }
  for (let index = 0; index <= gridRows; index += 1) {
    const y = (index / gridRows) * height;
    ctx.beginPath();
    ctx.moveTo(42, y);
    ctx.lineTo(width - 42, y);
    ctx.stroke();
  }
  ctx.restore();

  regions.forEach((region) => {
    const texturePoints = region.path.map((point) => (
      worldToTexture(point.x, point.z, mapWidth, mapHeight, width, height)
    ));
    const regionCenter = worldToTexture(region.x, region.z, mapWidth, mapHeight, width, height);

    ctx.save();
    drawSmoothPath(ctx, texturePoints);
    const gradient = ctx.createRadialGradient(regionCenter.x, regionCenter.y, 4, regionCenter.x, regionCenter.y, width * 0.18);
    gradient.addColorStop(0, rgba(region.color, 0.42));
    gradient.addColorStop(0.64, rgba(region.color, 0.3));
    gradient.addColorStop(1, rgba(region.color, 0.16));
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = rgba(region.color, 0.72);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.setLineDash([18, 10]);
    ctx.strokeStyle = "rgba(66, 42, 20, 0.34)";
    ctx.stroke();
    ctx.setLineDash([]);

    for (let index = 0; index < Math.min(region.count * 8 + 18, 90); index += 1) {
      const angle = seededUnit(`${region.id}:dot-${index}`, "a") * Math.PI * 2;
      const distance = Math.sqrt(seededUnit(`${region.id}:dot-${index}`, "d"));
      const x = regionCenter.x + Math.cos(angle) * distance * region.radiusX * (width / mapWidth) * 0.92;
      const y = regionCenter.y + Math.sin(angle) * distance * region.radiusZ * (height / mapHeight) * 0.92;
      ctx.fillStyle = rgba(region.color, 0.22);
      ctx.beginPath();
      ctx.arc(x, y, 2.2 + seededUnit(`${region.id}:dot-${index}`, "r") * 3.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  });

  nodes.forEach((node) => {
    if ((node.mapSize || 0) < 0.12) return;
    const point = worldToTexture(node.x, node.z, mapWidth, mapHeight, width, height);
    const fontSize = clamp((node.mapSize || 0.16) * (width / mapWidth) * 0.24, 13, 22);
    ctx.font = `700 ${fontSize}px Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(237, 220, 169, 0.8)";
    const stamp = node.year == null ? "undated" : `${node.year}`;
    ctx.strokeText(stamp, point.x, point.y + fontSize * 0.55);
    // Estimates are printed in the estimated colour, catalogue dates in ink.
    ctx.fillStyle = node.estimated || node.undated ? ESTIMATED_YEAR_COLOR : "rgba(53, 34, 16, 0.9)";
    ctx.fillText(stamp, point.x, point.y + fontSize * 0.55);
  });

  const compassX = width - 150;
  const compassY = 144;
  ctx.save();
  ctx.translate(compassX, compassY);
  ctx.strokeStyle = "rgba(92, 58, 23, 0.4)";
  ctx.lineWidth = 3;
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2;
    const length = index % 2 === 0 ? 74 : 48;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * 22, Math.sin(angle) * 22);
    ctx.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 58, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = "rgba(78, 47, 20, 0.46)";
  ctx.lineWidth = 18;
  ctx.strokeRect(42, 42, width - 84, height - 84);
  ctx.strokeStyle = "rgba(247, 224, 159, 0.28)";
  ctx.lineWidth = 3;
  ctx.strokeRect(58, 58, width - 116, height - 116);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  if (THREE.SRGBColorSpace) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  return texture;
}

function ParchmentMap({ nodes, routeLines, mapWidth, mapHeight, regions }) {
  const mapTexture = useMemo(
    () => createChartMapTexture(nodes, regions, routeLines, mapWidth, mapHeight),
    [nodes, regions, routeLines, mapWidth, mapHeight],
  );

  useEffect(() => () => {
    mapTexture?.dispose();
  }, [mapTexture]);

  return (
    <group position={[0, 0.08, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <boxGeometry args={[mapWidth + 0.22, mapHeight + 0.22, 0.035]} />
        <meshStandardMaterial color="#b99158" roughness={0.92} metalness={0.02} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.024, 0]}>
        <planeGeometry args={[mapWidth, mapHeight]} />
        {mapTexture ? (
          <meshBasicMaterial map={mapTexture} toneMapped={false} />
        ) : (
          <meshStandardMaterial color="#e4cf98" roughness={0.88} />
        )}
      </mesh>
      {[
        [-mapWidth / 2 - 0.02, -mapHeight / 2 - 0.02],
        [mapWidth / 2 + 0.02, -mapHeight / 2 - 0.02],
        [-mapWidth / 2 - 0.02, mapHeight / 2 + 0.02],
        [mapWidth / 2 + 0.02, mapHeight / 2 + 0.02],
      ].map(([x, z]) => (
        <group key={`${x}-${z}`} position={[x, 0.079, z]}>
          <mesh>
            <cylinderGeometry args={[0.065, 0.085, 0.035, 24]} />
            <meshStandardMaterial color="#8f5d2b" roughness={0.52} metalness={0.34} />
          </mesh>
          <mesh position={[0, 0.03, 0]}>
            <sphereGeometry args={[0.055, 20, 10]} />
            <meshStandardMaterial color="#d2a04b" roughness={0.42} metalness={0.46} />
          </mesh>
        </group>
      ))}
      {nodes.map((node) => (
        <PaintingIsland key={node.id} node={node} />
      ))}
    </group>
  );
}

function pumpThumbnailLoadQueue() {
  while (activeThumbnailLoads < MAX_THUMBNAIL_LOADS && thumbnailLoadQueue.length) {
    const entry = thumbnailLoadQueue.shift();
    activeThumbnailLoads += 1;
    entry.task()
      .then(entry.resolve)
      .catch(entry.reject)
      .finally(() => {
        activeThumbnailLoads -= 1;
        pumpThumbnailLoadQueue();
      });
  }
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function drawCoveredImage(ctx, image, width, height) {
  const sourceWidth = image.width || image.naturalWidth;
  const sourceHeight = image.height || image.naturalHeight;
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = width / height;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  let cropX = 0;
  let cropY = 0;

  if (sourceAspect > targetAspect) {
    cropWidth = sourceHeight * targetAspect;
    cropX = (sourceWidth - cropWidth) / 2;
  } else {
    cropHeight = sourceWidth / targetAspect;
    cropY = (sourceHeight - cropHeight) / 2;
  }

  ctx.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, width, height);
}

async function createMapThumbnailTexture(url) {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = MAP_THUMBNAIL_SIZE;
  canvas.height = MAP_THUMBNAIL_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let bitmap = null;
  let objectUrl = "";
  try {
    const response = await fetch(url, { mode: "cors" });
    const blob = await response.blob();
    if ("createImageBitmap" in window) {
      bitmap = await createImageBitmap(blob);
      drawCoveredImage(ctx, bitmap, MAP_THUMBNAIL_SIZE, MAP_THUMBNAIL_SIZE);
    } else {
      objectUrl = URL.createObjectURL(blob);
      const image = await loadImageElement(objectUrl);
      drawCoveredImage(ctx, image, MAP_THUMBNAIL_SIZE, MAP_THUMBNAIL_SIZE);
    }
  } finally {
    bitmap?.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  if (THREE.SRGBColorSpace) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  return texture;
}

function getMapThumbnailTexture(url) {
  if (!url) return { texture: null, promise: Promise.resolve(null) };
  const cached = thumbnailTextureCache.get(url);
  if (cached) return cached;

  const entry = {
    texture: null,
    promise: null,
  };
  entry.promise = new Promise((resolve, reject) => {
    thumbnailLoadQueue.push({
      task: () => createMapThumbnailTexture(url).then((texture) => {
        entry.texture = texture;
        return texture;
      }),
      resolve,
      reject,
    });
    pumpThumbnailLoadQueue();
  });
  thumbnailTextureCache.set(url, entry);
  return entry;
}

function ThumbnailPlate({ width, height, color, opacity = 0.24 }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.052, 0]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} />
    </mesh>
  );
}

function PaintingThumbnail({ url, width, height, color }) {
  const [texture, setTexture] = useState(() => (
    url ? thumbnailTextureCache.get(url)?.texture || null : null
  ));

  useEffect(() => {
    let cancelled = false;
    if (!url) return undefined;

    const entry = getMapThumbnailTexture(url);
    entry.promise.then((loadedTexture) => {
      if (!cancelled && loadedTexture) setTexture(loadedTexture);
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url) {
    return <ThumbnailPlate width={width} height={height} color={color} opacity={0.88} />;
  }

  if (!texture) {
    return <ThumbnailPlate width={width} height={height} color={color} opacity={0.68} />;
  }

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.052, 0]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

function PaintingIsland({ node }) {
  const color = new THREE.Color(node.color);
  const islandSize = node.mapSize || 0.22;
  const width = islandSize * 1.16;
  const height = islandSize * 0.84;

  return (
    <group position={[node.x, 0.16, node.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[islandSize * 0.72, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.14} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <planeGeometry args={[width + 0.035, height + 0.035]} />
        <meshStandardMaterial color="#f0d9a2" roughness={0.78} />
      </mesh>
      <PaintingThumbnail
        key={node.thumb || node.id}
        url={node.thumb}
        width={width}
        height={height}
        color={color}
      />
      <Line
        points={[
          [-width / 2, 0.066, -height / 2],
          [width / 2, 0.066, -height / 2],
          [width / 2, 0.066, height / 2],
          [-width / 2, 0.066, height / 2],
          [-width / 2, 0.066, -height / 2],
        ]}
        color={node.color}
        transparent
        opacity={0.92}
        lineWidth={1.8}
      />
    </group>
  );
}

function SelectableIsland({ node, isActive, onSelect }) {
  const downPointRef = useRef(null);
  const islandSize = node.mapSize || 0.22;
  const width = islandSize * 1.34;
  const height = islandSize * 1;

  return (
    <group
      position={[node.x, 0.26, node.z]}
      onPointerDown={(event) => {
        downPointRef.current = {
          x: event.nativeEvent?.clientX ?? event.clientX ?? 0,
          y: event.nativeEvent?.clientY ?? event.clientY ?? 0,
        };
      }}
      onPointerUp={(event) => {
        const start = downPointRef.current;
        downPointRef.current = null;
        if (!start) return;
        const x = event.nativeEvent?.clientX ?? event.clientX ?? 0;
        const y = event.nativeEvent?.clientY ?? event.clientY ?? 0;
        if (Math.hypot(x - start.x, y - start.y) < 5) {
          event.stopPropagation();
          onSelect(node);
        }
      }}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.02} depthWrite={false} />
      </mesh>
      {isActive ? (
        <Line
          points={[
            [-width / 2, 0.015, -height / 2],
            [width / 2, 0.015, -height / 2],
            [width / 2, 0.015, height / 2],
            [-width / 2, 0.015, height / 2],
            [-width / 2, 0.015, -height / 2],
          ]}
          color="#fff1c8"
          transparent
          opacity={0.95}
          lineWidth={2.6}
        />
      ) : null}
    </group>
  );
}

// The chart sits in a real cabin now: a plank floor and panelled walls close
// the navigator's table in, so the parchment reads as furniture seen in
// perspective rather than a flat overhead scan.
function CabinEnvironment({ mapWidth, mapHeight, floorY }) {
  const wallTex = useRepeatingCanvasTexture(drawWoodGrainTexture, [], 512, [6, 4]);
  const floorTex = useRepeatingCanvasTexture(drawWoodGrainTexture, [], 512, [8, 6]);
  const roomW = Math.max(mapWidth + 6, 14);
  const roomD = Math.max(mapHeight + 6, 12);
  const wallH = 7.5;
  const backZ = -roomD / 2;

  return (
    <group>
      <mesh raycast={() => null} rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY, 0]}>
        <planeGeometry args={[roomW, roomD]} />
        <meshStandardMaterial color="#3a2a1a" roughness={0.92} map={floorTex} />
      </mesh>
      <mesh raycast={() => null} position={[0, floorY + wallH / 2, backZ]}>
        <planeGeometry args={[roomW, wallH]} />
        <meshStandardMaterial color="#241710" roughness={0.95} map={wallTex} emissive="#180c05" emissiveIntensity={0.1} />
      </mesh>
      <mesh raycast={() => null} rotation={[0, Math.PI / 2, 0]} position={[-roomW / 2, floorY + wallH / 2, 0]}>
        <planeGeometry args={[roomD, wallH]} />
        <meshStandardMaterial color="#221610" roughness={0.95} map={wallTex} />
      </mesh>
      <mesh raycast={() => null} rotation={[0, -Math.PI / 2, 0]} position={[roomW / 2, floorY + wallH / 2, 0]}>
        <planeGeometry args={[roomD, wallH]} />
        <meshStandardMaterial color="#221610" roughness={0.95} map={wallTex} />
      </mesh>
      <SternWindow position={[0, floorY + 2.7, backZ + 0.08]} />
      {/* wainscot rail so the back wall reads as a cabin, not a void */}
      <mesh raycast={() => null} position={[0, floorY + 1.0, backZ + 0.06]}>
        <boxGeometry args={[roomW, 0.16, 0.12]} />
        <meshStandardMaterial color="#3a2616" roughness={0.78} emissive="#1a0d05" emissiveIntensity={0.08} />
      </mesh>
    </group>
  );
}

// A latticed galleon stern window: moonlit sky and sea behind a muntin grid, so
// the chart-room shares the Captain's Quarters' window onto the night ocean.
function SternWindow({ position }) {
  const W = 1.9;
  const H = 1.25;
  const frame = "#241509";
  const cols = [-0.95, 0, 0.95];
  const rows = [-0.55, 0.55];
  return (
    <group position={position}>
      <mesh raycast={() => null} position={[0, 0, -0.12]}>
        <boxGeometry args={[W * 2 + 0.4, H * 2 + 0.4, 0.2]} />
        <meshStandardMaterial color="#0a0905" roughness={1} />
      </mesh>
      <mesh raycast={() => null} position={[0, 0.28, -0.05]}>
        <planeGeometry args={[W * 2, H * 2 - 0.6]} />
        <meshStandardMaterial color="#173557" emissive="#2a5b92" emissiveIntensity={0.95} roughness={1} />
      </mesh>
      <mesh raycast={() => null} position={[0, -0.82, -0.05]}>
        <planeGeometry args={[W * 2, 0.74]} />
        <meshStandardMaterial color="#0f2236" emissive="#1c3a5a" emissiveIntensity={0.7} roughness={1} />
      </mesh>
      <mesh raycast={() => null} position={[0.5, 0.86, -0.045]}>
        <circleGeometry args={[0.3, 28]} />
        <meshBasicMaterial color="#f3f6fc" />
      </mesh>
      <mesh raycast={() => null} position={[0.5, 0.86, -0.046]}>
        <circleGeometry args={[0.56, 28]} />
        <meshBasicMaterial color="#bcd0ee" transparent opacity={0.34} depthWrite={false} />
      </mesh>
      {/* outer frame */}
      {[
        [0, H + 0.12, W * 2 + 0.36, 0.2],
        [0, -H - 0.14, W * 2 + 0.36, 0.24],
      ].map(([x, y, w, h], i) => (
        <mesh key={`f${i}`} raycast={() => null} position={[x, y, 0.04]}>
          <boxGeometry args={[w, h, 0.16]} />
          <meshStandardMaterial color={frame} roughness={0.82} />
        </mesh>
      ))}
      {[-W - 0.1, W + 0.1].map((x, i) => (
        <mesh key={`s${i}`} raycast={() => null} position={[x, 0, 0.04]}>
          <boxGeometry args={[0.2, H * 2 + 0.36, 0.16]} />
          <meshStandardMaterial color={frame} roughness={0.82} />
        </mesh>
      ))}
      {/* muntins */}
      {cols.map((x) => (
        <mesh key={`v${x}`} raycast={() => null} position={[x, 0, 0.03]}>
          <boxGeometry args={[0.06, H * 2, 0.1]} />
          <meshStandardMaterial color={frame} roughness={0.8} />
        </mesh>
      ))}
      {rows.map((y) => (
        <mesh key={`h${y}`} raycast={() => null} position={[0, y, 0.03]}>
          <boxGeometry args={[W * 2, 0.06, 0.1]} />
          <meshStandardMaterial color={frame} roughness={0.8} />
        </mesh>
      ))}
      {/* cool moonlight spilling into the cabin */}
      <pointLight position={[0, 0, 1.6]} color="#86acdc" intensity={0.7} distance={9} />
    </group>
  );
}

function TableSupport({ mapWidth, mapHeight, floorY }) {
  const topY = -0.08;
  const w = mapWidth + 1.4;
  const d = mapHeight + 1.2;
  const inset = 0.55;
  const legH = topY - 0.18 - floorY;
  const legs = [
    [-w / 2 + inset, -d / 2 + inset],
    [w / 2 - inset, -d / 2 + inset],
    [-w / 2 + inset, d / 2 - inset],
    [w / 2 - inset, d / 2 - inset],
  ];
  return (
    <group>
      <mesh raycast={() => null} position={[0, topY - 0.17, 0]}>
        <boxGeometry args={[w, 0.22, d]} />
        <meshStandardMaterial color="#5a3c1f" roughness={0.84} emissive="#241405" emissiveIntensity={0.06} />
      </mesh>
      {legs.map(([x, z], index) => (
        <mesh key={index} raycast={() => null} position={[x, floorY + legH / 2, z]}>
          <boxGeometry args={[0.22, legH, 0.22]} />
          <meshStandardMaterial color="#4a3119" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function NavLantern({ position, distance }) {
  return (
    <group position={position}>
      <mesh raycast={() => null} position={[0, 1.5, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 3, 6]} />
        <meshStandardMaterial color="#2a2a2a" metalness={0.8} roughness={0.5} />
      </mesh>
      <mesh raycast={() => null}>
        <cylinderGeometry args={[0.24, 0.24, 0.52, 14, 1, true]} />
        <meshStandardMaterial color="#ffcf86" transparent opacity={0.34} emissive="#ffae4a" emissiveIntensity={0.75} side={2} />
      </mesh>
      <mesh raycast={() => null} position={[0, 0.32, 0]}>
        <coneGeometry args={[0.28, 0.24, 10]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      <mesh raycast={() => null} position={[0, -0.3, 0]}>
        <cylinderGeometry args={[0.22, 0.18, 0.06, 14]} />
        <meshStandardMaterial {...BRASS_MATERIAL} />
      </mesh>
      <pointLight position={[0, -0.1, 0]} color="#ffb866" intensity={1.6} distance={distance} />
    </group>
  );
}

// A brass loupe resting on the chart — pure dressing, but it grounds the
// parchment as a physical object on the table.
function ArchiveScene({
  nodes,
  routeLines,
  activeRouteLines,
  selected,
  setSelected,
  mapWidth,
  mapHeight,
  regions,
  onOpenPainting,
}) {
  const floorY = -2.7;
  const diag = Math.hypot(mapWidth, mapHeight);
  const dist = Math.max(7, diag * 0.8);

  return (
    <>
      <PerspectiveCamera
        key={`${Math.round(mapWidth)}-${Math.round(mapHeight)}`}
        makeDefault
        fov={42}
        near={0.1}
        far={dist * 6}
        position={[0, dist * 0.8, dist * 0.66]}
      />
      <color attach="background" args={["#0d0904"]} />
      <fog attach="fog" args={["#0d0805", dist * 1.15, dist * 3.4]} />
      <ambientLight intensity={0.5} color="#ffe2b8" />
      <hemisphereLight args={["#ffdca0", "#140c06", 0.32]} />
      <directionalLight position={[dist * 0.4, dist, dist * 0.5]} intensity={0.8} color="#ffe2a0" />
      <pointLight position={[-dist * 0.5, dist * 0.4, -dist * 0.4]} intensity={0.4} color="#7fa8d8" distance={dist * 2} />
      <CabinEnvironment mapWidth={mapWidth} mapHeight={mapHeight} floorY={floorY} />
      <NavLantern position={[0, dist * 0.6, 0]} distance={dist * 1.9} />
      <TableSupport mapWidth={mapWidth} mapHeight={mapHeight} floorY={floorY} />
      <ChartTableBase mapWidth={mapWidth} mapHeight={mapHeight} />
      <ParchmentMap
        nodes={nodes}
        routeLines={routeLines}
        mapWidth={mapWidth}
        mapHeight={mapHeight}
        regions={regions}
      />
      {activeRouteLines.map((line) => (
        <Line
          key={line.id}
          points={line.points}
          color={line.color}
          transparent
          opacity={0.72}
          lineWidth={2.1}
        />
      ))}

      {nodes.map((node) => (
        <SelectableIsland
          key={`hit-${node.id}`}
          node={node}
          isActive={selected?.id === node.id}
          onSelect={(nodeToOpen) => {
            setSelected(nodeToOpen);
            onOpenPainting(nodeToOpen);
          }}
        />
      ))}
      <OrbitControls
        makeDefault
        enableRotate
        enablePan
        enableZoom
        enableDamping
        dampingFactor={0.12}
        zoomSpeed={0.8}
        panSpeed={0.9}
        minDistance={dist * 0.4}
        maxDistance={dist * 1.8}
        minPolarAngle={0.16}
        maxPolarAngle={1.24}
        target={[0, 0, 0]}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
    </>
  );
}

export default function HistoryTable({
  images = [],
  databaseName = "default",
  onOpenCreativity,
  onOpenInfluence,
}) {
  const [f5Nodes, setF5Nodes] = useState([]);
  const [hasLoadedF5, setHasLoadedF5] = useState(false);
  const [selected, setSelected] = useState(null);
  const { open: openFullscreen } = useFullscreenImage();
  const [activeEra, setActiveEra] = useState("");
  const [chromeOpen, setChromeOpen] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState(0);
  const [pipelineMessage, setPipelineMessage] = useState("");
  const [isF5Running, setIsF5Running] = useState(false);
  const [yearSummary, setYearSummary] = useState(null);

  const loadF5 = useCallback(async () => {
    const coords = await getF5Coords(databaseName);
    const mapped = Array.isArray(coords.coords)
      ? coords.coords.filter((coord) => coord.x != null && coord.y != null).map(mapBackendNode)
      : [];
    setF5Nodes(mapped);
    setYearSummary(coords.years || null);
    setHasLoadedF5(true);
  }, [databaseName]);

  useEffect(() => {
    let mounted = true;
    const timeoutId = window.setTimeout(() => {
      if (!mounted) return;
      setHasLoadedF5(false);
      setF5Nodes([]);
      setSelected(null);
      setActiveEra("");
      loadF5().catch(() => {
        if (mounted) {
          setF5Nodes([]);
          setHasLoadedF5(true);
        }
      });
    }, 0);
    return () => {
      mounted = false;
      window.clearTimeout(timeoutId);
    };
  }, [loadF5]);

  useEffect(() => {
    let mounted = true;
    const checkStatus = async () => {
      try {
        const status = await getPipelineStatus("f5");
        if (!mounted) return;
        const f5Status = status.f5 || {};
        setPipelineProgress(f5Status.progress || 0);
        setPipelineMessage(f5Status.message || "");
        setIsF5Running(f5Status.status === "running");
        if (f5Status.status === "completed") {
          await loadF5();
        }
      } catch {
        if (mounted) setIsF5Running(false);
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [databaseName, loadF5]);

  const currentImageKeys = useMemo(() => {
    const keys = new Set();
    images.forEach((image) => {
      collectImageKeys(image).forEach((key) => keys.add(key));
    });
    return keys;
  }, [images]);
  const allNodes = useMemo(() => {
    const dbFilteredNodes = databaseName
      ? f5Nodes.filter((node) => {
        const nodeDatabase = getItemDatabaseName(node);
        return !nodeDatabase || nodeDatabase === databaseName;
      })
      : f5Nodes;

    if (!images.length || !currentImageKeys.size) return dbFilteredNodes;
    return dbFilteredNodes.filter((node) => (
      collectImageKeys(node).some((key) => currentImageKeys.has(key))
    ));
  }, [databaseName, f5Nodes, images.length, currentImageKeys]);
  const hasIndexedMap = allNodes.length > 0;
  const estimatedCount = useMemo(
    () => allNodes.filter((node) => node.estimated).length,
    [allNodes],
  );
  const undatedCount = useMemo(
    () => allNodes.filter((node) => node.undated).length,
    [allNodes],
  );
  const typicalYearError = Number(yearSummary?.model?.mae) || null;

  const chartLayout = useMemo(() => {
    const filteredNodes = allNodes
      .filter((node) => !activeEra || String(node.era.id) === String(activeEra))
      .sort(byYear);
    return packNodesOnChart(filteredNodes);
  }, [allNodes, activeEra]);
  const nodes = chartLayout.nodes;

  const routeLines = useMemo(() => {
    if (nodes.length < 2) return [];
    const grouped = new Map();
    nodes.forEach((node) => {
      const key = String(node.era.id);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(node);
    });
    const candidateLines = Array.from(grouped.values()).flatMap((group) => (
      group
        .sort(byYear)
        .slice(1)
        .map((node, index) => {
          const previous = group[index];
          return {
            id: `${previous.id}-${node.id}`,
            color: node.color,
            opacity: 0.2 + Math.min(index / Math.max(group.length, 1), 1) * 0.14,
            offset: seededUnit(`${previous.id}-${node.id}`, "path"),
            points: makeRoutePoints(previous, node, index),
          };
        })
    ));
    const stride = Math.max(1, Math.ceil(candidateLines.length / MAX_ROUTE_LINES));
    const lines = [];
    for (let index = 0; index < candidateLines.length; index += stride) {
      lines.push(candidateLines[index]);
    }
    return lines;
  }, [nodes]);

  const visibleSelected = selected && (
    !activeEra || String(selected.era.id) === String(activeEra)
  )
    ? selected
    : null;
  const selectedNode = visibleSelected;
  const activeRouteLines = useMemo(() => {
    if (!selectedNode) return [];
    const selectedIndex = nodes.findIndex((node) => node.id === selectedNode.id);
    if (selectedIndex <= 0) return [];
    const previous = [...nodes]
      .slice(0, selectedIndex)
      .reverse()
      .find((node) => String(node.era.id) === String(selectedNode.era.id));
    if (!previous) return [];
    const node = nodes[selectedIndex];
    return [{
      id: `active-${previous.id}-${node.id}`,
      color: node.color,
      points: makeRoutePoints(previous, node, selectedIndex),
    }];
  }, [nodes, selectedNode]);
  const yearRange = useMemo(() => {
    const years = allNodes.map((node) => node.year).filter(Number.isFinite);
    if (!years.length) return "n/a";
    return `${Math.min(...years)}-${Math.max(...years)}`;
  }, [allNodes]);
  const eraStats = useMemo(
    () =>
      ERA_BANDS.map((era) => ({
        ...era,
        count: allNodes.filter((node) => node.era.id === era.id).length,
      })),
    [allNodes],
  );
  const sectionSummary = useMemo(() => {
    const strongest = eraStats.reduce((best, era) => (
      Number(era.count || 0) > Number(best.count || 0) ? era : best
    ), eraStats[0]);
    return strongest?.count ? strongest.label : "No map sections yet";
  }, [eraStats]);
  const timelineNodes = useMemo(() => {
    if (nodes.length <= 9) return nodes;
    const sampled = new Map();
    Array.from({ length: 9 }, (_, index) => {
      const item = nodes[Math.round((index / 8) * (nodes.length - 1))];
      if (item) sampled.set(item.id, item);
      return item;
    });
    return Array.from(sampled.values());
  }, [nodes]);
  const selectedPosition = useMemo(() => {
    if (!selectedNode) return "";
    const index = nodes.findIndex((node) => node.id === selectedNode.id);
    if (index < 0) return "";
    return `${index + 1}/${nodes.length}`;
  }, [nodes, selectedNode]);
  const displayedWorks = hasIndexedMap ? allNodes.length : images.length;
  const statusLabel = isF5Running ? "Building" : hasIndexedMap ? "Ready" : hasLoadedF5 ? "Not indexed" : "Loading";
  const statusValue = isF5Running
    ? `${pipelineProgress}%`
    : hasIndexedMap
      ? `${nodes.length} artworks`
      : hasLoadedF5
        ? "Placeholder"
        : "...";

  return (
    <section className={styles.root}>
      <div className={styles.stage}>
        {hasIndexedMap ? (
          <Canvas
            frameloop="demand"
            dpr={[0.85, 1]}
            camera={{ position: [0, 4.2, 6.4], fov: 48 }}
            shadows
            gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
            fallback={
              <div className={styles.webglFallback}>
                <strong>Interactive chart needs WebGL</strong>
                <span>The F5 style path data is ready. Open this screen in a browser with WebGL enabled to walk the navigator's table.</span>
              </div>
            }
          >
            <ArchiveScene
              nodes={nodes}
              routeLines={routeLines}
              activeRouteLines={activeRouteLines}
              selected={visibleSelected}
              setSelected={setSelected}
              mapWidth={chartLayout.mapWidth}
              mapHeight={chartLayout.mapHeight}
              regions={chartLayout.regions}
              onOpenPainting={(painting) =>
                painting &&
                openFullscreen({
                  images: [
                    {
                      src: painting.thumb,
                      label: painting.label,
                      caption: `${
                        painting.era?.label
                          ? `${painting.dateLabel} · ${painting.era.label}`
                          : painting.dateLabel
                      }${painting.estimated ? ` · ${ESTIMATED_YEAR_NOTE}` : ""}${
                        painting.undated ? ` · ${UNDATED_NOTE}` : ""
                      }`,
                    },
                  ],
                })
              }
            />
          </Canvas>
        ) : (
          <div className={styles.emptyMapState}>
            <div className={styles.emptyMapCard}>
              <span>{isF5Running ? "Building F5 index" : "F5 index missing"}</span>
              <strong>{isF5Running ? `${pipelineProgress}%` : "Run F5 for this dataset"}</strong>
              <p>
                {isF5Running
                  ? pipelineMessage || "The chart will appear when the history map finishes indexing."
                  : "This dataset has not been indexed for the history map yet, so the table is hidden until real F5 artifacts exist."}
              </p>
              {isF5Running ? (
                <div className={styles.pipelineTrack}>
                  <span style={{ width: `${pipelineProgress}%` }} />
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* The chart-room is immersive by default; chrome is opt-in. */}
      <button
        type="button"
        className={styles.chromeToggle}
        onClick={() => setChromeOpen((open) => !open)}
        aria-expanded={chromeOpen}
        aria-label={chromeOpen ? "Hide chart controls" : "Show chart controls"}
      >
        {chromeOpen ? "✕ Close" : "☰ Controls"}
      </button>

      <header className={`${styles.topBar} ${chromeOpen ? styles.topBarOpen : ""}`}>
        <div className={styles.topBarTitle}>
          <p className={styles.eyebrow}>F5 Navigator's Chart Table</p>
          <h2 className={styles.header}>Paintings As Islands</h2>
        </div>
        <div className={styles.statusPill}>
          <span>{statusLabel}</span>
          <strong>{statusValue}</strong>
        </div>
        <div className={styles.controlsRow}>
          <button className={styles.backBtn} onClick={onOpenCreativity}>Creativity</button>
          <button className={styles.backBtn} onClick={onOpenInfluence}>Influence</button>
        </div>
      </header>

      <aside className={`${styles.sidePanel} ${chromeOpen ? styles.sidePanelOpen : ""}`} aria-hidden={!chromeOpen}>
          <div className={styles.metricGrid}>
            <div><span>Works</span><strong>{displayedWorks}</strong></div>
            <div><span>Shown</span><strong>{nodes.length}</strong></div>
            <div><span>Range</span><strong>{yearRange}</strong></div>
            <div><span>Sections</span><strong>{eraStats.filter((era) => era.count > 0).length}</strong></div>
          </div>

          <div className={styles.readoutBox}>
            <span>Largest Map Section</span>
            <strong>{sectionSummary}</strong>
            <div className={styles.eraStrip} aria-hidden="true">
              {eraStats.map((era) => (
                <span
                  key={era.id}
                  style={{
                    background: era.color,
                    flexGrow: Math.max(era.count, 1),
                    opacity: era.count ? 1 : 0.28,
                  }}
                />
              ))}
            </div>
          </div>

          <div className={styles.mapInstructions}>
            Drag to orbit · right-drag to pan · scroll to zoom · click an island
          </div>

          <div className={styles.timelinePanel}>
            <p className={styles.panelTitle}>Chronology</p>
            {estimatedCount > 0 ? (
              <p className={styles.estimatedLegend}>
                <span style={{ background: ESTIMATED_YEAR_COLOR }} />
                <span style={{ color: ESTIMATED_YEAR_COLOR }}>
                  {estimatedCount} of {allNodes.length} {ESTIMATED_YEAR_NOTE}
                </span>
              </p>
            ) : null}
            {undatedCount > 0 ? (
              <p className={styles.estimatedLegend}>
                <span style={{ background: UNDATED_ERA.color }} />
                <span style={{ color: UNDATED_ERA.color }}>
                  {undatedCount} of {allNodes.length} {UNDATED_NOTE}
                </span>
              </p>
            ) : null}
            <div className={styles.timelineRail} aria-hidden="true">
              {timelineNodes.map((node) => (
                <span key={node.id} style={{ background: node.color }} />
              ))}
            </div>
            <div className={styles.timelineList}>
              {timelineNodes.map((node) => (
                <button
                  key={`timeline-${node.id}`}
                  type="button"
                  className={`${styles.timelineButton} ${selectedNode?.id === node.id ? styles.timelineButtonActive : ""}`}
                  onClick={() => setSelected(node)}
                  title={node.estimated ? ESTIMATED_YEAR_NOTE : node.undated ? UNDATED_NOTE : undefined}
                >
                  <span style={node.estimated || node.undated ? { color: ESTIMATED_YEAR_COLOR } : undefined}>
                    {node.year ?? "undated"}
                    {node.estimated ? "*" : ""}
                  </span>
                  <strong>{node.label}</strong>
                </button>
              ))}
            </div>
          </div>

          {isF5Running ? (
            <div className={styles.pipelineBox}>
              <span>{pipelineMessage || "Building F5 chart table"}</span>
              <strong>{pipelineProgress}%</strong>
              <div className={styles.pipelineTrack}>
                <span style={{ width: `${pipelineProgress}%` }} />
              </div>
            </div>
          ) : null}

          <p className={styles.panelTitle}>Map Sections</p>
          <button
            type="button"
            className={`${styles.eraButton} ${!activeEra ? styles.eraButtonActive : ""}`}
            onClick={() => setActiveEra("")}
          >
            <span className={styles.clusterSwatch} style={{ background: "#f3dfad" }} />
            All map sections
            <strong>{allNodes.length}</strong>
          </button>
          {eraStats.filter((era) => era.count > 0).map((era) => (
            <button
              key={era.id}
              type="button"
              className={`${styles.eraButton} ${String(activeEra) === String(era.id) ? styles.eraButtonActive : ""}`}
              onClick={() => setActiveEra(String(era.id))}
            >
              <span className={styles.clusterSwatch} style={{ background: era.color }} />
              {era.label}
              <strong>{era.count}</strong>
            </button>
          ))}

          <div className={styles.selectedPanel}>
            <p className={styles.panelTitle}>Previous Selected Artwork</p>
            {selectedNode ? (
              <>
                <div className={styles.previewFrame}>
                  {selectedNode.thumb ? (
                    <img src={selectedNode.thumb} alt={selectedNode.label} />
                  ) : (
                    <span>{selectedNode.label}</span>
                  )}
                </div>
                <strong>{selectedNode.label}</strong>
                <span>{selectedNode.artist || selectedNode.era.label}</span>
                <span style={selectedNode.estimated || selectedNode.undated ? { color: ESTIMATED_YEAR_COLOR } : undefined}>
                  {selectedNode.dateLabel}
                  {selectedNode.estimated ? ` · ${ESTIMATED_YEAR_NOTE}` : ""}
                  {selectedNode.undated ? ` · ${UNDATED_NOTE}` : ""}
                  {selectedNode.yearSource === "model_estimate" && typicalYearError
                    ? ` · year head, typical error ±${Math.round(typicalYearError)} yr`
                    : ""}
                  {yearCertaintyBand(selectedNode.yearConfidence)
                    ? ` · ${yearCertaintyBand(selectedNode.yearConfidence)} certainty`
                    : ""}
                </span>
                {selectedPosition ? <span>Chronology position {selectedPosition}</span> : null}
                <div className={styles.scoreRow}>
                  <span>Bridge {Math.round(selectedNode.bridgeScore * 100)}%</span>
                  <span>Signal {Math.round(selectedNode.distinctiveness * 100)}%</span>
                </div>
              </>
            ) : (
              <span>Click an artwork on the parchment map.</span>
            )}
          </div>
      </aside>
    </section>
  );
}
