// import { SmbUserSetupService } from './smb-user-setup.service';
// import { ShellPoolExecutorService } from './shell-for-meta-stamping.service';
// import { AclOperations } from './aclOperations';
// import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib/dist/logger/logger.factory';
// import { FileServerDetails } from '@netapp-cloud-datamigrate/jobs-lib';
// import { LoggerService } from '@nestjs/common';

// const mockLogger: Partial<LoggerService> = {
//   log: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn(),
// };

// const mockShellPool = {
//   executeCommand: jest.fn(),
// };

// const mockAclOperations = {
//   resolvePrincipal: jest.fn(),
//   parseIcaclsOutput: jest.fn(),
// };

// const mockLoggerFactory = {
//   create: jest.fn(() => mockLogger),
// };

// const fileServer: FileServerDetails = {
//   hostname: 'host',
//   path: 'share\\folder',
//   username: 'user1',
// } as any;

// const context = {
//   jobConfig: {
//     destinationFileServer: { ...fileServer },
//     sourceFileServer: { ...fileServer, username: 'user2' },
//   },
//   jobRunId: 'jobRunId-1',
// };

// describe('SmbUserSetupService', () => {
//   let service: SmbUserSetupService;

//   beforeEach(() => {
//     jest.clearAllMocks();
//     service = new SmbUserSetupService(
//       mockLoggerFactory as any,
//       mockShellPool as any,
//       mockAclOperations as any,
//     );
//   });

//   describe('setup', () => {
//     it('should add destination user if not present and remove others', async () => {
//       // destinationAcl: only user2, sourceAcl: user2
//       const destinationAcl = {
//         permissions: [{ principal: 'user2', permissions: [{ code: 'F' }] }],
//       };
//       const sourceAcl = {
//         permissions: [{ principal: 'user2', permissions: [{ code: 'F' }] }],
//       };
//       jest.spyOn(service, 'getFileACL').mockImplementationOnce(async () => destinationAcl as any)
//         .mockImplementationOnce(async () => sourceAcl as any);
//       jest.spyOn(service, 'addPrincipals').mockResolvedValue(undefined);
//       jest.spyOn(service, 'removePrincipals').mockResolvedValue(undefined);
//       jest.spyOn(service, 'disableInheritance').mockResolvedValue(undefined);

//       await service.setup('jobRunId-1', context);

//       expect(service.addPrincipals).toHaveBeenCalledWith(
//         context.jobConfig.destinationFileServer,
//         context.jobConfig.destinationFileServer.username,
//         '(OI)(CI)(F)'
//       );
//       expect(service.removePrincipals).toHaveBeenCalledWith(
//         context.jobConfig.destinationFileServer,
//         'user2'
//       );
//       expect(service.disableInheritance).toHaveBeenCalled();
//       expect(service.addPrincipals).toHaveBeenCalledWith(
//         context.jobConfig.destinationFileServer,
//         'user2',
//         '(F)',
//         context.jobRunId
//       );
//     });

//     it('should not add destination user if already present', async () => {
//       const destinationAcl = {
//         permissions: [{ principal: 'user1', permissions: [{ code: 'F' }] }],
//       };
//       const sourceAcl = {
//         permissions: [{ principal: 'user2', permissions: [{ code: 'F' }] }],
//       };
//       jest.spyOn(service, 'getFileACL').mockImplementationOnce(async () => destinationAcl as any)
//         .mockImplementationOnce(async () => sourceAcl as any);
//       jest.spyOn(service, 'addPrincipals').mockResolvedValue(undefined);
//       jest.spyOn(service, 'removePrincipals').mockResolvedValue(undefined);
//       jest.spyOn(service, 'disableInheritance').mockResolvedValue(undefined);

//       await service.setup('jobRunId-1', context);

//       expect(service.addPrincipals).not.toHaveBeenCalledWith(
//         context.jobConfig.destinationFileServer,
//         context.jobConfig.destinationFileServer.username,
//         '(OI)(CI)(F)'
//       );
//     });

//     it('should handle missing ACLs gracefully', async () => {
//       jest.spyOn(service, 'getFileACL').mockImplementationOnce(async () => null)
//         .mockImplementationOnce(async () => null);

//       await service.setup('jobRunId-1', context);

//       expect(mockLogger.warn).toHaveBeenCalled();
//     });

//     it('should log errors when addPrincipals fails', async () => {
//       const destinationAcl = {
//         permissions: [],
//       };
//       const sourceAcl = {
//         permissions: [{ principal: 'user2', permissions: [{ code: 'F' }] }],
//       };
//       jest.spyOn(service, 'getFileACL').mockImplementationOnce(async () => destinationAcl as any)
//         .mockImplementationOnce(async () => sourceAcl as any);
//       jest.spyOn(service, 'addPrincipals').mockRejectedValue(new Error('fail'));
//       jest.spyOn(service, 'removePrincipals').mockResolvedValue(undefined);
//       jest.spyOn(service, 'disableInheritance').mockResolvedValue(undefined);

//       await service.setup('jobRunId-1', context);

//       expect(mockLogger.error).toHaveBeenCalled();
//     });

//     it('should log errors when removePrincipals fails', async () => {
//       const destinationAcl = {
//         permissions: [{ principal: 'user2', permissions: [{ code: 'F' }] }],
//       };
//       const sourceAcl = {
//         permissions: [{ principal: 'user2', permissions: [{ code: 'F' }] }],
//       };
//       jest.spyOn(service, 'getFileACL').mockImplementationOnce(async () => destinationAcl as any)
//         .mockImplementationOnce(async () => sourceAcl as any);
//       jest.spyOn(service, 'addPrincipals').mockResolvedValue(undefined);
//       jest.spyOn(service, 'removePrincipals').mockRejectedValue(new Error('fail'));
//       jest.spyOn(service, 'disableInheritance').mockResolvedValue(undefined);

//       await service.setup('jobRunId-1', context);

//       expect(mockLogger.error).toHaveBeenCalled();
//     });

//     it('should log errors when disableInheritance fails', async () => {
//       const destinationAcl = {
//         permissions: [{ principal: 'user1', permissions: [{ code: 'F' }] }],
//       };
//       const sourceAcl = {
//         permissions: [{ principal: 'user2', permissions: [{ code: 'F' }] }],
//       };
//       jest.spyOn(service, 'getFileACL').mockImplementationOnce(async () => destinationAcl as any)
//         .mockImplementationOnce(async () => sourceAcl as any);
//       jest.spyOn(service, 'addPrincipals').mockResolvedValue(undefined);
//       jest.spyOn(service, 'removePrincipals').mockResolvedValue(undefined);
//       jest.spyOn(service, 'disableInheritance').mockRejectedValue(new Error('fail'));

//       await service.setup('jobRunId-1', context);

//       expect(mockLogger.error).toHaveBeenCalled();
//     });

//     it('should log errors when addPrincipals for source users fails', async () => {
//       const destinationAcl = {
//         permissions: [{ principal: 'user1', permissions: [{ code: 'F' }] }],
//       };
//       const sourceAcl = {
//         permissions: [{ principal: 'user2', permissions: [{ code: 'F' }] }],
//       };
//       jest.spyOn(service, 'getFileACL').mockImplementationOnce(async () => destinationAcl as any)
//         .mockImplementationOnce(async () => sourceAcl as any);
//       jest.spyOn(service, 'addPrincipals').mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('fail'));
//       jest.spyOn(service, 'removePrincipals').mockResolvedValue(undefined);
//       jest.spyOn(service, 'disableInheritance').mockResolvedValue(undefined);

//       await service.setup('jobRunId-1', context);

//       expect(mockLogger.error).toHaveBeenCalled();
//     });
//   });

//   describe('disableInheritance', () => {
//     it('should execute icacls command and log success', async () => {
//       mockShellPool.executeCommand.mockResolvedValue({});
//       await service.disableInheritance(fileServer);
//       expect(mockShellPool.executeCommand).toHaveBeenCalled();
//       expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Successfully disabled inheritance'));
//     });

//     it('should log and throw error on failure', async () => {
//       mockShellPool.executeCommand.mockRejectedValue(new Error('fail'));
//       await expect(service.disableInheritance(fileServer)).rejects.toThrow('fail');
//       expect(mockLogger.error).toHaveBeenCalled();
//     });
//   });

//   describe('removePrincipals', () => {
//     it('should execute icacls command and log success', async () => {
//       mockShellPool.executeCommand.mockResolvedValue({});
//       await service.removePrincipals(fileServer, 'user1');
//       expect(mockShellPool.executeCommand).toHaveBeenCalled();
//       expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Successfully removed principal'));
//     });

//     it('should log and throw error on failure', async () => {
//       mockShellPool.executeCommand.mockRejectedValue(new Error('fail'));
//       await expect(service.removePrincipals(fileServer, 'user1')).rejects.toThrow('fail');
//       expect(mockLogger.error).toHaveBeenCalled();
//     });
//   });

//   describe('addPrincipals', () => {
//     it('should resolve principal if jobRunId is provided', async () => {
//       mockAclOperations.resolvePrincipal.mockResolvedValue('resolvedUser');
//       mockShellPool.executeCommand.mockResolvedValue({});
//       await service.addPrincipals(fileServer, 'user1', '(F)', 'jobRunId-1');
//       expect(mockAclOperations.resolvePrincipal).toHaveBeenCalledWith('user1', 'jobRunId-1');
//       expect(mockShellPool.executeCommand).toHaveBeenCalled();
//     });

//     it('should not resolve principal if jobRunId is not provided', async () => {
//       mockShellPool.executeCommand.mockResolvedValue({});
//       await service.addPrincipals(fileServer, 'user1', '(F)');
//       expect(mockAclOperations.resolvePrincipal).not.toHaveBeenCalled();
//       expect(mockShellPool.executeCommand).toHaveBeenCalled();
//     });

//     it('should log and throw error on failure', async () => {
//       mockShellPool.executeCommand.mockRejectedValue(new Error('fail'));
//       await expect(service.addPrincipals(fileServer, 'user1', '(F)')).rejects.toThrow('fail');
//       expect(mockLogger.error).toHaveBeenCalled();
//     });
//   });

//   describe('getFileACL', () => {
//     it('should return parsed ACL if successful', async () => {
//       mockShellPool.executeCommand.mockResolvedValue({ stdout: 'acl', stderr: '' });
//       mockAclOperations.parseIcaclsOutput.mockReturnValue({ permissions: [{ principal: 'user1', permissions: [{ code: 'F' }] }] });
//       const result = await service.getFileACL(fileServer, 'jobRunId-1');
//       expect(result).toBeTruthy();
//       expect(mockAclOperations.parseIcaclsOutput).toHaveBeenCalled();
//     });

//     it('should return null if stderr is present', async () => {
//       mockShellPool.executeCommand.mockResolvedValue({ stdout: '', stderr: 'error' });
//       const result = await service.getFileACL(fileServer, 'jobRunId-1');
//       expect(result).toBeNull();
//     });

//     it('should return null if no permissions found', async () => {
//       mockShellPool.executeCommand.mockResolvedValue({ stdout: 'acl', stderr: '' });
//       mockAclOperations.parseIcaclsOutput.mockReturnValue({ permissions: [] });
//       const result = await service.getFileACL(fileServer, 'jobRunId-1');
//       expect(result).toBeNull();
//     });

//     it('should log and throw error on failure', async () => {
//       mockShellPool.executeCommand.mockRejectedValue(new Error('fail'));
//       await expect(service.getFileACL(fileServer, 'jobRunId-1')).rejects.toThrow('fail');
//       expect(mockLogger.error).toHaveBeenCalled();
//     });
//   });
// });
