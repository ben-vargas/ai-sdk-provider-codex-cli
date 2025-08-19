import type { Logger } from './types.js';

const defaultLogger: Logger = {
  warn: (m: string) => console.warn(m),
  error: (m: string) => console.error(m),
};

const noopLogger: Logger = {
  warn: () => {},
  error: () => {},
};

export function getLogger(logger: Logger | false | undefined): Logger {
  if (logger === false) return noopLogger;
  if (!logger) return defaultLogger;
  return logger;
}
