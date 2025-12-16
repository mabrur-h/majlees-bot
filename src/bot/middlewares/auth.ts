import type { NextFunction } from "grammy";
import type { BotContext } from "../context.js";
import { apiClient } from "../../api/index.js";

async function getUserProfilePhotoUrl(ctx: BotContext, userId: number): Promise<string | undefined> {
  try {
    const photos = await ctx.api.getUserProfilePhotos(userId, { limit: 1 });
    if (photos.total_count > 0 && photos.photos[0]?.[0]) {
      const fileId = photos.photos[0][0].file_id;
      const file = await ctx.api.getFile(fileId);
      if (file.file_path) {
        return `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
      }
    }
  } catch (error) {
    console.error("Failed to get profile photo:", error);
  }
  return undefined;
}

export async function authMiddleware(
  ctx: BotContext,
  next: NextFunction
): Promise<void> {
  // Skip if no user info available
  if (!ctx.from) {
    await next();
    return;
  }

  // Skip if already authenticated in this session
  if (ctx.session.isAuthenticated && ctx.session.user) {
    await next();
    return;
  }

  // Try to authenticate with Telegram
  const telegramUser = ctx.from;

  try {
    // Fetch profile photo URL
    const photoUrl = await getUserProfilePhotoUrl(ctx, telegramUser.id);

    const response = await apiClient.loginWithTelegram({
      telegramId: telegramUser.id,
      username: telegramUser.username,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name,
      languageCode: telegramUser.language_code,
      isPremium: telegramUser.is_premium,
      photoUrl,
    });

    if (response.success && response.data) {
      ctx.session.user = response.data.user;
      ctx.session.tokens = response.data.tokens;
      ctx.session.isAuthenticated = true;
      ctx.session.isNewUser = response.data.isNewUser;

      const status = response.data.isNewUser ? "New user created" : "User authenticated";
      console.log(
        `${status}: ${telegramUser.id} (@${telegramUser.username})`
      );
    } else {
      console.log(
        `Auth failed for ${telegramUser.id}: ${response.error?.message}`
      );
    }
  } catch (error) {
    console.error("Auth middleware error:", error);
  }

  await next();
}

// Helper to check if user is authenticated
export async function requireAuth(
  ctx: BotContext,
  callback: () => Promise<void>
): Promise<void> {
  if (!ctx.session.isAuthenticated) {
    await ctx.reply("Please start the bot first with /start to authenticate.");
    return;
  }
  await callback();
}
