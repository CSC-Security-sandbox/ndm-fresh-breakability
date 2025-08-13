import { ValidatePathActivity } from './validate-path.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { AuthService } from 'src/auth/auth.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { SMBProtocol } from '../../protocols/smb/smb.protocol';
import { NFSProtocol } from '../../protocols/nfs/nfs.protocol';
import { mockLogger } from 'src/auth/auth.service.spec';
import { WorkersConfig } from 'src/config/app.config';

jest.mock('axios');

const mockConfigService = {
    get: jest.fn(),
};

const mockAuthService = {
    getAccessToken: jest.fn().mockResolvedValue('mocked-access-token'),
}

const mockProtocolInstance = {
    mountPath: jest.fn(),
    unmountPath: jest.fn(),
};

describe('ValidatePathActivity', () => {
    let service: ValidatePathActivity;
    let protocols: Protocols;
    let loggerFactory: LoggerFactory;
    let mockLoggerInstance: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockConfigService.get.mockImplementation((key: string) => {
            switch (key) {
                case 'worker.workerId':
                    return 'worker-123';
                case 'worker.baseWorkingPath':
                    return '/mnt/worker';
                case 'worker.connection.workerConfigUrl':
                    return 'http://worker-config-url';
                default:
                    return undefined;
            }
        });

        WorkersConfig.configService = mockConfigService as any;

        loggerFactory = {
            create: jest.fn().mockReturnValue(mockLogger),
        } as any;


        protocols = new Protocols(
            new NFSProtocol(loggerFactory),
            new SMBProtocol(loggerFactory)
        );

        jest.spyOn(protocols, 'getProtocol').mockReturnValue(mockProtocolInstance as any);

        service = new ValidatePathActivity(
            mockConfigService as any as ConfigService,
            // mockLogger as any as Logger,
            mockAuthService as any as AuthService,
            loggerFactory as LoggerFactory,
            protocols as Protocols,
        );
    });

    describe('validatePath', () => {
        const input = {
            path: '/data',
            host: 'localhost',
            username: 'user',
            password: 'pass',
            protocol: 'NFS',
            uploadId: 'upload-1',
            protocolVersion: '4.1',
            pathId: 'path-1',
        };

        it('should validate path successfully', async () => {
            mockProtocolInstance.mountPath.mockResolvedValue(undefined);
            mockProtocolInstance.unmountPath.mockResolvedValue(undefined);

            const result = await service.validatePath(input as any);

            expect(protocols.getProtocol).toHaveBeenCalledWith(ProtocolTypes[input.protocol]);
            expect(mockProtocolInstance.mountPath).toHaveBeenCalledWith(input.uploadId, expect.objectContaining({
                hostname: input.host,
                username: input.username,
                password: input.password,
                protocolVersion: input.protocolVersion,
                mountBasePath: '/mnt/worker',
                jobRunId: input.uploadId,
                pathId: input.pathId,
                path: input.path,
            }),
                false);
            expect(mockProtocolInstance.unmountPath).toHaveBeenCalledWith(input.uploadId, expect.any(Object), false);
            expect(result).toEqual({
                traceId: input.uploadId,
                status: 'success',
                workerId: 'worker-123',
                path: input.path,
                pathId: input.pathId,
                message: expect.stringContaining('Paths validated successfully by worker worker-123'),
            });
            expect(mockLogger.log).toHaveBeenCalled();
        });

        it('should return error if mountPath throws', async () => {
            mockProtocolInstance.mountPath.mockRejectedValue(new Error('mount error'));

            const result = await service.validatePath(input as any);

            expect(result.status).toBe('error');
        });

        it('should return error if unmountPath throws', async () => {
            mockProtocolInstance.mountPath.mockResolvedValue(undefined);
            mockProtocolInstance.unmountPath.mockRejectedValue(new Error('unmount error'));

            const result = await service.validatePath(input as any);

            expect(result.status).toBe('error');
        });
    });

    describe('postValidationResult', () => {
        it('should post validation result successfully', async () => {
            (axios.patch as jest.Mock).mockResolvedValue({});

            await service.postValidationResult('upload-1', { status: 'success' });

            expect(axios.patch).toHaveBeenCalledWith(
                'http://worker-config-url/api/v1/paths-upload/upload-1',
                { validationResult: { status: 'success' } },
                { headers: { Authorization : 'Bearer mocked-access-token'} }
            );
            expect(mockLogger.log).toHaveBeenCalledWith(
                '[worker-123] Validation result posted successfully for uploadId: upload-1'
            );
        });

        it('should throw and log error if axios.patch fails', async () => {
            (axios.patch as jest.Mock).mockRejectedValue(new Error('network error'));

            await expect(service.postValidationResult('upload-1', { status: 'fail' }))
                .rejects
                .toThrow('Failed to post validation result: network error');

            expect(mockLogger.error).toHaveBeenCalledWith(
                '[worker-123] Failed to post validation result: network error'
            );
        });
    });
});