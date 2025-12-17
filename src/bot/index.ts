import { Bot, session } from "grammy";
import { config } from "../config.js";
import type { BotContext } from "./context.js";
import { createInitialSessionData } from "./context.js";
import { loggerMiddleware } from "./middlewares/logger.js";
import { authMiddleware } from "./middlewares/auth.js";
import {
  handleStart,
  handleHelp,
  handleApp,
  handleTranscribeVideo,
  handleShowPlans,
  handleTextTranscribe,
  BUTTON_TRANSCRIBE,
  BUTTON_BALANCE,
  BUTTON_PLANS,
  handleMedia,
  handleTypeSelection,
  handlePricing,
  handlePlanSelection,
  handlePackagesMenu,
  handlePackageSelection,
  handleBackToPlans,
  handleBuyPlan,
  handleBuyPackage,
  handleBalance,
  handleShowBalance,
  handleInfo,
  handleShowInfo,
  handleSettings,
  handleShowSettings,
  handleLinkGoogle,
  handleUnlinkGoogle,
  handleBackToSettings,
  handleBackToMain,
} from "./handlers/index.js";

export function createBot(): Bot<BotContext> {
  // Configure bot with Local Bot API if enabled
  const botConfig = config.useLocalBotApi
    ? {
        client: {
          // Use Local Bot API server URL
          apiRoot: config.localBotApiUrl,
        },
      }
    : undefined;

  const bot = new Bot<BotContext>(config.botToken, botConfig);

  if (config.useLocalBotApi) {
    console.log("Using Local Bot API at: " + config.localBotApiUrl);
    console.log("Max file size: " + (config.maxFileSize / 1024 / 1024 / 1024).toFixed(1) + " GB");
  }

  // Session middleware (must be first)
  bot.use(
    session({
      initial: createInitialSessionData,
    })
  );

  // Register middlewares
  if (config.isDev) {
    bot.use(loggerMiddleware);
  }

  // Auth middleware - authenticates users with backend
  bot.use(authMiddleware);

  // Register command handlers
  bot.command("start", handleStart);
  bot.command("help", handleHelp);
  bot.command("app", handleApp);
  bot.command(["pricing", "plans", "tarif"], handlePricing);
  bot.command(["balance", "balans", "daqiqalar"], handleBalance);
  bot.command(["info", "malumot", "qollanma"], handleInfo);
  bot.command(["settings", "sozlamalar"], handleSettings);

  // Handle text button messages
  bot.hears(BUTTON_TRANSCRIBE, handleTextTranscribe);
  bot.hears(BUTTON_BALANCE, handleBalance);
  bot.hears(BUTTON_PLANS, handlePricing);

  // Handle video and audio messages
  bot.on(":video", handleMedia);
  bot.on(":audio", handleMedia);
  bot.on(":voice", handleMedia);
  bot.on(":video_note", handleMedia);

  // Handle callback queries for main menu
  bot.callbackQuery("transcribe_video", handleTranscribeVideo);
  bot.callbackQuery("show_plans", handleShowPlans);
  bot.callbackQuery("show_balance", handleShowBalance);

  // Handle callback queries for type selection
  bot.callbackQuery(/^type:/, handleTypeSelection);

  // Handle callback queries for pricing/subscription
  bot.callbackQuery(/^plan_/, handlePlanSelection);
  bot.callbackQuery("packages_menu", handlePackagesMenu);
  bot.callbackQuery(/^package_/, handlePackageSelection);
  bot.callbackQuery("back_to_plans", handleBackToPlans);
  bot.callbackQuery(/^buy_plan_/, handleBuyPlan);
  bot.callbackQuery(/^buy_package_/, handleBuyPackage);

  // Handle callback queries for settings/account linking
  bot.callbackQuery("show_info", handleShowInfo);
  bot.callbackQuery("show_settings", handleShowSettings);
  bot.callbackQuery("link_google", handleLinkGoogle);
  bot.callbackQuery("unlink_google", handleUnlinkGoogle);
  bot.callbackQuery("back_to_settings", handleBackToSettings);
  bot.callbackQuery("back_to_main", handleBackToMain);

  // Error handling
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  return bot;
}

export type { BotContext } from "./context.js";
