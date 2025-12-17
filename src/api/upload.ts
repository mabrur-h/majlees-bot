import { createReadStream } from "fs";
import { stat, unlink } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import { config } from "../config.js";

const execAsync = promisify(exec);

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

class UploadService {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Upload a file from a URL (e.g., Telegram file URL) to the backend
   * This downloads the file and uploads it using multipart/form-data
   * since TUS protocol is more complex and requires chunking
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
   * Upload a file from Local Bot API server
   * Supports multiple file access methods:
   * 1. Direct file access (Railway/Docker - same container)
   * 2. Mounted volume (Linux/Mac local dev)
   * 3. Docker cp fallback (Windows local dev)
   *
   * Files are automatically cleaned up after successful upload to save disk space.
   */
  async uploadFromLocalPath(
    accessToken: string,
    filePath: string,
    options: UploadOptions,
    botToken?: string,
    localApiUrl?: string
  ): Promise<UploadResult> {
    // Track the actual file path for cleanup later
    let actualFilePath: string | null = null;

    try {
      let fileBuffer: Buffer;

      // Method 1: Try direct file access (for Railway where both services run in same container)
      if (filePath.startsWith("/var/lib/telegram-bot-api/")) {
        console.log("Trying direct file access:", filePath);
        try {
          const fileStats = await stat(filePath);
          console.log("Direct access successful, file size:", fileStats.size, "bytes");

          const chunks: Buffer[] = [];
          const stream = createReadStream(filePath);
          for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
          }
          fileBuffer = Buffer.concat(chunks);
          actualFilePath = filePath; // Track for cleanup
        } catch (directError) {
          console.log("Direct file access failed, trying other methods...");

          // Method 2: Try mounted volume on host (Linux/Mac local dev)
          const hostFilesPath = config.localBotApiFilesPath;
          if (hostFilesPath) {
            const relativePath = filePath.replace("/var/lib/telegram-bot-api/", "");
            const hostPath = path.join(hostFilesPath, relativePath);

            console.log("Trying mounted volume:", hostPath);

            try {
              const fileStats = await stat(hostPath);
              console.log("Mounted volume access successful, file size:", fileStats.size, "bytes");

              const chunks: Buffer[] = [];
              const stream = createReadStream(hostPath);
              for await (const chunk of stream) {
                chunks.push(Buffer.from(chunk));
              }
              fileBuffer = Buffer.concat(chunks);
              actualFilePath = hostPath; // Track for cleanup
            } catch (mountError) {
              // Method 3: Docker cp fallback (Windows local dev)
              console.log("Mounted volume not accessible, trying docker cp...");

              const tempFile = path.join(os.tmpdir(), `telegram-file-${Date.now()}.tmp`);

              try {
                const containerPath = `telegram-bot-api:${filePath}`;
                console.log(`Running: docker cp "${containerPath}" "${tempFile}"`);

                await execAsync(`docker cp "${containerPath}" "${tempFile}"`);

                const fileStats = await stat(tempFile);
                console.log("Docker cp successful, file size:", fileStats.size, "bytes");

                const chunks: Buffer[] = [];
                const stream = createReadStream(tempFile);
                for await (const chunk of stream) {
                  chunks.push(Buffer.from(chunk));
                }
                fileBuffer = Buffer.concat(chunks);

                await unlink(tempFile).catch(() => {});
              } catch (dockerError) {
                console.error("All file access methods failed");
                console.error("Direct access error:", directError);
                console.error("Docker cp error:", dockerError);
                return {
                  success: false,
                  error: `Failed to access file: ${filePath}`,
                };
              }
            }
          } else {
            // No mounted volume configured, try docker cp directly
            console.log("No mounted volume configured, trying docker cp...");

            const tempFile = path.join(os.tmpdir(), `telegram-file-${Date.now()}.tmp`);

            try {
              const containerPath = `telegram-bot-api:${filePath}`;
              console.log(`Running: docker cp "${containerPath}" "${tempFile}"`);

              await execAsync(`docker cp "${containerPath}" "${tempFile}"`);

              const fileStats = await stat(tempFile);
              console.log("Docker cp successful, file size:", fileStats.size, "bytes");

              const chunks: Buffer[] = [];
              const stream = createReadStream(tempFile);
              for await (const chunk of stream) {
                chunks.push(Buffer.from(chunk));
              }
              fileBuffer = Buffer.concat(chunks);

              await unlink(tempFile).catch(() => {});
            } catch (dockerError) {
              console.error("All file access methods failed");
              console.error("Direct access error:", directError);
              console.error("Docker cp error:", dockerError);
              return {
                success: false,
                error: `Failed to access file: ${filePath}`,
              };
            }
          }
        }
      } else {
        // Non-standard path, try HTTP download as fallback
        const apiUrl = localApiUrl || config.localBotApiUrl;
        const token = botToken || config.botToken;

        const fileUrl = `${apiUrl}/file/bot${token}/${filePath}`;
        console.log("Downloading from Local Bot API:", fileUrl);

        const fileResponse = await fetch(fileUrl);
        if (!fileResponse.ok) {
          return {
            success: false,
            error: `Failed to download file from Local Bot API: ${fileResponse.status}`,
          };
        }

        const arrayBuffer = await fileResponse.arrayBuffer();
        fileBuffer = Buffer.from(arrayBuffer);
      }

      const fileSizeMB = fileBuffer.length / 1024 / 1024;
      console.log(`File ready, size: ${fileBuffer.length} bytes (${fileSizeMB.toFixed(1)} MB)`);

      // Convert Buffer to ArrayBuffer
      const arrayBuffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.length
      ) as ArrayBuffer;

      // Use TUS chunked upload for all files (more reliable, avoids 413 errors)
      const TUS_THRESHOLD_MB = 10; // Use TUS for files larger than 10MB

      let result: UploadResult;

      if (fileSizeMB > TUS_THRESHOLD_MB) {
        // Use TUS chunked upload for large files
        console.log(`Using TUS chunked upload (file > ${TUS_THRESHOLD_MB}MB)`);
        result = await this.uploadWithTus(accessToken, arrayBuffer, options);
      } else {
        // Use simple upload for small files
        console.log("Using simple upload (small file)");
        const fileBlob = new Blob([arrayBuffer], { type: options.mimeType });

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
        console.log("Upload response:", responseText);

        if (!uploadResponse.ok) {
          let errorMsg = "Upload failed with status " + uploadResponse.status;
          let errorCode: string | undefined;
          let isRateLimited = false;

          if (uploadResponse.status === 429) {
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

          result = {
            success: false,
            error: errorMsg,
            errorCode,
            isRateLimited,
          };
        } else {
          const data = JSON.parse(responseText);
          result = {
            success: true,
            lectureId: data.data?.lecture?.id || data.lectureId || data.id,
          };
        }
      }

      // Only clean up and return success if upload succeeded
      if (!result.success) {
        return result;
      }

      // Clean up the source file after successful upload to save disk space
      if (actualFilePath) {
        try {
          await unlink(actualFilePath);
          console.log("Cleaned up source file:", actualFilePath);
        } catch (cleanupError) {
          // Non-fatal - just log it
          console.log("Could not clean up source file (may already be deleted):", actualFilePath);
        }
      }

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
   * Upload using TUS protocol with chunked uploads (resumable)
   * Uploads file in chunks to avoid server size limits and enable resume on failure
   */
  async uploadWithTus(
    accessToken: string,
    fileBuffer: ArrayBuffer,
    options: UploadOptions,
    onProgress?: (percent: number) => void
  ): Promise<UploadResult> {
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
    const MAX_RETRIES = 3;

    try {
      const uploadEndpoint = this.baseUrl + "/api/v1/uploads";
      const fileSize = fileBuffer.byteLength;

      // Step 1: Create upload with POST
      const metadata = this.buildMetadata({
        filename: options.filename,
        filetype: options.mimeType,
        language: options.language,
        summarizationType: options.summarizationType,
        title: options.title || "",
      });

      console.log(`Creating TUS upload, size: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
      console.log(`Will upload in ${Math.ceil(fileSize / CHUNK_SIZE)} chunks of ${CHUNK_SIZE / 1024 / 1024}MB`);

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

      // Step 2: Upload file in chunks
      let offset = 0;
      let lectureId: string | null = null;

      while (offset < fileSize) {
        const chunkEnd = Math.min(offset + CHUNK_SIZE, fileSize);
        const chunk = fileBuffer.slice(offset, chunkEnd);
        const chunkNumber = Math.floor(offset / CHUNK_SIZE) + 1;
        const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

        console.log(`Uploading chunk ${chunkNumber}/${totalChunks} (${chunk.byteLength} bytes, offset: ${offset})`);

        let success = false;
        let lastError: string | null = null;

        for (let retry = 0; retry < MAX_RETRIES && !success; retry++) {
          if (retry > 0) {
            console.log(`Retry ${retry}/${MAX_RETRIES} for chunk ${chunkNumber}`);
            // Wait before retry (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retry)));
          }

          try {
            const patchResponse = await fetch(uploadLocation, {
              method: "PATCH",
              headers: {
                Authorization: "Bearer " + accessToken,
                "Tus-Resumable": "1.0.0",
                "Upload-Offset": String(offset),
                "Content-Type": "application/offset+octet-stream",
              },
              body: chunk,
            });

            if (patchResponse.status === 204 || patchResponse.status === 200) {
              // Get the new offset from response
              const newOffset = patchResponse.headers.get("Upload-Offset");
              if (newOffset) {
                offset = parseInt(newOffset, 10);
              } else {
                offset = chunkEnd;
              }

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
            } else {
              const errorText = await patchResponse.text();
              lastError = `Chunk upload failed: ${patchResponse.status} - ${errorText}`;
              console.error(lastError);
            }
          } catch (fetchError) {
            lastError = fetchError instanceof Error ? fetchError.message : "Network error";
            console.error(`Chunk upload network error: ${lastError}`);
          }
        }

        if (!success) {
          return {
            success: false,
            error: lastError || "Failed to upload chunk after retries",
          };
        }
      }

      console.log("TUS upload complete, lecture ID:", lectureId);

      return {
        success: true,
        lectureId: lectureId || undefined,
      };
    } catch (error) {
      console.error("TUS upload error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown TUS upload error",
      };
    }
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
}

export const uploadService = new UploadService(config.apiBaseUrl);
