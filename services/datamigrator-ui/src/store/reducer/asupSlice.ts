import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface AsupSliceState {
  enabled: boolean;
  consentGiven: boolean;
  lastUpdated: string | null;
  lastTransmission: string | null;
  isConsentModalOpen: boolean;
  isInitialized: boolean;  // Track if settings have been fetched from backend
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
        consentGiven: parsed.consentGiven ?? false,
        lastUpdated: parsed.lastUpdated ?? null,
        lastTransmission: parsed.lastTransmission ?? null,
        isConsentModalOpen: false,
        isInitialized: parsed.isInitialized ?? false,
      };
    }
  } catch (e) {
    console.error("Failed to load ASUP settings from localStorage", e);
  }
  return {
    enabled: false,
    consentGiven: false,
    lastUpdated: null,
    lastTransmission: null,
    isConsentModalOpen: false,
    isInitialized: false,
  };
};

const initialState: AsupSliceState = loadInitialState();

export const asupSlice = createSlice({
  name: "asupSlice",
  initialState,
  reducers: {
    setAsupEnabled: (state, action: PayloadAction<boolean>) => {
      state.enabled = action.payload;
      state.lastUpdated = new Date().toISOString();
      // Persist to localStorage
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          enabled: state.enabled,
          consentGiven: state.consentGiven,
          lastUpdated: state.lastUpdated,
          lastTransmission: state.lastTransmission,
        })
      );
    },
    setAsupConsent: (state, action: PayloadAction<boolean>) => {
      state.consentGiven = action.payload;
      state.lastUpdated = new Date().toISOString();
      // If consent is revoked, also disable ASUP
      if (!action.payload) {
        state.enabled = false;
      }
      // Persist to localStorage
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          enabled: state.enabled,
          consentGiven: state.consentGiven,
          lastUpdated: state.lastUpdated,
          lastTransmission: state.lastTransmission,
        })
      );
    },
    setLastTransmission: (state, action: PayloadAction<string>) => {
      state.lastTransmission = action.payload;
      // Persist to localStorage
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          enabled: state.enabled,
          consentGiven: state.consentGiven,
          lastUpdated: state.lastUpdated,
          lastTransmission: state.lastTransmission,
        })
      );
    },
    openConsentModal: (state) => {
      state.isConsentModalOpen = true;
    },
    closeConsentModal: (state) => {
      state.isConsentModalOpen = false;
    },
    resetAsupSettings: (state) => {
      state.enabled = false;
      state.consentGiven = false;
      state.lastUpdated = null;
      state.lastTransmission = null;
      state.isConsentModalOpen = false;
      state.isInitialized = false;
      localStorage.removeItem(STORAGE_KEY);
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
        consentGiven: boolean;
        lastUpdated?: string;
        lastTransmission?: string;
      }>
    ) => {
      // Backend settings take precedence
      state.enabled = action.payload.enabled;
      state.consentGiven = action.payload.consentGiven;
      state.lastUpdated = action.payload.lastUpdated || state.lastUpdated;
      state.lastTransmission = action.payload.lastTransmission || state.lastTransmission;
      state.isInitialized = true;
      // Persist to localStorage as cache
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          enabled: state.enabled,
          consentGiven: state.consentGiven,
          lastUpdated: state.lastUpdated,
          lastTransmission: state.lastTransmission,
          isInitialized: state.isInitialized,
        })
      );
    },
  },
});

export const {
  setAsupEnabled,
  setAsupConsent,
  setLastTransmission,
  openConsentModal,
  closeConsentModal,
  resetAsupSettings,
  syncAsupSettings,
} = asupSlice.actions;

export default asupSlice.reducer;
