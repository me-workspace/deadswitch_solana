/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * having the .json extension is the actual IDL.
 */
export type Deadswitch = {
  "address": "14S2ouXUde99HRRrSmMUcqMCUpMkd2NngjMmnz21mXKh",
  "metadata": {
    "name": "deadswitch",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Onchain inheritance & dead man's switch protocol on Solana"
  },
  "instructions": [
    {
      "name": "createVault",
      "discriminator": number[],
      "accounts": [
        { "name": "owner", "writable": true, "signer": true },
        { "name": "vault", "writable": true },
        { "name": "heartbeatAuthority" },
        { "name": "systemProgram" }
      ],
      "args": [
        { "name": "vaultId", "type": "u64" },
        { "name": "name", "type": "string" },
        { "name": "note", "type": "string" },
        { "name": "inactivityWindow", "type": "i64" },
        { "name": "gracePeriod", "type": "i64" },
        { "name": "crankFeeBps", "type": "u16" },
        { "name": "beneficiaries", "type": { "vec": { "defined": { "name": "beneficiaryInput" } } } },
        { "name": "solDepositLamports", "type": "u64" }
      ]
    },
    {
      "name": "recordHeartbeat",
      "discriminator": number[],
      "accounts": [
        { "name": "authority", "signer": true },
        { "name": "vault", "writable": true }
      ],
      "args": []
    },
    {
      "name": "updateVault",
      "discriminator": number[],
      "accounts": [
        { "name": "owner", "writable": true, "signer": true },
        { "name": "vault", "writable": true }
      ],
      "args": [
        { "name": "name", "type": { "option": "string" } },
        { "name": "note", "type": { "option": "string" } },
        { "name": "inactivityWindow", "type": { "option": "i64" } },
        { "name": "gracePeriod", "type": { "option": "i64" } },
        { "name": "crankFeeBps", "type": { "option": "u16" } },
        { "name": "beneficiaries", "type": { "option": { "vec": { "defined": { "name": "beneficiaryInput" } } } } }
      ]
    },
    {
      "name": "topUpVault",
      "discriminator": number[],
      "accounts": [
        { "name": "owner", "writable": true, "signer": true },
        { "name": "vault", "writable": true },
        { "name": "systemProgram" },
        { "name": "tokenProgram" },
        { "name": "associatedTokenProgram" }
      ],
      "args": [
        { "name": "solAmount", "type": "u64" },
        { "name": "splDeposits", "type": { "vec": { "defined": { "name": "splDeposit" } } } }
      ]
    },
    {
      "name": "cancelVault",
      "discriminator": number[],
      "accounts": [
        { "name": "owner", "writable": true, "signer": true },
        { "name": "vault", "writable": true },
        { "name": "systemProgram" },
        { "name": "tokenProgram" },
        { "name": "associatedTokenProgram" }
      ],
      "args": []
    },
    {
      "name": "executeRedistribution",
      "discriminator": number[],
      "accounts": [
        { "name": "crank", "writable": true, "signer": true },
        { "name": "vault", "writable": true },
        { "name": "owner", "writable": true },
        { "name": "systemProgram" },
        { "name": "tokenProgram" },
        { "name": "associatedTokenProgram" }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "vault",
      "discriminator": number[]
    }
  ],
  "types": [
    {
      "name": "beneficiaryInput",
      "type": {
        "kind": "struct",
        "fields": [
          { "name": "wallet", "type": "pubkey" },
          { "name": "shareBps", "type": "u16" },
          { "name": "name", "type": "string" }
        ]
      }
    },
    {
      "name": "splDeposit",
      "type": {
        "kind": "struct",
        "fields": [
          { "name": "mint", "type": "pubkey" },
          { "name": "amount", "type": "u64" }
        ]
      }
    },
    {
      "name": "vault",
      "type": {
        "kind": "struct",
        "fields": [
          { "name": "owner", "type": "pubkey" },
          { "name": "vaultId", "type": "u64" },
          { "name": "bump", "type": "u8" },
          { "name": "heartbeatAuthority", "type": "pubkey" },
          { "name": "inactivityWindow", "type": "i64" },
          { "name": "gracePeriod", "type": "i64" },
          { "name": "crankFeeBps", "type": "u16" },
          { "name": "status", "type": { "defined": { "name": "vaultStatus" } } },
          { "name": "lastActivity", "type": "i64" },
          { "name": "createdAt", "type": "i64" },
          { "name": "updatedAt", "type": "i64" },
          { "name": "name", "type": { "array": ["u8", 64] } },
          { "name": "note", "type": { "array": ["u8", 256] } },
          { "name": "numBeneficiaries", "type": "u8" },
          { "name": "numAssets", "type": "u8" },
          { "name": "beneficiaries", "type": { "array": [{ "defined": { "name": "beneficiary" } }, 10] } },
          { "name": "assetConfigs", "type": { "array": [{ "defined": { "name": "assetConfig" } }, 20] } }
        ]
      }
    },
    {
      "name": "vaultStatus",
      "type": {
        "kind": "enum",
        "variants": [
          { "name": "active" },
          { "name": "executed" },
          { "name": "cancelled" }
        ]
      }
    }
  ]
};

export const IDL: Deadswitch = {
  "address": "14S2ouXUde99HRRrSmMUcqMCUpMkd2NngjMmnz21mXKh",
  "metadata": {
    "name": "deadswitch",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Onchain inheritance & dead man's switch protocol on Solana"
  }
} as any;
