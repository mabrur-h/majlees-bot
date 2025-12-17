import { InlineKeyboard } from "grammy";
import type { BotContext } from "../context.js";
import { apiClient } from "../../api/client.js";
import { config } from "../../config.js";

/**
 * Escape special Markdown characters
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

/**
 * /info command - Show bot usage guide
 */
export async function handleInfo(ctx: BotContext): Promise<void> {
  await showInfo(ctx, false);
}

/**
 * Show info callback (from inline button)
 */
export async function handleShowInfo(ctx: BotContext): Promise<void> {
  await showInfo(ctx, true);
  await ctx.answerCallbackQuery();
}

/**
 * Show bot usage guide
 */
async function showInfo(ctx: BotContext, _isCallback: boolean): Promise<void> {
  const message =
    `📚 *Majleesdan - Foydalanish qo'llanmasi*\n\n` +
    `*Botdan qanday foydalanish:*\n\n` +
    `1️⃣ *Video/Audio yuborish*\n` +
    `Menga video yoki audio fayl yuboring. Men uni avtomatik qayta ishlab, transkriptsiya qilaman.\n\n` +
    `2️⃣ *Kontent turini tanlash*\n` +
    `Yuborilgandan so'ng, kontent turini tanlang:\n` +
    `   • Ma'ruza - darslar va ma'ruzalar uchun\n` +
    `   • CustDev - intervyu va suhbatlar uchun\n\n` +
    `3️⃣ *Natijalarni olish*\n` +
    `AI transkriptsiya, xulosa va asosiy fikrlarni tayyorlaydi.\n\n` +
    `*Qo'llab-quvvatlanadigan formatlar:*\n` +
    `📹 Video: MP4, MOV, AVI, MKV\n` +
    `🎵 Audio: MP3, WAV, M4A, OGG, FLAC\n\n` +
    `*Mavjud buyruqlar:*\n` +
    `/start - Botni qayta ishga tushirish\n` +
    `/info - Foydalanish qo'llanmasi\n` +
    `/settings - Hisob sozlamalari\n` +
    `/balance - Daqiqalar balansini ko'rish\n` +
    `/pricing - Tariflarni ko'rish\n` +
    `/help - Yordam\n` +
    `/app - Web ilovani ochish\n\n` +
    `*Savollaringiz bormi?*\n` +
    `Aloqa: @majlees\\_ai`;

  const keyboard = new InlineKeyboard()
    .text("📊 Balans", "show_balance")
    .text("📦 Tariflar", "show_plans")
    .row()
    .text("⚙️ Sozlamalar", "show_settings")
    .row()
    .webApp("🌐 Web ilova", config.webAppUrl);

  await ctx.reply(message, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

/**
 * /settings command - Show account settings with linking options
 */
export async function handleSettings(ctx: BotContext): Promise<void> {
  await showSettings(ctx, false);
}

/**
 * Show settings callback (from inline button)
 */
export async function handleShowSettings(ctx: BotContext): Promise<void> {
  await showSettings(ctx, true);
  await ctx.answerCallbackQuery();
}

/**
 * Show account settings information
 */
async function showSettings(ctx: BotContext, isCallback: boolean): Promise<void> {
  if (!ctx.session.isAuthenticated || !ctx.session.tokens) {
    const message = "Iltimos, avval /start buyrug'ini yuboring";
    if (isCallback) {
      await ctx.answerCallbackQuery(message);
    } else {
      await ctx.reply(message);
    }
    return;
  }

  try {
    const response = await apiClient.getLinkedAccountsStatus(ctx.session.tokens.accessToken);

    if (!response.success || !response.data) {
      // Check if user no longer exists (deleted after account merge)
      if (response.error?.code === "USER_NOT_FOUND") {
        ctx.session.isAuthenticated = false;
        ctx.session.tokens = undefined;
        ctx.session.user = undefined;

        const message = "Sizning sessiyangiz yaroqsiz. Iltimos, /start buyrug'ini yuboring.";
        if (isCallback) {
          await ctx.answerCallbackQuery(message);
        } else {
          await ctx.reply(message);
        }
        return;
      }

      const errorMessage = "❌ Sozlamalarni olishda xatolik yuz berdi.";
      if (isCallback) {
        try {
          await ctx.editMessageText(errorMessage);
        } catch {
          await ctx.reply(errorMessage);
        }
      } else {
        await ctx.reply(errorMessage);
      }
      return;
    }

    const status = response.data;

    // Build status message
    let message = `⚙️ *Hisob sozlamalari*\n\n`;
    message += `*Ulangan hisoblar:*\n\n`;

    // Google status
    if (status.google.linked) {
      message += `✅ *Google:* ${status.google.email || "Ulangan"}\n`;
    } else {
      message += `❌ *Google:* Ulanmagan\n`;
    }

    // Telegram status
    if (status.telegram.linked) {
      const username = status.telegram.username
        ? escapeMarkdown(status.telegram.username)
        : "Ulangan";
      message += `✅ *Telegram:* @${username}\n`;
    } else {
      message += `❌ *Telegram:* Ulanmagan\n`;
    }

    message += `\n*Hisob ulash nima?*\n`;
    message += `Hisoblarni ulash orqali siz Google va Telegram orqali bir xil ma'lumotlarga kirishingiz mumkin.\n\n`;

    // Build keyboard based on status
    const keyboard = new InlineKeyboard();

    if (!status.google.linked) {
      keyboard.text("🔗 Google ulash", "link_google").row();
    }

    if (status.google.linked && status.telegram.linked) {
      // Both linked - show unlink options
      keyboard.text("🔓 Google uzish", "unlink_google").row();
      message += `💡 *Eslatma:* Kamida bitta autentifikatsiya usuli ulangan bo'lishi kerak.\n`;
    }

    keyboard.text("📊 Balans", "show_balance").text("🏠 Bosh sahifa", "back_to_main");

    if (isCallback) {
      // Check if current message is a photo (has caption) or text message
      const callbackMsg = ctx.callbackQuery?.message;
      const isPhotoMessage = callbackMsg && "photo" in callbackMsg && callbackMsg.photo;

      if (isPhotoMessage) {
        // Can't edit photo to text, send new message instead
        await ctx.reply(message, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } else {
        try {
          await ctx.editMessageText(message, {
            parse_mode: "Markdown",
            reply_markup: keyboard,
          });
        } catch {
          await ctx.reply(message, {
            parse_mode: "Markdown",
            reply_markup: keyboard,
          });
        }
      }
    } else {
      await ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    }
  } catch (error) {
    console.error("Error fetching settings:", error);
    const errorMessage = "❌ Sozlamalarni olishda xatolik yuz berdi.";
    if (isCallback) {
      try {
        await ctx.editMessageText(errorMessage);
      } catch {
        await ctx.reply(errorMessage);
      }
    } else {
      await ctx.reply(errorMessage);
    }
  }
}

/**
 * Handle "Link Google" button - explains how to link from web app
 */
export async function handleLinkGoogle(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const message =
    `🔗 *Google hisobini ulash*\n\n` +
    `Google hisobingizni ulash uchun:\n\n` +
    `1️⃣ Web ilovani oching\n` +
    `2️⃣ Sozlamalar bo'limiga o'ting\n` +
    `3️⃣ "Hisoblarni ulash" tugmasini bosing\n` +
    `4️⃣ Google hisobingiz bilan kiring\n\n` +
    `Ulangandan so'ng, siz Google yoki Telegram orqali tizimga kirishingiz mumkin bo'ladi.\n\n` +
    `Barcha ma'lumotlaringiz har ikki hisobda ham mavjud bo'ladi.`;

  const keyboard = new InlineKeyboard()
    .webApp("🌐 Web ilovani ochish", config.webAppUrl)
    .row()
    .text("⬅️ Sozlamalarga qaytish", "back_to_settings");

  await ctx.reply(message, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

/**
 * Handle "Unlink Google" button - confirm and explain
 */
export async function handleUnlinkGoogle(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const message =
    `⚠️ *Google hisobini uzish*\n\n` +
    `Google hisobingizni uzish uchun web ilovadan foydalaning:\n\n` +
    `1️⃣ Web ilovani oching\n` +
    `2️⃣ Sozlamalar bo'limiga o'ting\n` +
    `3️⃣ Google yonidagi "Uzish" tugmasini bosing\n\n` +
    `⚠️ *Diqqat:* Google uzilgandan so'ng, faqat Telegram orqali tizimga kirishingiz mumkin bo'ladi.`;

  const keyboard = new InlineKeyboard()
    .webApp("🌐 Web ilovani ochish", config.webAppUrl)
    .row()
    .text("⬅️ Sozlamalarga qaytish", "back_to_settings");

  await ctx.reply(message, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

/**
 * Handle "Back to settings" callback
 */
export async function handleBackToSettings(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await handleSettings(ctx);
}

/**
 * Handle "Back to main" callback
 */
export async function handleBackToMain(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text("🎬 Transkriptsiya qilish", "transcribe_video")
    .row()
    .text("📊 Balans", "show_balance")
    .text("📦 Tariflar", "show_plans")
    .row()
    .webApp("🌐 Web ilovani ochish", config.webAppUrl);

  await ctx.editMessageText("Bosh menyuga xush kelibsiz! Quyidagi amallarni tanlang:", {
    reply_markup: keyboard,
  });
}
