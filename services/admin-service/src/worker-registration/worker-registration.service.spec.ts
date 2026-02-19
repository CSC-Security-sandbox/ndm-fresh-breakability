import { Test, TestingModule } from '@nestjs/testing';
import { WorkerRegistrationService } from './worker-registration.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { InternalServerErrorException } from '@nestjs/common';
import { KeycloakAdminConfig } from 'src/config/keycloak.config';
import { RegisterWorkerDto } from './dto/register-worker.dto';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from '../test-utils/logger-mocks';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('fs/promises');
jest.mock('https');

import { readFile } from 'fs/promises';
import { request } from 'https';

const mockedReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockedRequest = request as jest.MockedFunction<typeof request>;

function mockK8sSecretResponse(tlsCert: string | null, statusCode = 200) {
  mockedReadFile.mockImplementation((path: any) => {
    if (String(path).includes('token')) return Promise.resolve('mock-token');
    if (String(path).includes('ca.crt')) return Promise.resolve('mock-ca');
    return Promise.resolve('');
  });

  const mockRes: any = {
    statusCode,
    on: jest.fn((event: string, callback: Function) => {
      if (event === 'data') {
        const responseBody = statusCode === 200
          ? JSON.stringify({ data: tlsCert ? { 'tls.crt': tlsCert } : {} })
          : JSON.stringify({ message: 'Forbidden' });
        callback(responseBody);
      }
      if (event === 'end') {
        callback();
      }
      return mockRes;
    }),
  };

  const mockReq: any = {
    on: jest.fn(),
    end: jest.fn(),
  };

  mockedRequest.mockImplementation((_options: any, callback: any) => {
    callback(mockRes);
    return mockReq;
  });
}

describe('WorkerRegistrationService', () => {
  let service: WorkerRegistrationService;

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
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory
        },
      ],
    }).compile();

    service = module.get<WorkerRegistrationService>(WorkerRegistrationService);
    jest.clearAllMocks();
  });

  describe('getAdminAccessToken', () => {
    it('should return the access token on success', async () => {
      const mockTokenResponse = { data: { access_token: 'mock-access-token' } };
      mockedAxios.post.mockResolvedValue(mockTokenResponse);

      const token = await service.getAdminAccessToken();

      expect(token).toBe('mock-access-token');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://keycloak-url/realms/master/protocol/openid-connect/token',
        expect.any(URLSearchParams),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
    });

    it('should throw an InternalServerErrorException when the request fails', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Network error'));

      await expect(service.getAdminAccessToken()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('registerWorker', () => {
    const validDetails: RegisterWorkerDto = { projectId: 'project1' };

    it('should register the worker successfully when response status is 201', async () => {
      const mockAccessToken = 'mock-access-token';
      const mockRegisterResponse = { status: 201 };

      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: mockAccessToken },
      });
      mockedAxios.post.mockResolvedValueOnce(mockRegisterResponse);
      mockedReadFile.mockRejectedValue(new Error('Not in K8s'));

      const result = await service.registerWorker(validDetails);
      expect(result).toBeDefined();
      expect(result.gatewayCACertificate).toBeNull();
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    it('should throw InternalServerErrorException when details are invalid', async () => {
      const invalidDetails: RegisterWorkerDto = { projectId: '' };
      await expect(service.registerWorker(invalidDetails)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw InternalServerErrorException when registration response status is not 201', async () => {
      const mockAccessToken = 'mock-access-token';
      const mockRegisterResponse = { status: 400 };

      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: mockAccessToken },
      });
      mockedAxios.post.mockResolvedValueOnce(mockRegisterResponse);

      await expect(service.registerWorker(validDetails)).rejects.toThrow(
        new InternalServerErrorException(
          `Unexpected error occurred while registering worker`,
        ),
      );
    });

    it('should throw InternalServerErrorException with axios error response data when registration fails with an Axios error', async () => {
      const mockAccessToken = 'mock-access-token';
      const axiosError = new Error('Axios error') as any;
      axiosError.response = { data: 'Detailed axios error message' };
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: mockAccessToken },
      });
      mockedAxios.post.mockRejectedValueOnce(axiosError);

      await expect(service.registerWorker(validDetails)).rejects.toThrow(
        new InternalServerErrorException(axiosError.response.data),
      );
    });

    it('should throw InternalServerErrorException with a generic message when registration fails with a non-Axios error', async () => {
      const mockAccessToken = 'mock-access-token';
      const nonAxiosError = new Error('Non-Axios error');
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(false);
      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: mockAccessToken },
      });
      mockedAxios.post.mockRejectedValueOnce(nonAxiosError);

      await expect(service.registerWorker(validDetails)).rejects.toThrow(
        new InternalServerErrorException(
          'Unexpected error occurred while registering worker',
        ),
      );
    });
  });

  describe('registerWorker with certificate', () => {
    const validDetails: RegisterWorkerDto = { projectId: 'project1' };

    it('should include gatewayCACertificate when K8s secret is available', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'mock-token' } });
      mockedAxios.post.mockResolvedValueOnce({ status: 201 });
      mockK8sSecretResponse('base64-encoded-cert-data');

      const result = await service.registerWorker(validDetails);
      expect(result.gatewayCACertificate).toBe('base64-encoded-cert-data');
    });

    it('should return null gatewayCACertificate when secret lacks tls.crt', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'mock-token' } });
      mockedAxios.post.mockResolvedValueOnce({ status: 201 });
      mockK8sSecretResponse(null);

      const result = await service.registerWorker(validDetails);
      expect(result.gatewayCACertificate).toBeNull();
    });

    it('should return null gatewayCACertificate when readFile rejects', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'mock-token' } });
      mockedAxios.post.mockResolvedValueOnce({ status: 201 });
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));

      const result = await service.registerWorker(validDetails);
      expect(result.gatewayCACertificate).toBeNull();
    });

    it('should return null gatewayCACertificate when K8s API returns non-200', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'mock-token' } });
      mockedAxios.post.mockResolvedValueOnce({ status: 201 });
      mockK8sSecretResponse('ignored', 403);

      const result = await service.registerWorker(validDetails);
      expect(result.gatewayCACertificate).toBeNull();
    });
  });
});
