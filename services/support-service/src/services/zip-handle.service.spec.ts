import { Test, TestingModule } from '@nestjs/testing';
import { ZipHandlerService } from './zip-handle.service';
import * as fs from 'fs';
import * as path from 'path';

// Create mocks that will be hoisted
const mockArchiver = {
  pipe: jest.fn(),
  append: jest.fn(),
  finalize: jest.fn(),
  pointer: jest.fn(() => 1024),
  on: jest.fn(),
};

const mockAdmZip = {
  addFile: jest.fn(),
  writeZip: jest.fn(),
  getEntries: jest.fn(),
  deleteFile: jest.fn(),
};

// Mock archiver completely
jest.mock('archiver', () => {
  return jest.fn(() => mockArchiver);
});

// Mock AdmZip
jest.mock('adm-zip', () => {
  return jest.fn(() => mockAdmZip);
});

// Mock fs with static functions
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    access: jest.fn(),
  },
  createWriteStream: jest.fn(),
  constants: {
    R_OK: 4,
    W_OK: 2,
  },
}));

describe('ZipHandlerService', () => {
  let service: ZipHandlerService;

  // Create typed mock functions from the mocked fs module
  const typedMkdir = fs.promises.mkdir as jest.MockedFunction<
    typeof fs.promises.mkdir
  >;
  const typedAccess = fs.promises.access as jest.MockedFunction<
    typeof fs.promises.access
  >;
  const typedCreateWriteStream = fs.createWriteStream as jest.MockedFunction<
    typeof fs.createWriteStream
  >;

  beforeEach(async () => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ZipHandlerService],
    }).compile();

    service = module.get<ZipHandlerService>(ZipHandlerService);

    // Reset mocks to default behavior
    typedMkdir.mockResolvedValue(undefined);
    mockArchiver.pipe.mockReturnValue(undefined);
    mockArchiver.append.mockReturnValue(undefined);
    mockArchiver.finalize.mockResolvedValue(undefined);
    mockArchiver.pointer.mockReturnValue(1024);
    mockArchiver.on.mockImplementation((event: string, callback: Function) => {
      // Don't trigger error by default
    });

    // Reset AdmZip mock
    mockAdmZip.getEntries.mockReturnValue([]);
    mockAdmZip.addFile.mockReturnValue(undefined);
    mockAdmZip.writeZip.mockReturnValue(undefined);
    mockAdmZip.deleteFile.mockReturnValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('service structure', () => {
    it('should have addCsvToZip method', () => {
      expect(typeof service.addCsvToZip).toBe('function');
    });

    it('should have private methods for internal functionality', () => {
      // Test that the service has the expected structure
      expect(service).toHaveProperty('logger');
      expect(typeof (service as any).getZipPath).toBe('function');
      expect(typeof (service as any).checkZipExists).toBe('function');
      expect(typeof (service as any).createNewZipWithCsv).toBe('function');
      expect(typeof (service as any).addToExistingZip).toBe('function');
    });
  });

  describe('getZipPath private method', () => {
    it('should return the path as-is if it ends with .zip', () => {
      const zipLocation = '/test/path/bundle.zip';
      const result = (service as any).getZipPath(zipLocation);
      expect(result).toBe(zipLocation);
    });

    it('should append support-bundle.zip if path does not end with .zip', () => {
      const nonZipLocation = '/test/path';
      const result = (service as any).getZipPath(nonZipLocation);
      expect(result).toBe(path.join(nonZipLocation, 'support-bundle.zip'));
    });

    it('should handle empty string input', () => {
      expect(() => (service as any).getZipPath('')).toThrow(
        'Failed to determine zip path: Zip location cannot be empty',
      );
    });

    it('should handle paths with different extensions', () => {
      const txtLocation = '/test/path/file.txt';
      const result = (service as any).getZipPath(txtLocation);
      expect(result).toBe(path.join(txtLocation, 'support-bundle.zip'));
    });
  });

  describe('checkZipExists private method', () => {
    it('should return true if zip file exists', async () => {
      typedAccess.mockResolvedValue(undefined);

      const result = await (service as any).checkZipExists(
        '/test/path/bundle.zip',
      );

      expect(result).toBe(true);
      expect(typedAccess).toHaveBeenCalledWith('/test/path/bundle.zip');
    });

    it('should return false if zip file does not exist', async () => {
      const enoentError = new Error('File not found');
      (enoentError as any).code = 'ENOENT';
      typedAccess.mockRejectedValue(enoentError);

      const result = await (service as any).checkZipExists(
        '/test/path/bundle.zip',
      );

      expect(result).toBe(false);
      expect(typedAccess).toHaveBeenCalledWith('/test/path/bundle.zip');
    });
  });

  describe('addCsvToZip method', () => {
    beforeEach(() => {
      typedMkdir.mockResolvedValue(undefined);
    });

    it('should create new zip when zip does not exist', async () => {
      typedAccess.mockRejectedValue(new Error('File not found'));

      const mockWriteStream = {
        on: jest.fn(),
      };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);

      // Mock archiver events
      mockArchiver.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'error') {
            // Don't trigger error by default
          }
        },
      );

      const csvContent = 'header1,header2\nvalue1,value2';
      const fileName = 'test.csv';
      const zipLocation = '/test/path/bundle.zip';

      // Mock writeStream close event to resolve promise
      mockWriteStream.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'close') {
            setTimeout(callback, 0); // Async callback
          }
        },
      );

      await service.addCsvToZip(csvContent, fileName, zipLocation);

      expect(typedMkdir).toHaveBeenCalledWith('/test/path', {
        recursive: true,
      });
      expect(typedCreateWriteStream).toHaveBeenCalledWith(zipLocation);
      expect(mockArchiver.append).toHaveBeenCalledWith(csvContent, {
        name: fileName,
      });
    });

    it('should add to existing zip when zip exists', async () => {
      typedAccess.mockResolvedValue(undefined);

      const csvContent = 'header1,header2\nvalue1,value2';
      const fileName = 'test.csv';
      const zipLocation = '/test/path/bundle.zip';

      await service.addCsvToZip(csvContent, fileName, zipLocation);

      expect(mockAdmZip.addFile).toHaveBeenCalledWith(
        fileName,
        Buffer.from(csvContent, 'utf8'),
      );
      expect(mockAdmZip.writeZip).toHaveBeenCalledWith(zipLocation);
    });

    it('should handle directory creation for nested paths', async () => {
      typedAccess.mockRejectedValue(new Error('File not found'));

      const mockWriteStream = { on: jest.fn() };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);

      mockWriteStream.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        },
      );

      await service.addCsvToZip(
        'content',
        'file.csv',
        '/deep/nested/path/bundle.zip',
      );

      expect(typedMkdir).toHaveBeenCalledWith('/deep/nested/path', {
        recursive: true,
      });
    });

    it('should handle paths without .zip extension', async () => {
      typedAccess.mockRejectedValue(new Error('File not found'));

      const mockWriteStream = { on: jest.fn() };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);

      mockWriteStream.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        },
      );

      await service.addCsvToZip('content', 'file.csv', '/test/directory');

      const expectedPath = path.join('/test/directory', 'support-bundle.zip');
      expect(typedMkdir).toHaveBeenCalledWith('/test/directory', {
        recursive: true,
      });
      expect(typedCreateWriteStream).toHaveBeenCalledWith(expectedPath);
    });
  });

  describe('createNewZipWithCsv private method', () => {
    it('should create archive and handle successful completion', async () => {
      const mockWriteStream = { on: jest.fn() };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);

      mockWriteStream.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        },
      );

      await (service as any).createNewZipWithCsv(
        'content',
        'file.csv',
        '/test/bundle.zip',
      );

      expect(mockArchiver.pipe).toHaveBeenCalledWith(mockWriteStream);
      expect(mockArchiver.append).toHaveBeenCalledWith('content', {
        name: 'file.csv',
      });
      expect(mockArchiver.finalize).toHaveBeenCalled();
    });

    it('should handle archive errors', async () => {
      const mockWriteStream = { on: jest.fn() };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);

      const testError = new Error('Archive creation failed');

      mockArchiver.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'error') {
            setTimeout(() => callback(testError), 0);
          }
        },
      );

      await expect(
        (service as any).createNewZipWithCsv(
          'content',
          'file.csv',
          '/test/bundle.zip',
        ),
      ).rejects.toThrow('Archive creation failed');
    });
  });

  describe('addToExistingZip private method', () => {
    it('should successfully add to existing zip using AdmZip', async () => {
      const csvContent = 'header1,header2\nvalue1,value2';
      const fileName = 'test.csv';
      const zipPath = '/test/bundle.zip';

      // Mock fs.access to allow file access
      typedAccess.mockResolvedValue(undefined);

      await (service as any).addToExistingZip(csvContent, fileName, zipPath);

      expect(mockAdmZip.addFile).toHaveBeenCalledWith(
        fileName,
        Buffer.from(csvContent, 'utf8'),
      );
      expect(mockAdmZip.writeZip).toHaveBeenCalledWith(zipPath);
    });

    it('should fallback to archiver when AdmZip fails', async () => {
      const csvContent = 'header1,header2\nvalue1,value2';
      const fileName = 'test.csv';
      const zipPath = '/test/bundle.zip';

      // Mock fs.access to allow file access
      typedAccess.mockResolvedValue(undefined);

      // Make AdmZip throw an error
      mockAdmZip.addFile.mockImplementation(() => {
        throw new Error('AdmZip error');
      });

      // Mock the fallback to createNewZipWithCsv
      const mockWriteStream = { on: jest.fn() };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);

      mockWriteStream.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        },
      );

      await (service as any).addToExistingZip(csvContent, fileName, zipPath);

      // Should have tried AdmZip first
      expect(mockAdmZip.addFile).toHaveBeenCalledWith(
        fileName,
        Buffer.from(csvContent, 'utf8'),
      );

      // Should have fallen back to archiver
      expect(typedCreateWriteStream).toHaveBeenCalledWith(zipPath);
      expect(mockArchiver.append).toHaveBeenCalledWith(csvContent, {
        name: fileName,
      });
    });

    it('should handle different types of AdmZip errors', async () => {
      const csvContent = 'data';
      const fileName = 'file.csv';
      const zipPath = '/test/bundle.zip';

      mockAdmZip.writeZip.mockImplementation(() => {
        throw new Error('Write operation failed');
      });

      const mockWriteStream = { on: jest.fn() };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);

      mockWriteStream.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        },
      );

      await (service as any).addToExistingZip(csvContent, fileName, zipPath);

      // Should fall back to archiver due to writeZip error
      expect(mockArchiver.append).toHaveBeenCalledWith(csvContent, {
        name: fileName,
      });
    });
  });

  describe('logger functionality', () => {
    it('should have logger instance', () => {
      expect(service['logger']).toBeDefined();
      expect(typeof service['logger'].log).toBe('function');
      expect(typeof service['logger'].error).toBe('function');
    });

    it('should log messages during zip operations', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log');
      typedAccess.mockResolvedValue(undefined);

      await service.addCsvToZip('content', 'file.csv', '/test/bundle.zip');

      expect(logSpy).toHaveBeenCalledWith(
        'Adding CSV to zip file: /test/bundle.zip',
      );
    });

    it('should log errors when AdmZip fails', async () => {
      const errorSpy = jest.spyOn(service['logger'], 'error');
      const logSpy = jest.spyOn(service['logger'], 'log');

      typedAccess.mockResolvedValue(undefined);
      // Make getEntries fail to trigger the fallback
      mockAdmZip.getEntries.mockImplementation(() => {
        throw new Error('Test error');
      });

      const mockWriteStream = { on: jest.fn() };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);
      mockWriteStream.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        },
      );

      await service.addCsvToZip('content', 'file.csv', '/test/bundle.zip');

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Error adding CSV to existing zip with AdmZip:',
        ),
      );
      expect(logSpy).toHaveBeenCalledWith(
        'Falling back to archiver-based approach...',
      );
    });
  });

  describe('Input Validation and Error Handling', () => {
    describe('validateInputs', () => {
      it('should throw error for empty CSV content', async () => {
        await expect(
          service.addCsvToZip('', 'file.csv', '/test/path'),
        ).rejects.toThrow(
          'CSV content is required and must be a non-empty string',
        );
      });

      it('should throw error for non-string CSV content', async () => {
        await expect(
          service.addCsvToZip(null as any, 'file.csv', '/test/path'),
        ).rejects.toThrow(
          'CSV content is required and must be a non-empty string',
        );
      });

      it('should throw error for empty file name', async () => {
        await expect(
          service.addCsvToZip('content', '', '/test/path'),
        ).rejects.toThrow(
          'File name is required and must be a non-empty string',
        );
      });

      it('should throw error for non-string file name', async () => {
        await expect(
          service.addCsvToZip('content', null as any, '/test/path'),
        ).rejects.toThrow(
          'File name is required and must be a non-empty string',
        );
      });

      it('should throw error for empty zip location', async () => {
        await expect(
          service.addCsvToZip('content', 'file.csv', ''),
        ).rejects.toThrow(
          'Zip location is required and must be a non-empty string',
        );
      });

      it('should throw error for non-string zip location', async () => {
        await expect(
          service.addCsvToZip('content', 'file.csv', null as any),
        ).rejects.toThrow(
          'Zip location is required and must be a non-empty string',
        );
      });

      it('should throw error for file name with invalid characters', async () => {
        await expect(
          service.addCsvToZip('content', 'file<>name.csv', '/test/path'),
        ).rejects.toThrow('File name contains invalid characters');
      });

      it('should throw error for zip location with path traversal', async () => {
        await expect(
          service.addCsvToZip('content', 'file.csv', '../../../etc/passwd'),
        ).rejects.toThrow('Invalid zip location path');
      });

      it('should throw error for zip location with null bytes', async () => {
        await expect(
          service.addCsvToZip('content', 'file.csv', '/test/path\0'),
        ).rejects.toThrow('Invalid zip location path');
      });
    });

    describe('ensureDirectoryExists error handling', () => {
      it('should handle directory creation errors', async () => {
        typedMkdir.mockRejectedValue(new Error('Permission denied'));

        await expect(
          service.addCsvToZip(
            'content',
            'file.csv',
            '/readonly/path/bundle.zip',
          ),
        ).rejects.toThrow(
          'Failed to add CSV to zip: Failed to create directory: Permission denied',
        );

        expect(typedMkdir).toHaveBeenCalledWith('/readonly/path', {
          recursive: true,
        });
      });
    });

    describe('getZipPath error handling', () => {
      it('should handle path.join errors gracefully', async () => {
        // This test ensures the getZipPath method doesn't crash with edge cases
        const service = new ZipHandlerService();

        expect(() => (service as any).getZipPath('/valid/path')).not.toThrow();
        expect(() =>
          (service as any).getZipPath('/valid/path.zip'),
        ).not.toThrow();
      });
    });
  });

  describe('checkZipExists enhanced error handling', () => {
    it('should return false for empty zip path', async () => {
      const result = await (service as any).checkZipExists('');
      expect(result).toBe(false);
    });

    it('should return false for non-ENOENT access errors', async () => {
      const accessError = new Error('Permission denied');
      (accessError as any).code = 'EACCES';
      typedAccess.mockRejectedValue(accessError);

      const result = await (service as any).checkZipExists(
        '/test/path/bundle.zip',
      );
      expect(result).toBe(false);
    });

    it('should return false for ENOENT errors', async () => {
      const enoentError = new Error('File not found');
      (enoentError as any).code = 'ENOENT';
      typedAccess.mockRejectedValue(enoentError);

      const result = await (service as any).checkZipExists(
        '/test/path/bundle.zip',
      );
      expect(result).toBe(false);
    });

    it('should return true when file exists', async () => {
      typedAccess.mockResolvedValue(undefined);

      const result = await (service as any).checkZipExists(
        '/test/path/bundle.zip',
      );
      expect(result).toBe(true);
    });
  });

  describe('createNewZipWithCsv enhanced error handling', () => {
    it('should reject for missing parameters', async () => {
      await expect(
        (service as any).createNewZipWithCsv(
          '',
          'file.csv',
          '/test/bundle.zip',
        ),
      ).rejects.toThrow('Missing required parameters for zip creation');
    });

    it('should handle output stream errors', async () => {
      const mockWriteStream = {
        on: jest.fn(),
      };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);

      const streamError = new Error('Stream write failed');
      mockWriteStream.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'error') {
            setTimeout(() => callback(streamError), 0);
          }
        },
      );

      await expect(
        (service as any).createNewZipWithCsv(
          'content',
          'file.csv',
          '/test/bundle.zip',
        ),
      ).rejects.toThrow('Failed to create zip file: Stream write failed');
    });

    it('should handle archive warnings that should be escalated', async () => {
      const mockWriteStream = { on: jest.fn() };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);

      const archiveWarning = new Error('Critical warning');
      (archiveWarning as any).code = 'CRITICAL';

      mockArchiver.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'warning') {
            setTimeout(() => callback(archiveWarning), 0);
          }
        },
      );

      await expect(
        (service as any).createNewZipWithCsv(
          'content',
          'file.csv',
          '/test/bundle.zip',
        ),
      ).rejects.toThrow('Archive warning escalated: Critical warning');
    });

    it('should handle ENOENT archive warnings gracefully', async () => {
      const mockWriteStream = { on: jest.fn() };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);

      const enoentWarning = new Error('File not found in archive');
      (enoentWarning as any).code = 'ENOENT';

      let warningCallback: Function;
      let closeCallback: Function;

      mockArchiver.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'warning') {
            warningCallback = callback;
          }
        },
      );

      mockWriteStream.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'close') {
            closeCallback = callback;
          }
        },
      );

      const promise = (service as any).createNewZipWithCsv(
        'content',
        'file.csv',
        '/test/bundle.zip',
      );

      // Trigger warning and then close
      setTimeout(() => {
        warningCallback(enoentWarning);
        closeCallback();
      }, 0);

      await expect(promise).resolves.toBeUndefined();
    });

    it('should handle finalize errors', async () => {
      const mockWriteStream = { on: jest.fn() };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);

      mockArchiver.finalize.mockRejectedValue(new Error('Finalize failed'));

      await expect(
        (service as any).createNewZipWithCsv(
          'content',
          'file.csv',
          '/test/bundle.zip',
        ),
      ).rejects.toThrow('Failed to finalize archive: Finalize failed');
    });
  });

  describe('addToExistingZip enhanced error handling', () => {
    beforeEach(() => {
      typedAccess.mockResolvedValue(undefined);
      mockAdmZip.getEntries.mockReturnValue([]);
    });

    it('should throw error for missing parameters', async () => {
      await expect(
        (service as any).addToExistingZip('', 'file.csv', '/test/bundle.zip'),
      ).rejects.toThrow('Both primary and fallback zip operations failed');
    });

    it('should handle permission denied errors', async () => {
      const accessError = new Error('Permission denied');
      (accessError as any).code = 'EACCES';
      typedAccess.mockRejectedValue(accessError);

      await expect(
        (service as any).addToExistingZip(
          'content',
          'file.csv',
          '/test/bundle.zip',
        ),
      ).rejects.toThrow(
        'Permission denied accessing zip file: /test/bundle.zip',
      );
    });

    it('should handle file not found errors', async () => {
      const enoentError = new Error('File not found');
      (enoentError as any).code = 'ENOENT';
      typedAccess.mockRejectedValue(enoentError);

      await expect(
        (service as any).addToExistingZip(
          'content',
          'file.csv',
          '/test/bundle.zip',
        ),
      ).rejects.toThrow('Zip file not found: /test/bundle.zip');
    });

    it('should handle corrupted zip files with fallback', async () => {
      mockAdmZip.addFile.mockImplementation(() => {
        throw new Error('Invalid or unsupported zip format');
      });

      const mockWriteStream = { on: jest.fn() };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);
      mockWriteStream.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        },
      );

      await (service as any).addToExistingZip(
        'content',
        'file.csv',
        '/test/bundle.zip',
      );

      expect(mockArchiver.append).toHaveBeenCalledWith('content', {
        name: 'file.csv',
      });
    });

    it('should replace existing files in zip', async () => {
      const existingEntry = { entryName: 'file.csv' };
      mockAdmZip.getEntries.mockReturnValue([existingEntry]);

      await (service as any).addToExistingZip(
        'content',
        'file.csv',
        '/test/bundle.zip',
      );

      expect(mockAdmZip.deleteFile).toHaveBeenCalledWith('file.csv');
      expect(mockAdmZip.addFile).toHaveBeenCalledWith(
        'file.csv',
        Buffer.from('content', 'utf8'),
      );
    });

    it('should handle both primary and fallback failures', async () => {
      // Primary failure
      mockAdmZip.addFile.mockImplementation(() => {
        throw new Error('AdmZip failed');
      });

      // Fallback failure
      const mockWriteStream = { on: jest.fn() };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);

      const archiveError = new Error('Fallback archive failed');
      mockArchiver.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'error') {
            setTimeout(() => callback(archiveError), 0);
          }
        },
      );

      await expect(
        (service as any).addToExistingZip(
          'content',
          'file.csv',
          '/test/bundle.zip',
        ),
      ).rejects.toThrow('Both primary and fallback zip operations failed');
    });
  });

  describe('createZipFromCsvString method', () => {
    it('should create zip from CSV string successfully', async () => {
      const mockWriteStream = { on: jest.fn() };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);

      mockWriteStream.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'close') {
            setTimeout(callback, 0);
          }
        },
      );

      const result = await service.createZipFromCsvString(
        'content',
        'test.csv',
      );

      expect(result).toMatch(/\/tmp\/test_\d+\.zip/);
      expect(mockArchiver.append).toHaveBeenCalledWith('content', {
        name: 'test.csv',
      });
    });

    it('should handle validation errors in createZipFromCsvString', async () => {
      await expect(
        service.createZipFromCsvString('', 'test.csv'),
      ).rejects.toThrow(
        'Failed to create zip from CSV string: CSV content is required',
      );
    });

    it('should handle zip creation errors in createZipFromCsvString', async () => {
      const mockWriteStream = { on: jest.fn() };
      typedCreateWriteStream.mockReturnValue(mockWriteStream as any);

      const archiveError = new Error('Archive creation failed');
      mockArchiver.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'error') {
            setTimeout(() => callback(archiveError), 0);
          }
        },
      );

      await expect(
        service.createZipFromCsvString('content', 'test.csv'),
      ).rejects.toThrow('Failed to create zip from CSV string');
    });
  });
});
