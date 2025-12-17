import { createReadStream } from "fs";
import { stat, unlink, open } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import { config } from "../config.js";

const execAsync = promisify(exec);

// Constants for upload configuration
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
const MAX_RETRIES = 5; // Increased from 3 for better reliability
const MAX_SESSION_RESTARTS = 3; // Increased from 2
const TUS_THRESHOLD_MB = 10; // Use TUS for files larger than 10MB
const RETRY_BASE_DELAY_MS = 1000; // Start with 1s delay
const MAX_RETRY_DELAY_MS = 30000; // Cap at 30s

export interface UploadOptions {
  filename: string;
  mimeType: string;
  language: string;
  summarizationType: "lecture" | "custdev";
  title?: string;
}

export interface UploadResult {
  success: boolean;
  lectureId?: string;
  error?: string;
  errorCode?: string;
  isRateLimited?: boolean;
}

/**
 * Check if an error indicates the upload session has expired or is corrupted
 * This is critical for handling Cloud Run restarts and GCS metadata issues
 */
function isSessionExpiredError(statusCode: number, errorText: string): boolean {
  // 404 always means session not found
  if (statusCode === 404) return true;

  // Check error text for various session expiration indicators
  const sessionExpiredPatterns = [
    'UPLOAD_NOT_FOUND',
    'expired',
    'corrupted',
    'Something went wrong',
    'not found',
    'No such object',
    'metadata',
    'does not exist',
    'invalid upload',
    'session',
  ];

  const lowerErrorText = errorText.toLowerCase();
  return sessionExpiredPatterns.some(pattern =>
    lowerErrorText.includes(pattern.toLowerCase())
  );
}

/**
 * Calculate retry delay with exponential backoff and jitter
 */
function getRetryDelay(retryCount: number): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at 30s)
  const exponentialDelay = RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
  const cappedDelay = Math.min(exponentialDelay, MAX_RETRY_DELAY_MS);
  // Add jitter (±25%) to prevent thundering herd
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(cappedDelay + jitter);
}

class UploadService {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Upload a file from a URL (e.g., Telegram file URL) to the backend
   * This downloads the file and uploads it using multipart/form-data
   * Only used for small files from Telegram Cloud API
   */
  async uploadFromUrl(
    accessToken: string,
    fileUrl: string,
    options: UploadOptions
  ): Promise<UploadResult> {
    try {
      // First, download the file from Telegram
      console.log("Downloading file from:", fileUrl);
      const fileResponse = await fetch(fileUrl);

      if (!fileResponse.ok) {
        return {
          success: false,
          error: "Failed to download file from Telegram: " + fileResponse.status,
        };
      }

      const fileBuffer = await fileResponse.arrayBuffer();
      const fileBlob = new Blob([fileBuffer], { type: options.mimeType });

      console.log("File downloaded, size:", fileBlob.size, "bytes");

      // Create form data for upload
      const formData = new FormData();
      formData.append("file", fileBlob, options.filename);
      formData.append("language", options.language);
      formData.append("summarizationType", options.summarizationType);
      if (options.title) {
        formData.append("title", options.title);
      }

      // Upload to backend using simple upload endpoint
      const uploadUrl = this.baseUrl + "/api/v1/lectures/upload";
      console.log("Uploading to:", uploadUrl);

      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken,
        },
        body: formData,
      });

      const responseText = await uploadResponse.text();
      console.log("Upload response status:", uploadResponse.status);
      console.log("Upload response:", responseText);

      if (!uploadResponse.ok) {
        let errorMsg = "Upload failed with status " + uploadResponse.status;
        let errorCode: string | undefined;
        let isRateLimited = false;

        // Check for rate limiting (429 status)
        if (uploadResponse.status === 429) {
          isRateLimited = true;
          errorCode = "RATE_LIMITED";
          errorMsg = "Too many uploads. Please wait before uploading more files.";
        }

        try {
          const errorData = JSON.parse(responseText);
          errorCode = errorData.error?.code || errorCode;
          errorMsg = errorData.error?.message || errorData.message || errorMsg;

          // Also check error code for rate limit
          if (errorCode === "UPLOAD_RATE_LIMIT_EXCEEDED" || errorCode === "RATE_LIMIT_EXCEEDED") {
            isRateLimited = true;
          }
        } catch {
          // Keep default error message
        }

        return {
          success: false,
          error: errorMsg,
          errorCode,
          isRateLimited,
        };
      }

      const data = JSON.parse(responseText);
      return {
        success: true,
        lectureId: data.data?.lecture?.id || data.lectureId || data.id,
      };
    } catch (error) {
      console.error("Upload service error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown upload error",
      };
    }
  }

  /**
   * Upload a file from Local Bot API server using streaming
   * Supports multiple file access methods:
   * 1. Direct file access (Railway/Docker - same container)
   * 2. Mounted volume (Linux/Mac local dev)
   * 3. Docker cp fallback (Windows local dev)
   *
   * OPTIMIZED: Uses streaming for large files to minimize memory usage
   * Files are automatically cleaned up after successful upload to save disk space.
   */
  async uploadFromLocalPath(
    accessToken: string,
    filePath: string,
    options: UploadOptions,
    botToken?: string,
    localApiUrl?: string,
    onProgress?: (percent: number) => void
  ): Promise<UploadResult> {
    // Track the actual file path for cleanup later
    let actualFilePath: string | null = null;
    let tempFilePath: string | null = null;

    try {
      // Resolve the actual file path
      const resolvedPath = await this.resolveFilePath(filePath, botToken, localApiUrl);

      if (!resolvedPath.success) {
        return {
          success: false,
          error: resolvedPath.error || "Failed to access file",
        };
      }

      actualFilePath = resolvedPath.actualPath!;
      tempFilePath = resolvedPath.tempPath || null;

      // Get file stats
      const fileStats = await stat(actualFilePath);
      const fileSizeMB = fileStats.size / 1024 / 1024;
      console.log(`File ready: ${actualFilePath}, size: ${fileStats.size} bytes (${fileSizeMB.toFixed(1)} MB)`);

      let result: UploadResult;

      if (fileSizeMB > TUS_THRESHOLD_MB) {
        // Use streaming TUS chunked upload for large files
        console.log(`Using streaming TUS chunked upload (file > ${TUS_THRESHOLD_MB}MB)`);
        result = await this.uploadWithTusStreaming(
          accessToken,
          actualFilePath,
          fileStats.size,
          options,
          onProgress
        );
      } else {
        // Use simple upload for small files (can load into memory)
        console.log("Using simple upload (small file)");
        result = await this.uploadSmallFile(accessToken, actualFilePath, options);
      }

      // Only clean up if upload succeeded
      if (!result.success) {
        return result;
      }

      // Clean up files after successful upload
      await this.cleanupFiles(actualFilePath, tempFilePath, filePath);

      return result;
    } catch (error) {
      console.error("Local file upload error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown upload error",
      };
    }
  }

  /**
   * Resolve the actual file path, handling different access methods
   */
  private async resolveFilePath(
    filePath: string,
    botToken?: string,
    localApiUrl?: string
  ): Promise<{ success: boolean; actualPath?: string; tempPath?: string; error?: string }> {
    // Method 1: Try direct file access (for Railway where both services run in same container)
    if (filePath.startsWith("/var/lib/telegram-bot-api/")) {
      console.log("Trying direct file access:", filePath);
      try {
        await stat(filePath);
        console.log("Direct access successful");
        return { success: true, actualPath: filePath };
      } catch (directError) {
        console.log("Direct file access failed, trying other methods...");

        // Method 2: Try mounted volume on host (Linux/Mac local dev)
        const hostFilesPath = config.localBotApiFilesPath;
        if (hostFilesPath) {
          const relativePath = filePath.replace("/var/lib/telegram-bot-api/", "");
          const hostPath = path.join(hostFilesPath, relativePath);

          console.log("Trying mounted volume:", hostPath);
          try {
            await stat(hostPath);
            console.log("Mounted volume access successful");
            return { success: true, actualPath: hostPath };
          } catch (mountError) {
            console.log("Mounted volume not accessible, trying docker cp...");
          }
        }

        // Method 3: Docker cp fallback (Windows local dev)
        const tempFile = path.join(os.tmpdir(), `telegram-file-${Date.now()}.tmp`);
        try {
          const containerPath = `telegram-bot-api:${filePath}`;
          console.log(`Running: docker cp "${containerPath}" "${tempFile}"`);
          await execAsync(`docker cp "${containerPath}" "${tempFile}"`);
          console.log("Docker cp successful");
          return { success: true, actualPath: tempFile, tempPath: tempFile };
        } catch (dockerError) {
          console.error("All file access methods failed");
          return { success: false, error: `Failed to access file: ${filePath}` };
        }
      }
    } else {
      // Non-standard path, try HTTP download as fallback
      const apiUrl = localApiUrl || config.localBotApiUrl;
      const token = botToken || config.botToken;
      const fileUrl = `${apiUrl}/file/bot${token}/${filePath}`;

      console.log("Downloading from Local Bot API:", fileUrl);
      const tempFile = path.join(os.tmpdir(), `telegram-file-${Date.now()}.tmp`);

      try {
        const fileResponse = await fetch(fileUrl);
        if (!fileResponse.ok) {
          return {
            success: false,
            error: `Failed to download file from Local Bot API: ${fileResponse.status}`,
          };
        }

        // Stream download to temp file
        const { createWriteStream } = await import("fs");
        const writeStream = createWriteStream(tempFile);
        const reader = fileResponse.body?.getReader();

        if (!reader) {
          return { success: false, error: "Failed to get response body reader" };
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          writeStream.write(Buffer.from(value));
        }

        await new Promise<void>((resolve, reject) => {
          writeStream.on("finish", resolve);
          writeStream.on("error", reject);
          writeStream.end();
        });

        console.log("Download complete");
        return { success: true, actualPath: tempFile, tempPath: tempFile };
      } catch (error) {
        return {
          success: false,
          error: `Failed to download file: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }
    }
  }

  /**
   * Upload a small file using simple multipart upload
   */
  private async uploadSmallFile(
    accessToken: string,
    filePath: string,
    options: UploadOptions
  ): Promise<UploadResult> {
    // For small files, loading into memory is acceptable
    const chunks: Buffer[] = [];
    const stream = createReadStream(filePath);
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const fileBuffer = Buffer.concat(chunks);

    const fileBlob = new Blob([fileBuffer], { type: options.mimeType });

    const formData = new FormData();
    formData.append("file", fileBlob, options.filename);
    formData.append("language", options.language);
    formData.append("summarizationType", options.summarizationType);
    if (options.title) {
      formData.append("title", options.title);
    }

    const uploadUrl = this.baseUrl + "/api/v1/lectures/upload";
    console.log("Uploading to:", uploadUrl);

    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
      },
      body: formData,
    });

    const responseText = await uploadResponse.text();
    console.log("Upload response status:", uploadResponse.status);

    if (!uploadResponse.ok) {
      return this.parseUploadError(uploadResponse.status, responseText);
    }

    const data = JSON.parse(responseText);
    return {
      success: true,
      lectureId: data.data?.lecture?.id || data.lectureId || data.id,
    };
  }

  /**
   * Upload using TUS protocol with STREAMING - reads chunks directly from disk
   * This is memory-efficient for large files (200-300 MB)
   * Only one 5MB chunk is in memory at a time
   */
  async uploadWithTusStreaming(
    accessToken: string,
    filePath: string,
    fileSize: number,
    options: UploadOptions,
    onProgress?: (percent: number) => void
  ): Promise<UploadResult> {
    let sessionRestarts = 0;

    // Wrap in restart loop to handle expired sessions
    while (sessionRestarts <= MAX_SESSION_RESTARTS) {
      try {
        const uploadEndpoint = this.baseUrl + "/api/v1/uploads";
        const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

        // Step 1: Create upload session with POST
        const metadata = this.buildMetadata({
          filename: options.filename,
          filetype: options.mimeType,
          language: options.language,
          summarizationType: options.summarizationType,
          title: options.title || "",
        });

        if (sessionRestarts > 0) {
          console.log(`Restarting upload (attempt ${sessionRestarts + 1}/${MAX_SESSION_RESTARTS + 1})...`);
        }
        console.log(`Creating TUS upload, size: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
        console.log(`Will upload in ${totalChunks} chunks of ${CHUNK_SIZE / 1024 / 1024}MB`);

        const createResponse = await fetch(uploadEndpoint, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + accessToken,
            "Tus-Resumable": "1.0.0",
            "Upload-Length": String(fileSize),
            "Upload-Metadata": metadata,
          },
        });

        if (createResponse.status !== 201) {
          const errorText = await createResponse.text();
          console.error("TUS create failed:", createResponse.status, errorText);

          // Check for rate limiting
          if (createResponse.status === 429) {
            return {
              success: false,
              error: "Too many uploads. Please wait before uploading more files.",
              errorCode: "RATE_LIMITED",
              isRateLimited: true,
            };
          }

          return {
            success: false,
            error: "Failed to create upload: " + createResponse.status,
          };
        }

        const uploadLocation = createResponse.headers.get("Location");
        if (!uploadLocation) {
          return {
            success: false,
            error: "No upload location returned",
          };
        }

        console.log("Upload created at:", uploadLocation);

        // Step 2: Upload file in chunks using streaming
        const result = await this.uploadChunksStreaming(
          accessToken,
          uploadLocation,
          filePath,
          fileSize,
          onProgress
        );

        if (result.sessionExpired) {
          sessionRestarts++;
          if (sessionRestarts > MAX_SESSION_RESTARTS) {
            return {
              success: false,
              error: "Upload session expired multiple times. Please try again later.",
            };
          }
          console.log("Session expired, will restart upload...");
          continue; // Restart the upload
        }

        return result;
      } catch (error) {
        console.error("TUS upload error:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown TUS upload error",
        };
      }
    }

    return {
      success: false,
      error: "Upload failed after multiple session restarts",
    };
  }

  /**
   * Upload chunks by streaming directly from file
   * Only one chunk (5MB) is in memory at a time
   */
  private async uploadChunksStreaming(
    accessToken: string,
    uploadLocation: string,
    filePath: string,
    fileSize: number,
    onProgress?: (percent: number) => void
  ): Promise<UploadResult & { sessionExpired?: boolean }> {
    let offset = 0;
    let lectureId: string | null = null;
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

    // Open file handle for efficient reading
    const fileHandle = await open(filePath, "r");

    try {
      while (offset < fileSize) {
        const chunkNumber = Math.floor(offset / CHUNK_SIZE) + 1;
        let success = false;
        let lastError: string | null = null;

        for (let retry = 0; retry < MAX_RETRIES && !success; retry++) {
          if (retry > 0) {
            const delay = getRetryDelay(retry);
            console.log(`Retry ${retry}/${MAX_RETRIES} for chunk ${chunkNumber} (waiting ${delay}ms)...`);
            await new Promise(resolve => setTimeout(resolve, delay));

            // On retry, check server's current offset with HEAD request
            const headResult = await this.checkServerOffset(accessToken, uploadLocation);

            if (headResult.sessionExpired) {
              await fileHandle.close();
              return { success: false, sessionExpired: true };
            }

            if (headResult.offset !== null && headResult.offset !== offset) {
              console.log(`Server offset (${headResult.offset}) differs from local (${offset}), adjusting...`);
              offset = headResult.offset;
            }
          }

          // Read chunk directly from file at current offset
          const chunkEnd = Math.min(offset + CHUNK_SIZE, fileSize);
          const chunkSize = chunkEnd - offset;
          const chunkBuffer = Buffer.alloc(chunkSize);

          const { bytesRead } = await fileHandle.read(chunkBuffer, 0, chunkSize, offset);
          if (bytesRead !== chunkSize) {
            lastError = `Failed to read chunk from file: expected ${chunkSize}, got ${bytesRead}`;
            console.error(lastError);
            continue;
          }

          console.log(`Uploading chunk ${chunkNumber}/${totalChunks} (${chunkSize} bytes, offset: ${offset})`);

          try {
            const patchResponse = await fetch(uploadLocation, {
              method: "PATCH",
              headers: {
                Authorization: "Bearer " + accessToken,
                "Tus-Resumable": "1.0.0",
                "Upload-Offset": String(offset),
                "Content-Type": "application/offset+octet-stream",
              },
              body: chunkBuffer,
            });

            if (patchResponse.status === 204 || patchResponse.status === 200) {
              // Get the new offset from response
              const newOffset = patchResponse.headers.get("Upload-Offset");
              offset = newOffset ? parseInt(newOffset, 10) : chunkEnd;

              // Check for lecture ID on final chunk
              const respLectureId = patchResponse.headers.get("X-Lecture-Id");
              if (respLectureId) {
                lectureId = respLectureId;
              }

              success = true;

              // Report progress
              const percent = Math.round((offset / fileSize) * 100);
              console.log(`Progress: ${percent}%`);
              if (onProgress) {
                onProgress(percent);
              }
            } else if (patchResponse.status === 409) {
              // Offset mismatch - get correct offset from server
              const serverOffset = patchResponse.headers.get("Upload-Offset");
              if (serverOffset) {
                offset = parseInt(serverOffset, 10);
                console.log(`Offset mismatch, server at ${offset}, retrying...`);
              }
              lastError = "Offset mismatch";
            } else {
              // Check for session expiration
              const errorText = await patchResponse.text();

              if (isSessionExpiredError(patchResponse.status, errorText)) {
                console.log(`Session expired (${patchResponse.status}), will restart upload...`);
                await fileHandle.close();
                return { success: false, sessionExpired: true };
              }

              lastError = `Server error ${patchResponse.status}: ${errorText.substring(0, 200)}`;
              console.error(lastError);
            }
          } catch (fetchError) {
            lastError = fetchError instanceof Error ? fetchError.message : "Network error";
            console.error(`Chunk upload network error: ${lastError}`);
          }
        }

        if (!success) {
          await fileHandle.close();
          return {
            success: false,
            error: lastError || "Failed to upload chunk after retries",
          };
        }
      }

      await fileHandle.close();
      console.log("TUS upload complete, lecture ID:", lectureId);

      return {
        success: true,
        lectureId: lectureId || undefined,
      };
    } catch (error) {
      await fileHandle.close();
      throw error;
    }
  }

  /**
   * Check server's current upload offset with HEAD request
   */
  private async checkServerOffset(
    accessToken: string,
    uploadLocation: string
  ): Promise<{ sessionExpired: boolean; offset: number | null }> {
    try {
      const headResponse = await fetch(uploadLocation, {
        method: "HEAD",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Tus-Resumable": "1.0.0",
        },
      });

      if (headResponse.status === 404) {
        return { sessionExpired: true, offset: null };
      }

      // Check for session expiration in other status codes
      if (headResponse.status >= 400) {
        const errorText = await headResponse.text().catch(() => "");
        if (isSessionExpiredError(headResponse.status, errorText)) {
          return { sessionExpired: true, offset: null };
        }
      }

      const serverOffset = headResponse.headers.get("Upload-Offset");
      return {
        sessionExpired: false,
        offset: serverOffset ? parseInt(serverOffset, 10) : null,
      };
    } catch (error) {
      console.log("HEAD request failed:", error instanceof Error ? error.message : "Unknown error");
      return { sessionExpired: false, offset: null };
    }
  }

  /**
   * Clean up files after successful upload
   */
  private async cleanupFiles(
    actualFilePath: string,
    tempFilePath: string | null | undefined,
    originalPath: string
  ): Promise<void> {
    // Clean up temp file first
    if (tempFilePath && tempFilePath !== actualFilePath) {
      try {
        await unlink(tempFilePath);
        console.log("Cleaned up temp file:", tempFilePath);
      } catch {
        // Ignore
      }
    }

    // Clean up source file (for bot API files)
    if (originalPath.startsWith("/var/lib/telegram-bot-api/")) {
      try {
        await unlink(actualFilePath);
        console.log("Cleaned up source file:", actualFilePath);
      } catch (cleanupError) {
        console.log("Could not clean up source file (may already be deleted):", actualFilePath);
      }
    }
  }

  /**
   * Parse upload error response
   */
  private parseUploadError(statusCode: number, responseText: string): UploadResult {
    let errorMsg = "Upload failed with status " + statusCode;
    let errorCode: string | undefined;
    let isRateLimited = false;

    if (statusCode === 429) {
      isRateLimited = true;
      errorCode = "RATE_LIMITED";
      errorMsg = "Too many uploads. Please wait before uploading more files.";
    }

    try {
      const errorData = JSON.parse(responseText);
      errorCode = errorData.error?.code || errorCode;
      errorMsg = errorData.error?.message || errorData.message || errorMsg;

      if (errorCode === "UPLOAD_RATE_LIMIT_EXCEEDED" || errorCode === "RATE_LIMIT_EXCEEDED") {
        isRateLimited = true;
      }
    } catch {
      // Keep default error message
    }

    return {
      success: false,
      error: errorMsg,
      errorCode,
      isRateLimited,
    };
  }

  /**
   * Build TUS metadata header (base64 encoded key-value pairs)
   */
  private buildMetadata(data: Record<string, string>): string {
    return Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => key + " " + Buffer.from(value).toString("base64"))
      .join(",");
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use uploadWithTusStreaming instead
   */
  async uploadWithTus(
    accessToken: string,
    fileBuffer: ArrayBuffer,
    options: UploadOptions,
    onProgress?: (percent: number) => void
  ): Promise<UploadResult> {
    // Create a temporary file and use streaming upload
    const tempFile = path.join(os.tmpdir(), `tus-upload-${Date.now()}.tmp`);
    const { writeFile } = await import("fs/promises");
    await writeFile(tempFile, Buffer.from(fileBuffer));

    try {
      const result = await this.uploadWithTusStreaming(
        accessToken,
        tempFile,
        fileBuffer.byteLength,
        options,
        onProgress
      );
      return result;
    } finally {
      await unlink(tempFile).catch(() => {});
    }
  }
}

export const uploadService = new UploadService(config.apiBaseUrl);
