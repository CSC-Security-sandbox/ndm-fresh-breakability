import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { ConfigurationService } from './configuration.service';
import { Configuration } from '../schemas/Configuration.schema';
import { mockConfigurationData } from '../../test/factory/configuration.factory';

const mockConfigurationModel = {
    find: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
};

describe('ConfigurationService', () => {
    let service: ConfigurationService;
    let model: Model<Configuration>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ConfigurationService,
                {
                    provide: 'ConfigurationModel',
                    useValue: mockConfigurationModel,
                },
            ],
        }).compile();

        service = module.get<ConfigurationService>(ConfigurationService);
        model = module.get<Model<Configuration>>('ConfigurationModel');
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('findConfiguration', () => {
        it('should return configurations matching the query', async () => {
            const mockQuery = { filter: { host: '127.0.0.1' } };

            const mockResult = [mockConfigurationData];
            (model.find as jest.Mock).mockReturnValue({
                exec: jest.fn().mockResolvedValue(mockResult),
            });

            const result = await service.findConfiguration(mockQuery);

            expect(result).toEqual(mockResult);
            expect(result.length).toEqual(1);
            expect(result[0].projectId.toString()).toEqual('66c85422795052061b4237f8');
            expect(model.find).toHaveBeenCalledWith(mockQuery.filter, undefined, undefined);
        });

        it('should called with projection', async () => {
            const mockQuery = { filter: { host: '127.0.0.1' }, projection: { host: 1 } };

            const mockResult = [mockConfigurationData];
            (model.find as jest.Mock).mockReturnValue({
                exec: jest.fn().mockResolvedValue(mockResult),
            });

            const result = await service.findConfiguration(mockQuery);

            expect(result).toEqual(mockResult);
            expect(result.length).toEqual(1);
            expect(result[0].projectId.toString()).toEqual('66c85422795052061b4237f8');
            expect(model.find).toHaveBeenCalledWith(mockQuery.filter, mockQuery.projection, undefined);
        });

        it('should return an empty array when no configurations match the query', async () => {
            const mockQuery = { filter: { host: '127.0.0.1' } };

            (model.find as jest.Mock).mockReturnValue({
                exec: jest.fn().mockResolvedValue([]),
            });

            const result = await service.findConfiguration(mockQuery);

            expect(result).toEqual([]);
            expect(model.find).toHaveBeenCalledWith(mockQuery.filter, undefined, undefined);
        });

        it('should throw an error if the query is invalid', async () => {
            const mockQuery = { filter: undefined };

            (model.find as jest.Mock).mockImplementation(() => {
                throw new Error('Invalid query');
            });

            await expect(service.findConfiguration(mockQuery)).rejects.toThrow('Invalid query');
        });
    });

    describe('updateConfiguration', () => {
        it('should update and return the updated configuration', async () => {
            const updatedConfig = { ...mockConfigurationData, host: '127.0.0.1' };
            const mockId = new Types.ObjectId();
            (model.findByIdAndUpdate as jest.Mock).mockResolvedValue(updatedConfig);
            
            const result = await service.update(mockId, { host: '127.0.0.1' });
            
            expect(result).toEqual(updatedConfig);
            expect(model.findByIdAndUpdate).toHaveBeenCalledWith(mockId, { host: '127.0.0.1' }, { new: true });
        });
        
        it('should handle errors during update', async () => {
            const mockId = new Types.ObjectId();
            (model.findByIdAndUpdate as jest.Mock).mockRejectedValue(new Error('Update failed'));
    
            await expect(service.update(mockId, { host: '127.0.0.1' })).rejects.toThrow('Update failed');
        });
    });

    describe('remove', () => {
        it('should delete a configuration and return success', async () => {
            const mockId = new Types.ObjectId();
            const mockResult = { ...mockConfigurationData, _id: mockId };
            (model.findByIdAndDelete as jest.Mock).mockResolvedValue(mockResult);
            const result = await service.remove(mockId);
            expect(result).toEqual({ success: true, id: mockId });
            expect(model.findByIdAndDelete).toHaveBeenCalledWith(mockId);
        });

        it('should throw NotFoundException when the configuration is not found', async () => {
            const mockId = new Types.ObjectId();
            (model.findByIdAndDelete as jest.Mock).mockResolvedValue(null);
            await expect(service.remove(mockId)).rejects.toThrow(
                new NotFoundException(`Configuration with ID ${mockId} not found`)
            );
        });
    });

});
