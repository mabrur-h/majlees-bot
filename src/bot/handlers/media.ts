import { InlineKeyboard } from "grammy";
import type { BotContext, PendingMedia } from "../context.js";
import { uploadService } from "../../api/upload.js";
import { checkMinutesForUpload } from "./balance.js";

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
  if (ctx.session.pendingMedia) {
    await ctx.reply(
      "📁 *Oldingi fayl kutilmoqda*\n\n" +
      "Siz allaqachon bitta fayl yuborgansiz.\n" +
      "Iltimos, avval uning turini tanlang yoki yangi fayl yuborish uchun kuting.",
      { parse_mode: "Markdown" }
    );
    return;
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
    mimeType = message.voice.mime_type;
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

  // Step 1: Downloading from Telegram
  await ctx.editMessageText(`${typeName}\n\n⏳ Yuklab olinmoqda... (1/3)`);

  try {
    const file = await ctx.api.getFile(pendingMedia.fileId);
    if (!file.file_path) {
      throw new Error("Fayl yo'lini olib bo'lmadi");
    }

    const fileUrl = "https://api.telegram.org/file/bot" + ctx.api.token + "/" + file.file_path;

    // Step 2: Uploading to server
    await ctx.editMessageText(`${typeName}\n\n📤 Serverga yuklanmoqda... (2/3)`);

    const result = await uploadService.uploadFromUrl(
      ctx.session.tokens.accessToken,
      fileUrl,
      {
        filename: pendingMedia.fileName || "upload_" + Date.now(),
        mimeType: pendingMedia.mimeType || "application/octet-stream",
        language: "uz",
        summarizationType: summarizationType,
      }
    );

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
    await ctx.editMessageText(
      `${typeName}\n\n` +
        `❌ *Xatolik yuz berdi*\n\n` +
        `Iltimos, qaytadan urinib ko'ring.\n` +
        `Muammo davom etsa, /start buyrug'ini yuboring.`,
      { parse_mode: "Markdown" }
    );
  } finally {
    // Always clear the uploading flag when done
    ctx.session.isUploading = false;
  }
}
