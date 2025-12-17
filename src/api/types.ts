// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// User types
export interface User {
  id: string;
  email: string | null;
  telegramId: number | null;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  telegramLastName: string | null;
  telegramLanguageCode: string | null;
  telegramIsPremium: boolean;
  telegramPhotoUrl: string | null;
  name: string | null;
  authProvider: "email" | "telegram";
  createdAt: string;
}

// Auth types
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string | number;
}

export interface LoginResponse {
  user: User;
  tokens: AuthTokens;
}

export interface TelegramAuthResponse {
  user: User;
  tokens: AuthTokens;
  isNewUser: boolean;
}

export interface TelegramAuthPayload {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  isPremium?: boolean;
  photoUrl?: string;
}

export interface MeResponse {
  user: User;
}

export interface LogoutResponse {
  message: string;
}

// Subscription types
export interface SubscriptionPlan {
  id: string;
  name: string;
  displayName: string;
  displayNameUz: string | null;
  priceUzs: number;
  minutesPerMonth: number;
  description: string | null;
  descriptionUz: string | null;
  features: string[] | null;
  featuresUz: string[] | null;
  isActive: boolean;
  sortOrder: number;
}

export interface MinutePackage {
  id: string;
  name: string;
  displayName: string;
  displayNameUz: string | null;
  priceUzs: number;
  minutes: number;
  description: string | null;
  descriptionUz: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface MinutesBalance {
  planMinutesRemaining: number;
  planMinutesTotal: number;
  planMinutesUsed: number;
  bonusMinutes: number;
  totalAvailable: number;
  billingCycleStart: string;
  billingCycleEnd: string;
  planName: string;
  planDisplayName: string;
  status: string;
}

export interface UserSubscription {
  id: string;
  userId: string;
  planId: string;
  billingCycleStart: string;
  billingCycleEnd: string;
  minutesIncluded: number;
  minutesUsed: number;
  bonusMinutes: number;
  status: string;
  plan?: SubscriptionPlan;
}

export interface PlansResponse {
  plans: SubscriptionPlan[];
}

export interface PackagesResponse {
  packages: MinutePackage[];
}

export interface BalanceResponse {
  balance: MinutesBalance;
}

export interface SubscriptionResponse {
  subscription: UserSubscription | null;
}

export interface Payment {
  id: string;
  userId: string;
  paymentType: "plan" | "package";
  planId: string | null;
  packageId: string | null;
  amountUzs: number;
  provider: string;
  providerTransactionId: string | null;
  status: "pending" | "completed" | "failed" | "refunded";
  createdAt: string;
  completedAt: string | null;
  planName?: string;
  planDisplayName?: string;
  packageName?: string;
  packageDisplayName?: string;
}

export interface ActivatePlanResponse {
  subscription?: UserSubscription;
  payment?: Payment;
  paymentUrl?: string;
  message: string;
  requiresPayment: boolean;
}

export interface PurchasePackageResponse {
  transaction?: {
    id: string;
    type: string;
    minutes: number;
    description: string | null;
    createdAt: string;
  };
  payment?: Payment;
  paymentUrl?: string;
  message: string;
  requiresPayment: boolean;
}

// Account Linking types
export interface CompleteTelegramLinkPayload {
  token: string;
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  isPremium?: boolean;
  photoUrl?: string | null;
}

export interface AccountLinkResponse {
  user: User;
  merged: boolean;
  message: string;
}

// Linked Accounts Status types
export interface LinkedAccountStatus {
  google: {
    linked: boolean;
    email?: string | null;
  };
  telegram: {
    linked: boolean;
    username?: string | null;
  };
}

export interface LinkedAccountsStatusResponse {
  google: {
    linked: boolean;
    email?: string | null;
  };
  telegram: {
    linked: boolean;
    username?: string | null;
  };
}
