import { Test, TestingModule } from '@nestjs/testing';
import { KoffiAclService } from './koffi-acl.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import * as koffi from 'koffi';

describe('KoffiAclService', () => {
  let service: KoffiAclService;
  let mockLoggerFactory: Partial<LoggerFactory>;
  let mockLogger: Partial<LoggerService>;

  beforeEach(async () => {
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      setParentContext: jest.fn(),
    };

    mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
      configService: {} as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KoffiAclService,
        { provide: LoggerFactory, useValue: mockLoggerFactory },
      ],
    }).compile();

    service = module.get<KoffiAclService>(KoffiAclService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('isInitialized', () => {
    it('should return false before initialize() is called', () => {
      expect(service.isInitialized()).toBe(false);
    });
  });

  describe('initialize', () => {
    it('should return false on non-Windows platforms', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });
      try {
        expect(service.initialize()).toBe(false);
        expect(service.isInitialized()).toBe(false);
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });

    it('should return false and log error if koffi.load fails', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      jest.spyOn(koffi, 'load').mockImplementation(() => {
        throw new Error('DLL not found');
      });
      try {
        expect(service.initialize()).toBe(false);
        expect(service.isInitialized()).toBe(false);
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to initialize koffi ACL bindings'),
        );
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });

    it('should succeed on Windows when koffi.load works', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mockFunc = jest.fn().mockReturnValue(jest.fn());
      const mockLib = { func: mockFunc };
      jest.spyOn(koffi, 'load').mockReturnValue(mockLib as any);
      jest.spyOn(koffi, 'struct').mockReturnValue({} as any);
      jest.spyOn(koffi, 'array').mockReturnValue({} as any);
      jest.spyOn(koffi, 'pointer' as any).mockReturnValue({} as any);

      try {
        expect(service.initialize()).toBe(true);
        expect(service.isInitialized()).toBe(true);
        expect(koffi.load).toHaveBeenCalledWith('advapi32.dll');
        expect(koffi.load).toHaveBeenCalledWith('kernel32.dll');
        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('Koffi ACL service initialized'),
        );
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });

    it('should be idempotent — second call returns true without re-loading', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mockFunc = jest.fn().mockReturnValue(jest.fn());
      const mockLib = { func: mockFunc };
      jest.spyOn(koffi, 'load').mockReturnValue(mockLib as any);
      jest.spyOn(koffi, 'struct').mockReturnValue({} as any);
      jest.spyOn(koffi, 'array').mockReturnValue({} as any);
      jest.spyOn(koffi, 'pointer' as any).mockReturnValue({} as any);

      try {
        service.initialize();
        const loadCallCount = (koffi.load as jest.Mock).mock.calls.length;

        expect(service.initialize()).toBe(true);
        expect((koffi.load as jest.Mock).mock.calls.length).toBe(loadCallCount);
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });
  });

  describe('getSecurityDescriptor', () => {
    let mockGetNamedSecurityInfoW: jest.Mock;
    let mockGetSecurityDescriptorControl: jest.Mock;
    let mockGetSecurityDescriptorOwner: jest.Mock;
    let mockGetSecurityDescriptorGroup: jest.Mock;
    let mockGetSecurityDescriptorDacl: jest.Mock;
    let mockGetAce: jest.Mock;
    let mockConvertSidToStringSidW: jest.Mock;
    let mockGetFileAttributesW: jest.Mock;
    let mockLocalFree: jest.Mock;

    beforeEach(() => {
      mockGetNamedSecurityInfoW = jest.fn();
      mockGetSecurityDescriptorControl = jest.fn();
      mockGetSecurityDescriptorOwner = jest.fn();
      mockGetSecurityDescriptorGroup = jest.fn();
      mockGetSecurityDescriptorDacl = jest.fn();
      mockGetAce = jest.fn();
      mockConvertSidToStringSidW = jest.fn();
      mockGetFileAttributesW = jest.fn();
      mockLocalFree = jest.fn();

      // Inject mocks via internal properties
      (service as any).initialized = true;
      (service as any).GetSecurityDescriptorControl = mockGetSecurityDescriptorControl;
      (service as any).GetSecurityDescriptorOwner = mockGetSecurityDescriptorOwner;
      (service as any).GetSecurityDescriptorGroup = mockGetSecurityDescriptorGroup;
      (service as any).GetSecurityDescriptorDacl = mockGetSecurityDescriptorDacl;
      (service as any).GetAce = mockGetAce;
      (service as any).ConvertSidToStringSidW = mockConvertSidToStringSidW;
      (service as any).LocalFree = mockLocalFree;

      // Async wrappers
      (service as any).getNamedSecurityInfoAsync = jest.fn();
      (service as any).getFileAttributesAsync = jest.fn();
    });

    it('should throw when GetNamedSecurityInfo returns non-zero', async () => {
      (service as any).getNamedSecurityInfoAsync.mockResolvedValue(5); // ERROR_ACCESS_DENIED

      await expect(
        service.getSecurityDescriptor('C:\\test\\file.txt'),
      ).rejects.toThrow('GetNamedSecurityInfo failed');
    });

    it('should return a valid SecurityDescriptor with no DACL (NULL DACL)', async () => {
      const fakeSdPtr = Buffer.alloc(8);
      (service as any).getNamedSecurityInfoAsync.mockImplementation(
        (path, objType, secInfo, pOwner, pGroup, pDacl, pSacl, pSD) => {
          pSD[0] = fakeSdPtr;
          return Promise.resolve(0);
        },
      );

      // Control: SE_DACL_PRESENT=0 (no DACL present)
      mockGetSecurityDescriptorControl.mockImplementation((sd, ctrl, rev) => {
        ctrl[0] = 0;
        rev[0] = 1;
        return true;
      });

      mockGetSecurityDescriptorOwner.mockImplementation((sd, owner, def) => {
        owner[0] = Buffer.from('owner-sid');
        def[0] = false;
        return true;
      });
      mockGetSecurityDescriptorGroup.mockImplementation((sd, group, def) => {
        group[0] = Buffer.from('group-sid');
        def[0] = false;
        return true;
      });

      mockConvertSidToStringSidW
        .mockImplementationOnce((sid, strOut) => {
          strOut[0] = Buffer.from('S-1-5-21-1234-500\0', 'utf16le');
          return true;
        })
        .mockImplementationOnce((sid, strOut) => {
          strOut[0] = Buffer.from('S-1-5-21-1234-513\0', 'utf16le');
          return true;
        });

      jest.spyOn(koffi, 'decode')
        .mockReturnValueOnce('S-1-5-21-1234-500')
        .mockReturnValueOnce('S-1-5-21-1234-513');

      (service as any).getFileAttributesAsync.mockResolvedValue(0x0020); // Archive

      const result = await service.getSecurityDescriptor('C:\\test\\file.txt');

      expect(result.Owner).toBe('S-1-5-21-1234-500');
      expect(result.Group).toBe('S-1-5-21-1234-513');
      expect(result.DaclPresent).toBe(false);
      expect(result.DaclProtected).toBe(false);
      expect(result.DaclAutoInherit).toBe(false);
      expect(result.DaclAces).toBeNull();
      expect(result.Attributes).toBe('Archive');
      expect(mockLocalFree).toHaveBeenCalledWith(fakeSdPtr);
    });

    it('should return DACL with ACEs when SE_DACL_PRESENT is set', async () => {
      const fakeSdPtr = Buffer.alloc(8);
      const fakeDaclPtr = Buffer.alloc(8);

      (service as any).getNamedSecurityInfoAsync.mockImplementation(
        (path, objType, secInfo, pOwner, pGroup, pDacl, pSacl, pSD) => {
          pSD[0] = fakeSdPtr;
          return Promise.resolve(0);
        },
      );

      // Control: DACL present + protected
      const SE_DACL_PRESENT = 0x0004;
      const SE_DACL_PROTECTED = 0x1000;
      mockGetSecurityDescriptorControl.mockImplementation((sd, ctrl, rev) => {
        ctrl[0] = SE_DACL_PRESENT | SE_DACL_PROTECTED;
        rev[0] = 1;
        return true;
      });

      mockGetSecurityDescriptorOwner.mockImplementation((sd, owner, def) => {
        owner[0] = Buffer.from('owner');
        def[0] = false;
        return true;
      });
      mockGetSecurityDescriptorGroup.mockImplementation((sd, group, def) => {
        group[0] = Buffer.from('group');
        def[0] = false;
        return true;
      });

      // Owner and Group SID to string
      mockConvertSidToStringSidW
        .mockImplementationOnce((sid, strOut) => {
          strOut[0] = Buffer.from('ptr');
          return true;
        })
        .mockImplementationOnce((sid, strOut) => {
          strOut[0] = Buffer.from('ptr');
          return true;
        });

      jest.spyOn(koffi, 'decode')
        .mockReturnValueOnce('S-1-5-21-111-500') // owner SID string
        .mockReturnValueOnce('S-1-5-21-111-513'); // group SID string

      // GetSecurityDescriptorDacl
      mockGetSecurityDescriptorDacl.mockImplementation((sd, present, dacl, def) => {
        present[0] = true;
        dacl[0] = fakeDaclPtr;
        def[0] = false;
        return true;
      });

      // parseAcl needs to read ACE count from DACL header
      // Mock koffi.decode for the ACL buffer (8 bytes: AclRevision=2, Sbz1=0, AclSize=..., AceCount=0)
      // We'll return 0 ACEs for simplicity
      const origDecode = koffi.decode;
      jest.spyOn(koffi, 'decode')
        .mockImplementation((ptr, type, opts?) => {
          if (ptr === fakeDaclPtr) {
            return new Uint8Array([2, 0, 16, 0, 0, 0, 0, 0]); // AceCount = 0
          }
          return origDecode(ptr, type, opts);
        });

      (service as any).getFileAttributesAsync.mockResolvedValue(0x0021); // ReadOnly + Archive

      const result = await service.getSecurityDescriptor('C:\\test\\file.txt');

      expect(result.DaclPresent).toBe(true);
      expect(result.DaclProtected).toBe(true);
      expect(result.DaclAces).toEqual([]);
      expect(result.Attributes).toContain('ReadOnly');
      expect(result.Attributes).toContain('Archive');
    });

    it('should always call LocalFree even on errors', async () => {
      const fakeSdPtr = Buffer.alloc(8);
      (service as any).getNamedSecurityInfoAsync.mockImplementation(
        (path, objType, secInfo, pOwner, pGroup, pDacl, pSacl, pSD) => {
          pSD[0] = fakeSdPtr;
          return Promise.resolve(0);
        },
      );

      mockGetSecurityDescriptorControl.mockImplementation(() => {
        throw new Error('Intentional error');
      });

      await expect(
        service.getSecurityDescriptor('C:\\test\\file.txt'),
      ).rejects.toThrow('Intentional error');

      expect(mockLocalFree).toHaveBeenCalledWith(fakeSdPtr);
    });
  });

  describe('setSecurityDescriptor', () => {
    let mockConvertStringSidToSidW: jest.Mock;
    let mockLookupAccountSidW: jest.Mock;
    let mockGetLengthSid: jest.Mock;
    let mockLocalFree: jest.Mock;

    beforeEach(() => {
      mockConvertStringSidToSidW = jest.fn();
      mockLookupAccountSidW = jest.fn();
      mockGetLengthSid = jest.fn();
      mockLocalFree = jest.fn().mockReturnValue(null);

      (service as any).initialized = true;
      (service as any).ConvertStringSidToSidW = mockConvertStringSidToSidW;
      (service as any).LookupAccountSidW = mockLookupAccountSidW;
      (service as any).GetLengthSid = mockGetLengthSid;
      (service as any).LocalFree = mockLocalFree;
      (service as any).setNamedSecurityInfoAsync = jest.fn();
      (service as any).setFileAttributesAsync = jest.fn();
    });

    it('should return error when Owner SID cannot be converted', async () => {
      mockConvertStringSidToSidW.mockImplementation((str, out) => {
        out[0] = null;
        return false;
      });

      const result = await service.setSecurityDescriptor('C:\\test\\file.txt', {
        Owner: 'INVALID-SID',
        Group: 'S-1-5-21-1234-513',
        DaclAces: null,
        DaclPresent: false,
        DaclProtected: false,
        DaclAutoInherit: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid Owner SID');
    });

    it('should return error when Group SID cannot be converted', async () => {
      mockConvertStringSidToSidW
        .mockImplementationOnce((str, out) => {
          out[0] = Buffer.from('valid-owner-sid');
          return true;
        })
        .mockImplementationOnce((str, out) => {
          out[0] = null;
          return false;
        });

      // canResolveSid mock
      mockLookupAccountSidW.mockReturnValue(false);

      const result = await service.setSecurityDescriptor('C:\\test\\file.txt', {
        Owner: 'S-1-5-21-1234-500',
        Group: 'INVALID-SID',
        DaclAces: null,
        DaclPresent: false,
        DaclProtected: false,
        DaclAutoInherit: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid Group SID');
    });

    it('should succeed for NULL DACL stamp', async () => {
      const ownerPtr = Buffer.from('owner');
      const groupPtr = Buffer.from('group');

      mockConvertStringSidToSidW
        .mockImplementationOnce((str, out) => { out[0] = ownerPtr; return true; })
        .mockImplementationOnce((str, out) => { out[0] = groupPtr; return true; });

      mockLookupAccountSidW.mockReturnValue(false);
      (service as any).setNamedSecurityInfoAsync.mockResolvedValue(0);

      const result = await service.setSecurityDescriptor('C:\\test\\file.txt', {
        Owner: 'S-1-5-21-1234-500',
        Group: 'S-1-5-21-1234-513',
        DaclAces: null,
        DaclPresent: false,
        DaclProtected: false,
        DaclAutoInherit: false,
      });

      expect(result.success).toBe(true);
      expect((service as any).setNamedSecurityInfoAsync).toHaveBeenCalled();

      // Verify DACL pointer is null for NULL DACL
      const callArgs = (service as any).setNamedSecurityInfoAsync.mock.calls[0];
      expect(callArgs[5]).toBeNull(); // pDacl should be null
    });

    it('should return error when SetNamedSecurityInfo fails', async () => {
      const ownerPtr = Buffer.from('owner');
      const groupPtr = Buffer.from('group');

      mockConvertStringSidToSidW
        .mockImplementationOnce((str, out) => { out[0] = ownerPtr; return true; })
        .mockImplementationOnce((str, out) => { out[0] = groupPtr; return true; });

      mockLookupAccountSidW.mockReturnValue(false);
      (service as any).setNamedSecurityInfoAsync.mockResolvedValue(5); // ACCESS_DENIED

      const result = await service.setSecurityDescriptor('C:\\test\\file.txt', {
        Owner: 'S-1-5-21-1234-500',
        Group: 'S-1-5-21-1234-513',
        DaclAces: null,
        DaclPresent: false,
        DaclProtected: false,
        DaclAutoInherit: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('error code 5');
    });

    it('should set file attributes after successful stamp', async () => {
      const ownerPtr = Buffer.from('owner');
      const groupPtr = Buffer.from('group');

      mockConvertStringSidToSidW
        .mockImplementationOnce((str, out) => { out[0] = ownerPtr; return true; })
        .mockImplementationOnce((str, out) => { out[0] = groupPtr; return true; });

      mockLookupAccountSidW.mockReturnValue(false);
      (service as any).setNamedSecurityInfoAsync.mockResolvedValue(0);
      (service as any).setFileAttributesAsync.mockResolvedValue(true);

      const result = await service.setSecurityDescriptor('C:\\test\\file.txt', {
        Owner: 'S-1-5-21-1234-500',
        Group: 'S-1-5-21-1234-513',
        DaclAces: null,
        DaclPresent: false,
        DaclProtected: false,
        DaclAutoInherit: false,
        Attributes: 'Archive, ReadOnly',
      });

      expect(result.success).toBe(true);
      expect((service as any).setFileAttributesAsync).toHaveBeenCalledWith(
        'C:\\test\\file.txt',
        0x0021, // Archive (0x20) | ReadOnly (0x01)
      );
    });
  });

  describe('fileAttributesToString (via getSecurityDescriptor)', () => {
    it('should handle common attribute combinations', () => {
      const fn = (service as any).fileAttributesToString.bind(service);

      expect(fn(0x0020)).toBe('Archive');
      expect(fn(0x0021)).toBe('ReadOnly, Archive');
      expect(fn(0x0010)).toBe('Directory');
      expect(fn(0x0022)).toBe('Hidden, Archive');
      expect(fn(0x0080)).toBe('Normal');
      expect(fn(0xffffffff)).toBe('');
    });

    it('should produce the same comma-separated format as .NET FileAttributes.ToString()', () => {
      const fn = (service as any).fileAttributesToString.bind(service);

      expect(fn(0x0010 | 0x0020)).toBe('Directory, Archive');
      expect(fn(0x0001 | 0x0002 | 0x0004 | 0x0020)).toBe('ReadOnly, Hidden, System, Archive');
    });
  });

  describe('parseAttributeString', () => {
    it('should round-trip with fileAttributesToString', () => {
      const toString = (service as any).fileAttributesToString.bind(service);
      const toMask = (service as any).parseAttributeString.bind(service);

      const testMasks = [0x0020, 0x0021, 0x0010, 0x0022, 0x0080];
      for (const mask of testMasks) {
        const str = toString(mask);
        expect(toMask(str)).toBe(mask);
      }
    });
  });
});
