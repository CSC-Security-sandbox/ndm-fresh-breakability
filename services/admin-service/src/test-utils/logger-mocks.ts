import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

/**
 * Complete mock for LoggerService with all methods
 */
export const mockLoggerService = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  setContext: jest.fn(),
};

/**
 * Mock for LoggerFactory that returns the mockLoggerService
 */
export const mockLoggerFactory = {
  create: jest.fn().mockReturnValue(mockLoggerService),
};

/**
 * Reset all logger mocks - call this in beforeEach or afterEach
 */
export const resetLoggerMocks = () => {
  jest.clearAllMocks();
  mockLoggerService.log.mockClear();
  mockLoggerService.error.mockClear();
  mockLoggerService.warn.mockClear();
  mockLoggerService.debug.mockClear();
  mockLoggerService.verbose.mockClear();
  mockLoggerService.setContext.mockClear();
  mockLoggerFactory.create.mockClear();
};

/**
 * Utility to verify that a specific log method was called with message
 */
export const expectLoggerCalled = (
  method: keyof typeof mockLoggerService,
  message?: string,
  times = 1
) => {
  if (message) {
    expect(mockLoggerService[method]).toHaveBeenCalledWith(
      expect.stringContaining(message)
    );
  }
  expect(mockLoggerService[method]).toHaveBeenCalledTimes(times);
};
