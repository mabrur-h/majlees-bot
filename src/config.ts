import "dotenv/config";

function getEnvVar(name: string, required = true): string {
  const value = process.env[name];
  if (required && !value) {
    throw new Error("Missing required environment variable: " + name);
  }
  return value ?? "";
}

// Check if using Local Bot API (for large file support up to 2GB)
const useLocalBotApi = getEnvVar("USE_LOCAL_BOT_API", false) === "true";
const localBotApiUrl = getEnvVar("LOCAL_BOT_API_URL", false) || "http://localhost:8081";
// Path where Local Bot API files are stored (mounted volume on host)
const localBotApiFilesPath = getEnvVar("LOCAL_BOT_API_FILES_PATH", false) || "";

export const config = {
  botToken: getEnvVar("BOT_TOKEN"),
  apiBaseUrl: getEnvVar("API_BASE_URL", false) || "http://localhost:3000",
  webAppUrl: getEnvVar("WEB_APP_URL", false) || "https://uznotes.app",
  webhookPort: parseInt(getEnvVar("WEBHOOK_PORT", false) || "3001", 10),
  webhookSecret: getEnvVar("WEBHOOK_SECRET", false) || "",
  nodeEnv: getEnvVar("NODE_ENV", false) || "development",
  isDev: (getEnvVar("NODE_ENV", false) || "development") === "development",

  // Local Bot API configuration (for files > 20MB, up to 2GB)
  useLocalBotApi,
  localBotApiUrl,
  localBotApiFilesPath, // Host path where Docker volume is mounted (e.g., C:/telegram-bot-api-data)
  // File size limit: 20MB for cloud API, 2GB for local API
  maxFileSize: useLocalBotApi ? 2 * 1024 * 1024 * 1024 : 20 * 1024 * 1024,
} as const;
