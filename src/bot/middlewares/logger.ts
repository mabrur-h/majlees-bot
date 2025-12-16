import type { BotContext } from "../context.js";
import type { NextFunction } from "grammy";

export async function loggerMiddleware(
  ctx: BotContext,
  next: NextFunction
): Promise<void> {
  const start = Date.now();
  const updateType = ctx.update.message
    ? "message"
    : ctx.update.callback_query
      ? "callback_query"
      : "other";

  console.log(`→ [${updateType}] from ${ctx.from?.id ?? "unknown"}`);

  await next();

  const ms = Date.now() - start;
  console.log(`← [${updateType}] completed in ${ms}ms`);
}
