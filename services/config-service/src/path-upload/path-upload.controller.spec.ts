import { PathUploadController } from './path-upload.controller';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { PathUploadService } from './path-upload.service';
import { ImportVolumePathsDto as UploadVolumePathsDto } from './dto/path-upload.dto';
import * as fs from 'fs';


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
    isRefreshPossible: jest.fn()
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
        }
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
    // below is the method 
    // const headers = ['path'];
    // const records = [{ path: 'example/path/to/volume' }];
    // const csvContent = [headers.join(','), ...records.map(row => Object.values(row).join(','))].join('\n');
    // const fileName = 'volume_paths_template.csv';
    
    // // create the uploads directory if it doesn't exist
    // if (!fs.existsSync(join(process.cwd(), './uploads'))) {
    //     fs.mkdirSync(join(process.cwd(), './uploads'), { recursive: true });
    // }

    // const filePath = join(process.cwd(), './uploads', fileName);
    // fs.writeFileSync(filePath, csvContent);
    // res.setHeader('Content-Type', 'text/csv');
    // res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    // res.sendFile(filePath);
    // const fileStream = fs.createReadStream(filePath);
    // fileStream.pipe(res)

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
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(fs, 'mkdirSync').mockImplementation((): any => {});
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      jest.spyOn(fs, 'createReadStream').mockReturnValue({ pipe: jest.fn()} as any);

      await controller.downloadCsvFile(mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Disposition', `attachment; filename=${fileName}`);
      expect(mockResponse.sendFile).toHaveBeenCalled();
    });

    it('should handle errors during file download', async () => {
      const mockResponse: any = {
        setHeader: jest.fn(),
        sendFile: jest.fn(),
        pipe: jest.fn()
      };
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(fs, 'mkdirSync').mockImplementation((): any => {});
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
        throw new Error('File not found');
      });

      await expect(controller.downloadCsvFile(mockResponse)).rejects.toThrow('File not found');
    });
  })
});