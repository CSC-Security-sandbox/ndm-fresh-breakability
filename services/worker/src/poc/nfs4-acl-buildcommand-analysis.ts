/**
 * POC Experiment 3: buildCommand async refactor feasibility
 *
 * Key question: buildCommand() in command-generation.service.ts is currently SYNCHRONOUS.
 * Reading NFSv4 ACLs requires either:
 *   a) Sync call via koffi (koffi supports synchronous FFI calls) → NO refactor needed
 *   b) Async call (Promise) → requires refactoring buildCommand + all callers
 *
 * This file:
 *   1. Documents the SYNC vs ASYNC options with koffi
 *   2. Lists all callers of buildCommand that would need changes
 *   3. Shows exactly what the diff would look like for each option
 *   4. Provides a recommendation with rationale
 *
 * Run: npx ts-node src/poc/nfs4-acl-buildcommand-analysis.ts
 */

// ─── FINDING: koffi supports SYNCHRONOUS calls ───────────────────────────────
//
// koffi's default func() call IS synchronous — it blocks the calling thread
// until the native function returns. This is by design for FFI performance.
//
// See: https://koffi.dev/functions#synchronous-calls
//
// This means getNfs4AclXattr() in nfs4-acl-libc.ts is ALREADY synchronous.
// The koffi call to getxattr(2) on Linux is a simple syscall — microseconds.
//
// CONCLUSION: buildCommand() does NOT need to become async.
//             We can call getNfs4AclXattr() synchronously inside buildCommand().

// ─── Current buildCommand signature ──────────────────────────────────────────
//
// services/worker/src/activities/core/shared/command-generation.service.ts:451
//
//   buildCommand(sFile: fs.Stats, fPath: string, dFile?: fs.Stats, originalCommandId?: string): Cmd | undefined
//
// ─── Proposed change (Option A — SYNC, recommended) ─────────────────────────
//
//   buildCommand(
//     sFile: fs.Stats,
//     fPath: string,
//     dFile?: fs.Stats,
//     originalCommandId?: string,
//     absoluteSourcePath?: string,   // ← new: needed for getxattr call
//     protocolVersion?: string,      // ← new: to gate on NFSv4 only
//   ): Cmd | undefined
//
//   Inside the function, before building metadata:
//
//     let nfs4Acl: Nfs4AceText[] | undefined;
//     if (absoluteSourcePath && isNfsV4(protocolVersion) && jobConfig.options.preservePermissions) {
//       try {
//         const buf = getNfs4AclXattr(absoluteSourcePath); // ← sync koffi call
//         if (buf) {
//           const binaryAces = xdrDecodeAcl(buf);
//           nfs4Acl = binaryAces.map(binaryToText);
//         }
//       } catch (e) {
//         // Graceful degrade: log warning, nfs4Acl stays undefined
//         // POSIX chmod/chown will still run
//         this.logger.warn(`NFSv4 ACL read failed for ${absoluteSourcePath}: ${e.message}`);
//       }
//     }
//
//     const metadata: CmdMeta = {
//       ...existing fields...
//       nfs4Acl,  // ← new field on CmdMeta
//     };
//
// ─── Callers that need the new parameters passed ──────────────────────────────
//
// 1. processItems() in command-generation.service.ts
//    - Already has absoluteSourcePath and jobContext (with protocolVersion)
//    - Pass absoluteSourcePath and jobContext.jobConfig.sourceFileServer.protocolVersion
//    - CHANGE COMPLEXITY: LOW (same file, 2 extra args)
//
// 2. buildCommand() in migrate-scan.service.ts (local copy of same logic)
//    - Same change: add absoluteSourcePath + protocolVersion params
//    - CHANGE COMPLEXITY: LOW
//
// 3. buildResolvedCommand() — NOT affected (no metadata, no ACL needed)
//
// 4. Test mocks in *.spec.ts files:
//    - command-generation.service.spec.ts: ~15 calls to buildCommand
//    - migrate-scan.service.spec.ts: ~10 calls to buildCommand
//    - All these calls can simply omit the new optional params → no change needed
//    - CHANGE COMPLEXITY: ZERO (params are optional)
//
// ─── Total files changed for Option A ────────────────────────────────────────
//
//   services/worker/src/activities/core/shared/command-generation.service.ts  (1 change)
//   services/worker/src/activities/core/scan/migrate/migrate-scan.service.ts  (1 change)
//   lib/jobs-lib/src/datatype/stream-datatypes.ts                             (CmdMeta.nfs4Acl)
//   lib/jobs-lib/src/types/nfs4-acl.types.ts                                 (new file — already in poc/)
//
// ─── Option B (async buildCommand) — NOT recommended ─────────────────────────
//
//   async buildCommand(...): Promise<Cmd | undefined>
//
//   This would require:
//   - processItems() becomes async → scanDirectory() becomes async → ScanService async
//   - ~30 callers in test files need `await` added
//   - Temporal activity timeout behavior changes (async boundaries)
//   - No benefit: koffi is already sync; making it async just adds overhead
//
//   CHANGE COMPLEXITY: HIGH, HIGH RISK
//   VERDICT: Do NOT use Option B.
//
// ─── isNfsV4 helper (used in the guard) ──────────────────────────────────────

export function isNfsV4(protocolVersion?: string): boolean {
  if (!protocolVersion) return false;
  // Matches v4.0, v4.1, v4.2 (and any future v4.x)
  const normalized = protocolVersion.replace(/^v/i, '');
  return normalized.startsWith('4');
}

// ─── Minimal diff preview ─────────────────────────────────────────────────────

export function printDiff(): void {
  console.log(`
${'═'.repeat(70)}
EXPERIMENT 3: buildCommand async/sync analysis
${'═'.repeat(70)}

FINDING: koffi FFI calls are SYNCHRONOUS by default.
         getNfs4AclXattr() is already a sync function.
         buildCommand() does NOT need to become async.

RECOMMENDATION: Option A — keep buildCommand synchronous, add 2 optional params.

FILES TO CHANGE:
  1. lib/jobs-lib/src/datatype/stream-datatypes.ts
     + nfs4Acl?: Nfs4AceText[]    in CmdMeta interface

  2. lib/jobs-lib/src/types/nfs4-acl.types.ts
     (already created in poc/ — move to lib/jobs-lib/src/types/)

  3. services/worker/src/activities/core/shared/command-generation.service.ts
     - buildCommand(sFile, fPath, dFile?, originalCommandId?): Cmd
     + buildCommand(sFile, fPath, dFile?, originalCommandId?, absSourcePath?, protocolVersion?): Cmd
     + inject NfsAclService (new)
     + sync koffi call inside buildCommand if isNfsV4(protocolVersion)

  4. services/worker/src/activities/core/scan/migrate/migrate-scan.service.ts
     - Same 2-param addition, same sync call pattern

TEST IMPACT:
  - All existing test calls use positional args with only 2-4 args → new optional
    params are never passed → ZERO test changes needed for existing tests
  - New tests for NFSv4 path will be added separately (Phase 9)

RISK: LOW
EFFORT IMPACT: No change to estimate (already accounted for in Phase 3)
${'═'.repeat(70)}
`);
}

// ─── Verify isNfsV4 helper correctness ───────────────────────────────────────

function runSelfTest(): void {
  const cases: Array<[string | undefined, boolean]> = [
    ['v4.0', true],
    ['v4.1', true],
    ['v4.2', true],
    ['4.1',  true],
    ['v3',   false],
    ['v3.0', false],
    [undefined, false],
    ['',    false],
    ['v2',  false],
  ];

  let passed = 0;
  let failed = 0;
  for (const [input, expected] of cases) {
    const actual = isNfsV4(input);
    if (actual === expected) {
      console.log(`  PASS isNfsV4(${JSON.stringify(input)}) = ${actual}`);
      passed++;
    } else {
      console.error(`  FAIL isNfsV4(${JSON.stringify(input)}) expected=${expected} got=${actual}`);
      failed++;
    }
  }
  console.log(`\n  isNfsV4 self-test: ${passed} passed, ${failed} failed`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

printDiff();
console.log('── isNfsV4 helper self-test:');
runSelfTest();
