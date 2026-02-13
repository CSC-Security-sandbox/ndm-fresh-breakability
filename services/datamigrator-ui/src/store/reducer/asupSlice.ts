import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface AsupSliceState {
  enabled: boolean;
  consentGiven: boolean;
  lastUpdated: string | null;
  lastTransmission: string | null;
  isConsentModalOpen: boolean;
}

const STORAGE_KEY = "asup_settings";

// Load initial state from localStorage
const loadInitialState = (): AsupSliceState => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...parsed,
        isConsentModalOpen: false,
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
      localStorage.removeItem(STORAGE_KEY);
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
} = asupSlice.actions;

export default asupSlice.reducer;
