import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface AuthState {
  accessToken: string | null;
  isAuthenticated: boolean;
}

const initialState: AuthState = {
  accessToken: null,
  isAuthenticated: false,
};

export const authSlice = createSlice({
  name: "authSlice",
  initialState,
  reducers: {
    setAuthToken: (state, action: PayloadAction<string | null>) => {
      state.accessToken = action.payload;
      state.isAuthenticated = !!action.payload;
    },
    clearAuth: (state) => {
      state.accessToken = null;
      state.isAuthenticated = false;
    },
  },
});

export const { setAuthToken, clearAuth } = authSlice.actions;
