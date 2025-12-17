import { InlineKeyboard } from "grammy";
import type { BotContext } from "../context.js";
import { apiClient } from "../../api/client.js";

/**
 * Create a visual progress bar
 */
function createProgressBar(used: number, total: number): string {
  if (total === 0) return "░░░░░░░░░░ 0%";

  const remaining = total - used;
  const percentage = Math.round((remaining / total) * 100);
  const filled = Math.round(percentage / 10);
  const empty = 10 - filled;

  return "▓".repeat(filled) + "░".repeat(empty) + ` ${percentage}%`;
}

/**
 * Format date to Uzbek locale
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("uz-UZ", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * /balance command - Show user's minutes balance
 */
export async function handleBalance(ctx: BotContext): Promise<void> {
  await showBalance(ctx, false);
}

/**
 * Show balance callback (from inline button)
 */
export async function handleShowBalance(ctx: BotContext): Promise<void> {
  await showBalance(ctx, true);
  await ctx.answerCallbackQuery();
}

/**
 * Show user's balance information
 */
async function showBalance(ctx: BotContext, isCallback: boolean): Promise<void> {
  // Check if user is authenticated
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
    const response = await apiClient.getBalance(ctx.session.tokens.accessToken);

    if (!response.success || !response.data) {
      // Check if user no longer exists (deleted after account merge)
      if (response.error?.code === "USER_NOT_FOUND") {
        // Clear session and prompt re-authentication
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

      const errorMessage = "❌ Balansni olishda xatolik yuz berdi.";
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

    const balance = response.data.balance;

    const progressBar = createProgressBar(balance.planMinutesUsed, balance.planMinutesTotal);

    const daysRemaining = Math.ceil(
      (new Date(balance.billingCycleEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );

    const message =
      `📊 *Sizning balansigiz*\n\n` +
      `📦 Tarif: *${balance.planDisplayName}*\n\n` +
      `*Tarif daqiqalari:*\n` +
      `${progressBar}\n` +
      `${balance.planMinutesRemaining}/${balance.planMinutesTotal} daqiqa\n\n` +
      `*Bonus daqiqalar:* ${balance.bonusMinutes} daqiqa\n\n` +
      `*Jami mavjud:* ${balance.totalAvailable} daqiqa\n\n` +
      `📅 Keyingi yangilanish: ${daysRemaining} kundan keyin\n` +
      `(${formatDate(balance.billingCycleEnd)})`;

    const keyboard = new InlineKeyboard()
      .text("📦 Tariflar", "back_to_plans")
      .text("➕ Daqiqa sotib olish", "packages_menu");

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
    console.error("Error fetching balance:", error);
    const errorMessage = "❌ Balansni olishda xatolik yuz berdi.";
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
 * Check if user has enough minutes for upload
 * Returns true if user has enough minutes, false otherwise
 */
export async function checkMinutesForUpload(
  ctx: BotContext,
  estimatedDurationSeconds: number
): Promise<boolean> {
  if (!ctx.session.isAuthenticated || !ctx.session.tokens) {
    await ctx.reply("Iltimos, avval /start buyrug'ini yuboring");
    return false;
  }

  try {
    const response = await apiClient.getBalance(ctx.session.tokens.accessToken);

    if (!response.success || !response.data) {
      // Check if user no longer exists (deleted after account merge)
      if (response.error?.code === "USER_NOT_FOUND") {
        ctx.session.isAuthenticated = false;
        ctx.session.tokens = undefined;
        ctx.session.user = undefined;
        await ctx.reply("Sizning sessiyangiz yaroqsiz. Iltimos, /start buyrug'ini yuboring.");
        return false;
      }
      // If we can't check, allow the upload (backend will handle it)
      return true;
    }

    const balance = response.data.balance;
    const estimatedMinutes = Math.ceil(estimatedDurationSeconds / 60);

    if (balance.totalAvailable < estimatedMinutes) {
      const message =
        `⚠️ *Yetarli daqiqalar yo'q*\n\n` +
        `Bu video uchun taxminan *${estimatedMinutes} daqiqa* kerak.\n` +
        `Sizda faqat *${balance.totalAvailable} daqiqa* mavjud.\n\n` +
        `Iltimos, qo'shimcha daqiqa sotib oling yoki tarifingizni yangilang.`;

      const keyboard = new InlineKeyboard()
        .text("📦 Tariflar", "back_to_plans")
        .text("➕ Daqiqa sotib olish", "packages_menu");

      await ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });

      return false;
    }

    return true;
  } catch (error) {
    console.error("Error checking minutes:", error);
    // If we can't check, allow the upload (backend will handle it)
    return true;
  }
}
