/**
 * Helius Enhanced Webhook payload types.
 *
 * @see https://docs.helius.dev/webhooks-and-websockets/webhooks
 */

/** Token transfer within a transaction */
export interface HeliusTokenTransfer {
  fromTokenAccount: string;
  toTokenAccount: string;
  fromUserAccount: string;
  toUserAccount: string;
  tokenAmount: number;
  mint: string;
  tokenStandard: string;
}

/** Native SOL transfer */
export interface HeliusNativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount: number;
}

/** Account data within a transaction */
export interface HeliusAccountData {
  account: string;
  nativeBalanceChange: number;
  tokenBalanceChanges: Array<{
    userAccount: string;
    tokenAccount: string;
    rawTokenAmount: {
      tokenAmount: string;
      decimals: number;
    };
    mint: string;
  }>;
}

/** Instruction within a transaction */
export interface HeliusInstruction {
  accounts: string[];
  data: string;
  programId: string;
  innerInstructions: Array<{
    accounts: string[];
    data: string;
    programId: string;
  }>;
}

/** Single enhanced transaction from Helius webhook */
export interface HeliusEnhancedTransaction {
  /** Transaction signature */
  signature: string;
  /** Slot the transaction was processed in */
  slot: number;
  /** Block timestamp (Unix epoch seconds) */
  timestamp: number;
  /** Transaction type categorized by Helius */
  type: string;
  /** Human-readable description */
  description: string;
  /** Fee paid in lamports */
  fee: number;
  /** Fee payer public key */
  feePayer: string;
  /** Native SOL transfers */
  nativeTransfers: HeliusNativeTransfer[];
  /** SPL token transfers */
  tokenTransfers: HeliusTokenTransfer[];
  /** Account-level data changes */
  accountData: HeliusAccountData[];
  /** Transaction instructions */
  instructions: HeliusInstruction[];
  /** Transaction source (e.g., "SYSTEM_PROGRAM") */
  source: string;
  /** Transaction error if failed */
  transactionError: string | null;
}

/**
 * The full webhook payload from Helius is an array of
 * enhanced transactions.
 */
export type HeliusWebhookPayload = HeliusEnhancedTransaction[];

/** Helius API webhook registration response */
export interface HeliusWebhookResponse {
  webhookID: string;
  wallet: string;
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType: string;
}

/** Helius API error shape */
export interface HeliusApiError {
  error: string;
  message?: string;
}
