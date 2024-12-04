import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
 
describe('AuthController', () => {
  let authController: AuthController;
  let authService: AuthService;
 
  const mockAuthService = {
    inviteUser: jest.fn(),
    resetPassword: jest.fn(),
    setUserStatus: jest.fn(),
  };
 
  const mockJwtService = {
    verifyToken: jest.fn().mockResolvedValue({
      user: {
        roles: [
          {
            permissions: ['permission1', 'permission2'],
            projects: ['project1'],
          },
        ],
      },
    }),
    configService: {},
    client: jest.fn(),
    logger: jest.fn(),
    getKey: jest.fn(),
  };
 
  const mockUserRepository = {
    create: jest.fn(),
    save: jest.fn(),
  };
 
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        Reflector,
        JwtAuthGuard,
      ],
    }).compile();
 
    authController = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });
 
  describe('inviteUser', () => {
    it('should invite a user and return the result', async () => {
      const mockInviteUserDto = {
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
      };
 
      const mockResponse = {
        user: { id: '123', email: 'testuser' },
        tempPassword: 'randomPass123',
      };
 
      mockAuthService.inviteUser.mockResolvedValue(mockResponse);
 
      const result = await authController.inviteUser(mockInviteUserDto);
 
      expect(result).toEqual(mockResponse);
      expect(mockAuthService.inviteUser).toHaveBeenCalledWith(
        mockInviteUserDto.username,
        mockInviteUserDto.firstName,
        mockInviteUserDto.lastName
      );
    });
  });
 
  describe('resetPassword', () => {
    it('should reset the password for the given email and return the new password', async () => {
      const email = 'testuser@example.com';
      const newPassword = 'newRandomPass123';
 
      mockAuthService.resetPassword.mockResolvedValue(newPassword);
 
      const result = await authController.resetPassword(email);
 
      expect(result).toEqual({ email, newPassword });
      expect(mockAuthService.resetPassword).toHaveBeenCalledWith(email);
    });
 
    it('should handle errors gracefully when resetting password fails', async () => {
      const email = 'invaliduser@example.com';
      const mockError = new Error('User not found');
 
      mockAuthService.resetPassword.mockRejectedValue(mockError);
 
      try {
        await authController.resetPassword(email);
      } catch (error) {
        expect(error).toBe(mockError);
      }
      expect(mockAuthService.resetPassword).toHaveBeenCalledWith(email);
    });
  });
 
  describe('setUserStatus', () => {
    it('should enable or disable a user based on the email and enable flag', async () => {
      const mockUserStatusDto = {
        email: 'testuser@example.com',
        enable: true,
      };
 
      const mockUser = {
        id: '123',
        email: 'testuser@example.com',
        isActive: true,
      };
 
      mockAuthService.setUserStatus.mockResolvedValue(mockUser);
 
      const result = await authController.setUserStatus(mockUserStatusDto);
 
      expect(result).toEqual({
        message: `User enabled successfully`,
        user: mockUser,
      });
      expect(mockAuthService.setUserStatus).toHaveBeenCalledWith(
        mockUserStatusDto.email,
        mockUserStatusDto.enable
      );
    });
  });
});