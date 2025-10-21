import { describe, it, expect, vi } from 'vitest';
import { getLogger, createVerboseLogger } from '../logger.js';
import type { Logger } from '../types.js';

describe('logger', () => {
  describe('getLogger', () => {
    it('returns default logger when undefined', () => {
      const logger = getLogger(undefined);
      expect(logger).toBeDefined();
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('returns noop logger when false', () => {
      const logger = getLogger(false);
      expect(logger).toBeDefined();
      // Should be no-op functions that don't throw
      expect(() => logger.debug('test')).not.toThrow();
      expect(() => logger.info('test')).not.toThrow();
      expect(() => logger.warn('test')).not.toThrow();
      expect(() => logger.error('test')).not.toThrow();
    });

    it('returns custom logger when provided', () => {
      const customLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const logger = getLogger(customLogger);
      expect(logger).toBe(customLogger);
    });
  });

  describe('createVerboseLogger', () => {
    it('passes through all log levels when verbose is true', () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const logger = createVerboseLogger(mockLogger, true);

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(mockLogger.debug).toHaveBeenCalledWith('debug message');
      expect(mockLogger.info).toHaveBeenCalledWith('info message');
      expect(mockLogger.warn).toHaveBeenCalledWith('warn message');
      expect(mockLogger.error).toHaveBeenCalledWith('error message');
    });

    it('only logs warn/error when verbose is false', () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const logger = createVerboseLogger(mockLogger, false);

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(mockLogger.debug).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith('warn message');
      expect(mockLogger.error).toHaveBeenCalledWith('error message');
    });

    it('defaults to verbose=false when not specified', () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const logger = createVerboseLogger(mockLogger);

      logger.debug('debug message');
      logger.info('info message');

      expect(mockLogger.debug).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should preserve this binding for custom logger instances', () => {
      // Create a logger that relies on instance state
      class CustomLogger implements Logger {
        private prefix = '[CUSTOM]';
        public lastMessage = '';

        debug(message: string): void {
          this.lastMessage = `${this.prefix} DEBUG: ${message}`;
        }

        info(message: string): void {
          this.lastMessage = `${this.prefix} INFO: ${message}`;
        }

        warn(message: string): void {
          this.lastMessage = `${this.prefix} WARN: ${message}`;
        }

        error(message: string): void {
          this.lastMessage = `${this.prefix} ERROR: ${message}`;
        }
      }

      const customLogger = new CustomLogger();
      const logger = createVerboseLogger(customLogger, false);

      // These should not throw and should preserve 'this' binding
      logger.warn('test warning');
      expect(customLogger.lastMessage).toBe('[CUSTOM] WARN: test warning');

      logger.error('test error');
      expect(customLogger.lastMessage).toBe('[CUSTOM] ERROR: test error');
    });
  });
});
