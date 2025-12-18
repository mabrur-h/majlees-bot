import { createBot } from "./bot/index.js";
import { createWebhookServer } from "./webhook/server.js";
import { config } from "./config.js";

async function main(): Promise<void> {
  console.log("=== Bot Starting ===");
  console.log("PORT env:", process.env.PORT);
  console.log("WEBHOOK_PORT env:", process.env.WEBHOOK_PORT);
  console.log("Config webhookPort:", config.webhookPort);
  console.log("WEBHOOK_SECRET configured:", !!config.webhookSecret);
  console.log("====================");

  const bot = createBot();
  createWebhookServer(bot, config.webhookPort);

  const shutdown = async (signal: string) => {
    console.log(signal + " received. Shutting down...");
    await bot.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log("Starting bot...");
  await bot.start({
    onStart: (botInfo) => {
      console.log("Bot @" + botInfo.username + " is running!");
      console.log("Webhook server on port " + config.webhookPort);
    },
  });
}

main().catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});
