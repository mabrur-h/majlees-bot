import { InputFile, InlineKeyboard, Keyboard } from "grammy";
import path from "path";
import type { BotContext } from "../context.js";
import { config } from "../../config.js";
import {
  handleAccountLink,
  isAccountLinkToken,
  extractLinkToken,
} from "./accountLinking.js";

// Button text constants for text buttons
export const BUTTON_TRANSCRIBE = "🎬 Transkriptsiya";
export const BUTTON_BALANCE = "📊 Balans";
export const BUTTON_PLANS = "📦 Tariflar";

/**
 * Create persistent reply keyboard (text buttons at bottom)
 */
export function getMainReplyKeyboard(): Keyboard {
  return new Keyboard()
    .text(BUTTON_TRANSCRIBE)
    .row()
    .text(BUTTON_BALANCE)
    .text(BUTTON_PLANS)
    .resized()
    .persistent();
}

const IMAGES_DIR = path.join(process.cwd(), "public", "images");
const WEB_APP_URL = config.webAppUrl;

// Onboarding slides
const SLIDE1_CAPTION =
  "🎯 *2 soatlik majlis → 2 daqiqada xulosa*\n\n" +
  "✅ O'zbek, rus, ingliz tillarida transkriptsiya\n" +
  "✅ AI xulosa va asosiy fikrlar\n" +
  "✅ CustDev intervyu tahlili";

const SLIDE2_CAPTION =
  "📤 *Shunchaki video yoki audio yuboring — qolganini biz qilamiz!*";

/**
 * Create main menu keyboard
 */
function getMainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎬 Transkriptsiya qilish", "transcribe_video")
    .row()
    .text("📊 Balans", "show_balance")
    .text("📦 Tariflar", "show_plans")
    .row()
    .text("ℹ️ Qo'llanma", "show_info")
    .text("⚙️ Sozlamalar", "show_settings")
    .row()
    .webApp("🌐 Web ilovani ochish", WEB_APP_URL);
}

export async function handleStart(ctx: BotContext): Promise<void> {
  const startParam = ctx.match as string | undefined;

  // Handle account linking deep link - e.g., t.me/bot?start=link_{token}
  if (startParam && isAccountLinkToken(startParam)) {
    const linkToken = extractLinkToken(startParam);
    await handleAccountLink(ctx, linkToken);
    return;
  }

  // Handle deep links - e.g., t.me/bot?start=lecture_123
  if (startParam?.startsWith("lecture_")) {
    const lectureId = startParam.replace("lecture_", "");
    const keyboard = new InlineKeyboard().webApp(
      "Ma'ruzani ko'rish",
      `${WEB_APP_URL}?startapp=lecture_${lectureId}`
    );

    await ctx.reply("Ma'ruzani ko'rish uchun tugmani bosing:", { reply_markup: keyboard });
    return;
  }

  // Send slide 1 with intro info
  const slide1Path = path.join(IMAGES_DIR, "slide1.png");
  const slide1Message = await ctx.replyWithPhoto(new InputFile(slide1Path), {
    caption: SLIDE1_CAPTION,
    parse_mode: "Markdown",
  });

  // Send slide 2 with CTA and inline keyboard, replying to slide 1
  const slide2Path = path.join(IMAGES_DIR, "slide2.png");
  await ctx.replyWithPhoto(new InputFile(slide2Path), {
    caption: SLIDE2_CAPTION,
    parse_mode: "Markdown",
    reply_markup: getMainMenuKeyboard(),
    reply_parameters: { message_id: slide1Message.message_id },
  });
}

/**
 * Handle text button: Transcribe
 */
export async function handleTextTranscribe(ctx: BotContext): Promise<void> {
  const message =
    "🎬 *Video/audio transkriptsiya qilish*\n\n" +
    "1️⃣ Menga video yoki audio fayl yuboring\n" +
    "2️⃣ Kontent turini tanlang (Ma'ruza yoki CustDev)\n" +
    "3️⃣ AI transkriptsiya va xulosa tayyorlaydi\n\n" +
    "📎 Qo'llab-quvvatlanadigan formatlar: MP4, MP3, WAV, M4A, OGG";

  await ctx.reply(message, { parse_mode: "Markdown" });
}

/**
 * Handle "Transcribe video" button click
 */
export async function handleTranscribeVideo(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const message =
    "🎬 *Video/audio transkriptsiya qilish*\n\n" +
    "1️⃣ Menga video yoki audio fayl yuboring\n" +
    "2️⃣ Kontent turini tanlang (Ma'ruza yoki CustDev)\n" +
    "3️⃣ AI transkriptsiya va xulosa tayyorlaydi\n\n" +
    "📎 Qo'llab-quvvatlanadigan formatlar: MP4, MP3, WAV, M4A, OGG";

  await ctx.reply(message, { parse_mode: "Markdown" });
}

/**
 * Handle "Plans" button click
 */
export async function handleShowPlans(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const { handlePricing } = await import("./pricing.js");
  await handlePricing(ctx);
}

export async function handleHelp(ctx: BotContext): Promise<void> {
  await ctx.reply(
    "Dabir Notes dan qanday foydalanish:\n\n" +
      "1. Menyu tugmasini yoki \"Ilovani ochish\" tugmasini bosing\n" +
      "2. Audio/video ma'ruzangizni yuklang\n" +
      "3. Transkriptsiya, xulosa va asosiy fikrlarni oling\n\n" +
      "Qo'llab-quvvatlanadigan formatlar: MP3, WAV, M4A, MP4 va boshqalar."
  );
}

export async function handleApp(ctx: BotContext): Promise<void> {
  const keyboard = new InlineKeyboard().webApp("Dabir Notes ni ochish", WEB_APP_URL);

  await ctx.reply("Ilovani ochish uchun quyidagi tugmani bosing:", {
    reply_markup: keyboard,
  });
}
