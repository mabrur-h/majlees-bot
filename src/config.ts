import "dotenv/config";

function getEnvVar(name: string, required = true): string {
  const value = process.env[name];
  if (required && !value) {
    throw new Error("Missing required environment variable: " + name);
  }
  return value ?? "";
}

export const config = {
  botToken: getEnvVar("BOT_TOKEN"),
  apiBaseUrl: getEnvVar("API_BASE_URL", false) || "http://localhost:3000",
  webAppUrl: getEnvVar("WEB_APP_URL", false) || "https://uznotes.app",
  webhookPort: parseInt(getEnvVar("WEBHOOK_PORT", false) || "3001", 10),
  webhookSecret: getEnvVar("WEBHOOK_SECRET", false) || "",
  nodeEnv: getEnvVar("NODE_ENV", false) || "development",
  isDev: (getEnvVar("NODE_ENV", false) || "development") === "development",
} as const;
