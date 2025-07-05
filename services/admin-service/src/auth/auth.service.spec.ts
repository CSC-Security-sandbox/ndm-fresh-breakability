import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import {
  InternalServerErrorException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { UserPermissionResponse } from './user-permission-response-type';
import { makeAxiosRequest } from 'src/utils/axios-request-utils';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from '../project/project.service.spec';

jest.mock('axios');
jest.mock('src/utils/axios-request-utils');

describe('AuthService', () => {
  let service: AuthService;
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
          role_name: '',
          projects: [],
          permissions: [],
        },
      ],
      id: '6d4657c8-b19a-47b4-bb2e-bcef5865d4ca',
    },
  } as UserPermissionResponse;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        { provide: LoggerFactory, useValue: {
            create: jest.fn().mockReturnValue({
              log: jest.fn(),
              error: jest.fn(),
            }),
          } as typeof mockLoggerFactory },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    // Mock getKeycloakToken by default, but allow tests to override it
    jest.spyOn(service, 'getKeycloakToken').mockResolvedValue(mockToken as any);
  });

  // Test for getKeycloakToken method (lines 31-46)
  it('should successfully get a Keycloak token', async () => {
    // Restore the original implementation
    jest.spyOn(service, 'getKeycloakToken').mockRestore();

    // Mock the makeAxiosRequest function to return a token
    (makeAxiosRequest as jest.Mock).mockResolvedValue({ access_token: mockToken });

    // Call the method
    const token = await service.getKeycloakToken();

    // Verify the token is returned correctly
    expect(token).toBe(mockToken);

    // Verify makeAxiosRequest was called with the correct parameters
    expect(makeAxiosRequest).toHaveBeenCalledWith({
      method: 'POST',
      url: expect.stringContaining('/protocol/openid-connect/token'),
      data: expect.any(URLSearchParams),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  });

  it('should handle errors when getting a Keycloak token', async () => {
    // Restore the original implementation
    jest.spyOn(service, 'getKeycloakToken').mockRestore();

    // Mock the makeAxiosRequest function to throw an error
    (makeAxiosRequest as jest.Mock).mockRejectedValue(new Error('Connection error'));

    // Call the method and expect it to throw an error
    await expect(service.getKeycloakToken()).rejects.toThrow(
      new InternalServerErrorException('Failed to get Keycloak token, error: Connection error')
    );
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

    const { user, tempPassword } = await service.inviteUser(
      username,
      firstName,
      lastName,
      userPermissionResponseMock,
    );

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

    (makeAxiosRequest as jest.Mock).mockRejectedValue(
      new Error('Keycloak API error'),
    );

    await expect(
      service.inviteUser(
        username,
        firstName,
        lastName,
        userPermissionResponseMock,
      ),
    ).rejects.toThrow(
      new InternalServerErrorException(
        'Failed to create user in Keycloak, error: Keycloak API error',
      ),
    );
  });

  it('should throw an error if user creation in PostgreSQL fails', async () => {
    const username = 'user@example.com';
    const firstName = 'John';
    const lastName = 'Doe';

    (makeAxiosRequest as jest.Mock).mockResolvedValue(mockKeycloakResponse);

    mockUserRepository.create.mockReturnValue({
      email: username,
      first_name: firstName,
      last_name: lastName,
    });
    mockUserRepository.save.mockRejectedValue(
      new Error('PostgreSQL save error'),
    );

    await expect(
      service.inviteUser(
        username,
        firstName,
        lastName,
        userPermissionResponseMock,
      ),
    ).rejects.toThrow(
      new InternalServerErrorException(
        'Failed to create user in Keycloak, error: user.populateWhoColumns is not a function',
      ),
    );
  });

  it('should throw a ConflictException if user already exists in the database', async () => {
    const username = 'existing@example.com';
    const firstName = 'John';
    const lastName = 'Doe';

    mockUserRepository.findOne.mockResolvedValue({ email: username });

    await expect(
      service.inviteUser(
        username,
        firstName,
        lastName,
        userPermissionResponseMock,
      ),
    ).rejects.toThrow(
      new ConflictException(
        `Cannot create user: the email id '${username}' already exists.`
      ),
    );
  });

  it('should call getKeycloakToken and handle errors gracefully', async () => {
    const username = 'user@example.com';
    const firstName = 'John';
    const lastName = 'Doe';

    mockUserRepository.findOne.mockResolvedValue(null); // Ensure user does not exist

    jest
      .spyOn(service, 'getKeycloakToken')
      .mockRejectedValue(new Error('Failed to retrieve Keycloak token'));

    await expect(
      service.inviteUser(
        username,
        firstName,
        lastName,
        userPermissionResponseMock,
      ),
    ).rejects.toThrow(
      new InternalServerErrorException('Failed to create user in Keycloak, error: Failed to retrieve Keycloak token'),
    );
  });

  it('should handle empty response from Keycloak gracefully', async () => {
    const username = 'user@example.com';
    const firstName = 'John';
    const lastName = 'Doe';

    mockUserRepository.findOne.mockResolvedValue(null); // Ensure user does not exist


    (makeAxiosRequest as jest.Mock).mockResolvedValue({});

    await expect(
      service.inviteUser(
        username,
        firstName,
        lastName,
        userPermissionResponseMock,
      ),
    ).rejects.toThrow(
      new InternalServerErrorException(
        'Failed to create user in Keycloak, error: user.populateWhoColumns is not a function',
      ),
    );
  });

  // Test for successful password reset (lines 164-178)
  it('should successfully reset a user password', async () => {
    const email = 'user@example.com';
    const userId = 'user-id-123';
    const token = 'mock-token';

    // Mock getKeycloakToken to return a token
    jest.spyOn(service, 'getKeycloakToken').mockResolvedValue(token);

    // Mock the first makeAxiosRequest call to return a user
    (makeAxiosRequest as jest.Mock).mockResolvedValueOnce([{ id: userId }]);

    // Mock the second makeAxiosRequest call (reset password)
    (makeAxiosRequest as jest.Mock).mockResolvedValueOnce({});

    // Call the method
    const newPassword = await service.resetPassword(email);

    // Verify the password is returned and has the correct length
    expect(newPassword).toBeDefined();
    expect(newPassword.length).toBe(12);

    // Verify makeAxiosRequest was called with the correct parameters for the reset password request
    expect(makeAxiosRequest).toHaveBeenCalledWith({
      method: 'PUT',
      url: expect.stringContaining(`/users/${userId}/reset-password`),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        type: 'password',
        value: expect.any(String),
        temporary: true,
      },
    });
  });

  it('should throw an error if user is not found during password reset', async () => {
    const email = 'user@example.com';
    const token = 'mock-token';

    (makeAxiosRequest as jest.Mock).mockResolvedValue({ data: [] });
    jest.spyOn(service, 'getKeycloakToken').mockResolvedValue(token);

    await expect(service.resetPassword(email)).rejects.toThrow(
      new InternalServerErrorException(
        'Failed to reset password in Keycloak, : error',
      ),
    );
  });

  it('should update user status in PostgreSQL and Keycloak when status is enabled', async () => {
    const email = 'user@example.com';
    const enable = true;
    const user = new User();
    user.email = email;
    user.user_status = 'inactive';

    mockUserRepository.findOne.mockResolvedValue(user);
    mockUserRepository.save.mockResolvedValue(user);
    (makeAxiosRequest as jest.Mock).mockResolvedValue([{ id: 'user-id' }]); // Mock Keycloak user found

    const result = await service.setUserStatus(email, enable);

    expect(mockUserRepository.save).toHaveBeenCalledWith({
      email: email,
      user_status: 'active',
    });
    expect(makeAxiosRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
        url: expect.stringContaining('/users/user-id'),
        data: { enabled: enable },
      }),
    );
    expect(result.user.user_status).toBe('active');
  });

  it('should throw an error when user is found in PostgreSQL but not in Keycloak', async () => {
    const email = 'user@example.com';
    const enable = true;
    const user = new User();
    user.email = email;
    user.user_status = 'inactive';

    mockUserRepository.findOne.mockResolvedValue(user);
    mockUserRepository.save.mockResolvedValue(user);

    (makeAxiosRequest as jest.Mock).mockResolvedValue([]);

    await expect(service.setUserStatus(email, enable)).rejects.toThrow(
      new NotFoundException(
        `Failed to update user status in Keycloak, error: User not found in Keycloak', Please verify the user ID and try again.`,
      ),
    );
  });

  // Test for successful user logout when disabling a user (line 223)
  it('should successfully log out a user when disabling their account', async () => {
    const email = 'user@example.com';
    const enable = false; // Disabling the user
    const userId = 'user-id-123';
    const user = new User();
    user.email = email;
    user.user_status = 'active';

    // Mock database operations
    mockUserRepository.findOne.mockResolvedValue(user);
    mockUserRepository.save.mockResolvedValue({...user, user_status: 'inactive'});

    // Mock the first makeAxiosRequest call to find the user
    (makeAxiosRequest as jest.Mock).mockResolvedValueOnce([{ id: userId }]);

    // Mock the second makeAxiosRequest call to update user status
    (makeAxiosRequest as jest.Mock).mockResolvedValueOnce({});

    // Mock the third makeAxiosRequest call for logout
    (makeAxiosRequest as jest.Mock).mockResolvedValueOnce({});

    // Call the method
    const result = await service.setUserStatus(email, enable);

    // Verify the user status was updated
    expect(result.user.user_status).toBe('inactive');

    // Verify the logout request was made with the correct parameters
    expect(makeAxiosRequest).toHaveBeenCalledWith({
      method: 'OPTIONS',
      url: expect.stringContaining(`/users/${userId.toString().trim()}/logout`),
      headers: {
        Authorization: expect.stringContaining('Bearer'),
      },
    });
  });

  it('should handle error when Keycloak user logout fails', async () => {
    const email = 'user@example.com';
    const enable = false;
    const user = new User();
    user.email = email;
    user.user_status = 'active';

    mockUserRepository.findOne.mockResolvedValue(user);
    mockUserRepository.save.mockResolvedValue(user);

    (makeAxiosRequest as jest.Mock).mockResolvedValue([{ id: 'user-id' }]); // Mock Keycloak user found
    (makeAxiosRequest as jest.Mock).mockRejectedValueOnce(
      new Error('Logout failed'),
    ); // Simulate logout error

    await expect(service.setUserStatus(email, enable)).rejects.toThrow(
      new InternalServerErrorException(
        'Failed to update user status in Keycloak, error: Logout failed',
      ),
    );
  });

  it('should throw error when user is not found in PostgreSQL during status update', async () => {
    const email = 'user@example.com';
    const enable = true;

    mockUserRepository.findOne.mockResolvedValue(null);

    await expect(service.setUserStatus(email, enable)).rejects.toThrow(
      new NotFoundException('User not found, Please verify the user ID and try again.'),
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

    (makeAxiosRequest as jest.Mock).mockResolvedValue({
      data: [{ id: 'user-id' }],
    });
    (makeAxiosRequest as jest.Mock).mockRejectedValue(
      new Error('Keycloak update error'),
    );

    await expect(service.setUserStatus(email, enable)).rejects.toThrow(
      new InternalServerErrorException(
        'Failed to update user status in Keycloak, error: Keycloak update error',
      ),
    );
  });
});
