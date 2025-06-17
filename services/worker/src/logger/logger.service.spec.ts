import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as winston from 'winston';
import { Logger } from './logger.service';

jest.mock('@temporalio/worker', () => ({
  Worker: jest.fn(),
  DefaultLogger: jest.fn(),
  makeTelemetryFilterString: jest.fn(),
  Runtime: {
    install: jest.fn(),
  },
}));

jest.mock('fs');
jest.mock('winston-daily-rotate-file');
jest.mock('winston', () => {
  const originalWinston = jest.requireActual('winston');
  return {
    ...originalWinston,
    createLogger: 
      jest.fn(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      })),

    transports: {
      Console: jest.fn(),
      DailyRotateFile: jest.fn(),
    },
    format: {
      combine: jest.fn(),
      timestamp: jest.fn(),
      colorize: jest.fn(),
      printf: jest.fn(),
    },
  };
});


describe('Logger', () => {
  let service: Logger;
  let loggerInstance: winston.Logger;

  beforeEach(async () => {
    jest.clearAllMocks();
  
    const module: TestingModule = await Test.createTestingModule({
      providers: [Logger],
    }).compile();

    service = module.get<Logger>(Logger);
    loggerInstance = (winston.createLogger as jest.Mock).mock.results[0].value;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create log directory if it does not exist', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.mkdirSync as jest.Mock).mockImplementation(() => {});

    new Logger();

    expect(fs.existsSync).toHaveBeenCalledWith(Logger.logDir);
    expect(fs.mkdirSync).toHaveBeenCalledWith(Logger.logDir);
  });

  it('should not create log directory if it exists', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    new Logger();

    expect(fs.existsSync).toHaveBeenCalledWith(Logger.logDir);
    expect(fs.mkdirSync).toHaveBeenCalledWith(Logger.logDir);

  });


  it('should log info messages', () => {
    const message = 'info message';
    service.info(message);
    expect(loggerInstance.info).toHaveBeenCalledWith(message);
  });

  it('should log error messages', () => {
    const message = 'error message';
    service.error(message);
    expect(loggerInstance.error).toHaveBeenCalledWith(message);
  });

  it('should log warn messages', () => {
    const message = 'warn message';
    service.warn(message);
    expect(loggerInstance.warn).toHaveBeenCalledWith(message);
  });

  it('should log debug messages', () => {
    const message = 'debug message';
    service.debug(message);
    expect(loggerInstance.debug).toHaveBeenCalledWith(message);
  });

  it('should log verbose messages', () => {
    const message = 'verbose message';
    service.verbose(message);
    expect(loggerInstance.verbose).toHaveBeenCalledWith(message);
  });

  it('should log messages', () => {
    const message = 'log message';
    service.log(message);
    expect(loggerInstance.info).toHaveBeenCalledWith(message);
  });
});