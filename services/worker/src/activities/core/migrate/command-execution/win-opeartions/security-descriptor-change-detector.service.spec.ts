import { Test, TestingModule } from '@nestjs/testing';
import { WinOperationService, SmbPermissionInheritanceMode } from './win-operation.service';
import { SecurityDescriptorChangeDetectorService } from './security-descriptor-change-detector.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { WinShellService } from 'src/activities/common/win-shell.service';
import { RedisService } from 'src/redis/redis.service';
import { MetricsService } from 'src/metrics/metrics.service';
import { SourceAclError } from './acl-operation.error';
import { KoffiAclService } from './koffi-acl.service';

// Local mirror of the service-internal SecurityDescriptor / Ace shape. Kept
// in-file (rather than imported) so test data is self-describing.
type SecurityDescriptor = {
  Owner: string;
  Group: string;
  DaclAces: Ace[];
  Attributes: string;
  DaclPresent: boolean;
  DaclProtected: boolean;
  DaclAutoInherit: boolean;
  originalOwner: string;
  originalGroup: string;
};

type Ace = {
  Sid: string;
  AccessMask: number;
  AceType: number;
  AceFlags: number;
  IsInherited: boolean;
  originalSid: string;
};

/**
 * Behavioural tests for the SMB security-descriptor change-detection gate.
 *
 * Subject under test: `SecurityDescriptorChangeDetectorService`.
 *
 * The detector owns the comparator semantics
 * (`securityDescriptorEquals`, `prepareExpectedDestinationSecurityDescriptor`,
 * `hasSecurityDescriptorChanged`) but delegates raw ACL I/O and shared
 * stamp/gate transforms (`getAclOperation`, `mapSIDToTarget`,
 * `applySmbInheritanceModeTransform`, `getSIDMapping`,
 * `resolveSmbInheritanceMode`) to `WinOperationService`. Both services are
 * instantiated here so that tests can drive realistic end-to-end flows while
 * still spying on the WOS-owned ACL/SID primitives.
 *
 * Section R (Cross-validator consistency) also reaches into
 * `WinOperationService.validateAclOperation` to pin the gate-vs-validator
 * contract from a single fixture.
 */
describe('SecurityDescriptorChangeDetectorService', () => {
  let service: SecurityDescriptorChangeDetectorService;
  let winOperationService: WinOperationService;
  let mockLoggerFactory: Partial<LoggerFactory>;
  let mockLogger: Partial<LoggerService>;
  let mockWinShellService: Partial<WinShellService>;
  let mockRedisService: Partial<RedisService>;

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

    mockWinShellService = {
      executeCommand: jest.fn(),
    };

    mockRedisService = {
      getOwnerIdentity: jest.fn(),
      setOwnerIdentity: jest.fn(),
    };

    const mockMetricsService = {
      runWithTiming: jest.fn().mockImplementation(
        (_wf: string, _spec: unknown, fn: () => unknown) =>
          typeof fn === 'function' ? Promise.resolve(fn()) : Promise.resolve(),
      ),
    };

    const mockKoffiAclService = {
      isInitialized: jest.fn().mockReturnValue(false),
      initialize: jest.fn().mockReturnValue(false),
      getSecurityDescriptor: jest.fn(),
      setSecurityDescriptor: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WinOperationService,
        SecurityDescriptorChangeDetectorService,
        { provide: LoggerFactory, useValue: mockLoggerFactory },
        { provide: WinShellService, useValue: mockWinShellService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: KoffiAclService, useValue: mockKoffiAclService },
      ],
    }).compile();

    service = module.get<SecurityDescriptorChangeDetectorService>(
      SecurityDescriptorChangeDetectorService,
    );
    winOperationService = module.get<WinOperationService>(WinOperationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('securityDescriptorEquals', () => {
    const mkAce = (over: Partial<Ace> = {}): Ace => ({
      Sid: 'S-1-5-21-AAA',
      AccessMask: 0x1f01ff,
      AceType: 0,
      AceFlags: 0,
      IsInherited: false,
      originalSid: '',
      ...over,
    });

    const mkSd = (over: Partial<SecurityDescriptor> = {}): SecurityDescriptor => ({
      Owner: 'S-1-5-21-OWNER',
      Group: 'S-1-5-21-GROUP',
      DaclAces: [mkAce()],
      Attributes: 'Archive',
      DaclPresent: true,
      DaclProtected: false,
      DaclAutoInherit: true,
      originalOwner: '',
      originalGroup: '',
      ...over,
    });

    it('returns equal=true for byte-identical descriptors', () => {
      const a = mkSd();
      const b = mkSd();
      const result = service.securityDescriptorEquals(a as any, b as any);
      expect(result.equal).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('flags owner SID mismatch', () => {
      const expected = mkSd({ Owner: 'S-1-5-21-AAA' });
      const actual = mkSd({ Owner: 'S-1-5-21-BBB' });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('owner');
      expect(result.reason?.expectedValue).toBe('S-1-5-21-AAA');
      expect(result.reason?.actualValue).toBe('S-1-5-21-BBB');
    });

    it('flags group SID mismatch', () => {
      const expected = mkSd({ Group: 'S-1-5-21-G1' });
      const actual = mkSd({ Group: 'S-1-5-21-G2' });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('group');
    });

    it('flags DaclPresent mismatch (NULL DACL vs empty-but-present DACL are semantically opposite)', () => {
      const expected = mkSd({ DaclPresent: true });
      const actual = mkSd({ DaclPresent: false });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('daclPresent');
      expect(result.reason?.expectedValue).toBe(true);
      expect(result.reason?.actualValue).toBe(false);
    });

    it('flags DaclProtected mismatch', () => {
      const expected = mkSd({ DaclProtected: true });
      const actual = mkSd({ DaclProtected: false });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('daclProtected');
    });

    it('does NOT flag DaclAutoInherit drift (Windows-controlled bit; see comparator doc-comment)', () => {
      // SE_DACL_AUTO_INHERITED is set/cleared by Windows' inheritance
      // engine and is not guaranteed to match what we wrote even on a
      // successful stamp. Strict compare here would oscillate the gate
      // into restamping every incremental scan. This test pins the
      // "intentionally not gated" contract so a future re-introduction
      // of the strict check is caught immediately.
      const expected = mkSd({ DaclAutoInherit: true });
      const actual = mkSd({ DaclAutoInherit: false });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('treats ACE order as significant: same set in swapped positions is reported as drift', () => {
      // Windows DACL evaluation is order-sensitive (first-match decides
      // access, canonical-order positions carry semantic meaning), so a
      // migration tool whose value proposition is "destination is byte-
      // faithful to source" must surface order drift, not silently accept it.
      const expected = mkSd({
        DaclAces: [
          mkAce({ Sid: 'S-1-5-21-A', AccessMask: 1 }),
          mkAce({ Sid: 'S-1-5-21-B', AccessMask: 2 }),
        ],
      });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: 'S-1-5-21-B', AccessMask: 2 }),
          mkAce({ Sid: 'S-1-5-21-A', AccessMask: 1 }),
        ],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceFieldDiff');
    });

    it('flags semantically-meaningful order swap (Allow-before-Deny vs Deny-before-Allow for same trustee)', () => {
      // [Allow Alice FC, Deny Alice FC]  -> Alice ALLOWED (Allow short-circuits)
      // [Deny Alice FC, Allow Alice FC]  -> Alice DENIED  (Deny short-circuits)
      // These DACLs grant opposite access despite holding the same ACE set.
      // The comparator must report this as drift so the gate re-stamps.
      const expected = mkSd({
        DaclAces: [
          mkAce({ Sid: 'S-1-5-21-ALICE', AceType: 0, AccessMask: 0x1f01ff }),
          mkAce({ Sid: 'S-1-5-21-ALICE', AceType: 1, AccessMask: 0x1f01ff }),
        ],
      });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: 'S-1-5-21-ALICE', AceType: 1, AccessMask: 0x1f01ff }),
          mkAce({ Sid: 'S-1-5-21-ALICE', AceType: 0, AccessMask: 0x1f01ff }),
        ],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceFieldDiff');
    });

    it('treats positionally-identical ACE sequences as equal', () => {
      const expected = mkSd({
        DaclAces: [
          mkAce({ Sid: 'S-1-5-21-A', AccessMask: 1 }),
          mkAce({ Sid: 'S-1-5-21-B', AccessMask: 2 }),
        ],
      });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: 'S-1-5-21-A', AccessMask: 1 }),
          mkAce({ Sid: 'S-1-5-21-B', AccessMask: 2 }),
        ],
      });
      expect(service.securityDescriptorEquals(expected as any, actual as any).equal).toBe(true);
    });

    it('flags ACE missing on destination (source has extra ACE)', () => {
      const expected = mkSd({
        DaclAces: [
          mkAce({ Sid: 'S-1-5-21-A' }),
          mkAce({ Sid: 'S-1-5-21-B' }),
        ],
      });
      const actual = mkSd({ DaclAces: [mkAce({ Sid: 'S-1-5-21-A' })] });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceMissingOnDestination');
    });

    it('flags extra ACE on destination', () => {
      const expected = mkSd({ DaclAces: [mkAce({ Sid: 'S-1-5-21-A' })] });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: 'S-1-5-21-A' }),
          mkAce({ Sid: 'S-1-5-21-B' }),
        ],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceExtraOnDestination');
    });

    it('flags ACE AccessMask drift', () => {
      const expected = mkSd({ DaclAces: [mkAce({ AccessMask: 0x1f01ff })] });
      const actual = mkSd({ DaclAces: [mkAce({ AccessMask: 0x120089 })] });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceFieldDiff');
    });

    it('flags ACE AceFlags drift (Inherited bit) — strict by default', () => {
      const expected = mkSd({ DaclAces: [mkAce({ AceFlags: 0x00 })] });
      const actual = mkSd({ DaclAces: [mkAce({ AceFlags: 0x10 })] });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceFieldDiff');
    });

    it('ignores audit/object ACE types (only AceType 0/1 are compared)', () => {
      const expected = mkSd({
        DaclAces: [
          mkAce({ AceType: 0 }),
          mkAce({ AceType: 2 }), // SystemAudit — excluded
          mkAce({ AceType: 5 }), // AccessAllowedObject — excluded
        ],
      });
      const actual = mkSd({ DaclAces: [mkAce({ AceType: 0 })] });
      expect(service.securityDescriptorEquals(expected as any, actual as any).equal).toBe(true);
    });

    it('masks non-settable attribute bits before compare', () => {
      // Compressed is not in the keep-mask, so its presence on the expected
      // descriptor only must not flag a mismatch.
      const expected = mkSd({ Attributes: 'Archive, Compressed' });
      const actual = mkSd({ Attributes: 'Archive' });
      expect(service.securityDescriptorEquals(expected as any, actual as any).equal).toBe(true);
    });

    it('flags a settable attribute drift (ReadOnly on expected descriptor only)', () => {
      const expected = mkSd({ Attributes: 'Archive, ReadOnly' });
      const actual = mkSd({ Attributes: 'Archive' });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('attributes');
    });

    it('short-circuits on the first mismatch (owner reported before group)', () => {
      const expected = mkSd({ Owner: 'S-1-5-21-A', Group: 'S-1-5-21-X' });
      const actual = mkSd({ Owner: 'S-1-5-21-B', Group: 'S-1-5-21-Y' });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.reason?.field).toBe('owner');
    });

    it('treats directories the same as files (no folder-specific bypass)', () => {
      // The comparator is shape-agnostic — a directory descriptor with
      // different DaclProtected is still flagged the same way as a file
      // would be. (Originally pinned via DaclAutoInherit, but that bit is
      // Windows-mutated and no longer gated; DaclProtected is the next
      // boolean SD field still under strict compare.)
      const expected = mkSd({ DaclProtected: true });
      const actual = mkSd({ DaclProtected: false });
      expect(service.securityDescriptorEquals(expected as any, actual as any).equal).toBe(false);
    });

    describe('NULL DACL handling (SE_DACL_PRESENT=0 on both sides)', () => {
      // Background: Win32 distinguishes "no DACL on the object"
      // (`SE_DACL_PRESENT=0`, meaning allow-everyone for access checks)
      // from "empty DACL" (`SE_DACL_PRESENT=1` with zero ACEs, meaning
      // deny-all). The reader normalizes the first case to
      // `DaclAces: null`, but the kernel sometimes still surfaces stale
      // ACE bytes from old DACL state in the underlying buffer. Before
      // this short-circuit was added, those phantom ACEs drove false-
      // positive `aceMissingOnDestination` / `aceExtraOnDestination`
      // mismatches and a re-stamp every incremental scan. These tests
      // pin the contract that NULL-DACL ↔ NULL-DACL compares as equal
      // regardless of what `DaclAces` happens to hold.

      it('treats NULL DACL on both sides as equal when DaclAces is null on both (canonical)', () => {
        const expected = mkSd({ DaclPresent: false, DaclAces: null as any });
        const actual = mkSd({ DaclPresent: false, DaclAces: null as any });
        const result = service.securityDescriptorEquals(expected as any, actual as any);
        expect(result.equal).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('treats NULL DACL on both sides as equal even when one side surfaces phantom ACE bytes', () => {
        // Defensive: real-world readers have been seen to return non-null
        // `DaclAces` alongside `DaclPresent: false` for files whose DACL
        // was cleared by the kernel but whose ACE bytes still linger.
        // The comparator must not walk those ACEs.
        const expected = mkSd({ DaclPresent: false, DaclAces: null as any });
        const actual = mkSd({
          DaclPresent: false,
          DaclAces: [mkAce({ Sid: 'S-1-5-21-PHANTOM', AceFlags: 0x10 })],
        });
        const result = service.securityDescriptorEquals(expected as any, actual as any);
        expect(result.equal).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('treats NULL DACL on both sides as equal even when both sides surface phantom ACEs (worst-case legacy read)', () => {
        const expected = mkSd({
          DaclPresent: false,
          DaclAces: [mkAce({ Sid: 'S-1-5-21-LEFT' })],
        });
        const actual = mkSd({
          DaclPresent: false,
          DaclAces: [mkAce({ Sid: 'S-1-5-21-RIGHT', AccessMask: 0x120089 })],
        });
        const result = service.securityDescriptorEquals(expected as any, actual as any);
        expect(result.equal).toBe(true);
      });

      it('still flags Attributes drift when both sides are NULL DACL (attributes live outside the DACL)', () => {
        // NULL DACL short-circuits the ACE walk but does NOT excuse
        // attribute drift — Attributes are stored on the file directly,
        // not in the security descriptor, and stamp can/does write them.
        const expected = mkSd({
          DaclPresent: false,
          DaclAces: null as any,
          Attributes: 'Archive, ReadOnly',
        });
        const actual = mkSd({
          DaclPresent: false,
          DaclAces: null as any,
          Attributes: 'Archive',
        });
        const result = service.securityDescriptorEquals(expected as any, actual as any);
        expect(result.equal).toBe(false);
        expect(result.reason?.field).toBe('attributes');
      });

      it('does NOT short-circuit when only one side is NULL DACL (semantically opposite states)', () => {
        // NULL DACL (allow all) and empty present DACL (deny all) are
        // semantically opposite, so the `daclPresent` mismatch must fire
        // and the comparator must not pretend the two are equivalent.
        const expectedNullDacl = mkSd({ DaclPresent: false, DaclAces: null as any });
        const actualEmptyPresentDacl = mkSd({ DaclPresent: true, DaclAces: [] });
        const result = service.securityDescriptorEquals(
          expectedNullDacl as any,
          actualEmptyPresentDacl as any,
        );
        expect(result.equal).toBe(false);
        expect(result.reason?.field).toBe('daclPresent');
      });
    });
  });

  describe('hasSecurityDescriptorChanged', () => {
    const sourcePath = '/src/file.txt';
    const targetPath = '/dst/file.txt';

    it('returns false and emits no log when source and destination security descriptors match', async () => {
      const acl = {
        Owner: 'S-1-5-21-O',
        Group: 'S-1-5-21-G',
        DaclAces: [],
        Attributes: '',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: true,
        originalOwner: '',
        originalGroup: '',
      };
      const getSpy = jest
        .spyOn(winOperationService, 'getAclOperation')
        .mockResolvedValue(acl as any);
      const changed = await service.hasSecurityDescriptorChanged(sourcePath, targetPath);
      expect(changed).toBe(false);
      expect(getSpy).toHaveBeenCalledTimes(2);
      expect(getSpy).toHaveBeenCalledWith(sourcePath, true, '');
      expect(getSpy).toHaveBeenCalledWith(targetPath, false, '');
      expect(mockLogger.log).not.toHaveBeenCalled();
    });

    it('returns true and emits one structured INFO log on mismatch — includes headline diff + full expected-destination/destination SDs', async () => {
      // The mismatch log carries two layers of detail in a single line:
      //   1. Headline pair (`field`, `expectedValue`, `actualValue`) — the
      //      first drifted field surfaced by the short-circuit comparator
      //      (these reflect the post-mapping/post-inheritance-transform
      //      comparison, since that is what `isMetaUpdated` gated on).
      //   2. Full descriptors
      //      (`expectedDestinationSecurityDescriptor`,
      //       `destinationSecurityDescriptor`) — the SD that
      //      `stampAclOperation` would hand to `Set-FileSecurityFast` on
      //      the destination if this mismatch triggers a re-stamp, and the
      //      live destination SD as read from disk. Lets the operator diff
      //      every other field without re-fetching ACLs and to reproduce
      //      stamp behaviour from logs alone.
      // Pin both so an accidental field removal during refactors trips.
      const sourceSecurityDescriptor = {
        Owner: 'S-1-5-21-A',
        Group: 'S-1-5-21-G',
        DaclAces: [],
        Attributes: '',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: true,
        originalOwner: '',
        originalGroup: '',
      };
      const destinationSecurityDescriptor = { ...sourceSecurityDescriptor, Owner: 'S-1-5-21-B' };
      jest
        .spyOn(winOperationService, 'getAclOperation')
        .mockImplementation(async (_p: string, isSource: boolean) =>
          (isSource ? sourceSecurityDescriptor : destinationSecurityDescriptor) as any,
        );
      const changed = await service.hasSecurityDescriptorChanged(sourcePath, targetPath);
      expect(changed).toBe(true);
      expect(mockLogger.log).toHaveBeenCalledTimes(1);
      const msg = (mockLogger.log as jest.Mock).mock.calls[0][0];
      expect(msg).toContain('ACL mismatch on destination');
      expect(msg).toContain(`target=${targetPath}`);
      expect(msg).toContain(`source=${sourcePath}`);
      expect(msg).toContain('field=owner');
      expect(msg).toContain('S-1-5-21-A');
      expect(msg).toContain('S-1-5-21-B');
      // Full SDs must be present — operators rely on these to diff the
      // rest of the descriptor without re-running Get-Acl.
      // `expectedDestinationSecurityDescriptor` is what stamp would hand
      // to `Set-FileSecurityFast`; `destinationSecurityDescriptor` is the
      // live destination SD. When SID mapping is disabled and the DLM-root
      // inheritance transform does not apply, the expected destination SD
      // equals the raw source SD (the fixture used here).
      expect(msg).toContain(`expectedDestinationSecurityDescriptor=${JSON.stringify(sourceSecurityDescriptor)}`);
      expect(msg).toContain(`destinationSecurityDescriptor=${JSON.stringify(destinationSecurityDescriptor)}`);
    });

    it('threads workflowId from jobContext into getAclOperation and log line', async () => {
      const acl = {
        Owner: 'S-1-5-21-A',
        Group: 'S-1-5-21-G',
        DaclAces: [],
        Attributes: '',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: true,
        originalOwner: '',
        originalGroup: '',
      };
      const destinationSecurityDescriptor = { ...acl, Group: 'S-1-5-21-Z' };
      const getSpy = jest
        .spyOn(winOperationService, 'getAclOperation')
        .mockImplementation(async (_p: string, isSource: boolean) =>
          (isSource ? acl : destinationSecurityDescriptor) as any,
        );
      const jobContext = { jobRunId: 'wf-123' } as any;
      await service.hasSecurityDescriptorChanged(sourcePath, targetPath, jobContext);
      expect(getSpy).toHaveBeenCalledWith(sourcePath, true, 'wf-123');
      expect(getSpy).toHaveBeenCalledWith(targetPath, false, 'wf-123');
      const msg = (mockLogger.log as jest.Mock).mock.calls[0][0];
      expect(msg).toContain('[wf-123]');
    });

    it('propagates SourceAclError from getAclOperation', async () => {
      jest
        .spyOn(winOperationService, 'getAclOperation')
        .mockImplementation(async (_p: string, isSource: boolean) => {
          if (isSource) throw new SourceAclError('boom');
          return {} as any;
        });
      await expect(service.hasSecurityDescriptorChanged(sourcePath, targetPath)).rejects.toBeInstanceOf(
        SourceAclError,
      );
      expect(mockLogger.log).not.toHaveBeenCalled();
    });

    describe('SID mapping integration', () => {
      const ctxWithMapping = (jobRunId = 'wf-map'): any => ({
        jobRunId,
        jobConfig: { options: { isIdentityMappingAvailable: true } },
      });

      it('does not invoke SID mapping when isIdentityMappingAvailable is false', async () => {
        const acl = {
          Owner: 'S-1-5-21-O',
          Group: 'S-1-5-21-G',
          DaclAces: [],
          Attributes: '',
          DaclPresent: true,
          DaclProtected: false,
          DaclAutoInherit: true,
          originalOwner: '',
          originalGroup: '',
        };
        jest
          .spyOn(winOperationService, 'getAclOperation')
          .mockResolvedValue(acl as any);
        const mapSpy = jest.spyOn(winOperationService, 'mapSIDToTarget');
        const jobContext = {
          jobRunId: 'wf-no-map',
          jobConfig: { options: { isIdentityMappingAvailable: false } },
        } as any;
        const changed = await service.hasSecurityDescriptorChanged(sourcePath, targetPath, jobContext);
        expect(changed).toBe(false);
        expect(mapSpy).not.toHaveBeenCalled();
      });

      it('compares mapped source SIDs against destination when mapping is enabled', async () => {
        const sourceSecurityDescriptor = {
          Owner: 'S-1-5-21-SRC-OWNER',
          Group: 'S-1-5-21-SRC-GROUP',
          DaclAces: [
            { Sid: 'S-1-5-21-SRC-USER', AccessMask: 0x1f01ff, AceType: 0, AceFlags: 0, IsInherited: false, originalSid: '' },
          ],
          Attributes: '',
          DaclPresent: true,
          DaclProtected: false,
          DaclAutoInherit: true,
          originalOwner: '',
          originalGroup: '',
        };
        const destinationSecurityDescriptor = {
          Owner: 'S-1-5-21-DST-OWNER',
          Group: 'S-1-5-21-DST-GROUP',
          DaclAces: [
            { Sid: 'S-1-5-21-DST-USER', AccessMask: 0x1f01ff, AceType: 0, AceFlags: 0, IsInherited: false, originalSid: '' },
          ],
          Attributes: '',
          DaclPresent: true,
          DaclProtected: false,
          DaclAutoInherit: true,
          originalOwner: '',
          originalGroup: '',
        };
        jest
          .spyOn(winOperationService, 'getAclOperation')
          .mockImplementation(async (_p: string, isSource: boolean) =>
            // Deep-clone the source so mapSIDToTarget's mutation doesn't leak across asserts.
            (isSource ? JSON.parse(JSON.stringify(sourceSecurityDescriptor)) : destinationSecurityDescriptor) as any,
          );
        jest
          .spyOn(winOperationService, 'getSIDMapping')
          .mockImplementation(async (sid: string) => {
            if (sid === 'S-1-5-21-SRC-OWNER') return 'S-1-5-21-DST-OWNER';
            if (sid === 'S-1-5-21-SRC-GROUP') return 'S-1-5-21-DST-GROUP';
            if (sid === 'S-1-5-21-SRC-USER') return 'S-1-5-21-DST-USER';
            return null;
          });
        const changed = await service.hasSecurityDescriptorChanged(sourcePath, targetPath, ctxWithMapping());
        expect(changed).toBe(false);
        expect(mockLogger.log).not.toHaveBeenCalled();
      });

      it('reports drift when a mapped Owner SID does not match the destination', async () => {
        const sourceSecurityDescriptor = {
          Owner: 'S-1-5-21-SRC-OWNER',
          Group: 'S-1-5-21-SRC-GROUP',
          DaclAces: [],
          Attributes: '',
          DaclPresent: true,
          DaclProtected: false,
          DaclAutoInherit: true,
          originalOwner: '',
          originalGroup: '',
        };
        const destinationSecurityDescriptor = {
          ...sourceSecurityDescriptor,
          Owner: 'S-1-5-21-DST-OTHER',
          Group: 'S-1-5-21-DST-GROUP',
        };
        jest
          .spyOn(winOperationService, 'getAclOperation')
          .mockImplementation(async (_p: string, isSource: boolean) =>
            (isSource ? JSON.parse(JSON.stringify(sourceSecurityDescriptor)) : destinationSecurityDescriptor) as any,
          );
        jest
          .spyOn(winOperationService, 'getSIDMapping')
          .mockImplementation(async (sid: string) => {
            if (sid === 'S-1-5-21-SRC-OWNER') return 'S-1-5-21-DST-OWNER';
            if (sid === 'S-1-5-21-SRC-GROUP') return 'S-1-5-21-DST-GROUP';
            return null;
          });
        const changed = await service.hasSecurityDescriptorChanged(sourcePath, targetPath, ctxWithMapping());
        expect(changed).toBe(true);
        const msg = (mockLogger.log as jest.Mock).mock.calls[0][0];
        expect(msg).toContain('field=owner');
        expect(msg).toContain('S-1-5-21-DST-OWNER');
        expect(msg).toContain('S-1-5-21-DST-OTHER');
      });

      it("mirrors stamp's Invalid-Owner revert: destination already holds the original source SID -> no drift, no re-stamp", async () => {
        // Mirrors the post-stamp state for a file where the Owner SID couldn't
        // be mapped: stampAclOperation reverts Owner to the original source
        // SID, so on the next incremental the gate must recognize the
        // destination as already in-sync (otherwise we'd re-stamp every scan).
        const sourceSecurityDescriptor = {
          Owner: 'S-1-5-21-SRC-OWNER',
          Group: 'S-1-5-21-SRC-GROUP',
          DaclAces: [
            { Sid: 'S-1-5-21-SRC-USER', AccessMask: 0x1f01ff, AceType: 0, AceFlags: 0, IsInherited: false, originalSid: '' },
          ],
          Attributes: '',
          DaclPresent: true,
          DaclProtected: false,
          DaclAutoInherit: true,
          originalOwner: '',
          originalGroup: '',
        };
        const destinationSecurityDescriptor = {
          Owner: 'S-1-5-21-SRC-OWNER', // stamp reverted Invalid -> original source SID
          Group: 'S-1-5-21-DST-GROUP',
          DaclAces: [
            { Sid: 'S-1-5-21-DST-USER', AccessMask: 0x1f01ff, AceType: 0, AceFlags: 0, IsInherited: false, originalSid: '' },
          ],
          Attributes: '',
          DaclPresent: true,
          DaclProtected: false,
          DaclAutoInherit: true,
          originalOwner: '',
          originalGroup: '',
        };
        jest
          .spyOn(winOperationService, 'getAclOperation')
          .mockImplementation(async (_p: string, isSource: boolean) =>
            (isSource ? JSON.parse(JSON.stringify(sourceSecurityDescriptor)) : destinationSecurityDescriptor) as any,
          );
        jest
          .spyOn(winOperationService, 'getSIDMapping')
          .mockImplementation(async (sid: string) => {
            if (sid === 'S-1-5-21-SRC-OWNER') return 'Invalid';
            if (sid === 'S-1-5-21-SRC-GROUP') return 'S-1-5-21-DST-GROUP';
            if (sid === 'S-1-5-21-SRC-USER') return 'S-1-5-21-DST-USER';
            return null;
          });
        const changed = await service.hasSecurityDescriptorChanged(sourcePath, targetPath, ctxWithMapping());
        expect(changed).toBe(false);
        expect(mockLogger.log).not.toHaveBeenCalled();
      });

      it("mirrors stamp's Invalid-ACE drop: destination missing the unmappable ACE -> no drift, no re-stamp", async () => {
        // stampAclOperation drops ACEs whose Sid mapped to 'Invalid', so the
        // expected destination DACL is the mapped source DACL minus those
        // entries. Destinations that already reflect that filtered state must
        // not trigger a re-stamp.
        const sourceSecurityDescriptor = {
          Owner: 'S-1-5-21-SRC-OWNER',
          Group: 'S-1-5-21-SRC-GROUP',
          DaclAces: [
            { Sid: 'S-1-5-21-SRC-USER', AccessMask: 0x1f01ff, AceType: 0, AceFlags: 0, IsInherited: false, originalSid: '' },
            { Sid: 'S-1-5-21-SRC-BAD',  AccessMask: 0x1f01ff, AceType: 0, AceFlags: 0, IsInherited: false, originalSid: '' },
          ],
          Attributes: '',
          DaclPresent: true,
          DaclProtected: false,
          DaclAutoInherit: true,
          originalOwner: '',
          originalGroup: '',
        };
        const destinationSecurityDescriptor = {
          Owner: 'S-1-5-21-DST-OWNER',
          Group: 'S-1-5-21-DST-GROUP',
          DaclAces: [
            { Sid: 'S-1-5-21-DST-USER', AccessMask: 0x1f01ff, AceType: 0, AceFlags: 0, IsInherited: false, originalSid: '' },
          ],
          Attributes: '',
          DaclPresent: true,
          DaclProtected: false,
          DaclAutoInherit: true,
          originalOwner: '',
          originalGroup: '',
        };
        jest
          .spyOn(winOperationService, 'getAclOperation')
          .mockImplementation(async (_p: string, isSource: boolean) =>
            (isSource ? JSON.parse(JSON.stringify(sourceSecurityDescriptor)) : destinationSecurityDescriptor) as any,
          );
        jest
          .spyOn(winOperationService, 'getSIDMapping')
          .mockImplementation(async (sid: string) => {
            if (sid === 'S-1-5-21-SRC-OWNER') return 'S-1-5-21-DST-OWNER';
            if (sid === 'S-1-5-21-SRC-GROUP') return 'S-1-5-21-DST-GROUP';
            if (sid === 'S-1-5-21-SRC-USER') return 'S-1-5-21-DST-USER';
            if (sid === 'S-1-5-21-SRC-BAD')  return 'Invalid';
            return null;
          });
        const changed = await service.hasSecurityDescriptorChanged(sourcePath, targetPath, ctxWithMapping());
        expect(changed).toBe(false);
        expect(mockLogger.log).not.toHaveBeenCalled();
      });

      it('reports drift when destination has not yet absorbed the post-stamp state for an Invalid Owner mapping', async () => {
        // First incremental after an Owner went unmappable: destination still
        // holds the pre-migration value, so the gate must report drift and
        // hand off to stamp (which records the per-principal error).
        const sourceSecurityDescriptor = {
          Owner: 'S-1-5-21-SRC-OWNER',
          Group: 'S-1-5-21-SRC-GROUP',
          DaclAces: [],
          Attributes: '',
          DaclPresent: true,
          DaclProtected: false,
          DaclAutoInherit: true,
          originalOwner: '',
          originalGroup: '',
        };
        const destinationSecurityDescriptor = {
          ...sourceSecurityDescriptor,
          Owner: 'S-1-5-21-DST-STALE',
          Group: 'S-1-5-21-DST-GROUP',
        };
        jest
          .spyOn(winOperationService, 'getAclOperation')
          .mockImplementation(async (_p: string, isSource: boolean) =>
            (isSource ? JSON.parse(JSON.stringify(sourceSecurityDescriptor)) : destinationSecurityDescriptor) as any,
          );
        jest
          .spyOn(winOperationService, 'getSIDMapping')
          .mockImplementation(async (sid: string) => {
            if (sid === 'S-1-5-21-SRC-OWNER') return 'Invalid';
            if (sid === 'S-1-5-21-SRC-GROUP') return 'S-1-5-21-DST-GROUP';
            return null;
          });
        const changed = await service.hasSecurityDescriptorChanged(sourcePath, targetPath, ctxWithMapping());
        expect(changed).toBe(true);
        const msg = (mockLogger.log as jest.Mock).mock.calls[0][0];
        expect(msg).toContain('field=owner');
        // Expected Owner is the reverted original source SID, not the 'Invalid' sentinel.
        expect(msg).toContain('S-1-5-21-SRC-OWNER');
        expect(msg).toContain('S-1-5-21-DST-STALE');
      });
    });

    describe('DLM root inheritance-mode transform', () => {
      // Mirrors stampAclOperation's `applySmbInheritanceMode` step. The gate
      // must apply the same transform when building the expected destination
      // SD for the DLM root, otherwise the destination's transformed ACEs
      // (e.g., inherited flipped to explicit) never equal the un-transformed
      // source and the DLM root false-positives drift on every incremental.

      const inheritedAce = (sid = 'S-1-5-21-INHERITED') => ({
        Sid: sid,
        AccessMask: 0x1f01ff,
        AceType: 0,
        AceFlags: 0x13,
        IsInherited: true,
        originalSid: '',
      });

      const explicitFromInherited = (sid = 'S-1-5-21-INHERITED') => ({
        Sid: sid,
        AccessMask: 0x1f01ff,
        AceType: 0,
        AceFlags: 0x03,
        IsInherited: false,
        originalSid: '',
      });

      const explicitAce = (sid = 'S-1-5-21-EXPLICIT') => ({
        Sid: sid,
        AccessMask: 0x1f01ff,
        AceType: 0,
        AceFlags: 0x00,
        IsInherited: false,
        originalSid: '',
      });

      const baseSd = (aces: any[]) => ({
        Owner: 'S-1-5-21-O',
        Group: 'S-1-5-21-G',
        DaclAces: aces,
        Attributes: '',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: true,
        originalOwner: '',
        originalGroup: '',
      });

      const ctxWithInheritanceMode = (mode?: string): any => ({
        jobRunId: 'wf-dlm-root',
        jobConfig: { options: mode ? { smbPermissionInheritanceMode: mode } : {} },
      });

      it('INHERIT_PERMS_AS_EXPLICIT: destination holds flipped-to-explicit ACEs -> no drift, no re-stamp', async () => {
        const sourceSd = baseSd([explicitAce(), inheritedAce()]);
        const destinationSd = baseSd([explicitAce(), explicitFromInherited()]);
        jest
          .spyOn(winOperationService, 'getAclOperation')
          .mockImplementation(async (_p: string, isSource: boolean) =>
            (isSource ? JSON.parse(JSON.stringify(sourceSd)) : destinationSd) as any,
          );
        const changed = await service.hasSecurityDescriptorChanged(
          sourcePath,
          targetPath,
          ctxWithInheritanceMode(SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT),
          true,
        );
        expect(changed).toBe(false);
        expect(mockLogger.log).not.toHaveBeenCalled();
      });

      it('INHERIT_PERMS_AS_IS: destination has inherited ACEs stripped -> no drift, no re-stamp', async () => {
        const sourceSd = baseSd([explicitAce(), inheritedAce()]);
        const destinationSd = baseSd([explicitAce()]);
        jest
          .spyOn(winOperationService, 'getAclOperation')
          .mockImplementation(async (_p: string, isSource: boolean) =>
            (isSource ? JSON.parse(JSON.stringify(sourceSd)) : destinationSd) as any,
          );
        const changed = await service.hasSecurityDescriptorChanged(
          sourcePath,
          targetPath,
          ctxWithInheritanceMode(SmbPermissionInheritanceMode.INHERIT_PERMS_AS_IS),
          true,
        );
        expect(changed).toBe(false);
        expect(mockLogger.log).not.toHaveBeenCalled();
      });

      it('defaults to INHERIT_PERMS_AS_EXPLICIT when no mode is configured on the job', async () => {
        // Default is EXPLICIT: the source's inherited ACE is flipped to
        // explicit by the gate transform, leaving a 1-ACE source DACL that
        // does NOT match the empty destination DACL -> drift detected.
        const sourceSd = baseSd([inheritedAce()]);
        const destinationSd = baseSd([]);
        jest
          .spyOn(winOperationService, 'getAclOperation')
          .mockImplementation(async (_p: string, isSource: boolean) =>
            (isSource ? JSON.parse(JSON.stringify(sourceSd)) : destinationSd) as any,
          );
        const changed = await service.hasSecurityDescriptorChanged(
          sourcePath,
          targetPath,
          ctxWithInheritanceMode(undefined),
          true,
        );
        expect(changed).toBe(true);
      });

      it('applyInheritanceMode=false: inherited source ACE vs explicit destination ACE -> drift detected (transform NOT applied for non-root items)', async () => {
        // Same descriptors as the EXPLICIT-mode happy path, but with the
        // flag off — confirms the gate does NOT silently transform when the
        // caller didn't flag this as the DLM root.
        const sourceSd = baseSd([inheritedAce()]);
        const destinationSd = baseSd([explicitFromInherited()]);
        jest
          .spyOn(winOperationService, 'getAclOperation')
          .mockImplementation(async (_p: string, isSource: boolean) =>
            (isSource ? JSON.parse(JSON.stringify(sourceSd)) : destinationSd) as any,
          );
        const changed = await service.hasSecurityDescriptorChanged(
          sourcePath,
          targetPath,
          ctxWithInheritanceMode(SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT),
          false,
        );
        expect(changed).toBe(true);
      });

      it('applyInheritanceMode defaults to false when omitted', async () => {
        const sourceSd = baseSd([inheritedAce()]);
        const destinationSd = baseSd([explicitFromInherited()]);
        jest
          .spyOn(winOperationService, 'getAclOperation')
          .mockImplementation(async (_p: string, isSource: boolean) =>
            (isSource ? JSON.parse(JSON.stringify(sourceSd)) : destinationSd) as any,
          );
        const changed = await service.hasSecurityDescriptorChanged(
          sourcePath,
          targetPath,
          ctxWithInheritanceMode(SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT),
        );
        expect(changed).toBe(true);
      });

      it('composes with SID mapping: applies mapping + Invalid revert + inheritance-mode transform on DLM root', async () => {
        // End-to-end mirror of stampAclOperation: SID mapping translates
        // Owner/Group/ACE SIDs, the Invalid Owner is reverted to its
        // original source SID, the dropped-Invalid ACE is filtered, AND
        // the inheritance-mode transform flips the inherited ACE to
        // explicit. Destination already holds that exact post-stamp state.
        const sourceSd = {
          Owner: 'S-1-5-21-SRC-OWNER',
          Group: 'S-1-5-21-SRC-GROUP',
          DaclAces: [
            { Sid: 'S-1-5-21-SRC-USER', AccessMask: 0x1f01ff, AceType: 0, AceFlags: 0x13, IsInherited: true,  originalSid: '' },
            { Sid: 'S-1-5-21-SRC-BAD',  AccessMask: 0x1f01ff, AceType: 0, AceFlags: 0x00, IsInherited: false, originalSid: '' },
          ],
          Attributes: '',
          DaclPresent: true,
          DaclProtected: false,
          DaclAutoInherit: true,
          originalOwner: '',
          originalGroup: '',
        };
        const destinationSd = {
          Owner: 'S-1-5-21-SRC-OWNER',
          Group: 'S-1-5-21-DST-GROUP',
          DaclAces: [
            { Sid: 'S-1-5-21-DST-USER', AccessMask: 0x1f01ff, AceType: 0, AceFlags: 0x03, IsInherited: false, originalSid: '' },
          ],
          Attributes: '',
          DaclPresent: true,
          DaclProtected: false,
          DaclAutoInherit: true,
          originalOwner: '',
          originalGroup: '',
        };
        jest
          .spyOn(winOperationService, 'getAclOperation')
          .mockImplementation(async (_p: string, isSource: boolean) =>
            (isSource ? JSON.parse(JSON.stringify(sourceSd)) : destinationSd) as any,
          );
        jest
          .spyOn(winOperationService, 'getSIDMapping')
          .mockImplementation(async (sid: string) => {
            if (sid === 'S-1-5-21-SRC-OWNER') return 'Invalid';
            if (sid === 'S-1-5-21-SRC-GROUP') return 'S-1-5-21-DST-GROUP';
            if (sid === 'S-1-5-21-SRC-USER')  return 'S-1-5-21-DST-USER';
            if (sid === 'S-1-5-21-SRC-BAD')   return 'Invalid';
            return null;
          });
        const changed = await service.hasSecurityDescriptorChanged(
          sourcePath,
          targetPath,
          {
            jobRunId: 'wf-dlm-root',
            jobConfig: {
              options: {
                isIdentityMappingAvailable: true,
                smbPermissionInheritanceMode: SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT,
              },
            },
          } as any,
          true,
        );
        expect(changed).toBe(false);
        expect(mockLogger.log).not.toHaveBeenCalled();
      });
    });
  });

  // =========================================================================
  // ACL comparator test matrix (table-driven)
  // =========================================================================
  //
  // Mirrors docs/acl-comparator-test-matrix.md. Each section (A–R) maps 1:1
  // to a section in the doc. Tests are table-driven so adding a row is the
  // unit of work, not adding an `it` block.
  //
  // Most cases exercise `securityDescriptorEquals` directly (pure function).
  // The SID-mapping / inheritance-mode sections drive through
  // `hasSecurityDescriptorChanged` with `getAclOperation` mocked, because
  // the relevant transforms live in private helpers reached from there.
  // =========================================================================
  describe('ACL comparator test matrix', () => {
    // ---- helpers ---------------------------------------------------------
    const mkAce = (over: Partial<Ace> = {}): Ace => ({
      Sid: 'S-1-5-21-AAA',
      AccessMask: 0x1f01ff,
      AceType: 0,
      AceFlags: 0,
      IsInherited: false,
      originalSid: '',
      ...over,
    });

    const mkSd = (over: Partial<SecurityDescriptor> = {}): SecurityDescriptor => ({
      Owner: 'S-1-5-21-OWNER',
      Group: 'S-1-5-21-GROUP',
      DaclAces: [],
      Attributes: 'Archive',
      DaclPresent: true,
      DaclProtected: false,
      DaclAutoInherit: true,
      originalOwner: '',
      originalGroup: '',
      ...over,
    });

    type Field =
      | 'owner'
      | 'group'
      | 'daclProtected'
      | 'daclAutoInherit'
      | 'attributes'
      | 'aceMissingOnDestination'
      | 'aceExtraOnDestination'
      | 'aceFieldDiff';

    type EqCase = {
      id: string;
      expected: SecurityDescriptor;
      actual: SecurityDescriptor;
      equal: boolean;
      field?: Field;
    };

    const runEqCases = (cases: EqCase[]) => {
      it.each(cases)('[$id] equal=$equal', ({ expected, actual, equal, field }) => {
        const result = service.securityDescriptorEquals(expected as any, actual as any);
        expect(result.equal).toBe(equal);
        if (!equal && field) {
          expect(result.reason?.field).toBe(field);
        }
      });
    };

    // ---- Section A: Owner / Group ---------------------------------------
    describe('A. Owner / Group', () => {
      runEqCases([
        {
          id: 'A1 owner equal',
          expected: mkSd({ Owner: 'S-1-5-21-A-500' }),
          actual: mkSd({ Owner: 'S-1-5-21-A-500' }),
          equal: true,
        },
        {
          id: 'A2 owner differs',
          expected: mkSd({ Owner: 'S-1-5-21-A-500' }),
          actual: mkSd({ Owner: 'S-1-5-21-B-500' }),
          equal: false,
          field: 'owner',
        },
        {
          id: 'A3 BUILTIN Administrators',
          expected: mkSd({ Owner: 'S-1-5-32-544', Group: 'S-1-5-32-544' }),
          actual: mkSd({ Owner: 'S-1-5-32-544', Group: 'S-1-5-32-544' }),
          equal: true,
        },
        {
          id: 'A4 owner case differs (DOCUMENTS current behavior: case-sensitive)',
          expected: mkSd({ Owner: 's-1-5-21-AAA' }),
          actual: mkSd({ Owner: 'S-1-5-21-AAA' }),
          equal: false,
          field: 'owner',
        },
        {
          id: 'A5 owner empty on both',
          expected: mkSd({ Owner: '' }),
          actual: mkSd({ Owner: '' }),
          equal: true,
        },
        {
          id: 'A6 owner empty vs populated',
          expected: mkSd({ Owner: '' }),
          actual: mkSd({ Owner: 'S-1-5-21-X' }),
          equal: false,
          field: 'owner',
        },
        {
          id: 'A7 group differs, owner equal',
          expected: mkSd({ Group: 'S-1-5-21-G1' }),
          actual: mkSd({ Group: 'S-1-5-21-G2' }),
          equal: false,
          field: 'group',
        },
        {
          id: 'A8 both owner+group differ -> owner reported first (short-circuit)',
          expected: mkSd({ Owner: 'S-1-5-21-A', Group: 'S-1-5-21-X' }),
          actual: mkSd({ Owner: 'S-1-5-21-B', Group: 'S-1-5-21-Y' }),
          equal: false,
          field: 'owner',
        },
      ]);
    });

    // ---- Section B: DaclProtected ---------------------------------------
    describe('B. DaclProtected', () => {
      runEqCases([
        {
          id: 'B1 both true',
          expected: mkSd({ DaclProtected: true }),
          actual: mkSd({ DaclProtected: true }),
          equal: true,
        },
        {
          id: 'B2 both false',
          expected: mkSd({ DaclProtected: false }),
          actual: mkSd({ DaclProtected: false }),
          equal: true,
        },
        {
          id: 'B3 expected true / actual false',
          expected: mkSd({ DaclProtected: true }),
          actual: mkSd({ DaclProtected: false }),
          equal: false,
          field: 'daclProtected',
        },
        {
          id: 'B4 expected false / actual true',
          expected: mkSd({ DaclProtected: false }),
          actual: mkSd({ DaclProtected: true }),
          equal: false,
          field: 'daclProtected',
        },
        {
          id: 'B5 undefined coerces to false',
          expected: mkSd({ DaclProtected: undefined as any }),
          actual: mkSd({ DaclProtected: false }),
          equal: true,
        },
        {
          id: 'B6 null coerces to false',
          expected: mkSd({ DaclProtected: null as any }),
          actual: mkSd({ DaclProtected: false }),
          equal: true,
        },
      ]);
    });

    // ---- Section C: DaclAutoInherit (intentionally not gated) -----------
    // `SE_DACL_AUTO_INHERITED` is set/cleared by Windows' inheritance
    // engine independent of what the stamp writes, so strict equality would
    // oscillate the gate into restamping every incremental scan after a
    // byte-faithful stamp. The comparator deliberately skips this bit;
    // these cases pin that behaviour. Symmetric with `validateAclOperation`.
    describe('C. DaclAutoInherit', () => {
      runEqCases([
        {
          id: 'C1 both true',
          expected: mkSd({ DaclAutoInherit: true }),
          actual: mkSd({ DaclAutoInherit: true }),
          equal: true,
        },
        {
          id: 'C2 mismatch is tolerated (kernel-controlled bit)',
          expected: mkSd({ DaclAutoInherit: true }),
          actual: mkSd({ DaclAutoInherit: false }),
          equal: true,
        },
        {
          id: 'C3 expected undefined vs actual true tolerated (Windows-side flip)',
          expected: mkSd({ DaclAutoInherit: undefined as any }),
          actual: mkSd({ DaclAutoInherit: true }),
          equal: true,
        },
      ]);
    });

    // ---- Section D: Attributes ------------------------------------------
    describe('D. Attributes (parseStampableAttributes)', () => {
      runEqCases([
        {
          id: 'D1 equal',
          expected: mkSd({ Attributes: 'Archive' }),
          actual: mkSd({ Attributes: 'Archive' }),
          equal: true,
        },
        {
          id: 'D2 order-independent mask',
          expected: mkSd({ Attributes: 'Archive,Hidden' }),
          actual: mkSd({ Attributes: 'Hidden,Archive' }),
          equal: true,
        },
        {
          id: 'D3 actual gains settable bit (ReadOnly)',
          expected: mkSd({ Attributes: 'Archive' }),
          actual: mkSd({ Attributes: 'Archive,ReadOnly' }),
          equal: false,
          field: 'attributes',
        },
        {
          id: 'D4 Compressed masked out (not stampable)',
          expected: mkSd({ Attributes: 'Archive,Compressed' }),
          actual: mkSd({ Attributes: 'Archive' }),
          equal: true,
        },
        {
          id: 'D5 ReparsePoint masked out',
          expected: mkSd({ Attributes: 'Archive,ReparsePoint' }),
          actual: mkSd({ Attributes: 'Archive' }),
          equal: true,
        },
        {
          id: 'D6 Encrypted+SparseFile masked out',
          expected: mkSd({ Attributes: 'Archive,Encrypted,SparseFile' }),
          actual: mkSd({ Attributes: 'Archive' }),
          equal: true,
        },
        {
          id: 'D7 empty == empty',
          expected: mkSd({ Attributes: '' }),
          actual: mkSd({ Attributes: '' }),
          equal: true,
        },
        {
          id: 'D8 undefined == empty',
          expected: mkSd({ Attributes: undefined as any }),
          actual: mkSd({ Attributes: '' }),
          equal: true,
        },
        {
          id: 'D9 Hidden vs empty',
          expected: mkSd({ Attributes: 'Hidden' }),
          actual: mkSd({ Attributes: '' }),
          equal: false,
          field: 'attributes',
        },
        {
          id: 'D10 unknown token ignored',
          expected: mkSd({ Attributes: 'Archive,Bogus' }),
          actual: mkSd({ Attributes: 'Archive' }),
          equal: true,
        },
        {
          id: 'D11 whitespace tolerated',
          expected: mkSd({ Attributes: '  Archive , Hidden  ' }),
          actual: mkSd({ Attributes: 'Archive,Hidden' }),
          equal: true,
        },
      ]);
    });

    // ---- Section E: ACE count -------------------------------------------
    describe('E. ACE count', () => {
      const A = mkAce({ Sid: 'S-1-5-21-A' });
      const B = mkAce({ Sid: 'S-1-5-21-B' });
      const C = mkAce({ Sid: 'S-1-5-21-C' });

      runEqCases([
        {
          id: 'E1 both empty DACL',
          expected: mkSd({ DaclAces: [] }),
          actual: mkSd({ DaclAces: [] }),
          equal: true,
        },
        {
          id: 'E2 both undefined DACL',
          expected: mkSd({ DaclAces: undefined as any }),
          actual: mkSd({ DaclAces: undefined as any }),
          equal: true,
        },
        {
          id: 'E3 expected [A], actual []',
          expected: mkSd({ DaclAces: [A] }),
          actual: mkSd({ DaclAces: [] }),
          equal: false,
          field: 'aceMissingOnDestination',
        },
        {
          id: 'E4 expected [], actual [A]',
          expected: mkSd({ DaclAces: [] }),
          actual: mkSd({ DaclAces: [A] }),
          equal: false,
          field: 'aceExtraOnDestination',
        },
        {
          id: 'E5 expected [A,B], actual [A]',
          expected: mkSd({ DaclAces: [A, B] }),
          actual: mkSd({ DaclAces: [A] }),
          equal: false,
          field: 'aceMissingOnDestination',
        },
        {
          id: 'E6 expected [A], actual [A,B]',
          expected: mkSd({ DaclAces: [A] }),
          actual: mkSd({ DaclAces: [A, B] }),
          equal: false,
          field: 'aceExtraOnDestination',
        },
        {
          id: 'E7 same length, different ACE at index 1',
          expected: mkSd({ DaclAces: [A, B] }),
          actual: mkSd({ DaclAces: [A, C] }),
          equal: false,
          field: 'aceFieldDiff',
        },
      ]);
    });

    // ---- Section F: ACE field equality (positional) ----------------------
    describe('F. ACE field equality (positional)', () => {
      const baseAce = mkAce({
        Sid: 'S-1-5-21-A-1001',
        AccessMask: 0x1f01ff,
        AceType: 0,
        AceFlags: 0x13, // OI | CI | INH
      });

      runEqCases([
        {
          id: 'F1 [A] vs [A]',
          expected: mkSd({ DaclAces: [baseAce] }),
          actual: mkSd({ DaclAces: [baseAce] }),
          equal: true,
        },
        {
          id: 'F2 Sid differs',
          expected: mkSd({ DaclAces: [baseAce] }),
          actual: mkSd({ DaclAces: [{ ...baseAce, Sid: 'S-1-5-21-A-1002' }] }),
          equal: false,
          field: 'aceFieldDiff',
        },
        {
          id: 'F3 AccessMask differs by one bit',
          expected: mkSd({ DaclAces: [baseAce] }),
          actual: mkSd({ DaclAces: [{ ...baseAce, AccessMask: 0x1f01fe }] }),
          equal: false,
          field: 'aceFieldDiff',
        },
        {
          id: 'F4 AceType Allow vs Deny',
          expected: mkSd({ DaclAces: [{ ...baseAce, AceType: 0 }] }),
          actual: mkSd({ DaclAces: [{ ...baseAce, AceType: 1 }] }),
          equal: false,
          field: 'aceFieldDiff',
        },
        {
          id: 'F5 Inherited bit cleared on actual (explicit-vs-inherited drift)',
          expected: mkSd({ DaclAces: [{ ...baseAce, AceFlags: 0x13 }] }),
          actual: mkSd({ DaclAces: [{ ...baseAce, AceFlags: 0x03 }] }),
          equal: false,
          field: 'aceFieldDiff',
        },
        {
          id: 'F6 propagation flag drift (OI bit only)',
          expected: mkSd({ DaclAces: [{ ...baseAce, AceFlags: 0x13 }] }),
          actual: mkSd({ DaclAces: [{ ...baseAce, AceFlags: 0x12 }] }),
          equal: false,
          field: 'aceFieldDiff',
        },
        {
          id: 'F7 same SID twice, same order',
          expected: mkSd({
            DaclAces: [
              { ...baseAce, AccessMask: 1 },
              { ...baseAce, AccessMask: 2 },
            ],
          }),
          actual: mkSd({
            DaclAces: [
              { ...baseAce, AccessMask: 1 },
              { ...baseAce, AccessMask: 2 },
            ],
          }),
          equal: true,
        },
        {
          id: 'F8 same SID twice, swapped masks (positional drift)',
          expected: mkSd({
            DaclAces: [
              { ...baseAce, AccessMask: 1 },
              { ...baseAce, AccessMask: 2 },
            ],
          }),
          actual: mkSd({
            DaclAces: [
              { ...baseAce, AccessMask: 2 },
              { ...baseAce, AccessMask: 1 },
            ],
          }),
          equal: false,
          field: 'aceFieldDiff',
        },
      ]);
    });

    // ---- Section G: Canonical-order drift -------------------------------
    describe('G. Canonical-order drift', () => {
      const explicitDeny = mkAce({ Sid: 'S-1-5-21-D', AceType: 1, AceFlags: 0x00 });
      const explicitAllow = mkAce({ Sid: 'S-1-5-21-A', AceType: 0, AceFlags: 0x00 });
      const inheritedDeny = mkAce({ Sid: 'S-1-5-21-D2', AceType: 1, AceFlags: 0x10 });
      const inheritedAllow = mkAce({ Sid: 'S-1-5-21-A2', AceType: 0, AceFlags: 0x10 });

      runEqCases([
        {
          id: 'G1 canonical order on both',
          expected: mkSd({ DaclAces: [explicitDeny, explicitAllow, inheritedDeny, inheritedAllow] }),
          actual: mkSd({ DaclAces: [explicitDeny, explicitAllow, inheritedDeny, inheritedAllow] }),
          equal: true,
        },
        {
          id: 'G2 ExplicitAllow before ExplicitDeny',
          expected: mkSd({ DaclAces: [explicitDeny, explicitAllow] }),
          actual: mkSd({ DaclAces: [explicitAllow, explicitDeny] }),
          equal: false,
          field: 'aceFieldDiff',
        },
        {
          id: 'G3 Inherited swapped before Explicit',
          expected: mkSd({ DaclAces: [explicitDeny, inheritedDeny] }),
          actual: mkSd({ DaclAces: [inheritedDeny, explicitDeny] }),
          equal: false,
          field: 'aceFieldDiff',
        },
      ]);
    });

    // ---- Section H: ACE-flag subtleties ---------------------------------
    describe('H. ACE-flag subtleties', () => {
      const base = mkAce({ Sid: 'S-1-5-21-H' });
      runEqCases([
        {
          id: 'H1 INHERITED bit set vs cleared',
          expected: mkSd({ DaclAces: [{ ...base, AceFlags: 0x10 }] }),
          actual: mkSd({ DaclAces: [{ ...base, AceFlags: 0x00 }] }),
          equal: false,
          field: 'aceFieldDiff',
        },
        {
          id: 'H2 INHERIT_ONLY differs',
          expected: mkSd({ DaclAces: [{ ...base, AceFlags: 0x08 }] }),
          actual: mkSd({ DaclAces: [{ ...base, AceFlags: 0x00 }] }),
          equal: false,
          field: 'aceFieldDiff',
        },
        {
          id: 'H3 NO_PROPAGATE differs',
          expected: mkSd({ DaclAces: [{ ...base, AceFlags: 0x04 }] }),
          actual: mkSd({ DaclAces: [{ ...base, AceFlags: 0x00 }] }),
          equal: false,
          field: 'aceFieldDiff',
        },
        {
          id: 'H5 OBJECT_INHERIT differs',
          expected: mkSd({ DaclAces: [{ ...base, AceFlags: 0x01 }] }),
          actual: mkSd({ DaclAces: [{ ...base, AceFlags: 0x00 }] }),
          equal: false,
          field: 'aceFieldDiff',
        },
        {
          id: 'H6 CONTAINER_INHERIT differs',
          expected: mkSd({ DaclAces: [{ ...base, AceFlags: 0x02 }] }),
          actual: mkSd({ DaclAces: [{ ...base, AceFlags: 0x00 }] }),
          equal: false,
          field: 'aceFieldDiff',
        },
      ]);

      it('H4 audit-only flag bits on AceType 2 ACEs are filtered before compare', () => {
        const audit = mkAce({ Sid: 'S-1-5-21-H', AceType: 2, AceFlags: 0x40 });
        const expected = mkSd({ DaclAces: [audit] });
        const actual = mkSd({ DaclAces: [] });
        expect(service.securityDescriptorEquals(expected as any, actual as any).equal).toBe(true);
      });
    });

    // ---- Section I: ACE type filtering ----------------------------------
    describe('I. ACE type filtering', () => {
      const allow = mkAce({ Sid: 'S-1-5-21-A', AceType: 0 });
      const deny = mkAce({ Sid: 'S-1-5-21-D', AceType: 1 });
      const audit = mkAce({ Sid: 'S-1-5-21-X', AceType: 2 });
      const objectAllow = mkAce({ Sid: 'S-1-5-21-Y', AceType: 5 });

      runEqCases([
        {
          id: 'I1 audit ACE filtered from source',
          expected: mkSd({ DaclAces: [allow, audit, deny] }),
          actual: mkSd({ DaclAces: [allow, deny] }),
          equal: true,
        },
        {
          id: 'I2 object-allow ACE filtered',
          expected: mkSd({ DaclAces: [allow, objectAllow, deny] }),
          actual: mkSd({ DaclAces: [allow, deny] }),
          equal: true,
        },
        {
          id: 'I3 audit on dest filtered',
          expected: mkSd({ DaclAces: [allow] }),
          actual: mkSd({ DaclAces: [allow, audit] }),
          equal: true,
        },
        {
          id: 'I4 all non-0/1 -> empty comparable arrays',
          expected: mkSd({ DaclAces: [audit, objectAllow] }),
          actual: mkSd({ DaclAces: [audit] }),
          equal: true,
        },
        {
          id: 'I5 KNOWN GAP: unstampable type-5 ACE on source only -> gate sees no drift',
          expected: mkSd({ DaclAces: [objectAllow] }),
          actual: mkSd({ DaclAces: [] }),
          equal: true,
        },
      ]);
    });

    // ---- Section J: Well-known SIDs -------------------------------------
    describe('J. Well-known SIDs', () => {
      runEqCases([
        {
          id: 'J1 Everyone (S-1-1-0)',
          expected: mkSd({ DaclAces: [mkAce({ Sid: 'S-1-1-0' })] }),
          actual: mkSd({ DaclAces: [mkAce({ Sid: 'S-1-1-0' })] }),
          equal: true,
        },
        {
          id: 'J2 Creator Owner (S-1-3-0) same mask',
          expected: mkSd({ DaclAces: [mkAce({ Sid: 'S-1-3-0', AccessMask: 0x1f01ff })] }),
          actual: mkSd({ DaclAces: [mkAce({ Sid: 'S-1-3-0', AccessMask: 0x1f01ff })] }),
          equal: true,
        },
        {
          // CREATOR OWNER (S-1-3-0) is the kernel-rewritten placeholder
          // principal. The kernel mutates AccessMask (e.g.,
          // GENERIC_ALL → FILE_ALL_ACCESS) and inheritance flag bits as
          // part of inheritance evaluation, so strict positional compare
          // on CO ACEs would oscillate the gate into restamping forever.
          // The comparator compares CO ACEs count-by-`AceType` only;
          // mask/flag drift on a paired CO ACE of the same `AceType` is
          // tolerated. Symmetric with `validateAclOperation`.
          id: 'J3 Creator Owner mask differs (count-by-AceType tolerates drift)',
          expected: mkSd({ DaclAces: [mkAce({ Sid: 'S-1-3-0', AccessMask: 0x1f01ff })] }),
          actual: mkSd({ DaclAces: [mkAce({ Sid: 'S-1-3-0', AccessMask: 0x120089 })] }),
          equal: true,
        },
        {
          id: 'J4 LocalSystem',
          expected: mkSd({ DaclAces: [mkAce({ Sid: 'S-1-5-18' })] }),
          actual: mkSd({ DaclAces: [mkAce({ Sid: 'S-1-5-18' })] }),
          equal: true,
        },
        {
          id: 'J5 BUILTIN\\Administrators',
          expected: mkSd({ DaclAces: [mkAce({ Sid: 'S-1-5-32-544' })] }),
          actual: mkSd({ DaclAces: [mkAce({ Sid: 'S-1-5-32-544' })] }),
          equal: true,
        },
      ]);
    });

    // ---- Section K: SID mapping path ------------------------------------
    describe('K. SID mapping path (prepareExpectedDestinationSecurityDescriptor)', () => {
      const sourcePath = '/src/file.txt';
      const targetPath = '/dst/file.txt';

      const ctxWithMapping = (): any => ({
        jobRunId: 'wf-k',
        jobConfig: { options: { isIdentityMappingAvailable: true } },
      });

      const mockSidMap = (map: Record<string, string | null>) => {
        (mockRedisService.getOwnerIdentity as jest.Mock).mockImplementation(
          async (_jobRunId: string, sid: string) => map[sid] ?? null,
        );
      };

      const mockGetAcls = (src: SecurityDescriptor, dst: SecurityDescriptor) => {
        jest
          .spyOn(winOperationService, 'getAclOperation')
          .mockImplementation(async (_p: string, isSource: boolean) =>
            (isSource ? structuredClone(src) : structuredClone(dst)) as any,
          );
      };

      it('K1 Owner=srcA, ACE[srcA] -> dest holds dstA equivalents', async () => {
        mockSidMap({ srcA: 'dstA' });
        const src = mkSd({ Owner: 'srcA', Group: 'srcA', DaclAces: [mkAce({ Sid: 'srcA' })] });
        const dst = mkSd({ Owner: 'dstA', Group: 'dstA', DaclAces: [mkAce({ Sid: 'dstA' })] });
        mockGetAcls(src, dst);
        const changed = await service.hasSecurityDescriptorChanged(
          sourcePath,
          targetPath,
          ctxWithMapping(),
        );
        expect(changed).toBe(false);
      });

      it('K2 Owner=srcA, dest still has srcA (unmapped)', async () => {
        mockSidMap({ srcA: 'dstA' });
        const src = mkSd({ Owner: 'srcA', Group: 'dstA' });
        const dst = mkSd({ Owner: 'srcA', Group: 'dstA' });
        mockGetAcls(src, dst);
        const changed = await service.hasSecurityDescriptorChanged(
          sourcePath,
          targetPath,
          ctxWithMapping(),
        );
        expect(changed).toBe(true);
      });

      it('K3 Owner=srcB (maps to Invalid) and dest reverted to source', async () => {
        mockSidMap({ srcB: 'Invalid' });
        const src = mkSd({ Owner: 'srcB', Group: 'srcB' });
        const dst = mkSd({ Owner: 'srcB', Group: 'srcB' });
        mockGetAcls(src, dst);
        const changed = await service.hasSecurityDescriptorChanged(
          sourcePath,
          targetPath,
          ctxWithMapping(),
        );
        expect(changed).toBe(false);
      });

      it('K4 ACE[srcB] mapped to Invalid is dropped from expected', async () => {
        mockSidMap({ srcB: 'Invalid' });
        const src = mkSd({
          Owner: 'sameOwner',
          Group: 'sameGroup',
          DaclAces: [mkAce({ Sid: 'srcB' })],
        });
        const dst = mkSd({
          Owner: 'sameOwner',
          Group: 'sameGroup',
          DaclAces: [], // Invalid-SID ACE dropped on stamp
        });
        mockGetAcls(src, dst);
        const changed = await service.hasSecurityDescriptorChanged(
          sourcePath,
          targetPath,
          ctxWithMapping(),
        );
        expect(changed).toBe(false);
      });

      it('K5 mixed map: srcA->dstA, srcB->Invalid (dropped)', async () => {
        mockSidMap({ srcA: 'dstA', srcB: 'Invalid' });
        const src = mkSd({
          Owner: 'srcA',
          Group: 'srcA',
          DaclAces: [mkAce({ Sid: 'srcA' }), mkAce({ Sid: 'srcB' })],
        });
        const dst = mkSd({
          Owner: 'dstA',
          Group: 'dstA',
          DaclAces: [mkAce({ Sid: 'dstA' })],
        });
        mockGetAcls(src, dst);
        const changed = await service.hasSecurityDescriptorChanged(
          sourcePath,
          targetPath,
          ctxWithMapping(),
        );
        expect(changed).toBe(false);
      });

      it('K7 isIdentityMappingAvailable=false, cross-domain SIDs differ -> drift', async () => {
        const src = mkSd({ Owner: 'srcA', Group: 'srcA' });
        const dst = mkSd({ Owner: 'dstA', Group: 'srcA' });
        mockGetAcls(src, dst);
        const changed = await service.hasSecurityDescriptorChanged(
          sourcePath,
          targetPath,
          { jobRunId: 'wf', jobConfig: { options: {} } } as any,
        );
        expect(changed).toBe(true);
      });
    });

    // ---- Section L: Inheritance-mode transform --------------------------
    describe('L. Inheritance-mode transform (applySmbInheritanceModeTransform)', () => {
      const explicit = mkAce({ Sid: 'SidX', AceFlags: 0x00, IsInherited: false });
      const inherited = mkAce({ Sid: 'SidY', AceFlags: 0x10, IsInherited: true });
      const sdWithMix = (): SecurityDescriptor =>
        mkSd({ DaclAces: [explicit, inherited] });

      it('L1 INHERIT_PERMS_AS_EXPLICIT: inherited ACE flipped to explicit', () => {
        const transformed = winOperationService.applySmbInheritanceModeTransform(
          sdWithMix(),
          SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT,
        );
        expect(transformed.DaclAces).toHaveLength(2);
        expect(transformed.DaclAces[0].IsInherited).toBe(false);
        expect(transformed.DaclAces[0].AceFlags & 0x10).toBe(0);
        expect(transformed.DaclAces[1].IsInherited).toBe(false);
        expect(transformed.DaclAces[1].AceFlags & 0x10).toBe(0);
      });

      it('L2 transformed expected vs dest still holding INH bit -> drift (inherited ACE on dest filtered, explicit-converted ACE on expected missing)', () => {
        const transformed = winOperationService.applySmbInheritanceModeTransform(
          sdWithMix(),
          SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT,
        );
        const dest = sdWithMix(); // dest still has INH bit on inherited ACE
        const result = service.securityDescriptorEquals(transformed as any, dest as any);
        // After transform, expected has 2 explicit ACEs. Dest has 1 explicit + 1 inherited.
        // Gate filters inherited from dest → sees 2 expected vs 1 actual → missing ACE.
        expect(result.equal).toBe(false);
        expect(result.reason?.field).toBe('aceMissingOnDestination');
      });

      it('L3 INHERIT_PERMS_AS_IS: ACL returned unchanged (no filtering)', () => {
        const transformed = winOperationService.applySmbInheritanceModeTransform(
          sdWithMix(),
          SmbPermissionInheritanceMode.INHERIT_PERMS_AS_IS,
        );
        expect(transformed.DaclAces).toHaveLength(2);
        expect(transformed.DaclAces[0].Sid).toBe('SidX');
        expect(transformed.DaclAces[1].Sid).toBe('SidY');
      });

      it('L4 INHERIT_PERMS_AS_IS: dest inherited ACE invisible to gate (filtered) -> equal', () => {
        const transformed = winOperationService.applySmbInheritanceModeTransform(
          sdWithMix(),
          SmbPermissionInheritanceMode.INHERIT_PERMS_AS_IS,
        );
        const dest = sdWithMix();
        const result = service.securityDescriptorEquals(transformed as any, dest as any);
        // After transform, expected has 1 explicit ACE. Dest has 1 explicit + 1 inherited.
        // Gate filters inherited from dest → sees 1 vs 1, both explicit and matching → equal.
        expect(result.equal).toBe(true);
      });

      it('L7 unknown mode behaves like INHERIT_PERMS_AS_IS (returns unchanged)', () => {
        const transformed = winOperationService.applySmbInheritanceModeTransform(
          sdWithMix(),
          'UNKNOWN_MODE' as SmbPermissionInheritanceMode,
        );
        expect(transformed.DaclAces).toHaveLength(2);
        expect(transformed.DaclAces[0].Sid).toBe('SidX');
        expect(transformed.DaclAces[1].Sid).toBe('SidY');
      });

      it('L-extra DaclAces undefined -> SD returned unchanged', () => {
        const sd = mkSd({ DaclAces: undefined as any });
        const transformed = winOperationService.applySmbInheritanceModeTransform(
          sd,
          SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT,
        );
        expect(transformed).toBe(sd);
      });
    });

    // ---- Section M: Files vs Folders ------------------------------------
    describe('M. Files vs Folders', () => {
      const ci = mkAce({ Sid: 'S-1-5-21-F', AceFlags: 0x02 });
      const oiCi = mkAce({ Sid: 'S-1-5-21-F', AceFlags: 0x03 });
      const oiCiIo = mkAce({ Sid: 'S-1-5-21-F', AceFlags: 0x0b });

      runEqCases([
        {
          id: 'M1 CI-only on a file (legal bytes, byte equality holds)',
          expected: mkSd({ DaclAces: [ci] }),
          actual: mkSd({ DaclAces: [ci] }),
          equal: true,
        },
        {
          id: 'M2 OI|CI on folder, matching',
          expected: mkSd({ DaclAces: [oiCi] }),
          actual: mkSd({ DaclAces: [oiCi] }),
          equal: true,
        },
        {
          id: 'M3 OI|CI|IO (template) vs OI|CI (concrete) differ',
          expected: mkSd({ DaclAces: [oiCiIo] }),
          actual: mkSd({ DaclAces: [oiCi] }),
          equal: false,
          field: 'aceFieldDiff',
        },
      ]);
    });

    // ---- Section N: Special / pathological ------------------------------
    describe('N. Special / pathological', () => {
      it('N1 Null DACL on both (DaclPresent=false)', () => {
        const sd = mkSd({ DaclPresent: false, DaclAces: [] });
        expect(service.securityDescriptorEquals(sd as any, sd as any).equal).toBe(true);
      });

      it('N2 NULL DACL (DaclPresent=false) vs empty present DACL is drift (opposite semantics)', () => {
        // Highest-severity correctness gap: NULL DACL means "grant all
        // access to all callers"; an empty-but-present DACL means
        // "deny everyone". Distinguishable only by the `DaclPresent` bit
        // because both sides have zero ACEs. The gate compares
        // `DaclPresent` so this surfaces; a naive comparator that walked
        // only ACEs would silently call these equal.
        const expected = mkSd({ DaclPresent: false, DaclAces: [] });
        const actual = mkSd({ DaclPresent: true, DaclAces: [] });
        const result = service.securityDescriptorEquals(expected as any, actual as any);
        expect(result.equal).toBe(false);
        expect(result.reason?.field).toBe('daclPresent');
      });

      it('N3 large DACL (1000 ACEs) all matching', () => {
        const aces: Ace[] = Array.from({ length: 1000 }, (_, i) =>
          mkAce({ Sid: `S-1-5-21-N-${i}`, AccessMask: i }),
        );
        const expected = mkSd({ DaclAces: aces });
        const actual = mkSd({ DaclAces: aces.map((a) => ({ ...a })) });
        const start = Date.now();
        const result = service.securityDescriptorEquals(expected as any, actual as any);
        const elapsed = Date.now() - start;
        expect(result.equal).toBe(true);
        expect(elapsed).toBeLessThan(500);
      });

      it('N4 100 ACEs, one differs at index 50', () => {
        const aces: Ace[] = Array.from({ length: 100 }, (_, i) =>
          mkAce({ Sid: `S-1-5-21-N-${i}`, AccessMask: i }),
        );
        const actualAces = aces.map((a, i) =>
          i === 50 ? { ...a, AccessMask: 9999 } : { ...a },
        );
        const result = service.securityDescriptorEquals(
          mkSd({ DaclAces: aces }) as any,
          mkSd({ DaclAces: actualAces }) as any,
        );
        expect(result.equal).toBe(false);
        expect(result.reason?.field).toBe('aceFieldDiff');
      });

      it('N5 unresolved SID on both, byte-equal', () => {
        const ace = mkAce({ Sid: 'S-1-5-21-9999-9999-9999-1234' });
        expect(
          service.securityDescriptorEquals(
            mkSd({ DaclAces: [ace] }) as any,
            mkSd({ DaclAces: [{ ...ace }] }) as any,
          ).equal,
        ).toBe(true);
      });

      it('N7 duplicate ACE [A,A] on both', () => {
        const a = mkAce({ Sid: 'S-1-5-21-DUP' });
        expect(
          service.securityDescriptorEquals(
            mkSd({ DaclAces: [a, a] }) as any,
            mkSd({ DaclAces: [a, a] }) as any,
          ).equal,
        ).toBe(true);
      });

      it('N8 [A,A] vs [A] -> count mismatch', () => {
        const a = mkAce({ Sid: 'S-1-5-21-DUP' });
        const result = service.securityDescriptorEquals(
          mkSd({ DaclAces: [a, a] }) as any,
          mkSd({ DaclAces: [a] }) as any,
        );
        expect(result.equal).toBe(false);
        expect(result.reason?.field).toBe('aceMissingOnDestination');
      });
    });

    // ---- Section O: short-circuit vs index loop -------------------------
    describe('O. ACE-count short-circuit vs index loop', () => {
      const A = mkAce({ Sid: 'S-1-5-21-A' });
      const B = mkAce({ Sid: 'S-1-5-21-B' });
      const C = mkAce({ Sid: 'S-1-5-21-C' });
      const Cdiff = mkAce({ Sid: 'S-1-5-21-CDIFF' });

      it('O1 length 3 all equal', () => {
        expect(
          service.securityDescriptorEquals(
            mkSd({ DaclAces: [A, B, C] }) as any,
            mkSd({ DaclAces: [A, B, C] }) as any,
          ).equal,
        ).toBe(true);
      });

      it('O2 mismatch at index 0 surfaces that ACE', () => {
        const result = service.securityDescriptorEquals(
          mkSd({ DaclAces: [A, B, C] }) as any,
          mkSd({ DaclAces: [Cdiff, B, C] }) as any,
        );
        expect(result.equal).toBe(false);
        expect(result.reason?.field).toBe('aceFieldDiff');
        expect((result.reason?.expectedValue as any).Sid).toBe('S-1-5-21-A');
      });

      it('O3 mismatch at last index surfaces that ACE', () => {
        const result = service.securityDescriptorEquals(
          mkSd({ DaclAces: [A, B, C] }) as any,
          mkSd({ DaclAces: [A, B, Cdiff] }) as any,
        );
        expect(result.equal).toBe(false);
        expect((result.reason?.expectedValue as any).Sid).toBe('S-1-5-21-C');
      });
    });

    // ---- Section P: Negative / robustness -------------------------------
    describe('P. Negative / robustness', () => {
      it('P2 DaclAces=null treated as empty', () => {
        const expected = mkSd({ DaclAces: null as any });
        const actual = mkSd({ DaclAces: [] });
        expect(service.securityDescriptorEquals(expected as any, actual as any).equal).toBe(true);
      });

      it('P3 ACE AccessMask=0', () => {
        const a = mkAce({ AccessMask: 0 });
        expect(
          service.securityDescriptorEquals(
            mkSd({ DaclAces: [a] }) as any,
            mkSd({ DaclAces: [{ ...a }] }) as any,
          ).equal,
        ).toBe(true);
      });

      it('P4 ACE AccessMask=-1 (signed-int marshal of GENERIC_ALL)', () => {
        const a = mkAce({ AccessMask: -1 });
        expect(
          service.securityDescriptorEquals(
            mkSd({ DaclAces: [a] }) as any,
            mkSd({ DaclAces: [{ ...a }] }) as any,
          ).equal,
        ).toBe(true);
      });

      it('P5 same negative encoding on both sides', () => {
        const a = mkAce({ AccessMask: -2147483648 });
        const b = mkAce({ AccessMask: -2147483648 });
        expect(
          service.securityDescriptorEquals(
            mkSd({ DaclAces: [a] }) as any,
            mkSd({ DaclAces: [b] }) as any,
          ).equal,
        ).toBe(true);
      });

      it('P5b mixed encoding (signed vs unsigned representation) treated as equal via int32 coercion', () => {
        const signed = mkAce({ AccessMask: -2147483648 });
        const unsigned = mkAce({ AccessMask: 0x80000000 });
        const result = service.securityDescriptorEquals(
          mkSd({ DaclAces: [signed] }) as any,
          mkSd({ DaclAces: [unsigned] }) as any,
        );
        // (value | 0) coerces both to int32: (-2147483648 | 0) === (0x80000000 | 0)
        // so two representations of the same 32-bit pattern are still equal.
        expect(result.equal).toBe(true);
      });
    });

    // ---- Section Q: End-to-end behavioral -------------------------------
    describe('Q. End-to-end behavioral', () => {
      const sourcePath = '/src/file.txt';
      const targetPath = '/dst/file.txt';

      const setupAcls = (src: SecurityDescriptor, dst: SecurityDescriptor) => {
        jest
          .spyOn(winOperationService, 'getAclOperation')
          .mockImplementation(async (_p: string, isSource: boolean) =>
            (isSource ? structuredClone(src) : structuredClone(dst)) as any,
          );
      };

      it('Q1 identical SDs -> no re-stamp', async () => {
        const sd = mkSd();
        setupAcls(sd, sd);
        expect(await service.hasSecurityDescriptorChanged(sourcePath, targetPath)).toBe(false);
      });

      it('Q2 Invalid-mapping idempotency: re-scan after stamp returns false', async () => {
        (mockRedisService.getOwnerIdentity as jest.Mock).mockResolvedValue('Invalid');
        const src = mkSd({ Owner: 'srcB', Group: 'srcB' });
        const dst = mkSd({ Owner: 'srcB', Group: 'srcB' });
        setupAcls(src, dst);
        const changed = await service.hasSecurityDescriptorChanged(
          sourcePath,
          targetPath,
          { jobRunId: 'wf', jobConfig: { options: { isIdentityMappingAvailable: true } } } as any,
        );
        expect(changed).toBe(false);
      });

      it('Q3 DLM-root inheritance transform idempotency', async () => {
        const inh = mkAce({ Sid: 'S-1-5-21-INH', AceFlags: 0x10, IsInherited: true });
        const src = mkSd({ DaclAces: [inh] });
        // Dest holds the transformed (explicit) variant.
        const dst = mkSd({
          DaclAces: [{ ...inh, AceFlags: 0x00, IsInherited: false }],
        });
        setupAcls(src, dst);
        const changed = await service.hasSecurityDescriptorChanged(
          sourcePath,
          targetPath,
          {
            jobRunId: 'wf-q3',
            jobConfig: {
              options: { smbPermissionInheritanceMode: SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT },
            },
          } as any,
          true,
        );
        expect(changed).toBe(false);
      });

      it('Q4 external actor adds ACE on dest -> drift', async () => {
        const src = mkSd({ DaclAces: [mkAce({ Sid: 'S-1-5-21-A' })] });
        const dst = mkSd({
          DaclAces: [mkAce({ Sid: 'S-1-5-21-A' }), mkAce({ Sid: 'S-1-5-21-ROGUE' })],
        });
        setupAcls(src, dst);
        expect(await service.hasSecurityDescriptorChanged(sourcePath, targetPath)).toBe(true);
      });

      it('Q5 external actor removes ACE on dest -> drift', async () => {
        const src = mkSd({
          DaclAces: [mkAce({ Sid: 'S-1-5-21-A' }), mkAce({ Sid: 'S-1-5-21-B' })],
        });
        const dst = mkSd({ DaclAces: [mkAce({ Sid: 'S-1-5-21-A' })] });
        setupAcls(src, dst);
        expect(await service.hasSecurityDescriptorChanged(sourcePath, targetPath)).toBe(true);
      });

      it('Q6 destination DaclProtected flipped -> drift', async () => {
        const src = mkSd({ DaclProtected: false });
        const dst = mkSd({ DaclProtected: true });
        setupAcls(src, dst);
        expect(await service.hasSecurityDescriptorChanged(sourcePath, targetPath)).toBe(true);
      });

      it('Q7 destination DACL reordered -> drift', async () => {
        const A = mkAce({ Sid: 'S-1-5-21-A' });
        const B = mkAce({ Sid: 'S-1-5-21-B' });
        const src = mkSd({ DaclAces: [A, B] });
        const dst = mkSd({ DaclAces: [B, A] });
        setupAcls(src, dst);
        expect(await service.hasSecurityDescriptorChanged(sourcePath, targetPath)).toBe(true);
      });

      it('Q8 source gains ACE -> drift', async () => {
        const src = mkSd({
          DaclAces: [mkAce({ Sid: 'S-1-5-21-A' }), mkAce({ Sid: 'S-1-5-21-NEW' })],
        });
        const dst = mkSd({ DaclAces: [mkAce({ Sid: 'S-1-5-21-A' })] });
        setupAcls(src, dst);
        expect(await service.hasSecurityDescriptorChanged(sourcePath, targetPath)).toBe(true);
      });

      it('Q9 Hidden attribute toggled on source -> drift', async () => {
        const src = mkSd({ Attributes: 'Archive,Hidden' });
        const dst = mkSd({ Attributes: 'Archive' });
        setupAcls(src, dst);
        expect(await service.hasSecurityDescriptorChanged(sourcePath, targetPath)).toBe(true);
      });

      it('Q10 Compressed attribute toggled (not stampable) -> no drift', async () => {
        const src = mkSd({ Attributes: 'Archive,Compressed' });
        const dst = mkSd({ Attributes: 'Archive' });
        setupAcls(src, dst);
        expect(await service.hasSecurityDescriptorChanged(sourcePath, targetPath)).toBe(false);
      });
    });

    // ---- Section R: Cross-validator consistency -------------------------
    //
    // Documents the divergence between the strict gate
    // (`securityDescriptorEquals`) and the loose post-stamp validator
    // (`validateAclOperation`). When the two disagree, validate's empty
    // `inValid` masks drift that the gate would catch on the next scan.
    // These tests pin the divergence so any future unification (recommended
    // — make validate delegate to equals) shows up as test churn.
    describe('R. Cross-validator consistency', () => {
      const runRow = async (
        srcAces: Ace[],
        dstAces: Ace[],
        opts: Partial<SecurityDescriptor> = {},
        validateExpectsNonEmpty = false,
      ) => {
        const src = mkSd({ ...opts, DaclAces: srcAces });
        const dst = mkSd({ ...opts, DaclAces: dstAces });
        const gate = service.securityDescriptorEquals(src as any, dst as any);
        const validate = await winOperationService.validateAclOperation(src as any, dst as any);
        return { gate, validate, validateExpectsNonEmpty };
      };

      it('R1 identical SDs: gate equal AND validate empty', async () => {
        const A = mkAce({ Sid: 'S-1-5-21-A' });
        const { gate, validate } = await runRow([A], [A]);
        expect(gate.equal).toBe(true);
        expect(validate.inValid).toBe('');
      });

      it('R2 dest has extra ACE -> both gate and validate flag it', async () => {
        const A = mkAce({ Sid: 'S-1-5-21-A' });
        const B = mkAce({ Sid: 'S-1-5-21-B' });
        const { gate, validate } = await runRow([A], [A, B]);
        expect(gate.equal).toBe(false);
        expect(gate.reason?.field).toBe('aceExtraOnDestination');
        expect(validate.inValid).not.toBe('');
        expect(validate.inValid).toContain('Extra ACE in target');
      });

      it('R3 dest mask is superset -> gate flags drift, validate also flags (both strict equality)', async () => {
        const src = mkAce({ Sid: 'S-1-5-21-A', AccessMask: 0x120089 });
        const dst = mkAce({ Sid: 'S-1-5-21-A', AccessMask: 0x1f01ff });
        const { gate, validate } = await runRow([src], [dst]);
        expect(gate.equal).toBe(false);
        expect(gate.reason?.field).toBe('aceFieldDiff');
        expect(validate.inValid).not.toBe('');
      });

      it('R4 KNOWN DIVERGENCE: reorder -> gate flags, validate silent', async () => {
        const A = mkAce({ Sid: 'S-1-5-21-A', AccessMask: 1 });
        const B = mkAce({ Sid: 'S-1-5-21-B', AccessMask: 2 });
        const { gate, validate } = await runRow([A, B], [B, A]);
        expect(gate.equal).toBe(false);
        expect(validate.inValid).toBe('');
      });

      it('R5 AceFlags differ (OI dropped) -> both gate and validate flag it (consistent)', async () => {
        // `AceFlags` packs inheritance shape (OBJECT_INHERIT 0x01,
        // CONTAINER_INHERIT 0x02, NO_PROPAGATE 0x04, INHERIT_ONLY 0x08,
        // INHERITED_ACE 0x10). Drift here silently changes propagation,
        // so both the gate (strict positional `AceFlags`) and the
        // validator (strict `AceFlags === srcAce.AceFlags` per non-CO
        // ACE) now flag it. This case was previously a divergence; the
        // validator was strengthened to match the gate.
        const src = mkAce({ Sid: 'S-1-5-21-A', AceFlags: 0x03 });
        const dst = mkAce({ Sid: 'S-1-5-21-A', AceFlags: 0x02 });
        const { gate, validate } = await runRow([src], [dst]);
        expect(gate.equal).toBe(false);
        expect(gate.reason?.field).toBe('aceFieldDiff');
        expect(validate.inValid).toContain('Missing ACE in target');
        expect(validate.inValid).toContain('AceFlags(0x3)');
      });

      it('R6 dest missing ACE: both flag it', async () => {
        const A = mkAce({ Sid: 'S-1-5-21-A' });
        const B = mkAce({ Sid: 'S-1-5-21-B' });
        const { gate, validate } = await runRow([A, B], [A]);
        expect(gate.equal).toBe(false);
        expect(validate.inValid).toContain('Missing ACE in target');
      });

      it('R7 owner mismatch: both flag it', async () => {
        const src = mkSd({ Owner: 'S-1-5-21-A' });
        const dst = mkSd({ Owner: 'S-1-5-21-B' });
        const gate = service.securityDescriptorEquals(src as any, dst as any);
        const validate = await winOperationService.validateAclOperation(src as any, dst as any);
        expect(gate.equal).toBe(false);
        expect(gate.reason?.field).toBe('owner');
        expect(validate.inValid).toContain('Owner mismatch');
      });
    });
  });
});
