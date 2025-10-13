import { Test, TestingModule } from '@nestjs/testing';
import { SetupExportsPathPermissionService } from './setup-exports-path-permission.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { WinShellService } from 'src/activities/common/win-shell.service';
import { RedisService } from 'src/redis/redis.service';
import { FileServerDetails } from '@netapp-cloud-datamigrate/jobs-lib';
import { ProtocolTypes } from 'src/protocols/protocols';

describe('SetupExportsPathPermissionService', () => {
  let service: SetupExportsPathPermissionService;
  let mockLoggerFactory: jest.Mocked<LoggerFactory>;
  let mockWinShellService: jest.Mocked<WinShellService>;
  let mockRedisService: jest.Mocked<RedisService>;
  let mockLogger: any;

  beforeEach(async () => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    } as any;

    mockWinShellService = {
      executeCommand: jest.fn(),
    } as any;

    mockRedisService = {
      getJobManagerContext: jest.fn(),
      getOwnerIdentity: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SetupExportsPathPermissionService,
        { provide: LoggerFactory, useValue: mockLoggerFactory },
        { provide: WinShellService, useValue: mockWinShellService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<SetupExportsPathPermissionService>(SetupExportsPathPermissionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('setupExportPathPermission', () => {
    it('should return early if destination is not SMB protocol', async () => {
      const jobRunId = 'test-job-run-id';
      const jobContext = {
        jobConfig: {
          destinationFileServer: {
            protocols: [{ type: ProtocolTypes.NFS }]
          }
        }
      } as any;

      mockRedisService.getJobManagerContext.mockResolvedValue(jobContext);

      await service.setupExportPathPermission(jobRunId);

      expect(mockLogger.debug).toHaveBeenCalledWith(`Identity mapping not available for jobRunId: ${jobRunId}`);
    });

    it('should proceed with setup for SMB protocol', async () => {
      const jobRunId = 'test-job-run-id';
      const jobContext = {
        jobConfig: {
          destinationFileServer: {
            protocols: [{ type: ProtocolTypes.SMB }],
            hostname: 'test-host',
            path: 'test-path'
          },
          sourceFileServer: {
            hostname: 'source-host',
            path: 'source-path'
          }
        }
      } as any;

      mockRedisService.getJobManagerContext.mockResolvedValue(jobContext);
      mockWinShellService.executeCommand.mockResolvedValue({ stdout: 'test-host\\test-path', stderr: '' });

      await service.setupExportPathPermission(jobRunId);

      expect(mockLogger.error).toHaveBeenCalledWith(`Starting ACL setup for jobRunId: ${jobRunId}`);
    });
  });

  describe('setup', () => {
    it('should throw error for invalid context', async () => {
      await expect(service.setup('test-id', {})).rejects.toThrow('Invalid context: missing file server configuration');
    });

    it('should handle setup with valid source and destination ACLs', async () => {
      const jobRunId = 'test-job-run-id';
      const context = {
        jobConfig: {
          destinationFileServer: {
            hostname: 'dest-host',
            path: 'dest-path'
          },
          sourceFileServer: {
            hostname: 'source-host',
            path: 'source-path'
          }
        }
      };

      const sourceAclOutput = 'source-host\\source-path testuser:(F)';
      const destAclOutput = 'dest-host\\dest-path destuser:(R)';

      mockWinShellService.executeCommand
        .mockResolvedValueOnce({ stdout: destAclOutput, stderr: '' }) // destination ACL
        .mockResolvedValueOnce({ stdout: sourceAclOutput, stderr: '' }) // source ACL
        .mockResolvedValue({ stdout: 'Successfully processed 1 files', stderr: '' }); // add/remove operations

      await service.setup(jobRunId, context);

      expect(mockWinShellService.executeCommand).toHaveBeenCalledTimes(4); // 2 ACL reads + 1 add + 1 remove
    });

    it('should handle case with no source ACL', async () => {
      const jobRunId = 'test-job-run-id';
      const context = {
        jobConfig: {
          destinationFileServer: {
            hostname: 'dest-host',
            path: 'dest-path'
          },
          sourceFileServer: {
            hostname: 'source-host',
            path: 'source-path'
          }
        }
      };

      mockWinShellService.executeCommand
        .mockResolvedValueOnce({ stdout: 'dest-host\\dest-path', stderr: '' }) // destination ACL
        .mockResolvedValueOnce({ stdout: 'source-host\\source-path', stderr: '' }); // source ACL

      await service.setup(jobRunId, context);

      expect(mockLogger.debug).toHaveBeenCalledWith('No principals found in source ACL to add');
    });

    it('should handle error when removing principals', async () => {
      const jobRunId = 'test-job-run-id';
      const context = {
        jobConfig: {
          destinationFileServer: {
            hostname: 'dest-host',
            path: 'dest-path'
          },
          sourceFileServer: {
            hostname: 'source-host',
            path: 'source-path'
          }
        }
      };

      const sourceAclOutput = '\\\\source-host/source-path testuser:(F)';
      const destAclOutput = '\\\\dest-host/dest-path destuser:(R)\ntestuser:(F)';

      mockWinShellService.executeCommand
        .mockResolvedValueOnce({ stdout: destAclOutput, stderr: '' }) // destination ACL
        .mockResolvedValueOnce({ stdout: sourceAclOutput, stderr: '' }) // source ACL
        .mockResolvedValueOnce({ stdout: 'Successfully processed 1 files', stderr: '' }) // add operation
        .mockRejectedValueOnce(new Error('Remove failed')); // remove operation fails

      await service.setup(jobRunId, context);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error removing principal destuser from destination: Remove failed',
        expect.any(String)
      );
    });
  });

  describe('parseIcaclsOutput', () => {
    it('should throw error for invalid output', () => {
      expect(() => service.parseIcaclsOutput('', 'test-path')).toThrow('Invalid icacls output');
      expect(() => service.parseIcaclsOutput(null as any, 'test-path')).toThrow('Invalid icacls output');
    });

    it('should throw error for empty output', () => {
      expect(() => service.parseIcaclsOutput('   \n  \n   ', 'test-path')).toThrow('Empty icacls output');
    });

    it('should parse valid icacls output', () => {
      const output = `test-path testuser:(F)
                      BUILTIN\\Users:(RX)
                      Successfully processed 1 files.`;
      
      const result = service.parseIcaclsOutput(output, 'test-path');
      
      expect(result.permissions).toHaveLength(2);
      expect(result.permissions[0].principal).toBe('testuser');
      expect(result.permissions[0].permissions).toContainEqual({ code: 'F', description: 'Full control' });
      expect(result.permissions[1].principal).toBe('BUILTIN\\Users');
      expect(result.permissions[1].permissions).toContainEqual({ code: 'RX', description: 'Read & Execute' });
    });

    it('should handle ACL line parsing errors gracefully', () => {
      const output = `test-path
                      :(invalid-no-user)
                      testuser:(F)`;
      
      const result = service.parseIcaclsOutput(output, 'test-path');
      
      expect(result.permissions).toHaveLength(1);
      expect(result.permissions[0].principal).toBe('testuser');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to parse ACL line: :(invalid-no-user)',
        expect.any(Error)
      );
    });

    it('should handle error parsing first line ACL info', () => {
      const output = `test-path malformed-user:(F)
                      testuser:(RX)`;
      
      // Mock parseAclLine to throw an error on first call only
      const originalParseAclLine = (service as any).parseAclLine;
      let callCount = 0;
      (service as any).parseAclLine = jest.fn().mockImplementation((line, permissions) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Parse error on first line');
        }
        return originalParseAclLine.call(service, line, permissions);
      });
      
      const result = service.parseIcaclsOutput(output, 'test-path');
      
      expect(result.permissions).toHaveLength(1);
      expect(result.permissions[0].principal).toBe('testuser');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to parse ACL line: malformed-user:(F)',
        expect.any(Error)
      );
      
      // Restore original method
      (service as any).parseAclLine = originalParseAclLine;
    });
  });

  describe('getFileACL', () => {
    it('should return null for invalid fileServer', async () => {
      const result = await service.getFileACL(null as any, 'test-job');
      
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith('Invalid fileServer parameter');
    });

    it('should return null when command fails', async () => {
      const fileServer: FileServerDetails = {
        hostname: 'test-host',
        path: 'test-path'
      } as any;

      mockWinShellService.executeCommand.mockResolvedValue({
        stdout: '',
        stderr: 'Access denied'
      });

      const result = await service.getFileACL(fileServer, 'test-job');
      
      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Error getting ACL for \\\\test-host/test-path: Access denied'
      );
    });

    it('should return parsed ACL for valid output', async () => {
      const fileServer: FileServerDetails = {
        hostname: 'test-host',
        path: 'test-path'
      } as any;

      const aclOutput = '\\\\test-host/test-path testuser:(F)';
      mockWinShellService.executeCommand.mockResolvedValue({
        stdout: aclOutput,
        stderr: ''
      });

      const result = await service.getFileACL(fileServer, 'test-job');
      
      expect(result).not.toBeNull();
      expect(result!.permissions).toHaveLength(1);
      expect(result!.permissions[0].principal).toBe('testuser');
    });

    it('should throw error when command execution fails', async () => {
      const fileServer: FileServerDetails = {
        hostname: 'test-host',
        path: 'test-path'
      } as any;

      mockWinShellService.executeCommand.mockRejectedValue(new Error('Command failed'));

      await expect(service.getFileACL(fileServer, 'test-job')).rejects.toThrow('Command failed');
    });
  });

  describe('addPrincipals', () => {
    it('should throw error for invalid parameters', async () => {
      await expect(service.addPrincipals(null as any, '', '')).rejects.toThrow(
        'Invalid parameters: destinationPath, principal, and permission are required'
      );
    });

    it('should execute icacls grant command successfully', async () => {
      const destinationPath: FileServerDetails = {
        hostname: 'test-host',
        path: 'test-path'
      } as any;

      mockWinShellService.executeCommand.mockResolvedValue({
        stdout: 'Successfully processed 1 files.',
        stderr: ''
      });

      await service.addPrincipals(destinationPath, 'testuser', '(F)', 'test-job');

      expect(mockWinShellService.executeCommand).toHaveBeenCalledWith(
        'icacls "\\\\test-host/test-path" /grant "testuser:(F)"'
      );
    });

    it('should resolve principal identity when jobRunId provided', async () => {
      const destinationPath: FileServerDetails = {
        hostname: 'test-host',
        path: 'test-path'
      } as any;

      mockRedisService.getOwnerIdentity.mockResolvedValue('S-1-5-21-123456789-123456789-123456789-1001');
      // First call (SidToName) returns 'testuser', second call (icacls) returns success
      mockWinShellService.executeCommand
        .mockResolvedValueOnce({ stdout: 'testuser', stderr: '' }) // SidToName
        .mockResolvedValueOnce({ stdout: 'Successfully processed 1 files.', stderr: '' }); // icacls

      await service.addPrincipals(destinationPath, 'testuser', '(F)', 'test-job');

      expect(mockRedisService.getOwnerIdentity).toHaveBeenCalledWith('test-job', 'testuser', 'SID');
      expect(mockWinShellService.executeCommand).toHaveBeenCalledWith(
        'icacls "\\\\test-host/test-path" /grant "testuser:(F)"'
      );
    });

    it('should throw error when icacls command fails', async () => {
      const destinationPath: FileServerDetails = {
        hostname: 'test-host',
        path: 'test-path'
      } as any;

      mockWinShellService.executeCommand.mockResolvedValue({
        stdout: '',
        stderr: 'Access denied'
      });

      await expect(service.addPrincipals(destinationPath, 'testuser', '(F)')).rejects.toThrow('Access denied');
    });
  });

  describe('removePrincipals', () => {
    it('should throw error for invalid parameters', async () => {
      await expect(service.removePrincipals(null as any, '')).rejects.toThrow(
        'Invalid parameters: destinationPath and principal are required'
      );
    });

    it('should execute icacls remove command successfully', async () => {
      const destinationPath: FileServerDetails = {
        hostname: 'test-host',
        path: 'test-path'
      } as any;

      mockWinShellService.executeCommand.mockResolvedValue({
        stdout: 'Successfully processed 1 files.',
        stderr: ''
      });

      await service.removePrincipals(destinationPath, 'testuser');

      expect(mockWinShellService.executeCommand).toHaveBeenCalledWith(
        'icacls "\\\\test-host/test-path" /remove "testuser"'
      );
    });

    it('should throw error when icacls remove command fails', async () => {
      const destinationPath: FileServerDetails = {
        hostname: 'test-host',
        path: 'test-path'
      } as any;

      mockWinShellService.executeCommand.mockResolvedValue({
        stdout: '',
        stderr: 'The account name is invalid'
      });

      await expect(service.removePrincipals(destinationPath, 'testuser')).rejects.toThrow('The account name is invalid');
    });
  });

  describe('formatPermissions', () => {
    it('should return empty string for invalid input', () => {
      // Access the private method for testing
      const result1 = (service as any).formatPermissions(null);
      const result2 = (service as any).formatPermissions([]);
      
      expect(result1).toBe('');
      expect(result2).toBe('');
    });

    it('should format permissions correctly', () => {
      const permissions = [
        { code: 'F', description: 'Full control' },
        { code: 'I', description: 'Inherited' }, // Should be filtered out
        { code: 'RX', description: 'Read & Execute' }
      ];
      
      const result = (service as any).formatPermissions(permissions);
      
      // Expect the actual implementation format: non-inheritance permissions grouped together
      expect(result).toBe('(F,RX)');
    });
  });

  describe('normalizePrincipal', () => {
    it('should handle empty principal', () => {
      const result = (service as any).normalizePrincipal('');
      expect(result).toBe('');
    });

    it('should not lowercase SIDs', () => {
      const sid = 'S-1-5-21-123456789-123456789-123456789-1001';
      const result = (service as any).normalizePrincipal(sid);
      expect(result).toBe(sid);
    });

    it('should lowercase non-SID principals', () => {
      const result = (service as any).normalizePrincipal('DOMAIN\\TestUser');
      expect(result).toBe('domain\\testuser');
    });
  });

  describe('parseAclLine', () => {
    it('should throw error for invalid line format', () => {
      const permissions: any[] = [];
      
      expect(() => (service as any).parseAclLine('invalid-line', permissions)).toThrow('Invalid ACL line format');
      expect(() => (service as any).parseAclLine('', permissions)).toThrow('Invalid ACL line');
    });

    it('should parse ACL line with DENY access type', () => {
      const permissions: any[] = [];
      
      (service as any).parseAclLine('testuser:(DENY)(F)', permissions);
      
      expect(permissions).toHaveLength(1);
      expect(permissions[0].accessType).toBe('deny');
      expect(permissions[0].principal).toBe('testuser');
    });

    it('should parse ACL line with allow permissions', () => {
      const permissions: any[] = [];
      
      (service as any).parseAclLine('testuser:(F)(RX)', permissions);
      
      expect(permissions).toHaveLength(1);
      expect(permissions[0].accessType).toBe('allow');
      expect(permissions[0].permissions).toContainEqual({ code: 'F', description: 'Full control' });
      expect(permissions[0].permissions).toContainEqual({ code: 'RX', description: 'Read & Execute' });
    });

    it('should handle errors in permission string parsing within parseAclLine', () => {
      const permissions: any[] = [];
      
      // Mock parsePermissionString to throw an error
      const originalParsePermissionString = (service as any).parsePermissionString;
      (service as any).parsePermissionString = jest.fn().mockImplementation(() => {
        throw new Error('Parse error');
      });
      
      (service as any).parseAclLine('testuser:(INVALID)', permissions);
      
      // Entry is not added because parsing failed and no permissions were added
      expect(permissions).toHaveLength(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to parse permission string: INVALID',
        expect.any(Error)
      );
      
      // Restore original method
      (service as any).parsePermissionString = originalParsePermissionString;
    });
  });

  describe('parsePermissionString', () => {
    it('should return empty array for invalid input', () => {
      const result1 = (service as any).parsePermissionString('');
      const result2 = (service as any).parsePermissionString(null);
      
      expect(result1).toEqual([]);
      expect(result2).toEqual([]);
    });

    it('should parse permission string with inheritance flags', () => {
      const result = (service as any).parsePermissionString('F,OI,CI', true);
      
      expect(result).toHaveLength(3);
      expect(result).toContainEqual({ code: 'F', description: 'Full control' });
      expect(result).toContainEqual({ code: 'OI', description: 'Object inherit' });
      expect(result).toContainEqual({ code: 'CI', description: 'Container inherit' });
    });

    it('should exclude inheritance flags when requested', () => {
      const result = (service as any).parsePermissionString('F,OI,CI', false);
      
      expect(result).toHaveLength(1);
      expect(result).toContainEqual({ code: 'F', description: 'Full control' });
    });
  });
});
