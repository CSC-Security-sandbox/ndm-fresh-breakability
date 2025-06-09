import { Test, TestingModule } from '@nestjs/testing';
import { PathUploadController } from './path-upload.controller';
import { PathUploadService } from './path-upload.service';
import { ImportVolumePathsDto } from './dto/path-upload.dto';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { ConfigModule } from '@nestjs/config';
import appConfig from 'src/config/app.config';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { WorkflowModule } from 'src/workflow/workflow.module';

jest.mock('fs');

describe('PathUploadController', () => {
  let controller: PathUploadController;
  let service: PathUploadService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PathUploadController],
      providers: [
        PathUploadService
      ],
      imports: [LoggerModule.forRoot(), ConfigModule.forRoot({ load: [appConfig] }), AuthKeycloakModule, WorkflowModule],
    }).compile();

    controller = module.get<PathUploadController>(PathUploadController);
    service = module.get<PathUploadService>(PathUploadService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('importVolumePaths', () => {
  it('should call processFileUpload with correct ImportVolumePathsDto', async () => {
    const dto: ImportVolumePathsDto = {
      fileName: 'volume_paths.csv',
      contents: 'path\n/path/to/data',
      fileSize: 1024,
    };
    const fileServerId = 'server123';
    const userDetails = { id: 'user1' } as any;
    const expectedResult = { success: true };

      jest.spyOn(service, 'processUploadPathValidation').mockResolvedValue(expectedResult as any);


    // service.processFileUpload.mockResolvedValue(expectedResult);

    const result = await controller.importVolumePaths(dto, fileServerId, userDetails);

    expect(result).toEqual(expectedResult);
    expect(service.processFileUpload).toHaveBeenCalledWith(dto, fileServerId, userDetails);
  });
});
  describe('confirmPathUpload', () => {
    it('should call processUploadPathValidation with correct uploadId', async () => {
      const uploadId = 'upload123';
      const expectedResult = { confirmed: true };

      jest.spyOn(service, 'processUploadPathValidation').mockResolvedValue(expectedResult as any);

      // service.processUploadPathValidation.mockResolvedValue(expectedResult);

      const result = await controller.confirmPathUpload(uploadId);
      expect(result).toEqual(expectedResult);
      expect(service.processUploadPathValidation).toHaveBeenCalledWith(uploadId);
    });
  });

 describe('updateUploadValidationResult', () => {
  it('should call processUploadUpdate with correct validationResult', async () => {
    const uploadId = 'upload-789';
    const dto: any = {
      validationResult: [
        {
          result: {
            traceId: '2c5de068-2ecc-49fe-a2da-1c4e3f96db2b',
            status: 'success',
            workerId: '4edbd212-f443-469f-beee-04d02d8a36cc',
            path: '/srv/nfs_share',
            pathId: '5cea4762-769e-438a-8194-34c5dbe9b564',
            message: 'Paths validated successfully by worker 4edbd212-f443-469f-beee-04d02d8a36cc'
          }
        }
      ],
    };
      const expectedResult = { updated: true };

      jest.spyOn(service, 'processUploadPathValidation').mockResolvedValue(expectedResult as any);


      // service.processUploadUpdate.mockResolvedValue(expectedResult);

      const result = await controller.updateUploadValidationResult(uploadId, dto);
      expect(result).toEqual(expectedResult);
      expect(service.processUploadUpdate).toHaveBeenCalledWith(dto.validationResult, uploadId);
    });
  });

  describe('downloadCsvFile', () => {
    it('should create a CSV file and send it as a response', async () => {
      const res = {
        setHeader: jest.fn(),
        sendFile: jest.fn(),
      } as unknown as Response;

      const csvContent = 'path\nexample/path/to/volume';
      const filePath = path.join(process.cwd(), './uploads/volume_paths_template.csv');

      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.mkdirSync as jest.Mock).mockImplementation(() => {});
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

      await controller.downloadCsvFile(res);

      expect(fs.existsSync).toHaveBeenCalledWith(path.join(process.cwd(), './uploads'));
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join(process.cwd(), './uploads'), { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(filePath, csvContent);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename=volume_paths_template.csv');
      expect(res.sendFile).toHaveBeenCalledWith(filePath);
    });
  });
});
