/**
 * Test-plan compliance suite for the ACL comparison gate.
 *
 * Source of truth: https://netapp.atlassian.net/wiki/spaces/CDMT/pages/619194501/
 * Test+Plan+for+ACL+comparison+approach (page version 16, 2026-05-25).
 *
 * One `it(...)` per numbered scenario from the plan. Test names embed the
 * scenario id (e.g. `S1.1`, `S3b.4`) so a reviewer can grep this file from
 * any row in the plan and find the corresponding unit test.
 *
 * Scope split versus `win-operation.service.spec.ts`:
 *   - The sibling file exercises *comparator behavior categories* (e.g.
 *     "order is significant", "short-circuit on first mismatch").
 *   - This file pins each *plan scenario* to its expected comparator verdict
 *     and the specific `field=` reported on drift, so the plan and the code
 *     can be audited against each other line-by-line.
 *
 * What this file deliberately does NOT cover (and why):
 *   - Group 8 (Error handling: stamp failures, post-stamp validation, fetch
 *     failures) — these belong to the stamp path and `validateAclOperation`,
 *     not the gate's comparator. Existing coverage:
 *       * `hasSecurityDescriptorChanged` SourceAclError propagation lives in
 *         `win-operation.service.spec.ts`.
 *       * `validateAclOperation` has its own subset-equality suite there.
 *   - Selection-layer rows (SEL_CTIME_BUMP_ONLY, SEL_CONTENT_CHANGE_ACL_CHANGED)
 *     belong to scan/selection logic upstream of the gate, not the gate
 *     itself. They are flagged in the "Out-of-scope" describe below.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { WinOperationService } from './win-operation.service';
import { SecurityDescriptorChangeDetectorService } from './security-descriptor-change-detector.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { WinShellService } from 'src/activities/common/win-shell.service';
import { RedisService } from 'src/redis/redis.service';
import { MetricsService } from 'src/metrics/metrics.service';

// Local mirror of the service-internal SecurityDescriptor / Ace shape. Kept
// in-file (rather than imported) so test data is self-describing.
type Ace = {
  Sid: string;
  AccessMask: number;
  AceType: number;
  AceFlags: number;
  IsInherited: boolean;
  originalSid: string;
};

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

// ───────────────────────────── Constants ─────────────────────────────
// Well-known SIDs (universal — same on every Windows box, no AD lookup).
const SID = {
  EVERYONE:         'S-1-1-0',
  CREATOR_OWNER:    'S-1-3-0',
  SYSTEM:           'S-1-5-18',
  ADMINISTRATORS:   'S-1-5-32-544',
  USERS:            'S-1-5-32-545',
  // Synthetic domain SIDs used as placeholder trustees in the test plan.
  ALICE:            'S-1-5-21-TEST-ALICE',
  BOB:              'S-1-5-21-TEST-BOB',
  CHARLIE:          'S-1-5-21-TEST-CHARLIE',
  EVE:              'S-1-5-21-TEST-EVE',
  U1:               'S-1-5-21-TEST-U1',
  U2:               'S-1-5-21-TEST-U2',
  // Mapped trustees for SID_MAP_* rows. Names mirror the plan's
  // ROOTDOMAIN\aclmap_u{1,2} placeholders.
  ACLMAP_U1_SRC:    'S-1-5-21-SRC-ACLMAP-U1',
  ACLMAP_U1_DST:    'S-1-5-21-DST-ACLMAP-U1',
  ACLMAP_U2_SRC:    'S-1-5-21-SRC-ACLMAP-U2',
  ACLMAP_U2_DST:    'S-1-5-21-DST-ACLMAP-U2',
  // Generic owner/group used across scenarios.
  OWNER:            'S-1-5-21-TEST-OWNER',
  GROUP:            'S-1-5-21-TEST-GROUP',
};

// Standard NTFS access masks — values lifted from MS-DTYP §2.4.3.
const MASK = {
  R:           0x120089, // FILE_GENERIC_READ
  W:           0x120116, // FILE_GENERIC_WRITE
  RX:          0x1200A9, // FILE_GENERIC_READ | EXECUTE
  M:           0x1301BF, // Modify
  F:           0x1F01FF, // Full Control
  DELETE:      0x010000, // DELETE
  WRITE_DAC:   0x040000, // WRITE_DAC
};

// ACE flag bits (MS-DTYP §2.4.4.1).
const FLAG = {
  NONE:        0x00,
  OI:          0x01, // OBJECT_INHERIT
  CI:          0x02, // CONTAINER_INHERIT
  NP:          0x04, // NO_PROPAGATE
  IO:          0x08, // INHERIT_ONLY
  INHERITED:   0x10, // INHERITED_ACE
  OI_CI:       0x03,
  OI_CI_IO:    0x0B,
  OI_CI_NP:    0x07,
};

// ACE type values.
const TYPE = {
  ALLOW: 0,
  DENY:  1,
  AUDIT: 2,
};

// ───────────────────────────── Factories ─────────────────────────────
const mkAce = (over: Partial<Ace> = {}): Ace => ({
  Sid: SID.EVERYONE,
  AccessMask: MASK.M,
  AceType: TYPE.ALLOW,
  AceFlags: FLAG.NONE,
  IsInherited: false,
  originalSid: '',
  ...over,
});

const mkSd = (over: Partial<SecurityDescriptor> = {}): SecurityDescriptor => ({
  Owner: SID.ADMINISTRATORS,
  Group: SID.GROUP,
  DaclAces: [mkAce()],
  Attributes: 'Archive',
  DaclPresent: true,
  DaclProtected: false,
  DaclAutoInherit: true,
  originalOwner: '',
  originalGroup: '',
  ...over,
});

const cloneSd = (sd: SecurityDescriptor): SecurityDescriptor =>
  JSON.parse(JSON.stringify(sd));

// ─────────────────────────────── Suite ───────────────────────────────
describe('ACL comparison — test-plan compliance (CDMT/619194501)', () => {
  let service: SecurityDescriptorChangeDetectorService;
  let winOperationService: WinOperationService;
  let mockLogger: Partial<LoggerService>;

  beforeEach(async () => {
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      setParentContext: jest.fn(),
    };
    const mockLoggerFactory: Partial<LoggerFactory> = {
      create: jest.fn().mockReturnValue(mockLogger),
      configService: {} as any,
    };
    const mockWinShellService: Partial<WinShellService> = {
      executeCommand: jest.fn(),
    };
    const mockRedisService: Partial<RedisService> = {
      getOwnerIdentity: jest.fn(),
      setOwnerIdentity: jest.fn(),
    };
    const mockMetricsService = {
      runWithTiming: jest.fn().mockImplementation(
        (_wf: string, _spec: unknown, fn: () => unknown) =>
          typeof fn === 'function' ? Promise.resolve(fn()) : Promise.resolve(),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WinOperationService,
        SecurityDescriptorChangeDetectorService,
        { provide: LoggerFactory, useValue: mockLoggerFactory },
        { provide: WinShellService, useValue: mockWinShellService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    service = module.get<SecurityDescriptorChangeDetectorService>(
      SecurityDescriptorChangeDetectorService,
    );
    winOperationService = module.get<WinOperationService>(WinOperationService);
  });

  afterEach(() => jest.clearAllMocks());

  // ═════════════════ Control rows (CTRL_*) ═════════════════════════
  describe('Control rows — proves the gate does not over-select', () => {
    it('CTRL_OWNER: byte-identical owner/group → Match (no drift, no log)', () => {
      const sd = mkSd();
      const result = service.securityDescriptorEquals(cloneSd(sd) as any, cloneSd(sd) as any);
      expect(result.equal).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('CTRL_DACL: byte-identical DACLs → Match', () => {
      const sd = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.EVERYONE, AccessMask: MASK.M }),
          mkAce({ Sid: SID.USERS,    AccessMask: MASK.R }),
        ],
      });
      expect(service.securityDescriptorEquals(cloneSd(sd) as any, cloneSd(sd) as any).equal).toBe(true);
    });

    it('CTRL_ATTRS: byte-identical attribute bitmasks → Match', () => {
      const sd = mkSd({ Attributes: 'Archive' });
      expect(service.securityDescriptorEquals(cloneSd(sd) as any, cloneSd(sd) as any).equal).toBe(true);
    });
  });

  // ═════════════════════════ Group 1 — Owner ═════════════════════════
  describe('Group 1 — Owner mismatch (type #1)', () => {
    it('S1.1 / row 4 (S1_3_OWNER_TO_USERS): owner Administrators → BUILTIN\\Users → field=owner', () => {
      const expected = mkSd({ Owner: SID.USERS });           // source after /setowner Users
      const actual   = mkSd({ Owner: SID.ADMINISTRATORS });  // destination still has original
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('owner');
      expect(result.reason?.expectedValue).toBe(SID.USERS);
      expect(result.reason?.actualValue).toBe(SID.ADMINISTRATORS);
    });

    it('row 5 (S1_4_OWNER_TO_SYSTEM): owner Administrators → NT AUTHORITY\\SYSTEM → field=owner', () => {
      const expected = mkSd({ Owner: SID.SYSTEM });
      const actual   = mkSd({ Owner: SID.ADMINISTRATORS });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('owner');
    });
  });

  // ═════════════════════════ Group 2 — Group ═════════════════════════
  describe('Group 2 — Group mismatch (type #2)', () => {
    it('S2.1 / row 6 (S2_1_GROUP_CHANGE): group changed to BUILTIN\\Users → field=group', () => {
      const expected = mkSd({ Group: SID.USERS });
      const actual   = mkSd({ Group: SID.GROUP });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('group');
    });
  });

  // ═══════════════════ Group 3a — DACL order (type #3b) ════════════════
  describe('Group 3a — DACL order mismatch', () => {
    it('S3a.1 / row 42 (S3A_1_DENY_BEFORE_ALLOW): Allow/Deny order swap → field=aceFieldDiff', () => {
      // Canonical: [Deny U1:W, Allow U2:R]. Non-canonical reorder swaps
      // them — same set, different positions. First-match semantics make
      // the two DACLs grant different effective access despite holding the
      // same ACE bytes, so the comparator must surface this.
      const expected = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.U2, AccessMask: MASK.R, AceType: TYPE.ALLOW }),
          mkAce({ Sid: SID.U1, AccessMask: MASK.W, AceType: TYPE.DENY  }),
        ],
      });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.U1, AccessMask: MASK.W, AceType: TYPE.DENY  }),
          mkAce({ Sid: SID.U2, AccessMask: MASK.R, AceType: TYPE.ALLOW }),
        ],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceFieldDiff');
    });

    it('S3a.2 / row 7 (S3a_2_ORDER_NONCANONICAL): inherited moved before explicit → field=aceFieldDiff', () => {
      // Canonical: [explicit Bob:F, inherited Users:R]. Non-canonical
      // reorder bubbles the inherited ACE to position 0. Captured by the
      // positional walk because the inherited-bit (in AceFlags) shifts
      // positions even though the SID set is the same.
      const expected = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.USERS, AccessMask: MASK.R, AceFlags: FLAG.INHERITED }),
          mkAce({ Sid: SID.BOB,   AccessMask: MASK.F, AceFlags: FLAG.NONE      }),
        ],
      });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.BOB,   AccessMask: MASK.F, AceFlags: FLAG.NONE      }),
          mkAce({ Sid: SID.USERS, AccessMask: MASK.R, AceFlags: FLAG.INHERITED }),
        ],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceFieldDiff');
    });
  });

  // ═══════════════════ Group 3b — Membership (type #3c) ════════════════
  describe('Group 3b — DACL membership mismatch', () => {
    it('S3b.1 / row 8 (S3b_1_ACE_ADD): ACE added on source → field=aceMissingOnDestination', () => {
      const expected = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.EVERYONE, AccessMask: MASK.M }),
          mkAce({ Sid: SID.USERS,    AccessMask: MASK.R }),
        ],
      });
      const actual = mkSd({
        DaclAces: [mkAce({ Sid: SID.EVERYONE, AccessMask: MASK.M })],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceMissingOnDestination');
      expect((result.reason?.expectedValue as any).Sid).toBe(SID.USERS);
      expect(result.reason?.actualValue).toBeNull();
    });

    it('S3b.2 / row 9 (S3b_2_ACE_REMOVE): ACE removed on source → field=aceExtraOnDestination', () => {
      // Critical — silent privilege persistence if not caught. Target still
      // grants access to a principal source no longer authorizes.
      const expected = mkSd({
        DaclAces: [mkAce({ Sid: SID.EVERYONE, AccessMask: MASK.M })],
      });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.EVERYONE, AccessMask: MASK.M }),
          mkAce({ Sid: SID.USERS,    AccessMask: MASK.R }),
        ],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceExtraOnDestination');
      expect((result.reason?.actualValue as any).Sid).toBe(SID.USERS);
    });

    it('S3b.3 / row 43 (S3B_3_ACE_SID_SWAP): trustee swapped same mask/type → field=aceFieldDiff', () => {
      // Single-trustee swap keeps ACE count identical, so the positional
      // walk surfaces a per-slot diff rather than a count-based one.
      const expected = mkSd({
        DaclAces: [mkAce({ Sid: SID.EVE, AccessMask: MASK.R })],
      });
      const actual = mkSd({
        DaclAces: [mkAce({ Sid: SID.BOB, AccessMask: MASK.R })],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceFieldDiff');
    });

    it('S3b.4 / row 44 (S3B_4_ACE_TYPE_FLIP): Allow → Deny same trustee/mask → field=aceFieldDiff', () => {
      // Security-critical: identical count, identical SID, identical mask
      // but AceType flipped. Naive comparators miss this. Comparator must
      // catch it via the AceType byte in the positional check.
      const expected = mkSd({
        DaclAces: [mkAce({ Sid: SID.U1, AccessMask: MASK.R, AceType: TYPE.DENY })],
      });
      const actual = mkSd({
        DaclAces: [mkAce({ Sid: SID.U1, AccessMask: MASK.R, AceType: TYPE.ALLOW })],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceFieldDiff');
    });

    it('S3b.5 / row 10 (S3b_5_ALLOW_TO_DENY): Allow → Deny (same trustee+mask) → field=aceFieldDiff', () => {
      const expected = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.R, AceType: TYPE.DENY })],
      });
      const actual = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.R, AceType: TYPE.ALLOW })],
      });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('aceFieldDiff');
    });

    it('S3b.6 / row 11 (S3b_6_DENY_TO_ALLOW): Deny → Allow (opposite direction) → field=aceFieldDiff', () => {
      const expected = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.R, AceType: TYPE.ALLOW })],
      });
      const actual = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.R, AceType: TYPE.DENY })],
      });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('aceFieldDiff');
    });

    it('S3b.7 / row 13 (S3b_8_CREATOR_OWNER_REMOVE): CREATOR OWNER removed on source → field=aceExtraOnDestination', () => {
      const expected = mkSd({
        DaclAces: [mkAce({ Sid: SID.EVERYONE, AccessMask: MASK.M })],
      });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.EVERYONE,      AccessMask: MASK.M }),
          mkAce({ Sid: SID.CREATOR_OWNER, AccessMask: MASK.F, AceFlags: FLAG.OI_CI_IO }),
        ],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceExtraOnDestination');
      expect((result.reason?.actualValue as any).Sid).toBe(SID.CREATOR_OWNER);
    });

    it('S3b.8 / row 12 (S3b_7_CREATOR_OWNER_ADD): CREATOR OWNER added on source → field=aceMissingOnDestination', () => {
      const expected = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.EVERYONE,      AccessMask: MASK.M }),
          mkAce({ Sid: SID.CREATOR_OWNER, AccessMask: MASK.F, AceFlags: FLAG.OI_CI_IO }),
        ],
      });
      const actual = mkSd({
        DaclAces: [mkAce({ Sid: SID.EVERYONE, AccessMask: MASK.M })],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceMissingOnDestination');
      expect((result.reason?.expectedValue as any).Sid).toBe(SID.CREATOR_OWNER);
    });

    // ── CREATOR OWNER (S-1-3-0) tolerance ──
    // The kernel rewrites AccessMask/AceFlags on S-1-3-0 ACEs post-stamp
    // (GENERIC_* mask translation, INHERITED bit flip) and the rewrite is
    // idempotent on the destination but not on the written form. The gate
    // matches policy with `validateAclOperation`: count-by-AceType on CO,
    // strict positional on everything else. Add/remove still surfaces as
    // missing/extra; mask/flags drift on a paired CO ACE does not.
    it('S3b.10 (CREATOR_OWNER_KERNEL_REWRITE): CO mask + flags differ, counts match → equal=true', () => {
      // Realistic post-stamp shape: source wrote (GENERIC_ALL | OI|CI|IO),
      // kernel translated to (FILE_ALL_ACCESS | OI|CI) and cleared IO.
      const expected = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.EVERYONE,      AccessMask: MASK.M }),
          mkAce({ Sid: SID.CREATOR_OWNER, AccessMask: 0x10000000, AceFlags: FLAG.OI_CI_IO }),
        ],
      });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.EVERYONE,      AccessMask: MASK.M }),
          mkAce({ Sid: SID.CREATOR_OWNER, AccessMask: MASK.F, AceFlags: FLAG.OI_CI }),
        ],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('S3b.11 (CREATOR_OWNER_REORDER): kernel reordered CO position; non-CO order preserved → equal=true', () => {
      // Both sides hold the same non-CO ACE in the same position; CO is at
      // a different index. Comparator pulls CO out before the positional
      // walk, so the position diff on CO must not fire as aceFieldDiff.
      const expected = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.CREATOR_OWNER, AccessMask: MASK.F, AceFlags: FLAG.OI_CI_IO }),
          mkAce({ Sid: SID.EVERYONE,      AccessMask: MASK.M }),
        ],
      });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.EVERYONE,      AccessMask: MASK.M }),
          mkAce({ Sid: SID.CREATOR_OWNER, AccessMask: MASK.F, AceFlags: FLAG.OI_CI_IO }),
        ],
      });
      expect(service.securityDescriptorEquals(expected as any, actual as any).equal).toBe(true);
    });

    it('S3b.12 (CREATOR_OWNER_NON_CO_DRIFT_STILL_FIRES): CO mutated but non-CO dest mask differs → field=aceFieldDiff (strict equality)', () => {
      // Strict equality: source Users:R, dest Users:F — different masks.
      // The non-CO positional walk catches this as aceFieldDiff even though
      // F is a superset of R.
      const expected = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.CREATOR_OWNER, AccessMask: 0x10000000, AceFlags: FLAG.OI_CI_IO }),
          mkAce({ Sid: SID.USERS,         AccessMask: MASK.R }),
        ],
      });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.CREATOR_OWNER, AccessMask: MASK.F, AceFlags: FLAG.OI_CI }),
          mkAce({ Sid: SID.USERS,         AccessMask: MASK.F }),
        ],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceFieldDiff');
    });

    it('S3b.13 (CREATOR_OWNER_ACE_TYPE_FLIP): CO Allow on source vs CO Deny on dest → field=aceMissingOnDestination', () => {
      // Tolerance is per-AceType — flipping CO from Allow to Deny changes
      // the per-type count (Allow: 1→0, Deny: 0→1) and must still surface
      // as drift. Otherwise a hostile/buggy ACE flip on the placeholder
      // would silently survive.
      const expected = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.EVERYONE,      AccessMask: MASK.M }),
          mkAce({ Sid: SID.CREATOR_OWNER, AccessMask: MASK.F, AceType: TYPE.ALLOW, AceFlags: FLAG.OI_CI_IO }),
        ],
      });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.EVERYONE,      AccessMask: MASK.M }),
          mkAce({ Sid: SID.CREATOR_OWNER, AccessMask: MASK.F, AceType: TYPE.DENY,  AceFlags: FLAG.OI_CI_IO }),
        ],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      // Missing fires first because expected has CO-Allow that actual lacks.
      expect(result.reason?.field).toBe('aceMissingOnDestination');
      expect((result.reason?.expectedValue as any).Sid).toBe(SID.CREATOR_OWNER);
      expect((result.reason?.expectedValue as any).AceType).toBe(TYPE.ALLOW);
    });

    it('S3b.14 (CREATOR_OWNER_DUPLICATE_ON_DEST): extra CO of same type on destination → field=aceExtraOnDestination', () => {
      // Per-type count catches duplicates even when one paired CO matches
      // — protects against silent CO-ACE accumulation on destination from
      // out-of-band tooling.
      const expected = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.CREATOR_OWNER, AccessMask: MASK.F, AceFlags: FLAG.OI_CI_IO }),
        ],
      });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.CREATOR_OWNER, AccessMask: MASK.F, AceFlags: FLAG.OI_CI_IO }),
          mkAce({ Sid: SID.CREATOR_OWNER, AccessMask: MASK.M, AceFlags: FLAG.OI_CI }),
        ],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceExtraOnDestination');
      expect((result.reason?.actualValue as any).Sid).toBe(SID.CREATOR_OWNER);
    });

    it('S3b.9 / row 14 (S3b_9_MASS_RESET): icacls /reset collapses source DACL → field=aceExtraOnDestination', () => {
      // Source DACL post-reset has just one inherited ACE; destination
      // still carries the original 5 explicit grants. Comparator reports
      // an extra ACE (the first one in destination that isn't in source).
      const expected = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.R, AceFlags: FLAG.INHERITED })],
      });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.USERS,    AccessMask: MASK.R, AceFlags: FLAG.INHERITED }), // surviving inherited
          mkAce({ Sid: SID.ALICE,    AccessMask: MASK.F }),
          mkAce({ Sid: SID.BOB,      AccessMask: MASK.F }),
          mkAce({ Sid: SID.CHARLIE,  AccessMask: MASK.F }),
          mkAce({ Sid: SID.EVE,      AccessMask: MASK.F }),
          mkAce({ Sid: SID.U1,       AccessMask: MASK.F }),
        ],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceExtraOnDestination');
    });
  });

  // ═══════════════════ Group 3c — AccessMask (type #3d) ════════════════
  describe('Group 3c — DACL AccessMask mismatch', () => {
    it('S3c.1 / row 15 (S3c_3_MASK_GROW): Everyone R → F → field=aceFieldDiff', () => {
      const expected = mkSd({ DaclAces: [mkAce({ Sid: SID.EVERYONE, AccessMask: MASK.F })] });
      const actual   = mkSd({ DaclAces: [mkAce({ Sid: SID.EVERYONE, AccessMask: MASK.R })] });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.reason?.field).toBe('aceFieldDiff');
      expect((result.reason?.expectedValue as any).AccessMask).toBe(MASK.F);
      expect((result.reason?.actualValue as any).AccessMask).toBe(MASK.R);
    });

    it('S3c.2 / row 16 (S3c_4_MASK_SHRINK): Everyone R on source, F on dest → field=aceFieldDiff (strict equality)', () => {
      // Strict equality: source is R, destination is F (different masks).
      // A mask shrink on source (F→R after re-stamp) means dest is now
      // over-permissive — must trigger a re-stamp.
      const expected = mkSd({ DaclAces: [mkAce({ Sid: SID.EVERYONE, AccessMask: MASK.R })] });
      const actual   = mkSd({ DaclAces: [mkAce({ Sid: SID.EVERYONE, AccessMask: MASK.F })] });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceFieldDiff');
      expect((result.reason?.expectedValue as any).AccessMask).toBe(MASK.R);
      expect((result.reason?.actualValue as any).AccessMask).toBe(MASK.F);
    });

    it('S3c.3: RX → RW (different bit positions) → field=aceFieldDiff', () => {
      const RW = MASK.R | MASK.W; // 0x120116 ⋃ 0x120089 — different bit family from RX
      const expected = mkSd({ DaclAces: [mkAce({ Sid: SID.BOB, AccessMask: RW })] });
      const actual   = mkSd({ DaclAces: [mkAce({ Sid: SID.BOB, AccessMask: MASK.RX })] });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('aceFieldDiff');
    });

    it('S3c.4: Delete → WriteDAC (special mask altered) → field=aceFieldDiff', () => {
      const expected = mkSd({ DaclAces: [mkAce({ Sid: SID.BOB, AccessMask: MASK.WRITE_DAC })] });
      const actual   = mkSd({ DaclAces: [mkAce({ Sid: SID.BOB, AccessMask: MASK.DELETE    })] });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('aceFieldDiff');
    });

    it('S3c.5 / row 18 (S3c_6_DENY_REMOVE): Deny removed on source → field=aceExtraOnDestination', () => {
      const expected = mkSd({
        DaclAces: [mkAce({ Sid: SID.ALICE, AccessMask: MASK.F, AceType: TYPE.ALLOW })],
      });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.ALICE, AccessMask: MASK.F, AceType: TYPE.ALLOW }),
          mkAce({ Sid: SID.ALICE, AccessMask: MASK.W, AceType: TYPE.DENY  }),
        ],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.reason?.field).toBe('aceExtraOnDestination');
      expect((result.reason?.actualValue as any).AceType).toBe(TYPE.DENY);
    });

    it('S3c.6 / row 17 (S3c_5_DENY_ADD): Deny added on source → field=aceMissingOnDestination', () => {
      const expected = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.ALICE, AccessMask: MASK.F, AceType: TYPE.ALLOW }),
          mkAce({ Sid: SID.ALICE, AccessMask: MASK.W, AceType: TYPE.DENY  }),
        ],
      });
      const actual = mkSd({
        DaclAces: [mkAce({ Sid: SID.ALICE, AccessMask: MASK.F, AceType: TYPE.ALLOW })],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.reason?.field).toBe('aceMissingOnDestination');
      expect((result.reason?.expectedValue as any).AceType).toBe(TYPE.DENY);
    });
  });

  // ═══════════════════ Group 3d — AceType (type #3e) ═══════════════════
  describe('Group 3d — DACL AceType mismatch', () => {
    it('S3d.1: Allow → Deny (single ACE flip, count preserved) → field=aceFieldDiff', () => {
      const expected = mkSd({ DaclAces: [mkAce({ Sid: SID.BOB, AccessMask: MASK.W, AceType: TYPE.DENY  })] });
      const actual   = mkSd({ DaclAces: [mkAce({ Sid: SID.BOB, AccessMask: MASK.W, AceType: TYPE.ALLOW })] });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('aceFieldDiff');
    });

    it('S3d.2: Deny → Allow (opposite direction) → field=aceFieldDiff', () => {
      const expected = mkSd({ DaclAces: [mkAce({ Sid: SID.ALICE, AccessMask: MASK.W, AceType: TYPE.ALLOW })] });
      const actual   = mkSd({ DaclAces: [mkAce({ Sid: SID.ALICE, AccessMask: MASK.W, AceType: TYPE.DENY  })] });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('aceFieldDiff');
    });
  });

  // ═════════════════ Group 3e — AceFlags / inheritance (#3f) ═══════════
  describe('Group 3e — DACL AceFlags / inheritance mismatch', () => {
    it('S3e.1 / row 19 (S3e_1_OI_DROP): (OI)(CI)F → (CI)F → field=aceFieldDiff', () => {
      const expected = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.F, AceFlags: FLAG.CI })],
      });
      const actual = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.F, AceFlags: FLAG.OI_CI })],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.reason?.field).toBe('aceFieldDiff');
      expect((result.reason?.expectedValue as any).AceFlags).toBe(FLAG.CI);
      expect((result.reason?.actualValue as any).AceFlags).toBe(FLAG.OI_CI);
    });

    it('S3e.2 / row 20 (S3e_2_CI_DROP): (OI)(CI)F → (OI)F → field=aceFieldDiff', () => {
      const expected = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.F, AceFlags: FLAG.OI })],
      });
      const actual = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.F, AceFlags: FLAG.OI_CI })],
      });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('aceFieldDiff');
    });

    it('S3e.3 / row 21 (S3e_3_IO_ADD): (OI)(CI)F → (OI)(CI)(IO)F → field=aceFieldDiff', () => {
      const expected = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.F, AceFlags: FLAG.OI_CI_IO })],
      });
      const actual = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.F, AceFlags: FLAG.OI_CI })],
      });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('aceFieldDiff');
    });

    it('S3e.4 / row 22 (S3e_4_NP_ADD): (OI)(CI)F → (OI)(CI)(NP)F → field=aceFieldDiff', () => {
      const expected = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.F, AceFlags: FLAG.OI_CI_NP })],
      });
      const actual = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.F, AceFlags: FLAG.OI_CI })],
      });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('aceFieldDiff');
    });

    it('S3e.5 / row 23 (S3e_5_ALL_FLAGS_CLEARED): (OI)(CI)F → F (no flags) → field=aceFieldDiff', () => {
      const expected = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.F, AceFlags: FLAG.NONE })],
      });
      const actual = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.F, AceFlags: FLAG.OI_CI })],
      });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('aceFieldDiff');
    });

    it('S3e.6 / row 24 (S3e_6_INHERITED_BIT_FLIPPED): explicit → inherited (same SID/mask/type) → field=aceFieldDiff', () => {
      // Provenance differs: ACE bytes match in Sid/AccessMask/AceType but
      // INHERITED bit (0x10 in AceFlags) is set on one side only. Caught
      // because AceFlags participates in the positional equality.
      const expected = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.R, AceFlags: FLAG.INHERITED })],
      });
      const actual = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.R, AceFlags: FLAG.NONE })],
      });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('aceFieldDiff');
    });
  });

  // ═══════════════════ Group 4 — DaclPresent (type #4) ═══════════════════
  describe('Group 4 — DaclPresent mismatch', () => {
    it('S4.1 / row 25 (S4_1_NULL_DACL): source flipped to NULL DACL → field=daclPresent', () => {
      // Source semantically opens up ("everyone implicitly full access");
      // destination retains the original restrictive DACL.
      const expected = mkSd({ DaclPresent: false, DaclAces: [] });
      const actual   = mkSd({ DaclPresent: true,  DaclAces: [mkAce({ Sid: SID.EVERYONE, AccessMask: MASK.M })] });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('daclPresent');
      expect(result.reason?.expectedValue).toBe(false);
      expect(result.reason?.actualValue).toBe(true);
    });

    it('S4.2 / row 26 (S4_2_EMPTY_DACL): source flipped to empty DACL → field=aceExtraOnDestination', () => {
      // Both sides have DaclPresent=true so the daclPresent check passes;
      // the ACE-count diff fires instead (source: 0 ACEs, dest: 1 ACE).
      // Verdict in the plan reads "dacl" — this is the comparator's
      // sub-field name for the count-based DACL difference.
      const expected = mkSd({ DaclPresent: true, DaclAces: [] });
      const actual   = mkSd({ DaclPresent: true, DaclAces: [mkAce({ Sid: SID.EVERYONE, AccessMask: MASK.M })] });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceExtraOnDestination');
    });

    it('S4.3 / row 45 (S4_3_NULL_VS_EMPTY_DACL): NULL ↔ empty DACL (both zero ACEs) → field=daclPresent', () => {
      // Highest-severity correctness gap: opposite access semantics
      // (NULL=everyone, empty=nobody) distinguished only by the DaclPresent
      // bit. Naive comparators that only walk ACEs would call these equal.
      const expected = mkSd({ DaclPresent: false, DaclAces: [] });
      const actual   = mkSd({ DaclPresent: true,  DaclAces: [] });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('daclPresent');
    });
  });

  // ═══════════════════ Group 5 — DaclProtected (type #5) ═════════════════
  describe('Group 5 — DaclProtected mismatch', () => {
    it('S5.1 / row 27 (S5_1_PROTECTED_ENABLE): inheritance disabled on source → field=daclProtected', () => {
      const expected = mkSd({ DaclProtected: true  });
      const actual   = mkSd({ DaclProtected: false });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('daclProtected');
      expect(result.reason?.expectedValue).toBe(true);
      expect(result.reason?.actualValue).toBe(false);
    });

    it('S5.2 / row 28 (S5_2_PROTECTED_DISABLE): inheritance re-enabled on source → field=daclProtected', () => {
      const expected = mkSd({ DaclProtected: false });
      const actual   = mkSd({ DaclProtected: true  });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('daclProtected');
    });

    it('S5.3 / row 29 (S5_3_INHERITANCE_R_DROPS_ACE): /inheritance:r drops inherited ACEs too → field=daclProtected (short-circuit)', () => {
      // Composite drift (DaclProtected flip + leftover inherited ACEs on
      // destination). Comparator's short-circuit order is owner → group →
      // daclPresent → daclProtected → attributes → ACEs, so daclProtected
      // fires first. (DaclAutoInherit is intentionally not gated — see
      // Group 6 below.) The plan's "Bidirectional ACE check
      // also fires" outcome refers to follow-up scans after stamp restores
      // the bit; in a single comparator call only the first field surfaces.
      const expected = mkSd({
        DaclProtected: true,
        DaclAces: [], // source's inheritance:r also stripped inherited ACEs
      });
      const actual = mkSd({
        DaclProtected: false,
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.R, AceFlags: FLAG.INHERITED })],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('daclProtected');
    });
  });

  // ═══════════════════ Group 6 — DaclAutoInherit (type #6) ═══════════════
  describe('Group 6 — DaclAutoInherit (intentionally not compared)', () => {
    // Plan rows S6.1 (S6_1_AUTOINHERIT_CLEAR) and S6.2 (S6_2_AUTOINHERIT_SET)
    // are intentionally not gated. `SE_DACL_AUTO_INHERITED` is set/cleared
    // by Windows' inheritance engine as a side-effect of propagation, so
    // the value we read back is not guaranteed to equal what we wrote even
    // on a byte-faithful stamp. Strict equality here would oscillate the
    // gate into restamping every incremental scan for a file whose stamp
    // already succeeded. Symmetric policy in `validateAclOperation`.
    it('S6.1 / row 30 (S6_1_AUTOINHERIT_CLEAR): auto-inherit true → false → equal=true (not gated)', () => {
      const expected = mkSd({ DaclAutoInherit: false });
      const actual   = mkSd({ DaclAutoInherit: true  });
      expect(service.securityDescriptorEquals(expected as any, actual as any).equal).toBe(true);
    });

    it('S6.2 / row 31 (S6_2_AUTOINHERIT_SET): auto-inherit false → true → equal=true (not gated)', () => {
      const expected = mkSd({ DaclAutoInherit: true  });
      const actual   = mkSd({ DaclAutoInherit: false });
      expect(service.securityDescriptorEquals(expected as any, actual as any).equal).toBe(true);
    });
  });

  // ═══════════════════ Group 7 — File Attributes ═════════════════════════
  describe('Group 7 — File Attributes (stampable subset only)', () => {
    it('S7.1 / row 32 (S7_1_READONLY_ADD): +ReadOnly on source → field=attributes', () => {
      const expected = mkSd({ Attributes: 'Archive, ReadOnly' });
      const actual   = mkSd({ Attributes: 'Archive' });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('attributes');
    });

    it('S7.2 / row 33 (S7_2_READONLY_REMOVE): -ReadOnly on source (opposite direction) → field=attributes', () => {
      const expected = mkSd({ Attributes: 'Archive' });
      const actual   = mkSd({ Attributes: 'Archive, ReadOnly' });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('attributes');
    });

    it('S7.3 / row 34 (S7_3_HIDDEN_ADD): +Hidden on source → field=attributes', () => {
      const expected = mkSd({ Attributes: 'Archive, Hidden' });
      const actual   = mkSd({ Attributes: 'Archive' });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('attributes');
    });

    it('S7.4 / row 35 (S7_4_SYSTEM_ADD_SUPERHIDDEN): +System on already-Hidden source → field=attributes', () => {
      const expected = mkSd({ Attributes: 'Archive, Hidden, System' });
      const actual   = mkSd({ Attributes: 'Archive, Hidden' });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('attributes');
    });

    it('S7.5 / row 36 (S7_5_NOTINDEXED_ADD): +NotContentIndexed (PS-only bit) → field=attributes', () => {
      const expected = mkSd({ Attributes: 'Archive, NotContentIndexed' });
      const actual   = mkSd({ Attributes: 'Archive' });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('attributes');
    });

    it('S7.6 / row 37 (S7_6_MULTI_BIT): +ReadOnly +Hidden simultaneously → field=attributes; bitmask compare is order-insensitive', () => {
      // The plan calls out that `[FileAttributes].ToString()` ordering is
      // not stable across Windows versions, so the comparator must be
      // insensitive to token order in the comma-list. Verified by
      // permuting both inputs.
      const expected1 = mkSd({ Attributes: 'Archive, Hidden, ReadOnly' });
      const actual1   = mkSd({ Attributes: 'ReadOnly, Hidden, Archive' });
      expect(service.securityDescriptorEquals(expected1 as any, expected1 as any).equal).toBe(true);
      // Same bitmask, different ordering → still equal (no false-positive).
      expect(service.securityDescriptorEquals(expected1 as any, actual1 as any).equal).toBe(true);

      // Real drift on top of the permutation still fires.
      const expected2 = mkSd({ Attributes: 'Archive, Hidden, ReadOnly' });
      const actual2   = mkSd({ Attributes: 'Archive' });
      expect(service.securityDescriptorEquals(expected2 as any, actual2 as any).reason?.field)
        .toBe('attributes');
    });

    it('S7.7 / row 38 (S7_7_ARCHIVE_REMOVE): -Archive on source → field=attributes', () => {
      // Most common attribute drift in real-world workloads (backup tools
      // clear Archive constantly). Comparator must catch it.
      const expected = mkSd({ Attributes: 'Normal' });
      const actual   = mkSd({ Attributes: 'Archive' });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('attributes');
    });

    it('S7.8 / row 39 (S7_8_TEMPORARY_ADD): +Temporary (PS-only bit) → field=attributes', () => {
      const expected = mkSd({ Attributes: 'Archive, Temporary' });
      const actual   = mkSd({ Attributes: 'Archive' });
      expect(service.securityDescriptorEquals(expected as any, actual as any).reason?.field)
        .toBe('attributes');
    });

    it('non-settable bits (Compressed/Encrypted/SparseFile) on expected only → still equal', () => {
      // Regression guard: comparator masks attributes down to the stampable
      // subset before comparing, so a destination missing a non-stampable
      // bit can never trigger drift (would cause infinite re-stamp).
      const expected = mkSd({ Attributes: 'Archive, Compressed, Encrypted, SparseFile' });
      const actual   = mkSd({ Attributes: 'Archive' });
      expect(service.securityDescriptorEquals(expected as any, actual as any).equal).toBe(true);
    });
  });

  // ═══════════════════ SID mapping rows (SID_MAP_*) ══════════════════════
  describe('SID mapping rows — exercise hasSecurityDescriptorChanged + mapper', () => {
    const sourcePath = '/src/file.txt';
    const targetPath = '/dst/file.txt';
    const ctxWithMapping = (jobRunId = 'wf-map'): any => ({
      jobRunId,
      jobConfig: { options: { isIdentityMappingAvailable: true } },
    });

    it('SID_MAP_1_NOOP_AFTER_BASELINE / row 40: mapped trustee, no mutation → equal=true (no drift, no log)', () => {
      // Regression guard against "comparator uses original SID instead of
      // mapped SID". After baseline migration, dest holds the mapped SID
      // and source still has the original. Mapping must translate before
      // compare or the gate will re-stamp on every incremental.
      const source = {
        Owner: SID.OWNER, Group: SID.GROUP,
        DaclAces: [{ Sid: SID.ACLMAP_U1_SRC, AccessMask: MASK.R, AceType: 0, AceFlags: 0, IsInherited: false, originalSid: '' }],
        Attributes: 'Archive', DaclPresent: true, DaclProtected: false, DaclAutoInherit: true,
        originalOwner: '', originalGroup: '',
      };
      const destination = {
        ...source,
        DaclAces: [{ Sid: SID.ACLMAP_U1_DST, AccessMask: MASK.R, AceType: 0, AceFlags: 0, IsInherited: false, originalSid: '' }],
      };
      jest.spyOn(winOperationService, 'getAclOperation').mockImplementation(async (_p, isSource) =>
        (isSource ? JSON.parse(JSON.stringify(source)) : destination) as any);
      jest.spyOn(winOperationService, 'getSIDMapping').mockImplementation(async (sid: string) =>
        sid === SID.ACLMAP_U1_SRC ? SID.ACLMAP_U1_DST : null);

      return service.hasSecurityDescriptorChanged(sourcePath, targetPath, ctxWithMapping()).then(changed => {
        expect(changed).toBe(false);
        expect(mockLogger.log).not.toHaveBeenCalled();
      });
    });

    it('SID_MAP_2_TRUSTEE_CHANGED / row 41: source swaps to a different mapped trustee → field=aceFieldDiff', () => {
      // Logical-identity drift across two mapped trustees: both
      // ACLMAP_U1 and ACLMAP_U2 are in the SID map; the source ACE now
      // names U2 while destination still has U1. Must fire even though
      // both SIDs are individually resolvable.
      const source = {
        Owner: SID.OWNER, Group: SID.GROUP,
        DaclAces: [{ Sid: SID.ACLMAP_U2_SRC, AccessMask: MASK.R, AceType: 0, AceFlags: 0, IsInherited: false, originalSid: '' }],
        Attributes: 'Archive', DaclPresent: true, DaclProtected: false, DaclAutoInherit: true,
        originalOwner: '', originalGroup: '',
      };
      const destination = {
        ...source,
        DaclAces: [{ Sid: SID.ACLMAP_U1_DST, AccessMask: MASK.R, AceType: 0, AceFlags: 0, IsInherited: false, originalSid: '' }],
      };
      jest.spyOn(winOperationService, 'getAclOperation').mockImplementation(async (_p, isSource) =>
        (isSource ? JSON.parse(JSON.stringify(source)) : destination) as any);
      jest.spyOn(winOperationService, 'getSIDMapping').mockImplementation(async (sid: string) => {
        if (sid === SID.ACLMAP_U1_SRC) return SID.ACLMAP_U1_DST;
        if (sid === SID.ACLMAP_U2_SRC) return SID.ACLMAP_U2_DST;
        return null;
      });

      return service.hasSecurityDescriptorChanged(sourcePath, targetPath, ctxWithMapping()).then(changed => {
        expect(changed).toBe(true);
        const msg = (mockLogger.log as jest.Mock).mock.calls[0][0];
        expect(msg).toContain('field=aceFieldDiff');
        // Expected (mapped) U2_DST present on source-side, actual is U1_DST on destination.
        expect(msg).toContain(SID.ACLMAP_U2_DST);
        expect(msg).toContain(SID.ACLMAP_U1_DST);
      });
    });
  });

  // ═══════════════════ Selection-layer / destination-only drift ══════════
  describe('Destination-only drift (SEL_DEST_ONLY_DRIFT)', () => {
    it('row 48 (SEL_DEST_ONLY_DRIFT): destination has extra ACE, source untouched → field=aceExtraOnDestination', () => {
      // Tests the gate's value-prop: even when source is byte-frozen since
      // baseline migration, the gate must catch ACEs *added on destination
      // out-of-band* (e.g., manual icacls grant by an admin).
      const expected = mkSd({
        DaclAces: [mkAce({ Sid: SID.USERS, AccessMask: MASK.R, AceFlags: FLAG.INHERITED })],
      });
      const actual = mkSd({
        DaclAces: [
          mkAce({ Sid: SID.USERS,         AccessMask: MASK.R, AceFlags: FLAG.INHERITED }),
          mkAce({ Sid: SID.ACLMAP_U1_DST, AccessMask: MASK.F, AceFlags: FLAG.NONE      }), // added on destination only
        ],
      });
      const result = service.securityDescriptorEquals(expected as any, actual as any);
      expect(result.equal).toBe(false);
      expect(result.reason?.field).toBe('aceExtraOnDestination');
      expect((result.reason?.actualValue as any).Sid).toBe(SID.ACLMAP_U1_DST);
    });
  });

  // ═════════════════ Out-of-scope rows (flagged, not implemented) ═════════
  describe.skip('Out-of-scope for this comparator suite (intentionally skipped)', () => {
    // The following scenarios in the plan exercise code paths *outside* the
    // comparator itself. They have coverage elsewhere (or require live NTFS
    // to be meaningful). Listed here as documentation so a reviewer can
    // confirm coverage source rather than misread the absence as a gap.

    // ── Group 8 — Error handling ──
    // S8.1 — Stamp failures. Covered by stampAclOperation tests; the gate
    //        does not produce stamp errors. Comparator is read-only.
    it('S8.1 Stamp failures — covered by stampAclOperation suite, not by comparator', () => undefined);

    // S8.2a — Post-stamp validation with SID mapping. Owned by
    //         validateAclOperation (subset-equality check), not the gate.
    it('S8.2a Post-stamp validation w/ SID mapping — see validateAclOperation tests', () => undefined);

    // S8.2b — Post-stamp validation without SID mapping. Same as above.
    it('S8.2b Post-stamp validation w/o SID mapping — see validateAclOperation tests', () => undefined);

    // S8.3 — Source/destination ACL fetch failures. Covered by the existing
    //        `propagates SourceAclError from getAclOperation` test in
    //        win-operation.service.spec.ts.
    it('S8.3 Source/destination fetch failures — see win-operation.service.spec.ts', () => undefined);

    // ── Selection-layer rows (rows 46, 47) ──
    // These exercise the *scan* and *change-detection* layers upstream of
    // the gate, not the comparator. Putting them here would conflate "did
    // the scanner pick this file for re-migration" with "does the gate
    // think the ACLs differ".
    it('SEL_CTIME_BUMP_ONLY (row 46) — scan/selection layer, not the comparator', () => undefined);
    it('SEL_CONTENT_CHANGE_ACL_CHANGED (row 47) — scan/selection layer, not the comparator', () => undefined);
  });
});
