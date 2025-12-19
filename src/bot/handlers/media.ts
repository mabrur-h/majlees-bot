import { InlineKeyboard } from "grammy";
import type { BotContext, PendingMedia } from "../context.js";
import { uploadService } from "../../api/upload.js";
import { checkMinutesForUpload } from "./balance.js";
import { config } from "../../config.js";

// Track media group IDs to avoid duplicate messages
const handledMediaGroups = new Map<string, number>();

// Clean up old media group IDs (older than 1 minute)
function cleanupMediaGroups(): void {
  const now = Date.now();
  for (const [groupId, timestamp] of handledMediaGroups) {
    if (now - timestamp > 60000) {
      handledMediaGroups.delete(groupId);
    }
  }
}

export async function handleMedia(ctx: BotContext): Promise<void> {
  const message = ctx.message;
  if (!message) return;

  // Check if this is part of a media group (album)
  if (message.media_group_id) {
    cleanupMediaGroups();

    // Only show message once per media group
    if (!handledMediaGroups.has(message.media_group_id)) {
      handledMediaGroups.set(message.media_group_id, Date.now());
      await ctx.reply(
        "📂 *Bir nechta fayl aniqlandi*\n\n" +
        "Iltimos, fayllarni bittadan yuboring.\n" +
        "Har bir fayl alohida qayta ishlanishi kerak.",
        { parse_mode: "Markdown" }
      );
    }
    return;
  }

  // Check if there's already an upload in progress
  if (ctx.session.isUploading) {
    await ctx.reply(
      "⏳ *Yuklash davom etmoqda*\n\n" +
      "Iltimos, joriy fayl yuklanishini kuting.\n" +
      "Fayllarni bittadan yuklang.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Check if there's a pending media waiting for type selection
  // If so, replace it with the new file (better UX than blocking)
  if (ctx.session.pendingMedia) {
    // Notify user that we're replacing the old file
    await ctx.reply(
      "🔄 *Yangi fayl qabul qilindi*\n\n" +
      "Oldingi fayl o'rniga yangi fayl qayta ishlanadi.",
      { parse_mode: "Markdown" }
    );
    // Clear the old pending media (will be replaced below)
    ctx.session.pendingMedia = undefined;
  }

  const messageId = message.message_id;
  const chatId = message.chat.id;

  let fileId: string | undefined;
  let fileName: string | undefined;
  let fileSize: number | undefined;
  let mimeType: string | undefined;
  let duration: number | undefined;

  if (message.video) {
    fileId = message.video.file_id;
    fileName = message.video.file_name;
    fileSize = message.video.file_size;
    mimeType = message.video.mime_type;
    duration = message.video.duration;
  } else if (message.audio) {
    fileId = message.audio.file_id;
    fileName = message.audio.file_name;
    fileSize = message.audio.file_size;
    mimeType = message.audio.mime_type;
    duration = message.audio.duration;
  } else if (message.voice) {
    fileId = message.voice.file_id;
    fileSize = message.voice.file_size;
    // Voice messages are always Ogg Opus, but Telegram may not provide mime_type
    // or may provide "audio/ogg; codecs=opus" which doesn't match exactly
    mimeType = "audio/ogg";
    duration = message.voice.duration;
    fileName = "voice_" + Date.now() + ".ogg";
  } else if (message.video_note) {
    fileId = message.video_note.file_id;
    fileSize = message.video_note.file_size;
    duration = message.video_note.duration;
    mimeType = "video/mp4";
    fileName = "video_note_" + Date.now() + ".mp4";
  }

  if (!fileId) {
    await ctx.reply("Bu media faylni qayta ishlab bo'lmadi.");
    return;
  }

  // Check file size - Cloud API has 20MB limit, Local API has 2GB limit
  if (fileSize && fileSize > config.maxFileSize) {
    const fileSizeMB = (fileSize / 1024 / 1024).toFixed(1);
    const maxSizeMB = Math.round(config.maxFileSize / 1024 / 1024);
    const keyboard = new InlineKeyboard()
      .webApp("🌐 Web ilovani ochish", config.webAppUrl);

    await ctx.reply(
      `📁 *Fayl juda katta*\n\n` +
        `📊 Fayl hajmi: ${fileSizeMB} MB\n` +
        `⚠️ Telegram orqali maksimum ${maxSizeMB} MB gacha fayl yuklash mumkin.\n\n` +
        `Katta fayllarni yuklash uchun web ilovadan foydalaning:`,
      {
        parse_mode: "Markdown",
        reply_markup: keyboard,
        reply_parameters: { message_id: messageId },
      }
    );
    return;
  }

  const pendingMedia: PendingMedia = {
    messageId,
    chatId,
    fileId,
    fileName,
    fileSize,
    mimeType,
    duration,
  };
  ctx.session.pendingMedia = pendingMedia;

  // Show file info and type selection with cancel option
  const fileSizeMB = fileSize ? (fileSize / 1024 / 1024).toFixed(1) : "?";
  const durationMin = duration ? Math.ceil(duration / 60) : "?";

  const keyboard = new InlineKeyboard()
    .text("📚 Ma'ruza", "type:meeting")
    .text("🎯 CustDev", "type:custdev")
    .row()
    .text("❌ Bekor qilish", "type:cancel");

  await ctx.reply(
    `📁 *Fayl qabul qilindi*\n\n` +
      `📊 Hajmi: ${fileSizeMB} MB\n` +
      `⏱ Davomiyligi: ~${durationMin} daqiqa\n\n` +
      `Kontent turini tanlang:`,
    {
      parse_mode: "Markdown",
      reply_markup: keyboard,
      reply_parameters: { message_id: messageId },
    }
  );
}

export async function handleTypeSelection(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;

  if (!data?.startsWith("type:")) {
    return;
  }

  const [, type] = data.split(":");

  // Handle cancel
  if (type === "cancel") {
    await ctx.answerCallbackQuery("Bekor qilindi");
    ctx.session.pendingMedia = undefined;
    await ctx.editMessageText("❌ Bekor qilindi. Yangi fayl yuborishingiz mumkin.");
    return;
  }

  const summarizationType = type === "meeting" ? "lecture" : "custdev";
  const typeName = type === "meeting" ? "📚 Ma'ruza" : "🎯 CustDev";

  await ctx.answerCallbackQuery();

  const pendingMedia = ctx.session.pendingMedia;
  if (!pendingMedia) {
    await ctx.editMessageText("⚠️ Media topilmadi. Iltimos, avval video yoki audio fayl yuboring.");
    return;
  }

  if (!ctx.session.isAuthenticated || !ctx.session.tokens) {
    await ctx.editMessageText("⚠️ Iltimos, avval /start buyrug'ini yuboring");
    return;
  }

  // Check if user has enough minutes for this media
  if (pendingMedia.duration) {
    const hasMinutes = await checkMinutesForUpload(ctx, pendingMedia.duration);
    if (!hasMinutes) {
      // User doesn't have enough minutes - message already sent by checkMinutesForUpload
      ctx.session.pendingMedia = undefined;
      return;
    }
  }

  // Mark upload as in progress
  ctx.session.isUploading = true;
  ctx.session.pendingMedia = undefined;

  // Step 1: Getting file from Telegram
  await ctx.editMessageText(`${typeName}\n\n⏳ Yuklab olinmoqda... (1/3)`);

  try {
    const file = await ctx.api.getFile(pendingMedia.fileId);
    if (!file.file_path) {
      throw new Error("Fayl yo'lini olib bo'lmadi");
    }

    // Step 2: Uploading to server
    await ctx.editMessageText(`${typeName}\n\n📤 Serverga yuklanmoqda... (2/3)`);

    let result;
    const uploadOptions = {
      filename: pendingMedia.fileName || "upload_" + Date.now(),
      mimeType: pendingMedia.mimeType || "application/octet-stream",
      language: "uz",
      summarizationType: summarizationType as "lecture" | "custdev",
    };

    if (config.useLocalBotApi) {
      // Local Bot API returns a local file path
      // The file is stored locally by telegram-bot-api server
      // Progress callback to update user on upload progress
      let lastProgressUpdate = 0;
      const onProgress = async (percent: number) => {
        // Only update every 20% to avoid rate limiting
        if (percent - lastProgressUpdate >= 20 || percent === 100) {
          lastProgressUpdate = percent;
          try {
            await ctx.editMessageText(
              `${typeName}\n\n📤 Serverga yuklanmoqda... (2/3)\n\n` +
              `${"▓".repeat(Math.floor(percent / 10))}${"░".repeat(10 - Math.floor(percent / 10))} ${percent}%`
            );
          } catch {
            // Ignore edit errors (message might not have changed)
          }
        }
      };

      result = await uploadService.uploadFromLocalPath(
        ctx.session.tokens.accessToken,
        file.file_path,
        uploadOptions,
        undefined, // botToken
        undefined, // localApiUrl
        onProgress
      );
    } else {
      // Cloud API - construct URL to download file
      const fileUrl = "https://api.telegram.org/file/bot" + ctx.api.token + "/" + file.file_path;
      result = await uploadService.uploadFromUrl(
        ctx.session.tokens.accessToken,
        fileUrl,
        uploadOptions
      );
    }

    if (result.success && result.lectureId) {
      // Step 3: Success
      await ctx.editMessageText(
        `${typeName}\n\n` +
          `✅ *Muvaffaqiyatli yuklandi!* (3/3)\n\n` +
          `Transkriptsiya va xulosa tayyor bo'lganda xabar beramiz.\n` +
          `Bu odatda 5-10 daqiqa davom etadi.`,
        { parse_mode: "Markdown" }
      );
      console.log("Upload successful. Lecture ID: " + result.lectureId);
    } else if (result.isRateLimited) {
      await ctx.editMessageText(
        "⏳ *Biroz kuting*\n\n" +
          "Siz soatiga maksimum 10 ta fayl yuklashingiz mumkin.\n" +
          "Iltimos, biroz kuting va qaytadan urinib ko'ring.",
        { parse_mode: "Markdown" }
      );
      console.log("Upload rate limited for user");
    } else {
      throw new Error(result.error || "Yuklash muvaffaqiyatsiz");
    }
  } catch (error) {
    console.error("Upload error:", error);

    // Check if it's a "file is too big" error from Telegram
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isFileTooLarge = errorMessage.includes("file is too big") || errorMessage.includes("file_too_big");

    if (isFileTooLarge) {
      const keyboard = new InlineKeyboard()
        .webApp("🌐 Web ilovani ochish", config.webAppUrl);

      await ctx.editMessageText(
        `${typeName}\n\n` +
          `📁 *Fayl juda katta*\n\n` +
          `⚠️ Telegram orqali maksimum 20 MB gacha fayl yuklash mumkin.\n\n` +
          `Katta fayllarni yuklash uchun web ilovadan foydalaning:`,
        {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        }
      );
    } else {
      await ctx.editMessageText(
        `${typeName}\n\n` +
          `❌ *Xatolik yuz berdi*\n\n` +
          `Iltimos, qaytadan urinib ko'ring.\n` +
          `Muammo davom etsa, /start buyrug'ini yuboring.`,
        { parse_mode: "Markdown" }
      );
    }
  } finally {
    // Always clear the uploading flag when done
    ctx.session.isUploading = false;
  }
}
