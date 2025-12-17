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

      console.log("File ready, size:", fileBuffer.length, "bytes");

      // Convert Buffer to ArrayBuffer for Blob compatibility
      const arrayBuffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.length
      ) as ArrayBuffer;
      const fileBlob = new Blob([arrayBuffer], { type: options.mimeType });

      // Create form data for upload
      const formData = new FormData();
      formData.append("file", fileBlob, options.filename);
      formData.append("language", options.language);
      formData.append("summarizationType", options.summarizationType);
      if (options.title) {
        formData.append("title", options.title);
      }

      // Upload to backend
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

        return {
          success: false,
          error: errorMsg,
          errorCode,
          isRateLimited,
        };
      }

      const data = JSON.parse(responseText);

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

      return {
        success: true,
        lectureId: data.data?.lecture?.id || data.lectureId || data.id,
      };
    } catch (error) {
      console.error("Local file upload error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown upload error",
      };
    }
  }

  /**
   * Upload using TUS protocol (resumable uploads)
   * For larger files, this provides better reliability
   */
  async uploadWithTus(
    accessToken: string,
    fileBuffer: ArrayBuffer,
    options: UploadOptions
  ): Promise<UploadResult> {
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

      console.log("Creating TUS upload, size:", fileSize);

      const createResponse = await fetch(uploadEndpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(fileSize),
          "Upload-Metadata": metadata,
          "Content-Type": "application/offset+octet-stream",
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

      // Step 2: Upload the file content with PATCH
      const patchResponse = await fetch(uploadLocation, {
        method: "PATCH",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Tus-Resumable": "1.0.0",
          "Upload-Offset": "0",
          "Content-Type": "application/offset+octet-stream",
        },
        body: fileBuffer,
      });

      if (patchResponse.status !== 204) {
        const errorText = await patchResponse.text();
        console.error("TUS patch failed:", patchResponse.status, errorText);
        return {
          success: false,
          error: "Failed to upload file: " + patchResponse.status,
        };
      }

      // Get lecture ID from response header
      const lectureId = patchResponse.headers.get("X-Lecture-Id");
      console.log("Upload complete, lecture ID:", lectureId);

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
