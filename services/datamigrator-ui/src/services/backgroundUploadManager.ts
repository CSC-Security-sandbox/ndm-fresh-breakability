import { store } from "@store/store";
import {
  setUploadStarted,
  setUploadProgress,
  setUploadFinalizing,
  setUploadCompleted,
  setUploadFailed,
  setUploadCancelled,
  resetUploadState,
} from "@store/reducer/uploadSlice";

const CHUNK_SIZE = 15 * 1024 * 1024; // 15MB
const PARALLEL_UPLOADS = 5;
const MAX_FILE_SIZE = 20 * 1024 * 1024 * 1024; // 20GB
const ALLOWED_EXTENSION = ".tar.gz";

function getBaseUrl(): string {
  return (
    (window as any)?.env?.VITE_ADMIN_SERVICE_URL ||
    import.meta.env.VITE_ADMIN_SERVICE_URL ||
    ""
  );
}

function getAuthHeaders(): Record<string, string> {
  const state = store.getState();
  const token = (state as any).authSlice?.accessToken;
  const projectId = localStorage.getItem("selected_project_id");
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
    headers["projectId"] = projectId || "";
  }
  return headers;
}

let abortController: AbortController | null = null;

function validateFile(file: File): { valid: boolean; error?: string } {
  if (!file.name.toLowerCase().endsWith(ALLOWED_EXTENSION)) {
    return { valid: false, error: `Only ${ALLOWED_EXTENSION} files are supported.` };
  }
  if (!file.name.match(/^upgrade-.+\.tar\.gz$/i)) {
    return { valid: false, error: "Expected filename: upgrade-{version}.tar.gz" };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large. Maximum: ${MAX_FILE_SIZE / (1024 * 1024 * 1024)}GB` };
  }
  if (file.size < 1 * 1024 * 1024) {
    return { valid: false, error: "File is smaller than 1MB." };
  }
  return { valid: true };
}

export async function startBackgroundUpload(file: File): Promise<void> {
  const validation = validateFile(file);
  if (!validation.valid) {
    store.dispatch(setUploadFailed({ error: validation.error! }));
    return;
  }

  if (abortController) {
    abortController.abort();
    const prevUploadId = (store.getState() as any).uploadSlice?.uploadId;
    if (prevUploadId) {
      const baseUrl = getBaseUrl();
      fetch(`${baseUrl}/upgrade/cancel-upload/${prevUploadId}`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      }).catch(() => { /* best effort */ });
    }
  }

  abortController = new AbortController();
  const signal = abortController.signal;
  const baseUrl = getBaseUrl();
  let uploadId = "";

  try {
    const initRes = await fetch(`${baseUrl}/upgrade/init`, {
      method: "POST",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
      signal,
    });
    if (!initRes.ok) {
      const body = await initRes.json().catch(() => ({}));
      throw new Error(body?.message || `Init failed: ${initRes.status}`);
    }
    const initData = await initRes.json();
    const parsed = initData?.data?.items || initData?.data || initData;
    uploadId = parsed.uploadId;
    const totalChunks: number = parsed.totalChunks;

    store.dispatch(setUploadStarted({ fileName: file.name, totalBytes: file.size, uploadId, totalChunks }));

    const chunkIndices = Array.from({ length: totalChunks }, (_, i) => i);
    let completedChunks = 0;
    let uploadAborted = false;

    const uploadSingleChunk = async (chunkIndex: number) => {
      if (uploadAborted || signal.aborted) throw new Error("Upload cancelled");
      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const blob = file.slice(start, end);

      const res = await fetch(`${baseUrl}/upgrade/chunk-upload/${uploadId}`, {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/octet-stream",
          "X-Chunk-Index": String(chunkIndex),
        },
        body: blob,
        signal,
      });
      if (!res.ok) {
        uploadAborted = true;
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Chunk ${chunkIndex} failed: ${res.status}`);
      }

      completedChunks++;
      store.dispatch(
        setUploadProgress({
          uploadedBytes: Math.min(completedChunks * CHUNK_SIZE, file.size),
          progress: Math.round((completedChunks / totalChunks) * 100),
          currentChunk: completedChunks,
        })
      );
    };

    const executing: Promise<void>[] = [];
    for (const idx of chunkIndices) {
      if (uploadAborted || signal.aborted) break;
      const p = uploadSingleChunk(idx).then(() => {
        const i = executing.indexOf(p);
        if (i > -1) executing.splice(i, 1);
      }).catch((err) => {
        const i = executing.indexOf(p);
        if (i > -1) executing.splice(i, 1);
        throw err;
      });
      executing.push(p);
      if (executing.length >= PARALLEL_UPLOADS) {
        await Promise.race(executing);
      }
    }
    if (executing.length > 0) await Promise.all(executing);

    store.dispatch(setUploadFinalizing());

    const processRes = await fetch(`${baseUrl}/upgrade/process-upload/${uploadId}`, {
      method: "POST",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      signal,
    });
    if (!processRes.ok) {
      const body = await processRes.json().catch(() => ({}));
      throw new Error(body?.message || `Processing failed: ${processRes.status}`);
    }
    const processData = await processRes.json();
    const result = processData?.data?.items || processData?.data || processData;

    if (result.success === false) {
      const errors: string[] = result.errors || [];
      const summary = errors.length > 0 ? errors.join("\n") : result.message || "Processing failed";
      const isValidation = errors.length > 0 || result.message?.toLowerCase().includes("checksum");
      store.dispatch(setUploadFailed({ error: summary, status: isValidation ? "validation_failed" : "error" }));
      return;
    }

    store.dispatch(setUploadCompleted({ bundleId: result.bundleId }));
  } catch (err: any) {
    if (uploadId) {
      try {
        await fetch(`${baseUrl}/upgrade/cancel-upload/${uploadId}`, {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        });
      } catch { /* best effort */ }
    }

    if (signal.aborted) {
      store.dispatch(setUploadCancelled());
      return;
    }

    const msg =
      !err?.message || err.message === "Failed to fetch"
        ? "Network error. Please check your connection and try again."
        : err.message;
    store.dispatch(setUploadFailed({ error: msg }));
  } finally {
    abortController = null;
  }
}

export function cancelBackgroundUpload(): void {
  const uploadId = (store.getState() as any).uploadSlice?.uploadId;
  if (abortController) {
    abortController.abort();
  }
  store.dispatch(setUploadCancelled());

  if (uploadId) {
    const baseUrl = getBaseUrl();
    fetch(`${baseUrl}/upgrade/cancel-upload/${uploadId}`, {
      method: "POST",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    }).catch(() => { /* best effort */ });
  }
}

export function resetBackgroundUpload(): void {
  if (abortController) {
    abortController.abort();
  }
  store.dispatch(resetUploadState());
}

export function isBackgroundUploadActive(): boolean {
  const state = store.getState() as any;
  return ["uploading", "finalizing"].includes(state.uploadSlice?.status);
}
