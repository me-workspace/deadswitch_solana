/** Standard API response envelope */
export interface ApiResponse<T> {
  data: T;
  meta?: {
    version: string;
    timestamp: number;
  };
  error?: string;
}

/** Paginated response */
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta: {
    version: string;
    timestamp: number;
    total: number;
    page: number;
    pageSize: number;
  };
}

/** API error response */
export interface ApiError {
  error: string;
  code: string;
  details?: Record<string, string[]>;
}

/** Heartbeat activity types */
export type ActivityType =
  | "heartbeat"
  | "manual"
  | "creation"
  | "update"
  | "top_up"
  | "execution"
  | "cancellation";

/** Heartbeat record from DB */
export interface HeartbeatRecord {
  id: string;
  vaultId: string;
  txSignature: string;
  sourceTx: string | null;
  activityType: ActivityType;
  description: string | null;
  recordedAt: string;
}

/** Alert config from DB */
export interface AlertConfig {
  email: string | null;
  telegramId: string | null;
  enabled: boolean;
  lastAlertThreshold: number | null;
}

/** Token price from price API */
export interface TokenPrice {
  mint: string;
  symbol: string;
  priceUsd: number;
  updatedAt: string;
}
