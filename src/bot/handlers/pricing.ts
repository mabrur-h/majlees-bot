import { InlineKeyboard, InputFile } from "grammy";
import path from "path";
import type { BotContext } from "../context.js";
import { apiClient } from "../../api/client.js";

const PRICING_IMAGE_PATH = path.join(process.cwd(), "public", "images", "pricing_plans.png");

// Format price with thousand separators
function formatPrice(price: number): string {
  return price.toLocaleString("uz-UZ");
}

/**
 * Build pricing message and keyboard from API data
 */
async function buildPricingContent(): Promise<{ message: string; keyboard: InlineKeyboard } | null> {
  const plansResponse = await apiClient.getPlans();

  if (!plansResponse.success || !plansResponse.data) {
    return null;
  }

  const plans = plansResponse.data.plans;

  // Build message
  let message = "📊 *UzNotes Tariflar*\n\n";
  message += "Har bir foydalanuvchi oyiga *30 daqiqa* bepul sinov imkoniyatiga ega\\!\n\n";

  // Build keyboard
  const keyboard = new InlineKeyboard();

  for (const plan of plans) {
    if (plan.name === "free") continue;

    const emoji = plan.name === "starter" ? "🟢" : plan.name === "pro" ? "🔵" : "🟣";
    const price = formatPrice(plan.priceUzs);
    keyboard.text(`${emoji} ${plan.displayName} - ${price} UZS`, `plan_${plan.name}`).row();
  }

  keyboard.text("➕ Qo'shimcha daqiqalar", "packages_menu").row();

  return { message, keyboard };
}

/**
 * /pricing or /plans command - Show subscription plans
 */
export async function handlePricing(ctx: BotContext): Promise<void> {
  const content = await buildPricingContent();

  if (!content) {
    await ctx.reply("Tariflarni olishda xatolik yuz berdi. Qayta urinib ko'ring.");
    return;
  }

  // Send pricing image with caption and keyboard
  await ctx.replyWithPhoto(new InputFile(PRICING_IMAGE_PATH), {
    caption: content.message,
    parse_mode: "MarkdownV2",
    reply_markup: content.keyboard,
  });
}

/**
 * Handle plan selection callback
 */
export async function handlePlanSelection(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const planName = data.replace("plan_", "");

  const planDetails: Record<string, { name: string; price: string; minutes: number; features: string[] }> = {
    starter: {
      name: "Starter",
      price: "99,000 UZS",
      minutes: 300,
      features: [
        "✅ 300 daqiqa (5 soat) video",
        "✅ Cheksiz transkriptsiya",
        "✅ AI xulosalar",
        "✅ Telegram + Web",
      ],
    },
    pro: {
      name: "Pro",
      price: "189,000 UZS",
      minutes: 900,
      features: [
        "✅ 900 daqiqa (15 soat) video",
        "✅ Cheksiz transkriptsiya",
        "✅ AI xulosalar",
        "✅ CustDev tahlil",
        "✅ Telegram + Web",
        "✅ Papkalar va teglar",
      ],
    },
    business: {
      name: "Business",
      price: "349,000 UZS",
      minutes: 2400,
      features: [
        "✅ 2400 daqiqa (40 soat) video",
        "✅ Cheksiz transkriptsiya",
        "✅ AI xulosalar",
        "✅ CustDev tahlil",
        "✅ Mind map",
        "✅ Telegram + Web",
        "✅ Papkalar va teglar",
        "✅ Ustuvor qo'llab-quvvatlash",
      ],
    },
  };

  const plan = planDetails[planName];
  if (!plan) {
    await ctx.answerCallbackQuery("Tarif topilmadi");
    return;
  }

  const message =
    `📦 *${plan.name} tarifi*\n\n` +
    `💰 Narxi: *${plan.price}/oy*\n` +
    `⏱ Daqiqalar: *${plan.minutes} daqiqa*\n\n` +
    `*Imkoniyatlar:*\n${plan.features.join("\n")}\n\n` +
    `Sotib olishni tasdiqlaysizmi?`;

  const keyboard = new InlineKeyboard()
    .text("✅ Sotib olish", `buy_plan_${planName}`)
    .text("◀️ Orqaga", "back_to_plans");

  await ctx.editMessageCaption({
    caption: message,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Handle packages menu callback
 */
export async function handlePackagesMenu(ctx: BotContext): Promise<void> {
  const caption =
    `➕ *Qo'shimcha daqiqalar*\n\n` +
    `Agar daqiqalaringiz tugab qolsa yoki yetarli bo'lmasa, ` +
    `qo'shimcha paketlar sotib olishingiz mumkin.\n\n` +
    `Bu daqiqalar keyingi oyga o'tmaydi va hozirgi hisobingizga qo'shiladi.`;

  const keyboard = new InlineKeyboard()
    .text("⏱ 1 soat - 36,000 UZS", "package_1hr")
    .row()
    .text("⏱ 5 soat - 229,000 UZS", "package_5hr")
    .row()
    .text("⏱ 10 soat - 289,000 UZS", "package_10hr")
    .row()
    .text("◀️ Orqaga", "back_to_plans");

  // Check if current message is a photo (has caption) or text message
  const message = ctx.callbackQuery?.message;
  const isPhotoMessage = message && "photo" in message && message.photo;

  if (isPhotoMessage) {
    // Edit caption on existing photo
    await ctx.editMessageCaption({
      caption: caption,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  } else {
    // Current message is text (e.g., from balance view) - send new pricing photo
    await ctx.replyWithPhoto(new InputFile(PRICING_IMAGE_PATH), {
      caption: caption,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }

  await ctx.answerCallbackQuery();
}

/**
 * Handle package selection callback
 */
export async function handlePackageSelection(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const packageName = data.replace("package_", "");

  const packageDetails: Record<string, { name: string; price: string; minutes: number }> = {
    "1hr": { name: "1 soat", price: "36,000 UZS", minutes: 60 },
    "5hr": { name: "5 soat", price: "229,000 UZS", minutes: 300 },
    "10hr": { name: "10 soat", price: "289,000 UZS", minutes: 600 },
  };

  const pkg = packageDetails[packageName];
  if (!pkg) {
    await ctx.answerCallbackQuery("Paket topilmadi");
    return;
  }

  const message =
    `📦 *${pkg.name} paketi*\n\n` +
    `💰 Narxi: *${pkg.price}*\n` +
    `⏱ Daqiqalar: *${pkg.minutes} daqiqa*\n\n` +
    `Bu daqiqalar hozirgi hisobingizga qo'shiladi.\n\n` +
    `Sotib olishni tasdiqlaysizmi?`;

  const keyboard = new InlineKeyboard()
    .text("✅ Sotib olish", `buy_package_${packageName}`)
    .text("◀️ Orqaga", "packages_menu");

  await ctx.editMessageCaption({
    caption: message,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Handle back to plans callback
 */
export async function handleBackToPlans(ctx: BotContext): Promise<void> {
  const content = await buildPricingContent();

  if (!content) {
    await ctx.answerCallbackQuery("Xatolik yuz berdi");
    return;
  }

  // Check if current message is a photo (has caption) or text message
  const message = ctx.callbackQuery?.message;
  const isPhotoMessage = message && "photo" in message && message.photo;

  if (isPhotoMessage) {
    // Edit caption on existing photo
    await ctx.editMessageCaption({
      caption: content.message,
      parse_mode: "MarkdownV2",
      reply_markup: content.keyboard,
    });
  } else {
    // Current message is text (e.g., from balance view) - send new pricing photo
    await ctx.replyWithPhoto(new InputFile(PRICING_IMAGE_PATH), {
      caption: content.message,
      parse_mode: "MarkdownV2",
      reply_markup: content.keyboard,
    });
  }

  await ctx.answerCallbackQuery();
}

/**
 * Handle plan purchase callback
 */
export async function handleBuyPlan(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const planName = data.replace("buy_plan_", "");

  // Check if user is authenticated
  if (!ctx.session.isAuthenticated || !ctx.session.tokens) {
    await ctx.answerCallbackQuery("Iltimos, avval /start buyrug'ini yuboring");
    return;
  }

  try {
    const response = await apiClient.activatePlanByName(
      ctx.session.tokens.accessToken,
      planName
    );

    // Check if user no longer exists (deleted after account merge)
    if (response.error?.code === "USER_NOT_FOUND") {
      ctx.session.isAuthenticated = false;
      ctx.session.tokens = undefined;
      ctx.session.user = undefined;
      await ctx.answerCallbackQuery("Sizning sessiyangiz yaroqsiz. Iltimos, /start buyrug'ini yuboring.");
      return;
    }

    if (response.success && response.data) {
      // Check if payment is required
      if (response.data.requiresPayment && response.data.paymentUrl) {
        // Paid plan - show payment link
        const payment = response.data.payment;
        const message =
          `💳 *To'lov talab qilinadi*\n\n` +
          `📦 Tarif: *${payment?.planDisplayName || planName}*\n` +
          `💰 Narxi: *${formatPrice(payment?.amountUzs || 0)} UZS*\n\n` +
          `Quyidagi tugmani bosib to'lovni amalga oshiring.\n` +
          `To'lov tasdiqlangandan so'ng tarif avtomatik faollashadi.`;

        const keyboard = new InlineKeyboard()
          .url("💳 To'lovga o'tish", response.data.paymentUrl)
          .row()
          .text("◀️ Orqaga", "back_to_plans");

        await ctx.editMessageCaption({
          caption: message,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } else {
        // Free plan - activated immediately
        const message =
          `✅ *Tarif muvaffaqiyatli faollashtirildi!*\n\n` +
          `Siz endi *${planName.charAt(0).toUpperCase() + planName.slice(1)}* tarifidan foydalanishingiz mumkin.\n\n` +
          `/balance - Daqiqalar balansini ko'rish`;

        const keyboard = new InlineKeyboard().text("📊 Balansni ko'rish", "show_balance");

        await ctx.editMessageCaption({
          caption: message,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      }
    } else {
      const errorMsg = response.error?.message || "Xatolik yuz berdi";
      await ctx.editMessageCaption({
        caption: `❌ ${errorMsg}. Iltimos, qayta urinib ko'ring.`,
        reply_markup: new InlineKeyboard().text("◀️ Orqaga", "back_to_plans"),
      });
    }
  } catch (error) {
    console.error("Error activating plan:", error);
    await ctx.editMessageCaption({
      caption: "❌ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring.",
      reply_markup: new InlineKeyboard().text("◀️ Orqaga", "back_to_plans"),
    });
  }

  await ctx.answerCallbackQuery();
}

/**
 * Handle package purchase callback
 */
export async function handleBuyPackage(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const packageName = data.replace("buy_package_", "");

  // Check if user is authenticated
  if (!ctx.session.isAuthenticated || !ctx.session.tokens) {
    await ctx.answerCallbackQuery("Iltimos, avval /start buyrug'ini yuboring");
    return;
  }

  try {
    const response = await apiClient.purchasePackageByName(
      ctx.session.tokens.accessToken,
      packageName
    );

    // Check if user no longer exists (deleted after account merge)
    if (response.error?.code === "USER_NOT_FOUND") {
      ctx.session.isAuthenticated = false;
      ctx.session.tokens = undefined;
      ctx.session.user = undefined;
      await ctx.answerCallbackQuery("Sizning sessiyangiz yaroqsiz. Iltimos, /start buyrug'ini yuboring.");
      return;
    }

    if (response.success && response.data) {
      // Check if payment is required (it always is for packages)
      if (response.data.requiresPayment && response.data.paymentUrl) {
        const payment = response.data.payment;
        const message =
          `💳 *To'lov talab qilinadi*\n\n` +
          `📦 Paket: *${payment?.packageDisplayName || packageName}*\n` +
          `💰 Narxi: *${formatPrice(payment?.amountUzs || 0)} UZS*\n\n` +
          `Quyidagi tugmani bosib to'lovni amalga oshiring.\n` +
          `To'lov tasdiqlangandan so'ng daqiqalar hisobingizga qo'shiladi.`;

        const keyboard = new InlineKeyboard()
          .url("💳 To'lovga o'tish", response.data.paymentUrl)
          .row()
          .text("◀️ Orqaga", "packages_menu");

        await ctx.editMessageCaption({
          caption: message,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } else {
        // Fallback (shouldn't happen for packages)
        const message =
          `✅ *Paket muvaffaqiyatli sotib olindi!*\n\n` +
          `Daqiqalar hisobingizga qo'shildi.\n\n` +
          `/balance - Yangi balansni ko'rish`;

        const keyboard = new InlineKeyboard().text("📊 Balansni ko'rish", "show_balance");

        await ctx.editMessageCaption({
          caption: message,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      }
    } else {
      const errorMsg = response.error?.message || "Xatolik yuz berdi";
      await ctx.editMessageCaption({
        caption: `❌ ${errorMsg}. Iltimos, qayta urinib ko'ring.`,
        reply_markup: new InlineKeyboard().text("◀️ Orqaga", "packages_menu"),
      });
    }
  } catch (error) {
    console.error("Error purchasing package:", error);
    await ctx.editMessageCaption({
      caption: "❌ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring.",
      reply_markup: new InlineKeyboard().text("◀️ Orqaga", "packages_menu"),
    });
  }

  await ctx.answerCallbackQuery();
}
