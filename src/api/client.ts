import { config } from "../config.js";
import type {
  ApiResponse,
  LoginResponse,
  TelegramAuthPayload,
  TelegramAuthResponse,
  MeResponse,
  LogoutResponse,
  User,
  PlansResponse,
  PackagesResponse,
  BalanceResponse,
  ActivatePlanResponse,
  PurchasePackageResponse,
  CompleteTelegramLinkPayload,
  AccountLinkResponse,
  LinkedAccountsStatusResponse,
} from "./types.js";

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const text = await response.text();

      if (!text) {
        console.error(`API returned empty response: ${endpoint} (status: ${response.status})`);
        return {
          success: false,
          error: {
            code: "EMPTY_RESPONSE",
            message: `Server returned empty response with status ${response.status}`,
          },
        };
      }

      try {
        const data = JSON.parse(text) as ApiResponse<T>;
        return data;
      } catch {
        console.error(`API returned invalid JSON: ${endpoint}`, text.substring(0, 200));
        return {
          success: false,
          error: {
            code: "INVALID_JSON",
            message: "Server returned invalid JSON",
          },
        };
      }
    } catch (error) {
      console.error(`API request failed: ${endpoint}`, error);
      return {
        success: false,
        error: {
          code: "NETWORK_ERROR",
          message: error instanceof Error ? error.message : "Network error",
        },
      };
    }
  }

  // Auth endpoints
  async loginWithTelegram(
    payload: TelegramAuthPayload
  ): Promise<ApiResponse<TelegramAuthResponse>> {
    return this.request<TelegramAuthResponse>("/api/v1/auth/telegram", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getMe(accessToken: string): Promise<ApiResponse<MeResponse>> {
    return this.request<MeResponse>("/api/v1/auth/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  async logout(refreshToken: string): Promise<ApiResponse<LogoutResponse>> {
    return this.request<LogoutResponse>("/api/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
  }

  async refreshTokens(
    refreshToken: string
  ): Promise<ApiResponse<LoginResponse>> {
    return this.request<LoginResponse>("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
  }

  // Helper to make authenticated requests
  async authenticatedRequest<T>(
    endpoint: string,
    accessToken: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      headers: {
        ...((options.headers as Record<string, string>) || {}),
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  // Subscription endpoints (public - no auth required)
  async getPlans(): Promise<ApiResponse<PlansResponse>> {
    return this.request<PlansResponse>("/api/v1/subscription/plans", {
      method: "GET",
    });
  }

  async getPackages(): Promise<ApiResponse<PackagesResponse>> {
    return this.request<PackagesResponse>("/api/v1/subscription/packages", {
      method: "GET",
    });
  }

  // Subscription endpoints (authenticated)
  async getBalance(accessToken: string): Promise<ApiResponse<BalanceResponse>> {
    return this.authenticatedRequest<BalanceResponse>(
      "/api/v1/subscription/balance",
      accessToken
    );
  }

  async activatePlanByName(
    accessToken: string,
    planName: string
  ): Promise<ApiResponse<ActivatePlanResponse>> {
    return this.authenticatedRequest<ActivatePlanResponse>(
      "/api/v1/subscription/activate-plan-by-name",
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({ planName }),
      }
    );
  }

  async purchasePackageByName(
    accessToken: string,
    packageName: string
  ): Promise<ApiResponse<PurchasePackageResponse>> {
    return this.authenticatedRequest<PurchasePackageResponse>(
      "/api/v1/subscription/purchase-package-by-name",
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({ packageName }),
      }
    );
  }

  // Account Linking endpoints
  async completeTelegramLink(
    payload: CompleteTelegramLinkPayload
  ): Promise<ApiResponse<AccountLinkResponse>> {
    return this.request<AccountLinkResponse>("/api/v1/auth/link/telegram/complete", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getLinkedAccountsStatus(
    accessToken: string
  ): Promise<ApiResponse<LinkedAccountsStatusResponse>> {
    return this.authenticatedRequest<LinkedAccountsStatusResponse>(
      "/api/v1/auth/link/status",
      accessToken
    );
  }
}

export const apiClient = new ApiClient(config.apiBaseUrl);
export type { User };
