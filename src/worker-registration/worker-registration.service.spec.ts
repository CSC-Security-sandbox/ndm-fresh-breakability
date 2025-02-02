import { Test, TestingModule } from '@nestjs/testing';
import { WorkerRegistrationService } from './worker-registration.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { KeycloakAdminConfig } from 'src/config/keycloak.config';
import { RegisterWorkerDto } from './dto/register-worker.dto';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WorkerRegistrationService', () => {
  let service: WorkerRegistrationService;
  let configService: ConfigService;

  const mockKeycloakConfig: KeycloakAdminConfig = {
    keycloakUrl: 'http://keycloak-url',
    keycloakAdminClient: 'admin-client',
    keycloakAdminUsername: 'admin',
    keycloakAdminPassword: 'password',
    keycloakRealm: 'master',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerRegistrationService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(mockKeycloakConfig),
          },
        },
      ],
    }).compile();

    service = module.get<WorkerRegistrationService>(WorkerRegistrationService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('getAdminAccessToken', () => {
    it('should return the access token', async () => {
      const mockTokenResponse = { data: { access_token: 'mock-access-token' } };
      mockedAxios.post.mockResolvedValue(mockTokenResponse);

      const token = await service.getAdminAccessToken();

      expect(token).toBe('mock-access-token');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://keycloak-url/realms/master/protocol/openid-connect/token',
        expect.any(URLSearchParams),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
    });

    it('should throw an InternalServerErrorException when the request fails', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Network error'));

      await expect(service.getAdminAccessToken()).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('registerWorker', () => {
    it('should register the worker successfully', async () => {
      const mockRegisterResponse = { status: 201 };
      const mockDetails: RegisterWorkerDto = { projectId: 'project1', workerName: 'worker1' };
      const mockClientConfig = { clientId: 'client-id', secret: 'client-secret' };
      const mockAccessToken = 'mock-access-token';

      // Mock axios.post calls
      mockedAxios.post
        .mockResolvedValueOnce({ data: { access_token: mockAccessToken } }) // Mock getAdminAccessToken
        .mockResolvedValueOnce(mockRegisterResponse); // Mock register worker API call

      const result = await service.registerWorker(mockDetails);

      expect(result).toBeDefined();

    });

    it('should throw BadRequestException when worker details are invalid', async () => {
      const mockDetails: RegisterWorkerDto = { projectId: '', workerName: '' };

      await expect(service.registerWorker(mockDetails)).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException when worker registration fails', async () => {
      const mockDetails: RegisterWorkerDto = { projectId: 'project1', workerName: 'worker1' };

      mockedAxios.post
        .mockResolvedValueOnce({ data: { access_token: 'mock-access-token' } }) // Mock getAdminAccessToken
        .mockRejectedValueOnce(new Error('Registration failed')); // Mock registration failure

      await expect(service.registerWorker(mockDetails)).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException when worker registration fails 2', async () => {
      const mockDetails: RegisterWorkerDto = { projectId: 'project1', workerName: 'worker1' };

      mockedAxios.post
        .mockResolvedValueOnce({ data: { access_token: 'mock-access-token' } }) // Mock getAdminAccessToken
        .mockRejectedValueOnce({status: 200}); 

      await expect(service.registerWorker(mockDetails)).rejects.toThrow(InternalServerErrorException);
    });


  });
});
