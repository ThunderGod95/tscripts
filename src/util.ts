const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const FG_RED = '\x1b[31m';
const FG_GREEN = '\x1b[32m';
const FG_YELLOW = '\x1b[33m';
const FG_CYAN = '\x1b[36m';

/**
 * Logs a standard information message. (Cyan)
 * @param args - Arguments to log, similar to console.log
 */
export function logInfo(...args: any[]) {
    console.log(FG_CYAN, BOLD, '[INFO]', RESET, FG_CYAN, ...args, RESET);
}

/**
 * Logs a success message. (Green)
 * @param args - Arguments to log, similar to console.log
 */
export function logSuccess(...args: any[]) {
    console.log(FG_GREEN, BOLD, '[SUCCESS]', RESET, FG_GREEN, ...args, RESET);
}

/**
 * Logs a warning message. (Yellow)
 * @param args - Arguments to log, similar to console.warn
 */
export function logWarning(...args: any[]) {
    console.warn(FG_YELLOW, BOLD, '[WARN]', RESET, FG_YELLOW, ...args, RESET);
}

/**
 * Logs an error message. (Red)
 * @param args - Arguments to log, similar to console.error
 */
export function logError(...args: any[]) {
    console.error(FG_RED, BOLD, '[ERROR]', RESET, FG_RED, ...args, RESET);
}