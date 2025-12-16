import { Context, SessionFlavor } from "grammy";
import type { User, AuthTokens } from "../api/index.js";

// Pending media info for type selection flow
export interface PendingMedia {
  messageId: number;
  chatId: number;
  fileId: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  duration?: number;
}

// Session data stored per user
export interface SessionData {
  user?: User;
  tokens?: AuthTokens;
  isAuthenticated: boolean;
  isNewUser?: boolean;
  pendingMedia?: PendingMedia;
  isUploading?: boolean; // Track if an upload is currently in progress
}

// Default session data
export function createInitialSessionData(): SessionData {
  return {
    isAuthenticated: false,
  };
}

// Extended context with session
export interface BotContext extends Context, SessionFlavor<SessionData> {
  // Add custom context properties here as needed
}
