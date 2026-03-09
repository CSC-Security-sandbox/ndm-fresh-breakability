import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type BackgroundUploadStatus =
  | "idle"
  | "uploading"
  | "finalizing"
  | "uploaded"
  | "error"
  | "validation_failed"
  | "cancelled";

export interface BackgroundUploadState {
  status: BackgroundUploadStatus;
  progress: number;
  fileName: string;
  uploadId: string;
  bundleId: string;
  totalBytes: number;
  uploadedBytes: number;
  currentChunk: number;
  totalChunks: number;
  error: string;
}

const initialState: BackgroundUploadState = {
  status: "idle",
  progress: 0,
  fileName: "",
  uploadId: "",
  bundleId: "",
  totalBytes: 0,
  uploadedBytes: 0,
  currentChunk: 0,
  totalChunks: 0,
  error: "",
};

export const uploadSlice = createSlice({
  name: "uploadSlice",
  initialState,
  reducers: {
    setUploadStarted(
      state,
      action: PayloadAction<{
        fileName: string;
        totalBytes: number;
        uploadId: string;
        totalChunks: number;
      }>
    ) {
      state.status = "uploading";
      state.progress = 0;
      state.fileName = action.payload.fileName;
      state.totalBytes = action.payload.totalBytes;
      state.uploadId = action.payload.uploadId;
      state.totalChunks = action.payload.totalChunks;
      state.currentChunk = 0;
      state.uploadedBytes = 0;
      state.error = "";
      state.bundleId = "";
    },
    setUploadProgress(
      state,
      action: PayloadAction<{ uploadedBytes: number; progress: number; currentChunk: number }>
    ) {
      state.uploadedBytes = action.payload.uploadedBytes;
      state.progress = action.payload.progress;
      state.currentChunk = action.payload.currentChunk;
    },
    setUploadFinalizing(state) {
      state.status = "finalizing";
    },
    setUploadCompleted(
      state,
      action: PayloadAction<{ bundleId: string }>
    ) {
      state.status = "uploaded";
      state.progress = 100;
      state.bundleId = action.payload.bundleId;
      state.uploadedBytes = state.totalBytes;
    },
    setUploadFailed(state, action: PayloadAction<{ error: string; status?: BackgroundUploadStatus }>) {
      state.status = action.payload.status || "error";
      state.error = action.payload.error;
    },
    setUploadCancelled(state) {
      state.status = "cancelled";
    },
    resetUploadState() {
      return initialState;
    },
  },
});

export const {
  setUploadStarted,
  setUploadProgress,
  setUploadFinalizing,
  setUploadCompleted,
  setUploadFailed,
  setUploadCancelled,
  resetUploadState,
} = uploadSlice.actions;
