// Central UI copy + shared labels.
//
// One place for the strings that used to be retyped per scene, so every screen
// reads the same words ("Back", loading messages, dataset wording, …). Import
// from here instead of hardcoding text in a component.

// Full-screen loading messages, keyed by feature/scene.
export const LOADING_MESSAGES = {
  scene: "Loading scene…",
  logbook: "Opening the logbook…",
  history: "Reading the navigator's log…",
  captains: "Reading the captain's log…",
  stars: "Charting the Star Atlas…",
  databases: "Loading databases…",
  cargo: "Loading cargo…",
};

// Messages shown while a background pipeline builds an archive's index.
export const BUILD_MESSAGES = {
  history: "Charting the archive…",
  captains: "Charting the instruments…",
};

// Shared button / control labels.
export const LABELS = {
  back: "Back",
  chartTable: "Chart Table",
  showAllShips: "Show all ships",
  creativity: "Creativity",
  influence: "Influence",
  retry: "Retry",
};
