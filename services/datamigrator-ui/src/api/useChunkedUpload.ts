import { useState, useCallback } from 'react';
import {
  useInitUploadMutation,
  useUploadChunkMutation,
  useFinalizeUploadMutation,
  useCancelUploadMutation,
} from '@api/upgradeApi';

interface UploadProgress {
  status: 'idle' | 'hashing' | 'uploading' | 'finalizing' | 'complete' | 'error' | 'cancelled';
  progress: number;           // 0-100
  currentChunk: number;
  totalChunks: number;
  uploadedBytes: number;
  totalBytes: number;
  error?: string;
}

const CHUNK_SIZE = 100 * 1024 * 1024; // 100MB - must match backend

export function useChunkedUpload() {
  const [progress, setProgress] = useState<UploadProgress>({
    status: 'idle',
    progress: 0,
    currentChunk: 0,
    totalChunks: 0,
    uploadedBytes: 0,
    totalBytes: 0,
  });

  const [initUpload] = useInitUploadMutation();
  const [uploadChunk] = useUploadChunkMutation();
  const [finalizeUpload] = useFinalizeUploadMutation();
  const [cancelUpload] = useCancelUploadMutation();

  // ═══════════════════════════════════════════════════════════════
  // Calculate SHA256 checksum of the entire file
  // Uses Web Crypto API (available in all modern browsers)
  // ═══════════════════════════════════════════════════════════════
  const calculateChecksum = useCallback(async (file: File): Promise<string> => {
    setProgress(prev => ({ ...prev, status: 'hashing' }));
    
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hashHex;
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // Main upload function
  // ═══════════════════════════════════════════════════════════════
  const upload = useCallback(async (file: File) => {
    try {
      // Validate file type
      if (!file.name.match(/\.(tar\.gz|zip)$/)) {
        throw new Error('File must be .tar.gz or .zip');
      }

      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      
      setProgress({
        status: 'hashing',
        progress: 0,
        currentChunk: 0,
        totalChunks,
        uploadedBytes: 0,
        totalBytes: file.size,
      });

      // Step 1: Calculate checksum
      const checksum = await calculateChecksum(file);

      // Step 2: Initialize upload session
      const initResult = await initUpload({
        fileName: file.name,
        fileSize: file.size,
        checksum,
      }).unwrap();

      const { uploadId } = initResult;

      setProgress(prev => ({ ...prev, status: 'uploading' }));

      // Step 3: Upload chunks sequentially
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        
        // File.slice() creates a Blob without loading entire file into memory
        const chunkBlob = file.slice(start, end);

        await uploadChunk({
          uploadId,
          chunkIndex: i,
          chunkData: chunkBlob,
        }).unwrap();

        setProgress(prev => ({
          ...prev,
          currentChunk: i + 1,
          uploadedBytes: end,
          progress: Math.round(((i + 1) / totalChunks) * 100),
        }));
      }

      // Step 4: Finalize
      setProgress(prev => ({ ...prev, status: 'finalizing' }));
      
      const result = await finalizeUpload(uploadId).unwrap();

      setProgress(prev => ({ 
        ...prev, 
        status: 'complete',
        progress: 100,
      }));

      return result;

    } catch (error: any) {
      setProgress(prev => ({
        ...prev,
        status: 'error',
        error: error.message || 'Upload failed',
      }));
      throw error;
    }
  }, [initUpload, uploadChunk, finalizeUpload, calculateChecksum]);

  // Cancel handler
  const cancel = useCallback(async (uploadId: string) => {
    await cancelUpload(uploadId);
    setProgress(prev => ({ ...prev, status: 'cancelled' }));
  }, [cancelUpload]);

  // Reset state
  const reset = useCallback(() => {
    setProgress({
      status: 'idle',
      progress: 0,
      currentChunk: 0,
      totalChunks: 0,
      uploadedBytes: 0,
      totalBytes: 0,
    });
  }, []);

  return {
    upload,
    cancel,
    reset,
    progress,
  };
}