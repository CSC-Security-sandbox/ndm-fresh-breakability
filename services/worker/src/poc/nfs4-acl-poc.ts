#!/usr/bin/env ts-node
/**
 * POC: NFSv4 ACL Round-Trip + Performance Benchmark
 *
 * Experiments 1 + 2 combined.
 *
 * Usage (must run as root on a Linux machine with NFSv4 mounts):
 *   npx ts-node src/poc/nfs4-acl-poc.ts <sourcePath> <targetPath> [--bench N]
 *
 * Arguments:
 *   sourcePath   Path to a file/dir on the SOURCE NFSv4 mount
 *   targetPath   Path to a file/dir on the TARGET NFSv4 mount (same name, already copied)
 *   --bench N    Run the benchmark against N files in the same directory as sourcePath
 *
 * What it tests (Experiment 1 — round-trip fidelity):
 *   1. Read system.nfs4_acl xattr from sourcePath via koffi → libc getxattr
 *   2. XDR-decode the binary buffer → Nfs4AceBinary[]
 *   3. Convert to Nfs4AceText[] (human-readable)
 *   4. Convert back to Nfs4AceBinary[] (round-trip within memory)
 *   5. XDR-encode back to Buffer
 *   6. Write to targetPath via koffi → libc setxattr
 *   7. Read back from targetPath and compare source vs target ACEs
 *   8. Report: matched ACEs, missing ACEs, extra ACEs, latency
 *
 * What it tests (Experiment 2 — performance):
 *   With --bench N, runs getxattr + setxattr for N files and measures:
 *   - Total elapsed time
 *   - Per-file average latency
 *   - P50, P95, P99 latency
 *   - Whether a persistent shell pool is needed (compare to WinShellService baseline)
 */

import * as fs from 'fs';
import * as path from 'path';
import { initLibcXattr, getNfs4AclXattr, setNfs4AclXattr } from './nfs4-acl-libc';
import { xdrDecodeAcl, xdrEncodeAcl, binaryToText, textToBinary, summarizeAces } from './nfs4-acl-xdr';
import { Nfs4AceText, Nfs4ValidatorOutput, NFS4_SPECIAL_PRINCIPALS } from './nfs4-acl-types';

// ─── CLI argument parsing ─────────────────────────────────────────────────────

function parseArgs(): { sourcePath: string; targetPath: string; benchN: number } {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: npx ts-node src/poc/nfs4-acl-poc.ts <sourcePath> <targetPath> [--bench N]');
    process.exit(1);
  }
  const sourcePath = args[0];
  const targetPath = args[1];
  let benchN = 0;
  const benchIdx = args.indexOf('--bench');
  if (benchIdx !== -1 && args[benchIdx + 1]) {
    benchN = parseInt(args[benchIdx + 1], 10);
  }
  return { sourcePath, targetPath, benchN };
}

// ─── Experiment 1: Round-trip fidelity ───────────────────────────────────────

interface RoundTripResult {
  filePath: string;
  sourceAces: Nfs4AceText[];
  targetAces: Nfs4AceText[];
  validation: Nfs4ValidatorOutput;
  readLatencyMs: number;
  writeLatencyMs: number;
  readBackLatencyMs: number;
  totalLatencyMs: number;
  rawSourceBuf: Buffer | null;
  rawTargetBuf: Buffer | null;
}

function validateAces(source: Nfs4AceText[], target: Nfs4AceText[]): Nfs4ValidatorOutput {
  const output: Nfs4ValidatorOutput = {
    sourceAcl: summarizeAces(source),
    targetAcl: summarizeAces(target),
    invalid: '',
  };

  // Only validate Allow (A) and Deny (D) ACEs — mirrors Windows validateAclOperation
  const srcAces = source.filter(a => a.type === 'A' || a.type === 'D');
  const tgtAces = target.filter(a => a.type === 'A' || a.type === 'D');

  for (const src of srcAces) {
    const match = tgtAces.find(
      tgt => tgt.type === src.type &&
             tgt.flags === src.flags &&
             tgt.principal === src.principal &&
             tgt.permissions === src.permissions
    );
    if (!match) {
      output.invalid += `Missing ACE in target: ${src.type}:${src.flags}:${src.principal}:${src.permissions}. `;
    }
  }

  // Check for extra ACEs on target that aren't in source (unexpected additions)
  for (const tgt of tgtAces) {
    const match = srcAces.find(
      src => src.type === tgt.type &&
             src.flags === tgt.flags &&
             src.principal === tgt.principal &&
             src.permissions === tgt.permissions
    );
    if (!match) {
      output.invalid += `Extra ACE on target not in source: ${tgt.type}:${tgt.flags}:${tgt.principal}:${tgt.permissions}. `;
    }
  }

  return output;
}

async function runRoundTrip(sourcePath: string, targetPath: string): Promise<RoundTripResult> {
  const result: RoundTripResult = {
    filePath: sourcePath,
    sourceAces: [],
    targetAces: [],
    validation: { sourceAcl: '', targetAcl: '', invalid: '' },
    readLatencyMs: 0,
    writeLatencyMs: 0,
    readBackLatencyMs: 0,
    totalLatencyMs: 0,
    rawSourceBuf: null,
    rawTargetBuf: null,
  };

  const totalStart = Date.now();

  // ── Step 1: Read source ACL ───────────────────────────────────────────────
  const readStart = Date.now();
  const sourceBuf = getNfs4AclXattr(sourcePath);
  result.readLatencyMs = Date.now() - readStart;
  result.rawSourceBuf = sourceBuf;

  if (!sourceBuf) {
    console.log(`  [WARN] No system.nfs4_acl xattr on source: ${sourcePath}`);
    console.log(`         This means either:`);
    console.log(`           a) The NFS server does not export NFSv4 ACLs via xattr`);
    console.log(`           b) The mount option 'acl' is missing`);
    console.log(`           c) All ACEs are default (implicit mode-bit-only)`);
    result.totalLatencyMs = Date.now() - totalStart;
    return result;
  }

  console.log(`  [READ]  source xattr size: ${sourceBuf.length} bytes`);
  console.log(`  [READ]  raw hex (first 64 bytes): ${sourceBuf.subarray(0, 64).toString('hex')}`);

  // ── Step 2: XDR decode ────────────────────────────────────────────────────
  let sourceBinaryAces;
  try {
    sourceBinaryAces = xdrDecodeAcl(sourceBuf);
  } catch (err) {
    console.error(`  [ERROR] XDR decode failed: ${err.message}`);
    console.error(`          Raw buffer: ${sourceBuf.toString('hex')}`);
    result.totalLatencyMs = Date.now() - totalStart;
    return result;
  }

  result.sourceAces = sourceBinaryAces.map(binaryToText);
  console.log(`  [PARSE] decoded ${result.sourceAces.length} ACEs:`);
  result.sourceAces.forEach((ace, i) => {
    console.log(`          [${i}] ${ace.type}:${ace.flags}:${ace.principal}:${ace.permissions}`);
  });

  // ── Step 3: In-memory round-trip (text → binary → buffer) ─────────────────
  const reBinary = result.sourceAces.map(textToBinary);
  const reEncoded = xdrEncodeAcl(reBinary);
  const reDecoded = xdrDecodeAcl(reEncoded).map(binaryToText);

  const inMemoryMismatch = reDecoded.filter((ace, i) => {
    const orig = result.sourceAces[i];
    return !orig ||
      ace.type !== orig.type ||
      ace.flags !== orig.flags ||
      ace.principal !== orig.principal ||
      ace.permissions !== orig.permissions;
  });

  if (inMemoryMismatch.length === 0 && reDecoded.length === result.sourceAces.length) {
    console.log(`  [CODEC] In-memory round-trip: OK (${result.sourceAces.length} ACEs preserved exactly)`);
  } else {
    console.warn(`  [CODEC] In-memory round-trip MISMATCH: ${inMemoryMismatch.length} ACEs differ`);
    inMemoryMismatch.forEach(ace => console.warn(`          mismatched: ${ace.type}:${ace.flags}:${ace.principal}:${ace.permissions}`));
  }

  // Verify XDR buffer sizes match
  if (reEncoded.length === sourceBuf.length) {
    console.log(`  [CODEC] Re-encoded buffer size matches original: ${reEncoded.length} bytes`);
  } else {
    console.warn(`  [CODEC] Buffer size mismatch: original=${sourceBuf.length} re-encoded=${reEncoded.length}`);
  }

  // ── Step 4: Write to target ───────────────────────────────────────────────
  const writeStart = Date.now();
  try {
    setNfs4AclXattr(targetPath, reEncoded);
    result.writeLatencyMs = Date.now() - writeStart;
    console.log(`  [WRITE] setxattr on target: OK (${result.writeLatencyMs}ms)`);
  } catch (err) {
    result.writeLatencyMs = Date.now() - writeStart;
    console.error(`  [ERROR] setxattr failed: ${err.message}`);
    result.totalLatencyMs = Date.now() - totalStart;
    return result;
  }

  // ── Step 5: Read back from target and validate ────────────────────────────
  const readBackStart = Date.now();
  const targetBuf = getNfs4AclXattr(targetPath);
  result.readBackLatencyMs = Date.now() - readBackStart;
  result.rawTargetBuf = targetBuf;

  if (!targetBuf) {
    console.error(`  [ERROR] getxattr on target returned null after successful setxattr`);
    result.totalLatencyMs = Date.now() - totalStart;
    return result;
  }

  let targetBinaryAces;
  try {
    targetBinaryAces = xdrDecodeAcl(targetBuf);
  } catch (err) {
    console.error(`  [ERROR] XDR decode of target failed: ${err.message}`);
    result.totalLatencyMs = Date.now() - totalStart;
    return result;
  }

  result.targetAces = targetBinaryAces.map(binaryToText);
  console.log(`  [VERIFY] target has ${result.targetAces.length} ACEs after write`);
  result.targetAces.forEach((ace, i) => {
    console.log(`           [${i}] ${ace.type}:${ace.flags}:${ace.principal}:${ace.permissions}`);
  });

  // ── Step 6: Compare source vs target ─────────────────────────────────────
  result.validation = validateAces(result.sourceAces, result.targetAces);
  result.totalLatencyMs = Date.now() - totalStart;

  return result;
}

// ─── Experiment 2: Performance benchmark ─────────────────────────────────────

interface BenchmarkResult {
  fileCount: number;
  successCount: number;
  failCount: number;
  noAclCount: number;
  totalMs: number;
  perFileMs: number[];
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
}

async function runBenchmark(sourceDir: string, targetDir: string, n: number): Promise<BenchmarkResult> {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`EXPERIMENT 2: Performance Benchmark (${n} files)`);
  console.log(`${'─'.repeat(60)}`);

  const result: BenchmarkResult = {
    fileCount: 0,
    successCount: 0,
    failCount: 0,
    noAclCount: 0,
    totalMs: 0,
    perFileMs: [],
    p50Ms: 0,
    p95Ms: 0,
    p99Ms: 0,
    avgMs: 0,
    minMs: 0,
    maxMs: 0,
  };

  let entries: string[];
  try {
    entries = fs.readdirSync(sourceDir).slice(0, n);
  } catch (err) {
    console.error(`Cannot read source directory ${sourceDir}: ${err.message}`);
    return result;
  }

  const benchStart = Date.now();

  for (const entry of entries) {
    const srcPath = path.join(sourceDir, entry);
    const tgtPath = path.join(targetDir, entry);

    // Skip if target doesn't exist
    if (!fs.existsSync(tgtPath)) {
      console.log(`  [SKIP] Target not found: ${tgtPath}`);
      continue;
    }

    result.fileCount++;
    const fileStart = Date.now();

    try {
      const buf = getNfs4AclXattr(srcPath);
      if (!buf) {
        result.noAclCount++;
        const elapsed = Date.now() - fileStart;
        result.perFileMs.push(elapsed);
        continue;
      }

      const aces = xdrDecodeAcl(buf);
      const reEncoded = xdrEncodeAcl(aces);
      setNfs4AclXattr(tgtPath, reEncoded);

      const elapsed = Date.now() - fileStart;
      result.perFileMs.push(elapsed);
      result.successCount++;
    } catch (err) {
      const elapsed = Date.now() - fileStart;
      result.perFileMs.push(elapsed);
      result.failCount++;
      console.error(`  [FAIL] ${entry}: ${err.message}`);
    }
  }

  result.totalMs = Date.now() - benchStart;

  if (result.perFileMs.length > 0) {
    const sorted = [...result.perFileMs].sort((a, b) => a - b);
    result.minMs = sorted[0];
    result.maxMs = sorted[sorted.length - 1];
    result.avgMs = Math.round(result.perFileMs.reduce((s, v) => s + v, 0) / result.perFileMs.length);
    result.p50Ms = sorted[Math.floor(sorted.length * 0.50)];
    result.p95Ms = sorted[Math.floor(sorted.length * 0.95)];
    result.p99Ms = sorted[Math.floor(sorted.length * 0.99)];
  }

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { sourcePath, targetPath, benchN } = parseArgs();

  // Initialize libc bindings (mirrors WinOperationService.initializeWindowsAPI pattern)
  try {
    initLibcXattr();
    console.log('[INIT] koffi → libc.so.6 xattr bindings loaded successfully');
  } catch (err) {
    console.error(`[FATAL] Failed to load libc via koffi: ${err.message}`);
    console.error(`        Ensure this is running on Linux as root.`);
    process.exit(1);
  }

  // ─── Experiment 1: Single file round-trip ──────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`EXPERIMENT 1: NFSv4 ACL Round-Trip Fidelity`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`Source: ${sourcePath}`);
  console.log(`Target: ${targetPath}`);
  console.log(`${'─'.repeat(60)}\n`);

  const rtResult = await runRoundTrip(sourcePath, targetPath);

  console.log(`\n── RESULTS ──`);
  if (!rtResult.rawSourceBuf) {
    console.log(`OUTCOME: No NFSv4 ACL xattr on source — server does not expose system.nfs4_acl`);
    console.log(`ACTION : Fall back to POSIX chmod/chown only. No ACL stamping needed/possible.`);
  } else if (rtResult.validation.invalid === '') {
    console.log(`OUTCOME: PASS — All ACEs round-tripped perfectly`);
    console.log(`         Source: ${rtResult.validation.sourceAcl}`);
    console.log(`         Target: ${rtResult.validation.targetAcl}`);
  } else {
    console.log(`OUTCOME: FAIL — ACE mismatches detected`);
    console.log(`         Mismatches: ${rtResult.validation.invalid}`);
    console.log(`         Source ACL: ${rtResult.validation.sourceAcl}`);
    console.log(`         Target ACL: ${rtResult.validation.targetAcl}`);
  }

  console.log(`\n── LATENCY (single file) ──`);
  console.log(`  getxattr (read source):  ${rtResult.readLatencyMs}ms`);
  console.log(`  setxattr (write target): ${rtResult.writeLatencyMs}ms`);
  console.log(`  getxattr (read back):    ${rtResult.readBackLatencyMs}ms`);
  console.log(`  Total:                   ${rtResult.totalLatencyMs}ms`);

  // ─── Experiment 2: Benchmark (optional) ───────────────────────────────────
  if (benchN > 0) {
    const sourceDir = path.dirname(sourcePath);
    const targetDir = path.dirname(targetPath);

    const bench = await runBenchmark(sourceDir, targetDir, benchN);

    console.log(`\n── BENCHMARK RESULTS (${bench.fileCount} files processed) ──`);
    console.log(`  Total time:       ${bench.totalMs}ms`);
    console.log(`  Success:          ${bench.successCount}`);
    console.log(`  No ACL (skipped): ${bench.noAclCount}`);
    console.log(`  Failed:           ${bench.failCount}`);
    console.log(`\n  Per-file latency (getxattr + XDR decode/encode + setxattr):`);
    console.log(`    avg:  ${bench.avgMs}ms`);
    console.log(`    min:  ${bench.minMs}ms`);
    console.log(`    max:  ${bench.maxMs}ms`);
    console.log(`    p50:  ${bench.p50Ms}ms`);
    console.log(`    p95:  ${bench.p95Ms}ms`);
    console.log(`    p99:  ${bench.p99Ms}ms`);

    console.log(`\n── VERDICT ──`);
    if (bench.avgMs < 5) {
      console.log(`VERDICT: koffi syscall is fast (avg ${bench.avgMs}ms). NO persistent shell pool needed.`);
      console.log(`         This is much faster than WinShellService PowerShell pool (typically 50-200ms/op).`);
    } else if (bench.avgMs < 50) {
      console.log(`VERDICT: koffi syscall is acceptable (avg ${bench.avgMs}ms). Monitor at production scale.`);
    } else {
      console.log(`VERDICT: High latency detected (avg ${bench.avgMs}ms). Investigate NFS mount performance.`);
      console.log(`         Consider: async parallel processing (already used in existing stamp phase).`);
    }

    // Compare to Windows PowerShell shell baseline
    console.log(`\n── COMPARISON TO SMB/WINDOWS BASELINE ──`);
    console.log(`  Windows PowerShell ACL op (typical): 50-200ms (WinShellService pool)`);
    console.log(`  NFS koffi getxattr+setxattr (this):  avg ${bench.avgMs}ms`);
    console.log(`  Speedup factor:                       ~${Math.round(100 / Math.max(bench.avgMs, 1))}x faster than Windows path`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`POC Complete. See findings above to update effort estimates.`);
  console.log(`${'─'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
