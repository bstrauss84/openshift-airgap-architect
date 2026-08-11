import { API_BASE_URL, apiFetch } from '../api';

const CHUNK_SIZE_DEFAULT = 40 * 1024 * 1024; // 40 MB
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

export interface ChunkedUploadOptions {
  file: File;
  filename: string;
  pvcName: string;
  pvcSize: string;
  isNewPvc: boolean;
  chunkSize?: number;
  onProgress?: (progress: ChunkedUploadProgress) => void;
  signal?: AbortSignal;
}

export interface ChunkedUploadProgress {
  phase: 'initializing' | 'uploading' | 'finalizing';
  overallPercent: number;
  chunksCompleted: number;
  totalChunks: number;
  bytesUploaded: number;
  totalBytes: number;
  currentChunkPercent: number;
  message: string;
}

export interface ChunkedUploadResult {
  jobId: string;
  uploadId: string;
  filename: string;
}

function uploadChunkXHR(
  url: string,
  blob: Blob,
  signal?: AbortSignal,
  onProgress?: (loaded: number, total: number) => void,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const onAbort = () => xhr.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      xhr.addEventListener('loadend', () => signal.removeEventListener('abort', onAbort), { once: true });
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          resolve(xhr.responseText);
        }
      } else {
        reject(new Error(`Chunk upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during chunk upload'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));

    xhr.send(blob);
  });
}

async function uploadChunkWithRetry(
  url: string,
  blob: Blob,
  signal?: AbortSignal,
  onProgress?: (loaded: number, total: number) => void,
): Promise<any> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await uploadChunkXHR(url, blob, signal, onProgress);
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

export async function chunkedUpload(options: ChunkedUploadOptions): Promise<ChunkedUploadResult> {
  const { file, filename, pvcName, pvcSize, isNewPvc, signal, onProgress } = options;
  const chunkSize = options.chunkSize || CHUNK_SIZE_DEFAULT;

  onProgress?.({
    phase: 'initializing', overallPercent: 0,
    chunksCompleted: 0, totalChunks: 0,
    bytesUploaded: 0, totalBytes: file.size,
    currentChunkPercent: 0, message: 'Initializing upload...',
  });

  const initResponse = await apiFetch('/api/mirror-import/upload/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, fileSize: file.size, chunkSize, pvcName, pvcSize, isNewPvc }),
  });

  const { uploadId, jobId, totalChunks } = initResponse;
  const startChunk = initResponse.receivedChunks || 0;
  let bytesUploaded = startChunk * chunkSize;

  for (let i = startChunk; i < totalChunks; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const blob = file.slice(start, end);

    const chunkUrl = `${API_BASE_URL}/api/mirror-import/upload/${uploadId}/chunk/${i}`;

    await uploadChunkWithRetry(chunkUrl, blob, signal, (loaded, total) => {
      const chunkPercent = Math.floor((loaded / total) * 100);
      const overallBytes = bytesUploaded + loaded;
      const overallPercent = Math.min(45, Math.floor((overallBytes / file.size) * 45));
      onProgress?.({
        phase: 'uploading',
        overallPercent,
        chunksCompleted: i,
        totalChunks,
        bytesUploaded: overallBytes,
        totalBytes: file.size,
        currentChunkPercent: chunkPercent,
        message: `Uploading chunk ${i + 1} of ${totalChunks} (${formatBytes(overallBytes)} / ${formatBytes(file.size)})`,
      });
    });

    bytesUploaded = Math.min((i + 1) * chunkSize, file.size);
  }

  onProgress?.({
    phase: 'finalizing', overallPercent: 46,
    chunksCompleted: totalChunks, totalChunks,
    bytesUploaded: file.size, totalBytes: file.size,
    currentChunkPercent: 100, message: 'Assembling upload...',
  });

  await apiFetch(`/api/mirror-import/upload/${uploadId}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  return { jobId, uploadId, filename };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
