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
      const result = (service as any).getZipPath('');
      expect(result).toBe('support-bundle.zip');
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
      typedAccess.mockRejectedValue(new Error('File not found'));

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
      mockAdmZip.addFile.mockImplementation(() => {
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
        'Error adding CSV to existing zip with AdmZip: Test error',
      );
      expect(logSpy).toHaveBeenCalledWith(
        'Falling back to archiver-based approach...',
      );
    });
  });
});
