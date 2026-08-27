import { create } from "zustand";

export const DEFAULT_FILTERS = {
  color: { active: false, value: { hues: [], sat: null, light: null } },
  portrait: { active: false, value: { sector: null, portraitsOnly: false } },
  pose: { active: false, value: null },
  hough: { active: false, value: { intensity: null, directions: [] } },
  origin: { active: false, value: { region: null } },
};

function cloneFilters() {
  return {
    color: { active: false, value: { hues: [], sat: null, light: null } },
    portrait: { active: false, value: { ...DEFAULT_FILTERS.portrait.value } },
    pose: { ...DEFAULT_FILTERS.pose },
    hough: { active: false, value: { intensity: null, directions: [] } },
    origin: { active: false, value: { region: null } },
  };
}

export const useF6Filters = create((set) => ({
  filters: cloneFilters(),
  lastResetAt: 0,
  focusedInstrument: "color",
  indexesByDatabase: {},
  loadingByDatabase: {},
  errorByDatabase: {},
  setFocusedInstrument: (focusedInstrument) => set({ focusedInstrument }),
  setIndexForDatabase: (databaseName, rawIndex) =>
    set((state) => ({
      indexesByDatabase: {
        ...state.indexesByDatabase,
        [databaseName]: rawIndex,
      },
    })),
  setLoadingForDatabase: (databaseName, loading) =>
    set((state) => ({
      loadingByDatabase: {
        ...state.loadingByDatabase,
        [databaseName]: loading,
      },
    })),
  setErrorForDatabase: (databaseName, error) =>
    set((state) => ({
      errorByDatabase: {
        ...state.errorByDatabase,
        [databaseName]: error,
      },
    })),
  setFilter: (key, value, active = true) =>
    set((state) => ({
      filters: {
        ...state.filters,
        [key]: { active, value },
      },
    })),
  clearFilter: (key) =>
    set((state) => ({
      filters: {
        ...state.filters,
        [key]: cloneFilters()[key],
      },
    })),
  clearAll: () => set({ filters: cloneFilters(), lastResetAt: Date.now() }),
}));

export function toFilterValues(filters) {
  return {
    color: filters.color.active ? filters.color.value : { hues: [], sat: null, light: null },
    portrait: filters.portrait.active ? filters.portrait.value : { sector: null, portraitsOnly: false },
    pose: filters.pose.active ? filters.pose.value : null,
    hough: filters.hough.active ? filters.hough.value : { intensity: null, directions: [] },
    origin: filters.origin.active ? filters.origin.value : { region: null },
  };
}
