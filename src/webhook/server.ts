import express from "express";
import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { BotContext } from "../bot/context.js";
import { config } from "../config.js";

export interface LectureNotification {
  type: "lecture_notification";
  telegramId: number;
  lectureId: string;
  status: "completed" | "failed";
  title?: string;
  summarizationType?: string;
  errorMessage?: string;
}

export function createWebhookServer(bot: Bot<BotContext>, port: number = 3001) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/webhook/lecture", async (req, res) => {
    console.log("Received lecture webhook request");
    const authHeader = req.headers.authorization;
    const expectedSecret = config.webhookSecret;

    // Debug logging (without revealing full secrets)
    console.log("Auth header present:", !!authHeader);
    console.log("Expected secret configured:", !!expectedSecret);

    if (expectedSecret && authHeader !== "Bearer " + expectedSecret) {
      console.log("Unauthorized webhook request - secret mismatch");
      console.log("Auth header prefix:", authHeader?.substring(0, 15) + "...");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const notification = req.body as LectureNotification;
    
    if (notification.type !== "lecture_notification") {
      res.status(400).json({ error: "Invalid notification type" });
      return;
    }

    console.log("Received notification:", notification.lectureId, notification.status);

    try {
      await sendLectureNotification(bot, notification);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to send notification:", error);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });

  app.listen(port, () => {
    console.log("Webhook server running on port " + port);
  });

  return app;
}

async function sendLectureNotification(
  bot: Bot<BotContext>,
  notification: LectureNotification
): Promise<void> {
  const { telegramId, lectureId, status, title, summarizationType, errorMessage } = notification;

  if (status === "completed") {
    const deepLink = config.webAppUrl + "?startapp=lecture_" + lectureId;
    const typeName = summarizationType === "custdev" ? "CustDev Analysis" : "Meeting Summary";
    const displayTitle = title || "Your recording";

    const keyboard = new InlineKeyboard()
      .webApp("View " + typeName, deepLink);

    await bot.api.sendMessage(
      telegramId,
      displayTitle + " is ready! Click below to view your " + typeName.toLowerCase() + ".",
      { reply_markup: keyboard }
    );
  } else {
    const displayTitle = title || "Your recording";
    const errorMsg = errorMessage || "Unknown error";

    await bot.api.sendMessage(
      telegramId,
      "Processing Failed: " + displayTitle + " - " + errorMsg
    );
  }
}
