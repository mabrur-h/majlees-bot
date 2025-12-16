import { config } from "../config.js";

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
