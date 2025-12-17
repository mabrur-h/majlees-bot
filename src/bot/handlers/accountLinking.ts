import { InlineKeyboard } from "grammy";
import type { BotContext } from "../context.js";
import { apiClient } from "../../api/client.js";
import { config } from "../../config.js";

/**
 * Handle account linking deep link
 * Format: /start link_{token}
 */
export async function handleAccountLink(
  ctx: BotContext,
  linkToken: string
): Promise<void> {
  const user = ctx.from;

  if (!user) {
    await ctx.reply(
      "Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Show processing message
  const processingMsg = await ctx.reply(
    "Hisoblarni ulash jarayoni...",
    { parse_mode: "Markdown" }
  );

  try {
    // Get user's profile photo URL if available
    let photoUrl: string | undefined;
    try {
      const photos = await ctx.api.getUserProfilePhotos(user.id, { limit: 1 });
      if (photos.total_count > 0 && photos.photos[0]?.[0]) {
        const fileId = photos.photos[0][0].file_id;
        const file = await ctx.api.getFile(fileId);
        if (file.file_path) {
          photoUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
        }
      }
    } catch {
      // Ignore photo fetch errors
    }

    // Call the API to complete the linking
    const response = await apiClient.completeTelegramLink({
      token: linkToken,
      telegramId: user.id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      languageCode: user.language_code,
      isPremium: user.is_premium ?? false,
      photoUrl: photoUrl ?? null,
    });

    // Delete processing message
    await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => {});

    if (!response.success) {
      const errorCode = response.error?.code;
      let errorMessage = "Hisoblarni ulashda xatolik yuz berdi.";

      switch (errorCode) {
        case "INVALID_LINK_TOKEN":
          errorMessage =
            "Havola muddati tugagan yoki noto'g'ri.\n\n" +
            "Iltimos, web ilovadan yangi havola oling.";
          break;
        case "TELEGRAM_ALREADY_LINKED":
          errorMessage =
            "Bu Telegram hisobi allaqachon ulangan.\n\n" +
            "Agar boshqa Google hisobiga ulashni xohlasangiz, avval joriy ulanishni bekor qiling.";
          break;
        case "INVALID_LINK_TYPE":
          errorMessage = "Noto'g'ri havola turi.";
          break;
        default:
          errorMessage = response.error?.message || errorMessage;
      }

      await ctx.reply(`${errorMessage}`, { parse_mode: "Markdown" });
      return;
    }

    // Success!
    const { merged, message: _message } = response.data!;

    let successMessage: string;
    if (merged) {
      successMessage =
        "🎉 *Hisoblar muvaffaqiyatli birlashtirildi!*\n\n" +
        "Telegram va Google hisoblaringiz birlashtirildi. " +
        "Barcha ma'lumotlaringiz endi bir hisobda.\n\n" +
        "Endi siz ikkala usul bilan ham tizimga kirishingiz mumkin.";
    } else {
      successMessage =
        "✅ *Telegram hisobi muvaffaqiyatli ulandi!*\n\n" +
        "Endi siz Google yoki Telegram orqali tizimga kirishingiz mumkin.\n\n" +
        "Barcha ma'lumotlaringiz har ikki hisobda ham mavjud bo'ladi.";
    }

    const keyboard = new InlineKeyboard().webApp(
      "🌐 Web ilovani ochish",
      config.webAppUrl
    );

    await ctx.reply(successMessage, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  } catch (error) {
    // Delete processing message
    await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => {});

    console.error("Account linking error:", error);
    await ctx.reply(
      "Hisoblarni ulashda xatolik yuz berdi. Iltimos, keyinroq qaytadan urinib ko'ring.",
      { parse_mode: "Markdown" }
    );
  }
}

/**
 * Check if a start parameter is an account link token
 */
export function isAccountLinkToken(startParam: string): boolean {
  return startParam.startsWith("link_");
}

/**
 * Extract the token from a link parameter
 */
export function extractLinkToken(startParam: string): string {
  return startParam.replace("link_", "");
}
