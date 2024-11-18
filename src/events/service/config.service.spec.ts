import { Test, TestingModule } from '@nestjs/testing';

import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileConfigService } from './config.service';

const mockConfig = { id: 'config-id', refreshedOn: null, fileServers: [] };
const mockFileServer = {
  id: 'file-server-id',
  configId: 'config-id',
  protocol: 'NFS',
  workers: [{ id: 'worker-1' }, { id: 'worker-2' }],
  volumes: [{ id: 'volume-1', volumePath: '/path1', reachableCount: 1 }],
};
const mockVolume = { id: 'volume-id', fileServerId: 'file-server-id', volumePath: '/new-path', reachableCount: 1 };

const mockConfigRepository = {
  findOne: jest.fn(),
  update: jest.fn(),
};

const mockFileServerRepository = {
  findOne: jest.fn(),
  update: jest.fn(),
};

const mockVolumeRepository = {
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};

describe('FileConfigService', () => {
  let service: FileConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileConfigService,
        { provide: getRepositoryToken(ConfigEntity), useValue: mockConfigRepository },
        { provide: getRepositoryToken(FileServerEntity), useValue: mockFileServerRepository },
        { provide: getRepositoryToken(VolumeEntity), useValue: mockVolumeRepository },
      ],
    }).compile();

    service = module.get<FileConfigService>(FileConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('updatePathToConfig', () => {
    it('should update reachableCount for existing paths', async () => {
      const payload = {
        config: { configId: 'config-id', protocol: 'NFS' },
        path: [{ mountPath: '/path1' }],
      };
      mockFileServerRepository.findOne.mockResolvedValue(mockFileServer);
      mockVolumeRepository.update.mockResolvedValue(null);

      await service.updatePathToConfig(payload);

      expect(mockFileServerRepository.findOne).toHaveBeenCalledWith({
        where: { configId: 'config-id', protocol: 'NFS' },
        relations: { workers: true, volumes: true },
      });
      expect(mockVolumeRepository.update).toHaveBeenCalledWith(
        { id: 'volume-1' },
        { reachableCount: 2 }
      );
    });

    it('should add new paths if not already existing', async () => {
      const payload = {
        config: { configId: 'config-id', protocol: 'NFS' },
        path: [{ mountPath: '/new-path' }],
      };
      mockFileServerRepository.findOne.mockResolvedValue(mockFileServer);
      mockVolumeRepository.create.mockReturnValue(mockVolume);
      mockVolumeRepository.save.mockResolvedValue(mockVolume);

      await service.updatePathToConfig(payload);

      expect(mockVolumeRepository.create).toHaveBeenCalledWith({
        fileServerId: 'file-server-id',
        volumePath: '/new-path',
        createdBy: 'config-id',
        reachableCount: 1,
      });
      expect(mockVolumeRepository.save).toHaveBeenCalled();
    });

  });

  describe('getPathConfig', () => {
    it('should retrieve the configuration with its file servers and workers', async () => {
      mockConfigRepository.findOne.mockResolvedValue(mockConfig);

      const result = await service.getPathConfig('config-id');

      expect(result).toEqual(mockConfig);
      expect(mockConfigRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'config-id' },
        relations: { fileServers: { workers: true } },
      });
    });
  });

  describe('updateRefetchingConfig', () => {
    it('should reset reachableCount for all volumes and mark file server as not refreshed', async () => {
      const config = {
        id: 'config-id',
        fileServers: [{ id: 'file-server-id' }, { id: 'file-server-id-2' }],
      };

      await service.updateRefetchingConfig(config as any);

      expect(mockVolumeRepository.update).toHaveBeenCalledWith(
        { fileServerId: 'file-server-id' },
        { reachableCount: 0 }
      );
      expect(mockVolumeRepository.update).toHaveBeenCalledWith(
        { fileServerId: 'file-server-id-2' },
        { reachableCount: 0 }
      );
      expect(mockFileServerRepository.update).toHaveBeenCalledWith(
        { configId: 'config-id' },
        { isRefreshed: false }
      );
    });
  });
});
