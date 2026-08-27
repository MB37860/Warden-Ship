export const SPRING_CONFIG = { tension: 150, friction: 18, mass: 0.9 };
// Head turn only. The eight-point rose needed pitch for S/SE/SW, and pitch
// cannot be measured from a painted face well enough to defend (see
// portrait_pose.py), so those three sectors matched nothing at all. Ordered
// left to right so cycling the compass sweeps the head the same way.
export const COMPASS_SECTORS = ["W", "NW", "N", "NE", "E"];

// Only the upper body survives the detector. Measured over 100 paintings:
// 20 yield a skeleton at all, 14 have even one visible wrist, and just 7 have a
// visible lower body — so five of the old eight tiles (standing, seated,
// kneeling, striding, fallen) were describing legs MediaPipe had invented below
// the frame. What is left are the three arm positions the data can carry, and a
// painting now gets exactly one of them instead of answering yes to several.
export const POSE_PRESETS = [
  ["armsRaised", "Arms Raised"],
  ["armsOut", "Arms Out"],
  ["armsDown", "Arms Lowered"],
];

// Each painting now carries a share for all three bands rather than one label,
// so "mixed" has nothing to select: choosing no direction is the neutral state.
export const WAVE_DIRECTIONS = [
  ["vertical", "|||"],
  ["diagonal", "///"],
  ["horizontal", "==="],
];

export const SATURATION_LEVELS = ["muted", "medium", "vivid"];
export const LIGHTNESS_LEVELS = ["dark", "medium", "bright"];

export const CAPTAINS_OBJECTS = [
  { id: "color", name: "Dye Swatches", defaultValue: { hues: [], sat: null, light: null } },
  { id: "portrait", name: "Carved Head", defaultValue: { sector: "N", portraitsOnly: true } },
  { id: "pose", name: "Lay Figure", defaultValue: "armsDown" },
  { id: "hough", name: "Star Chart", defaultValue: { intensity: 5, directions: [] } },
];

// Continents the globe cycles through. These must match the regions the F6
// pipeline derives from the artist's nationality (see NATION_TO_REGION).
export const ORIGIN_REGIONS = ["europe", "americas", "asia", "africa", "oceania"];

export const FEATURE_NAMES = {
  color: "Dye Swatches",
  portrait: "Carved Head",
  pose: "Lay Figure",
  hough: "Line Structure",
};

export const BRASS_MATERIAL = {
  color: "#b8860b",
  metalness: 0.85,
  roughness: 0.25,
};

export const DARK_IRON_MATERIAL = {
  color: "#2a2a2a",
  metalness: 0.9,
  roughness: 0.4,
};

export const WOOD_MATERIAL = {
  color: "#1a0f07",
  roughness: 0.7,
  metalness: 0,
  emissive: "#1a0800",
  emissiveIntensity: 0.08,
};

export const CORK_MATERIAL = {
  color: "#3d2b1a",
  roughness: 0.7,
  metalness: 0,
  emissive: "#1a0a00",
  emissiveIntensity: 0.08,
};

export const WAX_MATERIAL = {
  color: "#8b0000",
  roughness: 0.6,
  metalness: 0.1,
};

export const PALE_WOOD_MATERIAL = {
  color: "#d4aa70",
  roughness: 0.65,
  metalness: 0,
  emissive: "#2a1a05",
  emissiveIntensity: 0.15,
};

// Colour families, not shades: [name, cloth colour, hue anchor]. The board used
// to carry twelve dyes, which asked the user to tell deep blue from indigo from
// ink violet — three cloths holding 13, 10 and 16 of the 100-painting mixed set
// between them, and four more splitting one ochre band. A painting is filed
// under the family its colour is nearest to, so the six divide the whole hue
// circle between them and every one of the fifteen two-cloth combinations
// returns something on that collection.
export const SWATCHES = [
  ["red", "#951818", 0.0],
  ["orange", "#a95519", 0.07],
  ["yellow", "#c5ab20", 0.14],
  ["green", "#337722", 0.3],
  ["blue", "#1d5487", 0.58],
  ["purple", "#693177", 0.8],
];
