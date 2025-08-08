import { PathUploadController } from './path-upload.controller';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { PathUploadService } from './path-upload.service';
import { ImportVolumePathsDto as UploadVolumePathsDto } from './dto/path-upload.dto';

jest.mock('fs');
import * as fs from 'fs';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';


describe('PathUploadController', () => {
  let controller: PathUploadController;
  let service: PathUploadService;

  const mockPathUploadService = {
    processFileUpload: jest.fn(),
    createUpload: jest.fn(),
    processUploadPathValidation: jest.fn(),
    processUploadUpdate: jest.fn(),
    createVolumeForFileServer: jest.fn(),
    processValidationResult: jest.fn(),
    isRefreshPossible: jest.fn(),
    createUploadDirectory: jest.fn(),
    getUploadedPaths: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PathUploadController],
      providers: [
        {
          provide: PathUploadService,
          useValue: mockPathUploadService,
         
        },
        {
          provide: JwtService,
          useValue: {},
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue({
              log: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
              debug: jest.fn(),
              verbose: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<PathUploadController>(PathUploadController);
    service = module.get<PathUploadService>(PathUploadService);
  });

  describe('POST /path-upload:fileServerId', () => {
    it('should call processFileUpload with correct parameters', async () => {
      const mockUploadData: UploadVolumePathsDto = {
        fileName: 'test.csv',
        contents: 'path\r\n/srv/nfs_share\r\n/srv/nfs_share/data/1',
        fileSize: 1024
      }
      const mockFileServerId = '123e4567-e89b-12d3-a456-426614174000';
      const mockUserDetails: any = { userId: 'user123', username: 'testuser' };
      jest.spyOn(service, 'processFileUpload').mockResolvedValue({ success: true });
      const result = await controller.importVolumePaths(mockUploadData, mockFileServerId, mockUserDetails);
      expect(service.processFileUpload).toHaveBeenCalledWith(mockUploadData, mockFileServerId, mockUserDetails);
      expect(result).toEqual({ success: true });
    });

    it('should throw an error if processFileUpload fails', async () => {
      const mockUploadData: UploadVolumePathsDto = {
        fileName: 'test.csv',
        contents: 'path\r\n/srv/nfs_share\r\n/srv/nfs_share/data/1',
        fileSize: 1024
      }
      const mockFileServerId = '123e4567-e89b-12d3-a456-426614174000';
      const mockUserDetails: any = { userId: 'user123', username: 'testuser' };
      jest.spyOn(service, 'processFileUpload').mockRejectedValue(new Error('Upload failed'));
      await expect(controller.importVolumePaths(mockUploadData, mockFileServerId, mockUserDetails)).rejects.toThrow('Upload failed');
    });

    it('should call processUploadPathValidation with correct parameters', async () => {
      const mockUploadId = '123e4567-e89b-12d3-a456-426614174000';
      const mockResponse: any = { success: true };
      jest.spyOn(service, 'processUploadPathValidation').mockResolvedValue(mockResponse);
      const result = await controller.confirmPathUpload(mockUploadId);
      expect(service.processUploadPathValidation).toHaveBeenCalledWith(mockUploadId);
      expect(result).toEqual({ success: true });
    });

    it('should throw an error if processUploadPathValidation fails', async () => {
      const mockUploadId = '123e4567-e89b-12d3-a456-426614174000';
      jest.spyOn(service, 'processUploadPathValidation').mockRejectedValue(new Error('Upload confirmation failed'));
      await expect(controller.confirmPathUpload(mockUploadId)).rejects.toThrow('Upload confirmation failed');
    });
  })

  describe('POST confirm/:uploadId', () => {
    it('should call processUploadPathValidation with correct uploadId', async () => {
      const mockUploadId = '123e4567-e89b-12d3-a456-426614174000';
      const mockResponse: any = { success: true };
      jest.spyOn(service, 'processUploadPathValidation').mockResolvedValue(mockResponse);
      const result = await controller.confirmPathUpload(mockUploadId);
      expect(service.processUploadPathValidation).toHaveBeenCalledWith(mockUploadId);
      expect(result).toEqual({ success: true }); 
    });

    it('should throw an error if processUploadPathValidation fails', async () => {
      const mockUploadId = '123e4567-e89b-12d3-a456-426614174000';
      jest.spyOn(service, 'processUploadPathValidation').mockRejectedValue(new Error('Upload confirmation failed'));
      await expect(controller.confirmPathUpload(mockUploadId)).rejects.toThrow('Upload confirmation failed');
    });
  });

  describe('PATCH /:uploadId', () => {
    it('should call processUploadUpdate with correct parameters', async () => {
      const mockUploadId = '123e4567-e89b-12d3-a456-426614174000';
      const mockValidationResult: any = {
        validationResult: [{ path: '/srv/nfs_share', valid: true }]
      };
      const mockResult: any = { success: true };
      jest.spyOn(service, 'processUploadUpdate').mockResolvedValue(mockResult);
      const result = await controller.updateUploadValidationResult(mockUploadId, mockValidationResult);
      expect(service.processUploadUpdate).toHaveBeenCalledWith(mockValidationResult.validationResult, mockUploadId);
      expect(result).toEqual({ success: true });
    });

    it('should throw an error if processUploadUpdate fails', async () => {
      const mockUploadId = '123e4567-e89b-12d3-a456-426614174000';
      const mockValidationResult: any = {
        validationResult: [{ path: '/srv/nfs_share', valid: true }]
      };
      jest.spyOn(service, 'processUploadUpdate').mockRejectedValue(new Error('Update failed'));
      await expect(controller.updateUploadValidationResult(mockUploadId, mockValidationResult)).rejects.toThrow('Update failed');
    });
  });
  describe('GET /download/template', () => {
    it('should download a CSV file with correct headers and content', async () => {
      const mockResponse: any = {
        setHeader: jest.fn(),
        sendFile: jest.fn(),
        pipe: jest.fn()
      };
      const headers = ['path'];
      const records = [{ path: 'example/path/to/volume' }];
      const csvContent = [headers.join(','), ...records.map(row => Object.values(row).join(','))].join('\n');
      const fileName = 'volume_paths_template.csv';
      
      // Mock the file system operations
      const mockCreateReadStream = jest.fn().mockReturnValue({ pipe: jest.fn() });
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.mkdirSync as jest.Mock).mockImplementation(() => {});
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
      (fs.createReadStream as jest.Mock).mockImplementation(mockCreateReadStream);

      await controller.downloadCsvFile('template', mockResponse, '123e4567-e89b-12d3-a456-426614174000');

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Disposition', `attachment; filename=${fileName}`);
      expect(mockResponse.sendFile).toHaveBeenCalled();
    });

    it('should download a CSV file for uploaded paths', async () => {
      const mockResponse: any = {
        setHeader: jest.fn(),
        sendFile: jest.fn(),
        pipe: jest.fn()
      };
      const headers = ['path', 'action', 'is_valid', 'message'];
      const records = [{ path: 'example/path/to/volume', action: 'CREATE', is_valid: "Valid", message: 'Valid path' }];
      const csvContent = [headers.join(','), ...records.map(row => Object.values(row).join(','))].join('\n');
      const fileName = 'volume_paths_template.csv';
      
      // Mock the file system operations
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.mkdirSync as jest.Mock).mockImplementation(() => {});
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
      jest.spyOn(mockPathUploadService, 'getUploadedPaths').mockResolvedValue(records as any[]);

      await controller.downloadCsvFile('uploaded-paths', mockResponse, '123e4567-e89b-12d3-a456-426614174000');

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(mockResponse.sendFile).toHaveBeenCalled();
    });

    it('should handle errors during file download', async () => {
      const mockResponse: any = {
        setHeader: jest.fn(),
        sendFile: jest.fn(),
        pipe: jest.fn()
      };
      
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.mkdirSync as jest.Mock).mockImplementation(() => {});
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
      (fs.createReadStream as jest.Mock).mockImplementation(() => {
        throw new Error('File not found');
      });

      jest.spyOn(service, 'createUploadDirectory').mockResolvedValue();

      await expect(controller.downloadCsvFile('template', mockResponse, '123e4567-e89b-12d3-a456-426614174000')).rejects.toThrow('File not found');
    });
  })
});