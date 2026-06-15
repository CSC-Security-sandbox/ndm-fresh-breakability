import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { UserPermissionResponse } from './user-permission-response-type';
import { makeAxiosRequest } from 'src/utils/axios-request-utils';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from '../test-utils/logger-mocks';

jest.mock('axios');
jest.mock('src/utils/axios-request-utils');
jest.mock('../utils/crypto-utils', () => ({
  encryptData: jest.fn().mockImplementation((text) => `encrypted:${text}`),
}));

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
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

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
    expect(tempPassword).toHaveLength(22);
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
        `Cannot create user: the email id '${username}' already exists.`,
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
      new InternalServerErrorException(
        'Failed to create user in Keycloak, error: Failed to retrieve Keycloak token',
      ),
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

  it('should throw an error if user is not found during password reset', async () => {
    const email = 'user@example.com';
    const token = 'mock-token';

    (makeAxiosRequest as jest.Mock).mockResolvedValue({ data: [] });
    jest.spyOn(service, 'getKeycloakToken').mockResolvedValue(token);

    await expect(service.resetPassword(email)).rejects.toThrow(
      new NotFoundException('User not found in Keycloak'),
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
        'Failed to update user status in Keycloak, error: User not found in Keycloak, Please verify the user ID and try again.',
      ),
    );
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
      new NotFoundException(
        'User not found, Please verify the user ID and try again.',
      ),
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

  // Database error handling tests
  describe('Database Error Handling', () => {
    it('should handle errors in getKeycloakToken', async () => {
      const axiosError = new Error('Network connection failed');

      // Create a new service instance without the spy to test the actual implementation
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          {
            provide: getRepositoryToken(User),
            useValue: mockUserRepository,
          },
          { provide: LoggerFactory, useValue: mockLoggerFactory },
        ],
      }).compile();

      const testService = module.get<AuthService>(AuthService);
      (makeAxiosRequest as jest.Mock).mockRejectedValue(axiosError);

      await expect(testService.getKeycloakToken()).rejects.toThrow(
        new InternalServerErrorException(
          'Failed to get Keycloak token, error: Network connection failed',
        ),
      );
    });

    it('should handle database errors in inviteUser and log them', async () => {
      const username = 'user@example.com';
      const firstName = 'John';
      const lastName = 'Doe';
      const dbError = new Error('Database connection failed');

      mockUserRepository.findOne.mockResolvedValue(null); // User doesn't exist
      (makeAxiosRequest as jest.Mock).mockResolvedValue(mockKeycloakResponse); // Keycloak succeeds
      mockUserRepository.create.mockReturnValue({
        email: username,
        first_name: firstName,
        last_name: lastName,
        populateWhoColumns: jest.fn(),
      });
      mockUserRepository.save.mockRejectedValue(dbError); // Database fails

      await expect(
        service.inviteUser(
          username,
          firstName,
          lastName,
          userPermissionResponseMock,
        ),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Failed to save user to database, error: Database connection failed',
        ),
      );
    });

    it('should throw ConflictException when DB unique constraint is violated on inviteUser', async () => {
      const username = 'duplicate@example.com';
      const firstName = 'Jane';
      const lastName = 'Doe';

      const constraintError: any = new Error('duplicate key value violates unique constraint');
      constraintError.code = '23505';

      mockUserRepository.findOne.mockResolvedValue(null);
      (makeAxiosRequest as jest.Mock).mockResolvedValue(mockKeycloakResponse);
      mockUserRepository.create.mockReturnValue({
        email: username,
        first_name: firstName,
        last_name: lastName,
        populateWhoColumns: jest.fn(),
      });
      mockUserRepository.save.mockRejectedValue(constraintError);

      await expect(
        service.inviteUser(
          username,
          firstName,
          lastName,
          userPermissionResponseMock,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should handle repository findOne errors in setUserStatus', async () => {
      const email = 'user@example.com';
      const enable = true;
      const dbError = new Error('Database query failed');

      mockUserRepository.findOne.mockRejectedValue(dbError);

      await expect(service.setUserStatus(email, enable)).rejects.toThrow(
        dbError,
      );
    });

    it('should handle repository save errors in setUserStatus', async () => {
      const email = 'user@example.com';
      const enable = true;
      const user = new User();
      user.email = email;
      user.user_status = 'inactive';
      const dbError = new Error('Save operation failed');

      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.save.mockRejectedValue(dbError);
      (makeAxiosRequest as jest.Mock).mockResolvedValue([{ id: 'user-id' }]);

      await expect(service.setUserStatus(email, enable)).rejects.toThrow(
        new InternalServerErrorException(
          'Failed to update user status in Keycloak, error: Save operation failed',
        ),
      );
    });

    it('should disable user and call logout endpoint', async () => {
      const email = 'user@example.com';
      const user = new User();
      user.email = email;
      user.user_status = 'active';

      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.save.mockResolvedValue(user);
      (makeAxiosRequest as jest.Mock)
        .mockResolvedValueOnce([{ id: 'keycloak-user-id' }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const result = await service.setUserStatus(email, false);

      expect(result.message).toContain('disabled');
      expect(result.user.user_status).toBe('inactive');
    });

    it('should successfully reset password', async () => {
      (makeAxiosRequest as jest.Mock)
        .mockResolvedValueOnce([{ id: 'kc-user-id' }])
        .mockResolvedValueOnce(undefined);

      const result = await service.resetPassword('user@example.com');
      expect(result).toContain('encrypted:');
    });

    it('should throw InternalServerErrorException for non-HTTP errors in resetPassword', async () => {
      const genericError = new Error('Network timeout');
      (makeAxiosRequest as jest.Mock)
        .mockRejectedValueOnce(genericError);

      await expect(service.resetPassword('user@example.com')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should cleanup Keycloak user when DB save fails in inviteUser', async () => {
      const username = 'cleanup@example.com';
      const dbError = new Error('DB constraint');

      mockUserRepository.findOne.mockResolvedValue(null);
      mockUserRepository.create.mockReturnValue({
        email: username,
        first_name: 'Test',
        last_name: 'User',
        populateWhoColumns: jest.fn(),
      });
      mockUserRepository.save.mockRejectedValue(dbError);
      (makeAxiosRequest as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ id: 'kc-user-to-delete' }])
        .mockResolvedValueOnce(undefined);

      await expect(
        service.inviteUser(username, 'Test', 'User', userPermissionResponseMock),
      ).rejects.toThrow(InternalServerErrorException);

      expect(makeAxiosRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});
