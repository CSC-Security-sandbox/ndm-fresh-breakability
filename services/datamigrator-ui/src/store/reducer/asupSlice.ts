import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface AsupSliceState {
  enabled: boolean;
  lastTransmission: string | null;
}

const STORAGE_KEY = "asup_settings";

// Load initial state from localStorage (used as cache)
const loadInitialState = (): AsupSliceState => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        enabled: parsed.enabled ?? false,
        lastTransmission: parsed.lastTransmission ?? null,
      };
    }
  } catch (e) {
    console.error("Failed to load ASUP settings from localStorage", e);
  }
  return {
    enabled: false,
    lastTransmission: null,
  };
};

const initialState: AsupSliceState = loadInitialState();

export const asupSlice = createSlice({
  name: "asupSlice",
  initialState,
  reducers: {
    setAsupEnabled: (state, action: PayloadAction<boolean>) => {
      state.enabled = action.payload;
      // Persist to localStorage
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          enabled: state.enabled,
          lastTransmission: state.lastTransmission,
        })
      );
    },
    /**
     * Sync ASUP settings from backend.
     * Used on app initialization to load the settings from server.
     * The backend reads from the global_settings table which is populated
     * by Keycloak when the instance creator sets their preference.
     */
    syncAsupSettings: (
      state,
      action: PayloadAction<{
        enabled: boolean;
        lastTransmission?: string;
      }>
    ) => {
      state.enabled = action.payload.enabled;
      state.lastTransmission = action.payload.lastTransmission || state.lastTransmission;
      // Persist to localStorage as cache
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          enabled: state.enabled,
          lastTransmission: state.lastTransmission,
        })
      );
    },
  },
});

export const {
  setAsupEnabled,
  syncAsupSettings,
} = asupSlice.actions;

export default asupSlice.reducer;
