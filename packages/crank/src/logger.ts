/** Log level priorities (lower number = more verbose) */
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

/** Current minimum log level. Set via `setLogLevel`. */
let currentLevel: LogLevel = "info";

/**
 * Set the minimum log level for output.
 *
 * @param level - The minimum level to display
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Format a log message with ISO timestamp, level, and content.
 *
 * @param level - The log level label
 * @param message - The log message
 * @returns Formatted log string
 */
function formatMessage(level: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${message}`;
}

/**
 * Structured logger with timestamp and level filtering.
 *
 * Usage:
 * ```ts
 * log.info("Scanning vaults...");
 * log.error("Transaction failed", error);
 * ```
 */
export const log = {
  /**
   * Log a debug message (only shown when LOG_LEVEL=debug).
   * @param message - The debug message
   * @param args - Additional data to log
   */
  debug(message: string, ...args: unknown[]): void {
    if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.debug) {
      console.debug(formatMessage("debug", message), ...args);
    }
  },

  /**
   * Log an informational message.
   * @param message - The info message
   * @param args - Additional data to log
   */
  info(message: string, ...args: unknown[]): void {
    if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.info) {
      console.info(formatMessage("info", message), ...args);
    }
  },

  /**
   * Log a warning message.
   * @param message - The warning message
   * @param args - Additional data to log
   */
  warn(message: string, ...args: unknown[]): void {
    if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.warn) {
      console.warn(formatMessage("warn", message), ...args);
    }
  },

  /**
   * Log an error message.
   * @param message - The error message
   * @param args - Additional data (e.g., Error objects)
   */
  error(message: string, ...args: unknown[]): void {
    if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.error) {
      console.error(formatMessage("error", message), ...args);
    }
  },
};
