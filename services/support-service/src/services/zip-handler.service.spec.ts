import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ZipHandlerService } from './zip-handler.service';

// Mock the dependencies
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    access: jest.fn(),
  },
  createWriteStream: jest.fn(),
}));

jest.mock('path', () => ({
  dirname: jest.fn(),
  join: jest.fn(),
}));

jest.mock('archiver', () => jest.fn());
jest.mock('adm-zip', () => jest.fn());

describe('ZipHandlerService', () => {
  let service: ZipHandlerService;
  let mockLogger: Partial<Logger>;

  // Import the mocked modules
  const mockFs = require('fs');
  const mockPath = require('path');
  const mockArchiver = require('archiver');
  const mockAdmZip = require('adm-zip');

  beforeEach(async () => {
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ZipHandlerService],
    }).compile();

    service = module.get<ZipHandlerService>(ZipHandlerService);

    // Replace the logger with our mock
    Object.defineProperty(service, 'logger', {
      value: mockLogger,
      writable: true,
    });

    // Reset all mocks
    jest.clearAllMocks();

    // Setup default mock behaviors
    mockFs.promises.mkdir.mockResolvedValue(undefined);
    mockPath.dirname.mockReturnValue('/test');
    mockPath.join.mockReturnValue('/test/path/support-bundle.zip');
  });

  describe('addCsvToZip', () => {
    const csvContent = 'Name,Value\nTest,123\n';
    const fileName = 'test.csv';
    const zipLocation = '/test/path';

    it('should create directory and add CSV to new zip when zip does not exist', async () => {
      const zipPath = '/test/path/support-bundle.zip';

      // Mock zip doesn't exist
      mockFs.promises.access.mockRejectedValue(new Error('File not found'));

      // Mock createNewZipWithCsv
      const createNewZipSpy = jest

        .spyOn(service as any, 'createNewZipWithCsv')
        .mockResolvedValue(undefined);

      await service.addCsvToZip(
        csvContent,
        fileName,
        zipLocation,
        'State Data',
      );

      expect(mockFs.promises.mkdir).toHaveBeenCalledWith('/test', {
        recursive: true,
      });
      expect(createNewZipSpy).toHaveBeenCalledWith(
        csvContent,
        fileName,
        zipPath,
        'State Data',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `Adding CSV to zip file: ${zipPath}`,
      );
    });

    it('should add CSV to existing zip when zip exists', async () => {
      const zipPath = '/test/path/support-bundle.zip';

      // Mock zip exists
      mockFs.promises.access.mockResolvedValue(undefined);

      // Mock addToExistingZip
      const addToExistingSpy = jest

        .spyOn(service as any, 'addToExistingZip')
        .mockResolvedValue(undefined);

      await service.addCsvToZip(
        csvContent,
        fileName,
        zipLocation,
        'State Data',
      );

      expect(addToExistingSpy).toHaveBeenCalledWith(
        csvContent,
        fileName,
        zipPath,
        'State Data',
      );
    });

    it('should handle mkdir errors gracefully', async () => {
      const mkdirError = new Error('Permission denied');
      mockFs.promises.mkdir.mockRejectedValue(mkdirError);

      await expect(
        service.addCsvToZip(csvContent, fileName, zipLocation),
      ).rejects.toThrow(mkdirError);
    });
  });

  describe('getZipPath (private method)', () => {
    it('should return the same path if it ends with .zip', () => {
      const zipLocation = '/test/path/custom.zip';

      const result = (service as any).getZipPath(zipLocation);

      expect(result).toBe(zipLocation);
    });

    it('should append support-bundle.zip if path does not end with .zip', () => {
      const zipLocation = '/test/path';
      mockPath.join.mockReturnValue('/test/path/support-bundle.zip');

      const result = (service as any).getZipPath(zipLocation);

      expect(mockPath.join).toHaveBeenCalledWith(
        zipLocation,
        'support-bundle.zip',
      );
      expect(result).toBe('/test/path/support-bundle.zip');
    });
  });

  describe('checkZipExists (private method)', () => {
    it('should return true when zip file exists', async () => {
      const zipPath = '/test/path/test.zip';
      mockFs.promises.access.mockResolvedValue(undefined);

      const result = await (service as any).checkZipExists(zipPath);

      expect(mockFs.promises.access).toHaveBeenCalledWith(zipPath);
      expect(result).toBe(true);
    });

    it('should return false when zip file does not exist', async () => {
      const zipPath = '/test/path/test.zip';
      mockFs.promises.access.mockRejectedValue(new Error('File not found'));

      const result = await (service as any).checkZipExists(zipPath);

      expect(result).toBe(false);
    });
  });

  describe('createNewZipWithCsv (private method)', () => {
    it('should create new zip file successfully', async () => {
      const csvContent = 'Name,Value\nTest,123\n';
      const fileName = 'test.csv';
      const zipPath = '/test/path/test.zip';

      const mockOutput = { on: jest.fn() };
      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(),
        append: jest.fn(),
        finalize: jest.fn(),
        pointer: jest.fn().mockReturnValue(1024),
      };

      mockFs.createWriteStream.mockReturnValue(mockOutput);
      mockArchiver.mockReturnValue(mockArchive);

      // Simulate successful archive creation
      mockOutput.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') {
          setTimeout(() => callback(), 0);
        }
      });

      const promise = (service as any).createNewZipWithCsv(
        csvContent,
        fileName,
        zipPath,
        'State Data',
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      await promise;

      expect(mockArchive.append).toHaveBeenCalledWith(csvContent, {
        name: `State Data/${fileName}`,
      });
      expect(mockLogger.log).toHaveBeenCalledWith(
        `New ZIP file created: ${zipPath} (1024 total bytes)`,
      );
    });

    it('should handle archive errors and reject promise', async () => {
      const csvContent = 'Name,Value\nTest,123\n';
      const fileName = 'test.csv';
      const zipPath = '/test/path/test.zip';

      const mockOutput = { on: jest.fn() };
      const mockArchive = {
        on: jest.fn(),
        pipe: jest.fn(),
        append: jest.fn(),
        finalize: jest.fn(),
        pointer: jest.fn().mockReturnValue(1024),
      };

      mockFs.createWriteStream.mockReturnValue(mockOutput);
      mockArchiver.mockReturnValue(mockArchive);

      const archiveError = new Error('Compression failed');

      // Simulate archive error
      mockArchive.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'error') {
          setTimeout(() => callback(archiveError), 0);
        }
      });

      const promise = (service as any).createNewZipWithCsv(
        csvContent,
        fileName,
        zipPath,
        'State Data',
      );

      await expect(promise).rejects.toThrow('Compression failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        `Archive error: ${archiveError.message}`,
      );
    });
  });

  describe('addToExistingZip (private method)', () => {
    it('should add CSV to existing zip successfully', async () => {
      const csvContent = 'Name,Value\nTest,123\n';
      const fileName = 'test.csv';
      const zipPath = '/test/path/test.zip';

      const mockAdmZipInstance = {
        getEntries: jest.fn().mockReturnValue([]),
        addFile: jest.fn(),
        writeZip: jest.fn(),
      };

      mockAdmZip.mockReturnValue(mockAdmZipInstance);

      await (service as any).addToExistingZip(
        csvContent,
        fileName,
        zipPath,
        'State Data',
      );

      expect(mockAdmZip).toHaveBeenCalledWith(zipPath);
      expect(mockAdmZipInstance.addFile).toHaveBeenCalledWith(
        'State Data/test.csv',
        Buffer.from(csvContent, 'utf8'),
      );
      expect(mockAdmZipInstance.writeZip).toHaveBeenCalledWith(zipPath);
      expect(mockLogger.log).toHaveBeenCalledWith(
        `CSV successfully added to existing ZIP file: ${zipPath} at State Data/test.csv`,
      );
    });

    it('should handle existing ndm_logs folder and add CSV to it', async () => {
      const csvContent = 'Name,Value\nTest,123\n';
      const fileName = 'test.csv';
      const zipPath = '/test/path/test.zip';

      const mockEntries = [
        {
          entryName: 'ndm_logs_20250101/some_file.txt',
        },
      ];

      const mockAdmZipInstance = {
        getEntries: jest.fn().mockReturnValue(mockEntries),
        addFile: jest.fn(),
        writeZip: jest.fn(),
      };

      mockAdmZip.mockReturnValue(mockAdmZipInstance);

      await (service as any).addToExistingZip(
        csvContent,
        fileName,
        zipPath,
        'State Data',
      );

      expect(mockAdmZipInstance.addFile).toHaveBeenCalledWith(
        'ndm_logs_20250101/State Data/test.csv',
        Buffer.from(csvContent, 'utf8'),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Found existing ndm_logs folder: ndm_logs_20250101. Adding CSV to: ndm_logs_20250101/State Data/test.csv',
      );
    });

    it('should log when no existing ndm_logs folder found', async () => {
      const csvContent = 'Name,Value\nTest,123\n';
      const fileName = 'test.csv';
      const zipPath = '/test/path/test.zip';

      const mockEntries = [
        {
          entryName: 'other_folder/some_file.txt',
        },
      ];

      const mockAdmZipInstance = {
        getEntries: jest.fn().mockReturnValue(mockEntries),
        addFile: jest.fn(),
        writeZip: jest.fn(),
      };

      mockAdmZip.mockReturnValue(mockAdmZipInstance);

      await (service as any).addToExistingZip(
        csvContent,
        fileName,
        zipPath,
        'State Data',
      );

      expect(mockAdmZipInstance.addFile).toHaveBeenCalledWith(
        'State Data/test.csv',
        Buffer.from(csvContent, 'utf8'),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'No existing ndm_logs folder found. Adding CSV to: State Data/test.csv',
      );
    });

    it('should fallback to createNewZipWithCsv when AdmZip fails', async () => {
      const csvContent = 'Name,Value\nTest,123\n';
      const fileName = 'test.csv';
      const zipPath = '/test/path/test.zip';
      const admZipError = new Error('AdmZip operation failed');

      const mockAdmZipInstance = {
        getEntries: jest.fn().mockImplementation(() => {
          throw admZipError;
        }),
        addFile: jest.fn(),
        writeZip: jest.fn(),
      };

      mockAdmZip.mockReturnValue(mockAdmZipInstance);

      const createNewZipSpy = jest

        .spyOn(service as any, 'createNewZipWithCsv')
        .mockResolvedValue(undefined);

      await (service as any).addToExistingZip(
        csvContent,
        fileName,
        zipPath,
        undefined,
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Error adding CSV to existing zip with AdmZip: ${admZipError.message}`,
      );
      expect(createNewZipSpy).toHaveBeenCalledWith(
        csvContent,
        fileName,
        zipPath,
        undefined,
      );
    });

    it('should handle non-Error objects in catch block', async () => {
      const csvContent = 'Name,Value\nTest,123\n';
      const fileName = 'test.csv';
      const zipPath = '/test/path/test.zip';
      const nonErrorObject = 'String error message';

      const mockAdmZipInstance = {
        getEntries: jest.fn().mockImplementation(() => {
          throw nonErrorObject;
        }),
        addFile: jest.fn(),
        writeZip: jest.fn(),
      };

      mockAdmZip.mockReturnValue(mockAdmZipInstance);

      const createNewZipSpy = jest

        .spyOn(service as any, 'createNewZipWithCsv')
        .mockResolvedValue(undefined);

      await (service as any).addToExistingZip(
        csvContent,
        fileName,
        zipPath,
        'CSV Files',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error adding CSV to existing zip with AdmZip: Unknown error',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Falling back to archiver-based approach...',
      );
      expect(createNewZipSpy).toHaveBeenCalledWith(
        csvContent,
        fileName,
        zipPath,
        'CSV Files',
      );
    });
  });

  describe('error handling scenarios', () => {
    it('should handle empty CSV content', async () => {
      const csvContent = '';
      const fileName = 'empty.csv';
      const zipLocation = '/test/path';

      mockFs.promises.access.mockRejectedValue(new Error('File not found'));

      const createNewZipSpy = jest

        .spyOn(service as any, 'createNewZipWithCsv')
        .mockResolvedValue(undefined);

      await service.addCsvToZip(csvContent, fileName, zipLocation);

      expect(createNewZipSpy).toHaveBeenCalledWith(
        '',
        fileName,
        '/test/path/support-bundle.zip',
        'CSV Files',
      );
    });

    it('should handle unicode characters in CSV content', async () => {
      const csvContent = 'Name,Value\nTést,123€\nДанные,456\n';
      const fileName = 'unicode.csv';
      const zipLocation = '/test/path';

      mockFs.promises.access.mockRejectedValue(new Error('File not found'));

      const createNewZipSpy = jest

        .spyOn(service as any, 'createNewZipWithCsv')
        .mockResolvedValue(undefined);

      await service.addCsvToZip(csvContent, fileName, zipLocation);

      expect(createNewZipSpy).toHaveBeenCalledWith(
        csvContent,
        fileName,
        '/test/path/support-bundle.zip',
        'CSV Files',
      );
    });
  });

  describe('logging verification', () => {
    it('should log appropriate messages during zip operations', async () => {
      const csvContent = 'Name,Value\nTest,123\n';
      const fileName = 'test.csv';
      const zipLocation = '/test/path';

      mockFs.promises.access.mockRejectedValue(new Error('File not found'));

      jest

        .spyOn(service as any, 'createNewZipWithCsv')
        .mockResolvedValue(undefined);

      await service.addCsvToZip(csvContent, fileName, zipLocation);

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Adding CSV to zip file: /test/path/support-bundle.zip',
      );
    });
  });
});
