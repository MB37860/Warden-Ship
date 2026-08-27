const SERIF = "'Palatino Linotype', 'Book Antiqua', Palatino, serif";

function seededNoise(index) {
  const x = Math.sin(index * 999.41) * 10000;
  return x - Math.floor(x);
}

function paperBase(ctx, canvas, darkEdges = true) {
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#f5e6c8");
  gradient.addColorStop(0.54, "#d7ba7b");
  gradient.addColorStop(1, "#f0d9a8");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 140; i += 1) {
    ctx.fillStyle = `rgba(71,43,16,${0.03 + seededNoise(i) * 0.08})`;
    ctx.beginPath();
    ctx.arc(seededNoise(i + 11) * canvas.width, seededNoise(i + 22) * canvas.height, 0.5 + seededNoise(i + 33) * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (darkEdges) {
    const edge = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.width * 0.1, canvas.width / 2, canvas.height / 2, canvas.width * 0.72);
    edge.addColorStop(0, "rgba(0,0,0,0)");
    edge.addColorStop(1, "rgba(60,32,10,0.28)");
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

export function drawWoodGrainTexture(ctx, canvas) {
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, "#120803");
  gradient.addColorStop(0.34, "#30180a");
  gradient.addColorStop(0.5, "#1a0f07");
  gradient.addColorStop(0.68, "#43240f");
  gradient.addColorStop(1, "#160904");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let x = 0; x < canvas.width; x += 9) {
    ctx.strokeStyle = `rgba(255,198,106,${0.03 + (x % 23) / 900})`;
    ctx.lineWidth = 1 + (x % 7);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= canvas.height; y += 24) {
      ctx.lineTo(x + Math.sin(y * 0.035 + x * 0.13) * 10, y);
    }
    ctx.stroke();
  }
}

export function drawClothSwatch(ctx, canvas, color, label) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 7) {
    ctx.strokeStyle = `rgba(255,255,255,${0.035 + (y % 3) * 0.02})`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y + Math.sin(y * 0.2) * 3);
    ctx.stroke();
  }
  for (let x = 0; x < canvas.width; x += 8) {
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + Math.sin(x) * 2, canvas.height);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(245,230,200,0.9)";
  ctx.fillRect(18, canvas.height - 48, canvas.width - 36, 34);
  ctx.fillStyle = "#1a0a00";
  ctx.font = `700 20px ${SERIF}`;
  ctx.textAlign = "center";
  ctx.fillText(label.toUpperCase(), canvas.width / 2, canvas.height - 25);
}

export function drawPuppetFace(ctx, canvas) {
  ctx.fillStyle = "#c8a87a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 9) {
    ctx.strokeStyle = `rgba(96,58,24,${0.06 + (y % 4) * 0.02})`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(canvas.width * 0.3, y + 10, canvas.width * 0.68, y - 7, canvas.width, y + 4);
    ctx.stroke();
  }
  ctx.strokeStyle = "#3a1a00";
  ctx.fillStyle = "#3a1a00";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(canvas.width * 0.5, canvas.height * 0.18, canvas.width * 0.25, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(canvas.width * 0.36, canvas.height * 0.42, 16, 26, -0.12, 0, Math.PI * 2);
  ctx.ellipse(canvas.width * 0.64, canvas.height * 0.42, 16, 26, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(canvas.width * 0.5, canvas.height * 0.43);
  ctx.lineTo(canvas.width * 0.47, canvas.height * 0.62);
  ctx.lineTo(canvas.width * 0.53, canvas.height * 0.62);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(canvas.width * 0.38, canvas.height * 0.75);
  ctx.quadraticCurveTo(canvas.width * 0.5, canvas.height * 0.8, canvas.width * 0.62, canvas.height * 0.75);
  ctx.stroke();
}

function globePoint(canvas, longitude, latitude) {
  return [
    ((longitude + 180) / 360) * canvas.width,
    ((90 - latitude) / 180) * canvas.height,
  ];
}

function drawLandmass(ctx, canvas, points) {
  if (!points.length) return;
  const [startX, startY] = globePoint(canvas, points[0][0], points[0][1]);
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  points.slice(1).forEach(([longitude, latitude]) => {
    const [x, y] = globePoint(canvas, longitude, latitude);
    ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

export function drawGlobeMap(ctx, canvas) {
  const ocean = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  ocean.addColorStop(0, "#15384b");
  ocean.addColorStop(0.48, "#245f72");
  ocean.addColorStop(1, "#102b3c");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(240, 214, 144, 0.22)";
  ctx.lineWidth = 2;
  for (let longitude = -150; longitude <= 150; longitude += 30) {
    const [x] = globePoint(canvas, longitude, 0);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let latitude = -60; latitude <= 60; latitude += 30) {
    const [, y] = globePoint(canvas, 0, latitude);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#8aa35b";
  ctx.strokeStyle = "#5f6f35";
  ctx.lineWidth = 4;
  const continents = [
    // North America
    [[-168, 70], [-145, 72], [-124, 66], [-104, 72], [-78, 64], [-58, 52], [-62, 45], [-82, 42], [-97, 25], [-115, 31], [-124, 48], [-140, 58], [-168, 70]],
    // South America
    [[-81, 12], [-67, 10], [-52, 4], [-35, -8], [-42, -23], [-54, -55], [-66, -48], [-74, -20], [-81, 12]],
    // Greenland
    [[-74, 82], [-24, 82], [-18, 60], [-44, 58], [-62, 67], [-74, 82]],
    // Europe + Asia
    [[-12, 36], [2, 44], [20, 58], [44, 70], [76, 72], [108, 63], [142, 56], [160, 50], [148, 36], [118, 22], [102, 8], [78, 8], [66, 24], [48, 28], [34, 34], [16, 38], [-12, 36]],
    // Africa
    [[-18, 35], [8, 37], [34, 31], [51, 11], [43, -12], [28, -35], [10, -35], [-5, -5], [-18, 15], [-18, 35]],
    // Arabia / India
    [[38, 30], [56, 25], [66, 12], [78, 8], [90, 22], [76, 28], [60, 30], [38, 30]],
    // Australia
    [[112, -11], [136, -10], [154, -24], [146, -40], [116, -35], [112, -11]],
    // Antarctica
    [[-180, -72], [-120, -76], [-60, -74], [0, -78], [60, -74], [120, -76], [180, -72], [180, -90], [-180, -90], [-180, -72]],
  ];
  continents.forEach((points) => drawLandmass(ctx, canvas, points));

  ctx.fillStyle = "rgba(214, 191, 128, 0.18)";
  for (let index = 0; index < 90; index += 1) {
    ctx.beginPath();
    ctx.arc(seededNoise(index + 411) * canvas.width, seededNoise(index + 509) * canvas.height, 1 + seededNoise(index + 613) * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawParchmentLabel(ctx, canvas, title, subtitle = "") {
  paperBase(ctx, canvas);
  ctx.strokeStyle = "#5c3d1e";
  ctx.lineWidth = 8;
  ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
  ctx.fillStyle = "#1a0a00";
  ctx.font = `800 42px ${SERIF}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(title || "").toUpperCase(), canvas.width / 2, canvas.height * 0.44);
  if (subtitle) {
    ctx.font = `700 26px ${SERIF}`;
    ctx.fillText(String(subtitle).toUpperCase(), canvas.width / 2, canvas.height * 0.68);
  }
}
