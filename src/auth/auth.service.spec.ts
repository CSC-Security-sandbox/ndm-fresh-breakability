import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Repository } from 'typeorm';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { UserPermissionResponse } from './auth-user.type';
import { makeAxiosRequest } from 'src/utils/axios-request-utils'; // Importing the new utility function

jest.mock('axios');
jest.mock('src/utils/axios-request-utils'); // Mocking makeAxiosRequest

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: Repository<User>;

  const mockUserRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  const mockToken = 'mocked-token';
  const mockKeycloakResponse = { id: 'mocked-user-id' };

  const userPermissionResponseMock = {
    user: {
      roles: [
        {
          role_name: "",
          projects: [],
          permissions: []
        }
      ],
      id: "6d4657c8-b19a-47b4-bb2e-bcef5865d4ca"
    }
  } as UserPermissionResponse;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));

    jest.spyOn(service, 'getKeycloakToken').mockResolvedValue(mockToken as any);
  });

  it('should create a new user in Keycloak and PostgreSQL', async () => {
    const username = 'user@example.com';
    const firstName = 'John';
    const lastName = 'Doe';

    (makeAxiosRequest as jest.Mock).mockResolvedValue(mockKeycloakResponse);
    jest.spyOn(service, 'getKeycloakToken').mockResolvedValue(mockToken as any);

    const whoColumns = jest.fn();
    mockUserRepository.create.mockReturnValue({
      email: username,
      first_name: firstName,
      last_name: lastName,
      populateWhoColumns: whoColumns,
    });
    mockUserRepository.save.mockResolvedValue({
      email: username,
      first_name: firstName,
      last_name: lastName,
      user_status: 'active',
    });

    const { user, tempPassword } = await service.inviteUser(username, firstName, lastName, userPermissionResponseMock);

    expect(mockUserRepository.save).toHaveBeenCalledWith({
      email: username,
      first_name: firstName,
      last_name: lastName,
      populateWhoColumns: whoColumns,
    });

    expect(makeAxiosRequest).toHaveBeenCalled();
    expect(tempPassword).toBeDefined();
    expect(tempPassword).toHaveLength(12);
    expect(user.first_name).toBe(firstName);
    expect(user.last_name).toBe(lastName);
  });

  it('should throw an error if Keycloak user creation fails', async () => {
    const username = 'user@example.com';
    const firstName = 'John';
    const lastName = 'Doe';

    (makeAxiosRequest as jest.Mock).mockRejectedValue(new Error('Keycloak API error'));

    await expect(service.inviteUser(username, firstName, lastName, userPermissionResponseMock)).rejects.toThrow(
      new InternalServerErrorException('Failed to create user in Keycloak'),
    );
  });

  it('should throw an error if user creation in PostgreSQL fails', async () => {
    const username = 'user@example.com';
    const firstName = 'John';
    const lastName = 'Doe';

    (makeAxiosRequest as jest.Mock).mockResolvedValue(mockKeycloakResponse);

    mockUserRepository.create.mockReturnValue({ email: username, first_name: firstName, last_name: lastName });
    mockUserRepository.save.mockRejectedValue(new Error('PostgreSQL save error'));

    await expect(service.inviteUser(username, firstName, lastName, userPermissionResponseMock)).rejects.toThrow(
      new InternalServerErrorException('Failed to create user in Keycloak'),
    );
  });

  it('should call getKeycloakToken and handle errors gracefully', async () => {
    const username = 'user@example.com';
    const firstName = 'John';
    const lastName = 'Doe';

    jest.spyOn(service, 'getKeycloakToken').mockRejectedValue(new Error('Failed to retrieve Keycloak token'));

    await expect(service.inviteUser(username, firstName, lastName, userPermissionResponseMock)).rejects.toThrow(
      new InternalServerErrorException('Failed to retrieve Keycloak token'),
    );
  });

  it('should handle empty response from Keycloak gracefully', async () => {
    const username = 'user@example.com';
    const firstName = 'John';
    const lastName = 'Doe';

    (makeAxiosRequest as jest.Mock).mockResolvedValue({});

    await expect(service.inviteUser(username, firstName, lastName, userPermissionResponseMock)).rejects.toThrow(
      new InternalServerErrorException('Failed to create user in Keycloak'),
    );
  });

  it('should throw an error if user is not found during password reset', async () => {
    const email = 'user@example.com';
    const token = 'mock-token';

    (makeAxiosRequest as jest.Mock).mockResolvedValue({ data: [] });
    jest.spyOn(service, 'getKeycloakToken').mockResolvedValue(token);

    await expect(service.resetPassword(email)).rejects.toThrow(
      new InternalServerErrorException('Failed to reset password in Keycloak, : error'),
    );
  });

  it('should set user status to active and update in Keycloak', async () => {
    const email = 'user@example.com';
    const enable = true;
    const user = new User();
    user.email = email;
    user.user_status = 'inactive';

    mockUserRepository.findOne.mockResolvedValue(user);
    mockUserRepository.save.mockResolvedValue(user);

    (makeAxiosRequest as jest.Mock).mockResolvedValue({ data: [{ id: 'user-id' }] });
    (makeAxiosRequest as jest.Mock).mockResolvedValue({});

    const updatedUser = await service.setUserStatus(email, enable);

    expect(updatedUser.user_status).toBe('active');
    expect(makeAxiosRequest).toHaveBeenCalled();
  });

  it('should set user status to inactive and update in Keycloak', async () => {
    const email = 'user@example.com';
    const enable = false;
    const user = new User();
    user.email = email;
    user.user_status = 'active';

    mockUserRepository.findOne.mockResolvedValue(user);
    mockUserRepository.save.mockResolvedValue(user);

    (makeAxiosRequest as jest.Mock).mockResolvedValue({ data: [{ id: 'user-id' }] });
    (makeAxiosRequest as jest.Mock).mockResolvedValue({});

    const updatedUser = await service.setUserStatus(email, enable);

    expect(updatedUser.user_status).toBe('inactive');
    expect(makeAxiosRequest).toHaveBeenCalled();
  });

  it('should throw error when user is not found in PostgreSQL during status update', async () => {
    const email = 'user@example.com';
    const enable = true;

    mockUserRepository.findOne.mockResolvedValue(null);

    await expect(service.setUserStatus(email, enable)).rejects.toThrow(
      new NotFoundException('User not found'),
    );
  });

  it('should throw error when updating user status fails in Keycloak', async () => {
    const email = 'user@example.com';
    const enable = true;
    const user = new User();
    user.email = email;
    user.user_status = 'inactive';

    mockUserRepository.findOne.mockResolvedValue(user);
    mockUserRepository.save.mockResolvedValue(user);

    (makeAxiosRequest as jest.Mock).mockResolvedValue({ data: [{ id: 'user-id' }] });
    (makeAxiosRequest as jest.Mock).mockRejectedValue(new Error('Keycloak update error'));

    await expect(service.setUserStatus(email, enable)).rejects.toThrow(
      new InternalServerErrorException('Failed to update user status in Keycloak, error:'),
    );
  });
});