import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';
import { CreateConfigurationDto } from './dto/createconfiguration.dto';
import { UpdateConfigurationDto } from './dto/updateConfiguration.dto';
import { Configuration } from '../schemas/Configuration.schema';
import { mockConfigurationData } from '../../test/factory/configuration.factory';

const mockConfigurationService = {
    createConfiguration: jest.fn(),
    findConfiguration: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
};

describe('ConfigurationController', () => {
    let controller: ConfigurationController;
    let service: ConfigurationService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [ConfigurationController],
            providers: [
                {
                    provide: ConfigurationService,
                    useValue: mockConfigurationService,
                },
            ],
        }).compile();

        controller = module.get<ConfigurationController>(ConfigurationController);
        service = module.get<ConfigurationService>(ConfigurationService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('createConfiguration', () => {
        it('should create a new configuration', async () => {
            const createDto: CreateConfigurationDto = { ...mockConfigurationData }
            const mockId = new Types.ObjectId();
            const createdConfig: any = { _id: mockId, ...createDto, projectId: new Types.ObjectId(mockConfigurationData.projectId) };

            jest.spyOn(service, 'createConfiguration').mockResolvedValue(createdConfig);

            const result = await controller.createConfiguration(createDto);

            expect(result).toEqual(createdConfig);
            expect(service.createConfiguration).toHaveBeenCalledWith(createDto);
        });
    });

    describe('getConfiguration', () => {
        it('should return a configuration by ID', async () => {
            const id = new Types.ObjectId();
            const configuration: any = { _id: id, ...mockConfigurationData, projectId: new Types.ObjectId(mockConfigurationData.projectId) };

            jest.spyOn(service, 'findConfiguration').mockResolvedValue([{_id: id.toString(), ...configuration}]);

            const result = await controller.getConfiguration(id.toString());

            expect(result).toEqual(configuration);
            expect(service.findConfiguration).toHaveBeenCalledWith({ filter: { _id: id.toString() } });
        });

        it('should throw NotFoundException if no configuration is found', async () => {
            const id = new Types.ObjectId();
            jest.spyOn(service, 'findConfiguration').mockResolvedValue([]);
            await expect(controller.getConfiguration(id.toString())).rejects.toThrow(NotFoundException);
        });
    });

    describe('findByProjectId', () => {
        it('should return configurations by project ID', async () => {
            const projectId = new Types.ObjectId().toHexString();
            const configurations = [{ }] as Configuration[];

            jest.spyOn(service, 'findConfiguration').mockResolvedValue(configurations);

            const result = await controller.findByProjectId(projectId);

            expect(result).toEqual(configurations);
            expect(service.findConfiguration).toHaveBeenCalledWith({ filter: { projectId: new Types.ObjectId(projectId) } });
        });
    });

    describe('update', () => {
        it('should update a configuration by ID', async () => {
            const id =  new Types.ObjectId()
            const updateDto: UpdateConfigurationDto = mockConfigurationData
            const updatedConfig: any = { id: id, ...updateDto, mountPath: '/new' }

            jest.spyOn(service, 'update').mockResolvedValue(updatedConfig);

            const result = await controller.update(id.toString(), updateDto);

            expect(result).toEqual(updatedConfig);
            expect(service.update).toHaveBeenCalledWith(new Types.ObjectId(id), updateDto);
        });
    });

    describe('remove', () => {
        it('should delete a configuration by ID', async () => {
            const id =  new Types.ObjectId()
            jest.spyOn(service, 'remove').mockResolvedValue({ success: true, id: new Types.ObjectId(id) });
            const result = await controller.remove(id.toString());
            expect(result).toEqual({ success: true, id: new Types.ObjectId(id) });
            expect(service.remove).toHaveBeenCalledWith(new Types.ObjectId(id));
        });
    });
});
