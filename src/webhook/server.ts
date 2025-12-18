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

export interface PaymentNotification {
  type: "payment_notification";
  telegramId: number;
  status: "success" | "failed" | "cancelled";
  amount: number;
  paymentType: "plan" | "package";
  itemName: string;
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

  // Payment notification webhook
  app.post("/webhook/payment", async (req, res) => {
    console.log("Received payment webhook request");
    const authHeader = req.headers.authorization;
    const expectedSecret = config.webhookSecret;

    if (expectedSecret && authHeader !== "Bearer " + expectedSecret) {
      console.log("Unauthorized payment webhook request");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const notification = req.body as PaymentNotification;

    if (notification.type !== "payment_notification") {
      res.status(400).json({ error: "Invalid notification type" });
      return;
    }

    console.log("Received payment notification:", notification.status, notification.amount);

    try {
      await sendPaymentNotification(bot, notification);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to send payment notification:", error);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });

  app.listen(port, "0.0.0.0", () => {
    console.log("Webhook server running on port " + port + " (0.0.0.0)");
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

async function sendPaymentNotification(
  bot: Bot<BotContext>,
  notification: PaymentNotification
): Promise<void> {
  const { telegramId, status, amount, paymentType, itemName } = notification;

  // Format amount with thousands separator
  const formattedAmount = amount.toLocaleString("uz-UZ");
  const typeText = paymentType === "plan" ? "tarif" : "paket";

  if (status === "success") {
    const keyboard = new InlineKeyboard()
      .webApp("Balansni ko'rish", config.webAppUrl + "?startapp=balance");

    await bot.api.sendMessage(
      telegramId,
      `✅ *To'lov muvaffaqiyatli!*\n\n` +
      `📦 ${itemName} ${typeText}i faollashtirildi\n` +
      `💰 Summa: ${formattedAmount} UZS\n\n` +
      `Xizmatimizdan foydalanganingiz uchun rahmat!`,
      {
        parse_mode: "Markdown",
        reply_markup: keyboard
      }
    );
  } else if (status === "cancelled") {
    await bot.api.sendMessage(
      telegramId,
      `❌ *To'lov bekor qilindi*\n\n` +
      `📦 ${itemName} ${typeText}i\n` +
      `💰 Summa: ${formattedAmount} UZS\n\n` +
      `Agar savollaringiz bo'lsa, /help buyrug'ini yuboring.`,
      { parse_mode: "Markdown" }
    );
  } else {
    await bot.api.sendMessage(
      telegramId,
      `⚠️ *To'lov amalga oshmadi*\n\n` +
      `📦 ${itemName} ${typeText}i\n` +
      `💰 Summa: ${formattedAmount} UZS\n\n` +
      `Iltimos, qaytadan urinib ko'ring yoki /pricing buyrug'ini yuboring.`,
      { parse_mode: "Markdown" }
    );
  }
}
