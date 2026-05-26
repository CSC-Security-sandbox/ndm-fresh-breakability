package utils

// =============================================================================
// ACL Mismatch Detection — Helpers for TC-ACL-MISMATCH
// =============================================================================
//
// This file contains everything the TC-ACL-MISMATCH test needs that is
// specific to ACL mismatch / Change-on-Change (CoC) detection. The general
// SMB/permission helpers used by the test (CreateFileServer, GetSMBFilePermissionsComprehensive,
// CompareSMBPermissions, sshRunScript, etc.) live in permissions_manager.go
// and jobs.go and are reused as-is.
//
// What's here:
//   1. AclMismatchScenario type + AclMismatchScenarios catalog (39 rows)
//   2. CreateSMBFilesForAclMismatchTest — baseline seeder
//   3. MutateSMBFilesForAclMismatchTest — applies one mutation per scenario
//   4. BuildExpectedMutatedSet / BuildExpectedControlSet
//   5. ExtractSourcePathsFromCocCSV — parses CoC report bytes for re-migrated paths
//   6. Fallback comparator: CompareSourceAndDestinationForScenario
//
// See: MD/ACL/plan.md and MD/ACL/test-scenarios-acl-comparator.md
// =============================================================================

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"fmt"
	"io"
	"path"
	"strings"
)

// AclMismatchVerdict captures the expected per-file comparator verdict.
type AclMismatchVerdict int

const (
	// VerdictMatch — control files; comparator must report no mismatch.
	VerdictMatch AclMismatchVerdict = iota
	// VerdictMismatch — mutated files; comparator must flag the divergence.
	VerdictMismatch
)

// MutationTarget tells the harness which share the mutation applies to.
// Defaults to TargetSource for every scenario except row 48 (SEL_DEST_ONLY_DRIFT).
type MutationTarget int

const (
	TargetSource MutationTarget = iota
	TargetDestination
)

// AclMismatchScenario describes one file under acl_mismatch_test/ in the
// source share. The test harness iterates over AclMismatchScenarios to build
// the expected mutated/control path sets and to validate per-file outcomes.
type AclMismatchScenario struct {
	ID                string             // e.g. "S09_ACE_ADD"
	RelPath           string             // path relative to <export>/acl_mismatch_test/, forward-slash style
	Verdict           AclMismatchVerdict // expected comparator verdict after the ad-hoc re-run
	ExpectedReasonSub string             // substring expected in the comparator's mismatch reason; "" for VerdictMatch
	IsControl         bool               // true → file must NOT be re-migrated by the ad-hoc run
	MutationTarget    MutationTarget     // TargetSource for rows 1-47, TargetDestination for row 48 only
	IsExpectedFailure bool               // true → known divergence between expected outcome and current product behavior; misses logged as XFAIL not FAIL
	Notes             string             // human-readable note (kept for log output / future report rows)
}

// AclMismatchTestRoot is the directory under the share where the entire tree
// lives. Kept short so cmd /C command lines stay well under length limits.
const AclMismatchTestRoot = "acl_mismatch_test"

// SID-mapping AD users (rows 40, 41). Created at the top of the seeder script,
// deleted at the end of the mutator script. Idempotent (drop-and-recreate).
// Kept inline rather than env-driven so the test is hermetic.
const (
	SidMapAdUser1     = "aclmap_u1"
	SidMapAdUser2     = "aclmap_u2"
	SidMapAdPassword  = "TestP@ssw0rd!"
	SidMapAdDomainStr = "ROOTDOMAIN" // SAM-style prefix for ACE entries
)

// AclMismatchScenarios is the canonical catalog (44 scenarios, serial 1–44).
//
// Removed (ONTAP does not persist over SMB):
//   - DaclAutoInherit (SE_DACL_AUTO_INHERITED) — SetFileSecurity silently ignored
//   - NotContentIndexed (0x2000), Temporary (0x0100) — SetAttributes silently ignored
var AclMismatchScenarios = []AclMismatchScenario{
	// 1–3: Controls — no mutation, must NOT re-migrate
	{ID: "S01_CTRL_OWNER", RelPath: "control/S01_ctrl_owner.txt", Verdict: VerdictMatch, IsControl: true, Notes: "Baseline: Owner=Administrators, Everyone:M. Mutation: none."},
	{ID: "S02_CTRL_DACL", RelPath: "control/S02_ctrl_dacl.txt", Verdict: VerdictMatch, IsControl: true, Notes: "Baseline: Everyone:M. Mutation: none."},
	{ID: "S03_CTRL_ATTRS", RelPath: "control/S03_ctrl_attrs.txt", Verdict: VerdictMatch, IsControl: true, Notes: "Baseline: default attrs. Mutation: none."},

	// 4–5: Owner
	{ID: "S04_OWNER_TO_USERS", RelPath: "owner/S04_owner_to_users.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "owner", Notes: "Baseline: Owner=Administrators. Mutation: Owner→BUILTIN\\Users."},
	{ID: "S05_OWNER_TO_SYSTEM", RelPath: "owner/S05_owner_to_system.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "owner", Notes: "Baseline: Owner=Administrators. Mutation: Owner→NT AUTHORITY\\SYSTEM."},

	// 6: Group
	{ID: "S06_GROUP_CHANGE", RelPath: "group/S06_group_change.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "group", Notes: "Baseline: Group=None. Mutation: Group→BUILTIN\\Users."},

	// 7–8: DACL order
	{ID: "S07_ORDER_DENY_BEFORE_ALLOW", RelPath: "dacl_order/S07_deny_before_allow.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "order", Notes: "Baseline: Deny Users:W, Allow Admins:R (canonical). Mutation: swap to Allow-first, Deny-second."},
	{ID: "S08_ORDER_DENY_BEFORE_ALLOW_2", RelPath: "dacl_order/S08_order_swap.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "order", Notes: "Baseline: Deny Users:W, Allow Admins:R (canonical). Mutation: swap to Allow-first, Deny-second."},

	// 9–17: DACL membership
	{ID: "S09_ACE_ADD", RelPath: "dacl_membership/S09_ace_add.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "ace", Notes: "Baseline: Everyone:M. Mutation: add Users:R."},
	{ID: "S10_ACE_REMOVE", RelPath: "dacl_membership/S10_ace_remove.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "ace", Notes: "Baseline: Everyone:M + Users:R. Mutation: remove Users."},
	{ID: "S11_ACE_SID_SWAP", RelPath: "dacl_membership/S11_ace_sid_swap.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "ace", Notes: "Baseline: Users:R. Mutation: replace Users→Administrators:R."},
	{ID: "S12_ACE_TYPE_FLIP", RelPath: "dacl_membership/S12_ace_type_flip.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "type", Notes: "Baseline: Allow Users:R. Mutation: flip to Deny Users:R."},
	{ID: "S13_ALLOW_TO_DENY", RelPath: "dacl_membership/S13_allow_to_deny.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "type", Notes: "Baseline: Allow Users:R. Mutation: remove + deny Users:R."},
	{ID: "S14_DENY_TO_ALLOW", RelPath: "dacl_membership/S14_deny_to_allow.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "type", Notes: "Baseline: Deny Users:R. Mutation: remove deny + grant Users:R."},
	{ID: "S15_CREATOR_OWNER_ADD", RelPath: "dacl_membership/S15_creator_owner_add", Verdict: VerdictMismatch, ExpectedReasonSub: "ace", Notes: "Baseline: Everyone:(OI)(CI)F. Mutation: add CREATOR OWNER:(OI)(CI)(IO)F."},
	{ID: "S16_CREATOR_OWNER_REMOVE", RelPath: "dacl_membership/S16_creator_owner_remove", Verdict: VerdictMismatch, ExpectedReasonSub: "ace", Notes: "Baseline: CREATOR OWNER + Everyone:(OI)(CI)F. Mutation: remove CREATOR OWNER."},
	{ID: "S17_MASS_RESET", RelPath: "dacl_membership/S17_mass_reset.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "ace", Notes: "Baseline: 5 explicit ACEs. Mutation: icacls /reset (inherited-only)."},

	// 18–21: DACL access mask
	{ID: "S18_MASK_GROW", RelPath: "dacl_mask/S18_mask_grow.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "mask", Notes: "Baseline: Everyone:R. Mutation: Everyone:R→F."},
	{ID: "S19_MASK_SHRINK", RelPath: "dacl_mask/S19_mask_shrink.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "mask", Notes: "Baseline: Everyone:F. Mutation: Everyone:F→R."},
	{ID: "S20_DENY_ADD", RelPath: "dacl_mask/S20_deny_add.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "ace", Notes: "Baseline: Allow Users:F. Mutation: add Deny Users:W."},
	{ID: "S21_DENY_REMOVE", RelPath: "dacl_mask/S21_deny_remove.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "ace", Notes: "Baseline: Deny Users:W + Allow Users:F. Mutation: remove deny."},

	// 22–27: DACL flags
	{ID: "S22_OI_DROP", RelPath: "dacl_flags/S22_oi_drop", Verdict: VerdictMismatch, ExpectedReasonSub: "flag", Notes: "Baseline: explicit Users:(OI)(CI)F on dir. Mutation: re-grant Users:(CI)F (drop OI)."},
	{ID: "S23_CI_DROP", RelPath: "dacl_flags/S23_ci_drop", Verdict: VerdictMismatch, ExpectedReasonSub: "flag", Notes: "Baseline: explicit Users:(OI)(CI)F on dir. Mutation: re-grant Users:(OI)F (drop CI)."},
	{ID: "S24_IO_ADD", RelPath: "dacl_flags/S24_io_add", Verdict: VerdictMismatch, ExpectedReasonSub: "flag", Notes: "Baseline: Users:(OI)(CI)F. Mutation: re-grant Users:(OI)(CI)(IO)F."},
	{ID: "S25_NP_ADD", RelPath: "dacl_flags/S25_np_add", Verdict: VerdictMismatch, ExpectedReasonSub: "flag", Notes: "Baseline: Users:(OI)(CI)F. Mutation: re-grant Users:(OI)(CI)(NP)F."},
	{ID: "S26_ALL_FLAGS_CLEARED", RelPath: "dacl_flags/S26_all_flags_cleared", Verdict: VerdictMismatch, ExpectedReasonSub: "flag", Notes: "Baseline: Users:(OI)(CI)F. Mutation: re-grant Users:F (no flags)."},
	{ID: "S27_INHERITED_BIT_FLIPPED", RelPath: "dacl_flags/S27_inherited_bit_flipped/file.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "flag", Notes: "Baseline: explicit Users:M (/inheritance:r). Mutation: /inheritance:e + remove explicit."},

	// 28–30: DACL present
	// S28 commented out — stamper always forces DaclPresent=true; ONTAP can't reproduce NULL DACL via SMB stamp, causing perpetual idempotency re-migration
	// {ID: "S28_NULL_DACL", RelPath: "dacl_present/S28_null_dacl.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "dacl", Notes: "Baseline: Everyone:M. Mutation: SDDL D:NO_ACCESS_CONTROL (NULL DACL)."},
	{ID: "S29_EMPTY_DACL", RelPath: "dacl_present/S29_empty_dacl.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "dacl", Notes: "Baseline: Everyone:M. Mutation: SDDL D: (empty DACL)."},
	// S30 commented out — pending product fix for DaclPresent bit comparison
	// {ID: "S30_NULL_VS_EMPTY_DACL", RelPath: "dacl_present/S30_null_vs_empty.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "dacl", IsExpectedFailure: true, Notes: "Baseline: NULL DACL. Mutation: empty DACL. XFAIL: comparator doesn't check DaclPresent bit."},

	// 31–33: DACL protected
	{ID: "S31_PROTECTED_ENABLE", RelPath: "dacl_protected/S31_protected_enable/file.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "protected", Notes: "Baseline: inheritance enabled. Mutation: /inheritance:r + grant Users:R (disable inheritance, keep 1 explicit ACE)."},
	{ID: "S32_PROTECTED_DISABLE", RelPath: "dacl_protected/S32_protected_disable/file.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "protected", Notes: "Baseline: inheritance disabled, Everyone:M. Mutation: /inheritance:e (re-enable)."},
	{ID: "S33_INHERITANCE_R_DROPS", RelPath: "dacl_protected/S33_inheritance_r_drops/file.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "protected", Notes: "Baseline: explicit + inherited ACEs. Mutation: /inheritance:r (drops inherited)."},

	// 34–39: Attributes (Tier-1 only)
	{ID: "S34_READONLY_ADD", RelPath: "attributes/S34_readonly_add.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "attribute", Notes: "Baseline: Archive (default). Mutation: +ReadOnly."},
	{ID: "S35_READONLY_REMOVE", RelPath: "attributes/S35_readonly_remove.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "attribute", Notes: "Baseline: Archive+ReadOnly. Mutation: -ReadOnly."},
	{ID: "S36_HIDDEN_ADD", RelPath: "attributes/S36_hidden_add.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "attribute", Notes: "Baseline: Archive (default). Mutation: +Hidden."},
	{ID: "S37_SYSTEM_ADD", RelPath: "attributes/S37_system_add.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "attribute", Notes: "Baseline: Archive+Hidden. Mutation: +System (super-hidden)."},
	{ID: "S38_MULTI_BIT", RelPath: "attributes/S38_multi_bit.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "attribute", Notes: "Baseline: Archive (default). Mutation: +ReadOnly +Hidden."},
	{ID: "S39_ARCHIVE_REMOVE", RelPath: "attributes/S39_archive_remove.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "attribute", Notes: "Baseline: Archive (default). Mutation: -Archive."},

	// 40–41: SID-mapping
	{ID: "S40_SID_MAP_NOOP", RelPath: "sid_mapping/S40_sid_map_noop.txt", Verdict: VerdictMatch, IsControl: true, Notes: "Baseline: grant aclmap_u1:R. Mutation: none. Must NOT re-migrate."},
	{ID: "S41_SID_MAP_CHANGED", RelPath: "sid_mapping/S41_sid_map_changed.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "ace", Notes: "Baseline: grant aclmap_u1:R. Mutation: swap aclmap_u1→aclmap_u2."},

	// 42–43: Selection-layer
	{ID: "S42_CTIME_BUMP_ONLY", RelPath: "selection/S42_ctime_bump.txt", Verdict: VerdictMatch, IsControl: true, Notes: "Baseline: content 'v1'. Mutation: Set-Acl identical ACL (ctime bump only). Must NOT re-migrate."},
	{ID: "S43_CONTENT_AND_ACL", RelPath: "selection/S43_content_and_acl.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "ace", Notes: "Baseline: content 'v1'. Mutation: content→'v2' + add ACE."},

	// 44: Destination-drift canary
	{ID: "S44_DEST_ONLY_DRIFT", RelPath: "selection/S44_dest_only_drift.txt", Verdict: VerdictMismatch, ExpectedReasonSub: "ace", MutationTarget: TargetDestination, Notes: "Baseline: content 'v1'. Mutation: icacls /grant on dest only."},
}

// =============================================================================
// 1. PATH-SET BUILDERS
// =============================================================================
// These return the source-relative path strings the migration report uses
// (backslash-separated, with the test root as the leaf-most folder of the
// share, e.g. "acl_mismatch_test\owner\S04_owner_to_users.txt").
// They feed validation assertions.

// BuildExpectedMutatedSet returns the set of report-style source paths that
// the ad-hoc re-run is expected to re-migrate. Excludes IsExpectedFailure
// rows so they don't count against pass/fail (they're surfaced separately).
func BuildExpectedMutatedSet() []string {
	out := make([]string, 0, len(AclMismatchScenarios))
	for _, sc := range AclMismatchScenarios {
		if sc.IsControl || sc.IsExpectedFailure {
			continue
		}
		out = append(out, scenarioReportPath(sc))
	}
	return out
}

// BuildExpectedFailureSet returns scenarios tagged as known divergences from
// current product behavior. The test harness logs misses on these as XFAIL
// rather than FAIL.
func BuildExpectedFailureSet() []AclMismatchScenario {
	out := make([]AclMismatchScenario, 0)
	for _, sc := range AclMismatchScenarios {
		if sc.IsExpectedFailure {
			out = append(out, sc)
		}
	}
	return out
}

// BuildExpectedControlSet returns the set of report-style source paths that
// the ad-hoc re-run must NOT re-migrate.
func BuildExpectedControlSet() []string {
	out := make([]string, 0)
	for _, sc := range AclMismatchScenarios {
		if !sc.IsControl {
			continue
		}
		out = append(out, scenarioReportPath(sc))
	}
	return out
}

func scenarioReportPath(sc AclMismatchScenario) string {
	// Migration report uses Windows-style backslash separators.
	rel := strings.ReplaceAll(sc.RelPath, "/", `\`)
	return fmt.Sprintf(`%s\%s`, AclMismatchTestRoot, rel)
}

// =============================================================================
// 2. REPORT PARSING (validation signal)
// =============================================================================

// FetchCocReportBytes is an exported wrapper around fetchCocCSV so external
// packages (e.g. the e2e test) can pull the raw ZIP archive without going
// through ValidateReport (which compares against a golden JSON we don't have
// for the ACL mismatch suite).
func FetchCocReportBytes(jobRunID string) ([]byte, error) {
	return fetchCocCSV(jobRunID)
}

// ExtractSourcePathsFromCocCSV reads a ZIP archive returned by fetchCocCSV
// and extracts every "Source Path" cell from the contained "coc-report.csv".
//
// The archive typically contains multiple CSVs (coc-report.csv, list CSVs,
// possibly a summary or numbered duplicate). We match on base name == "coc-report.csv"
// to mirror pickCSVForValidation/countCocBundleCSVRows in report_validator.go.
// Logs every CSV's base name + row count for debuggability when the report is
// unexpectedly empty.
func ExtractSourcePathsFromCocCSV(zipBytes []byte) ([]string, error) {
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return nil, fmt.Errorf("open ZIP: %w", err)
	}

	// First pass: enumerate every CSV for visibility.
	type csvEntry struct {
		name string
		base string
		body []byte
	}
	var csvs []csvEntry
	for _, f := range zr.File {
		lower := strings.ToLower(f.Name)
		if !strings.HasSuffix(lower, ".csv") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("open %s in ZIP: %w", f.Name, err)
		}
		raw, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", f.Name, err)
		}
		csvs = append(csvs, csvEntry{name: f.Name, base: path.Base(f.Name), body: raw})
	}

	if len(csvs) == 0 {
		return nil, fmt.Errorf("no CSV files found in ZIP archive (%d entries total)", len(zr.File))
	}

	// Log inventory so failures are diagnosable from the test log alone.
	for _, c := range csvs {
		LogDebug(fmt.Sprintf("CoC ZIP CSV: %q (size=%d bytes)", c.name, len(c.body)))
	}

	// Preferred: exact base-name match "coc-report.csv". Falls back to any
	// CSV whose base starts with "coc-report" (handles numbered variants
	// like "coc-report-2.csv" if the bundle ever ships them).
	var chosen *csvEntry
	for i := range csvs {
		if strings.EqualFold(csvs[i].base, "coc-report.csv") {
			chosen = &csvs[i]
			break
		}
	}
	if chosen == nil {
		for i := range csvs {
			if strings.HasPrefix(strings.ToLower(csvs[i].base), "coc-report") {
				chosen = &csvs[i]
				break
			}
		}
	}
	if chosen == nil {
		// Last resort: lexicographically first CSV.
		chosen = &csvs[0]
	}
	LogDebug(fmt.Sprintf("CoC ZIP: parsing %q for Source Path column", chosen.name))
	return parseSourcePathColumn(chosen.body)
}

func parseSourcePathColumn(raw []byte) ([]string, error) {
	r := csv.NewReader(bytes.NewReader(raw))
	r.FieldsPerRecord = -1 // tolerate ragged rows
	rows, err := r.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("parse CSV: %w", err)
	}
	if len(rows) == 0 {
		return []string{}, nil
	}
	// Find the "Source Path" column (case-insensitive match).
	header := rows[0]
	col := -1
	for i, h := range header {
		if strings.EqualFold(strings.TrimSpace(h), "Source Path") {
			col = i
			break
		}
	}
	if col == -1 {
		return nil, fmt.Errorf("no 'Source Path' column in CSV header: %v", header)
	}
	out := make([]string, 0, len(rows)-1)
	for _, row := range rows[1:] {
		if col >= len(row) {
			continue
		}
		p := strings.TrimSpace(row[col])
		if p != "" {
			out = append(out, p)
		}
	}
	return out, nil
}

// =============================================================================
// 3. BASELINE SEEDER — CreateSMBFilesForAclMismatchTest
// =============================================================================

// CreateSMBFilesForAclMismatchTest builds a single PowerShell script containing
// every directory/file/icacls/Set-Acl command, ships it to the worker via the
// .ps1-file transport (see sshRunPowerShellScript), and executes it. This
// bypasses cmd.exe's 8191-char command-line cap that bit us with the old
// `cmd /C ... && ... && ...` chain.
//
// Hybrid strategy inside the .ps1:
//   - Native PS for control flow (mkdir, Set-Content, share mount, AD users,
//     try/catch, special-state ACLs via Set-Acl/SDDL).
//   - icacls.exe still invoked for ordinary ACE grants/owner changes so the
//     ACL bytes match what the existing 39 working scenarios were validated
//     against. icacls is just a native binary; calling it from PS has none
//     of the cmd quoting problems.
func CreateSMBFilesForAclMismatchTest(export string) error {
	script := createAclMismatchTestStructureScript(export)
	LogDebug(fmt.Sprintf("Creating ACL mismatch test tree on: %s", export))

	config := GetAttachedWorkerDetails()
	sshConfig := SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	output, err := sshRunPowerShellScript(sshConfig, "acl_mismatch_seed", script)
	LogDebug(fmt.Sprintf("CreateSMBFilesForAclMismatchTest output: %s", output))
	if err != nil {
		LogDebug(fmt.Sprintf("CreateSMBFilesForAclMismatchTest ERROR: %v", err))
		return fmt.Errorf("CreateSMBFilesForAclMismatchTest failed: %w\noutput: %s", err, output)
	}
	LogDebug("Successfully created ACL mismatch baseline tree")
	return nil
}

// createAclMismatchTestStructureScript returns the body of a PowerShell .ps1
// to be executed on the worker. The script:
//  1. Provisions the two SID-mapping AD users (best-effort).
//  2. Stages an empty local tree under C:\acl_mismatch_test.
//  3. Mounts the source share at Z:, wipes any prior acl_mismatch_test root.
//  4. Copies the local tree onto the share, resets ACLs to Everyone:(OI)(CI)F.
//  5. Applies the per-scenario baseline ACL/attribute state.
//  6. Unmounts and cleans up the local stage.
func createAclMismatchTestStructureScript(export string) string {
	split := strings.Split(export, ":")
	host := strings.TrimSpace(split[0])
	shareName := strings.TrimSpace(split[1])
	smbShare := fmt.Sprintf(`\\%s\%s`, host, shareName)

	localTestDir := `C:\acl_mismatch_test`
	mappedDrive := `Z:`
	share := fmt.Sprintf(`%s\%s`, mappedDrive, AclMismatchTestRoot)

	var b strings.Builder

	// ── Prelude: hard-fail on any unhandled error so problems surface in stderr.
	b.WriteString("$ErrorActionPreference = 'Stop'\n")
	b.WriteString("$ProgressPreference = 'SilentlyContinue'\n")
	b.WriteString("Write-Output 'ACL-MISMATCH-SEED-START'\n\n")

	// ── AD user verification ─────────────────────────────────────────────
	// SID-mapping rows 40, 41 reference two pre-existing AD users. We do NOT
	// try to create them here (would require RSAT-AD-PowerShell on the worker);
	// the users must be provisioned out-of-band on the domain controller.
	// Verify they resolve via NTAccount->SID translation, which works on any
	// domain-joined Windows box without needing the AD module.
	// Sets $script:SidMapAvailable so per-scenario ACE grants below can be
	// guarded if the users are missing.
	fmt.Fprintf(&b, `$script:SidMapAvailable = $true
foreach ($u in '%s','%s') {
    try {
        $sid = ([System.Security.Principal.NTAccount]"%s\$u").Translate([System.Security.Principal.SecurityIdentifier])
        Write-Output "AD-USER-OK: $u -> $($sid.Value)"
    } catch {
        Write-Output "AD-USER-MISSING: $u ($($_.Exception.Message))"
        $script:SidMapAvailable = $false
    }
}

`, SidMapAdUser1, SidMapAdUser2, SidMapAdDomainStr)

	// ── Stage local tree under C:\acl_mismatch_test ──────────────────────
	fmt.Fprintf(&b, "if (Test-Path '%s') { Remove-Item -Recurse -Force '%s' }\n", localTestDir, localTestDir)
	fmt.Fprintf(&b, "New-Item -ItemType Directory -Force -Path '%s' | Out-Null\n", localTestDir)

	// Derive + create unique parent dirs from the scenarios catalog.
	dirsCreated := map[string]bool{}
	for _, sc := range AclMismatchScenarios {
		parent := winParent(sc.RelPath)
		if parent != "" && !dirsCreated[parent] {
			fmt.Fprintf(&b, "New-Item -ItemType Directory -Force -Path '%s\\%s' | Out-Null\n", localTestDir, parent)
			dirsCreated[parent] = true
		}
	}

	// Echo a baseline body into every leaf. Dir-only scenarios get a marker
	// file so the directory is non-empty and visible to the scanner.
	for _, sc := range AclMismatchScenarios {
		winRel := strings.ReplaceAll(sc.RelPath, "/", `\`)
		if strings.HasSuffix(winRel, ".txt") {
			fmt.Fprintf(&b, "Set-Content -Path '%s\\%s' -Value 'baseline' -NoNewline\n", localTestDir, winRel)
		} else {
			fmt.Fprintf(&b, "New-Item -ItemType Directory -Force -Path '%s\\%s' | Out-Null\n", localTestDir, winRel)
			fmt.Fprintf(&b, "Set-Content -Path '%s\\%s\\.keep' -Value 'baseline' -NoNewline\n", localTestDir, winRel)
		}
	}
	b.WriteString("\n")

	// ── Mount share and copy ────────────────────────────────────────────
	// Use net.exe (not New-PSDrive) to match the existing helpers; behavior
	// and credential semantics are identical to what the cmd version did.
	// Best-effort unmount: net.exe writes to stderr if Z: isn't currently
	// mapped, which $ErrorActionPreference=Stop would turn into a fatal
	// NativeCommandError. Wrap so the script keeps going.
	fmt.Fprintf(&b, "try { & net.exe use %s /delete /y *>&1 | Out-Null } catch { }\n", mappedDrive)
	fmt.Fprintf(&b, "& net.exe use %s %s /user:%s '%s' 2>&1 | Out-Null\n",
		mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD)
	fmt.Fprintf(&b, "if ($LASTEXITCODE -ne 0) { throw \"net use mount failed: exit $LASTEXITCODE\" }\n")
	fmt.Fprintf(&b, "if (Test-Path '%s') { Remove-Item -Recurse -Force '%s' }\n", share, share)
	fmt.Fprintf(&b, "& xcopy.exe /E /I /Y '%s' '%s' 2>&1 | Out-Null\n", localTestDir, share)

	// Break inheritance on the test root only (no /T) so the volume-root's
	// GENERIC_ALL (0x10000000) ACE stops propagating into child dirs/files.
	// Then grant Everyone:(OI)(CI)F recursively as the clean baseline ACE.
	fmt.Fprintf(&b, "& icacls.exe '%s' /inheritance:r 2>&1 | Out-Null\n", share)
	fmt.Fprintf(&b, "& icacls.exe '%s' /grant 'Everyone:(OI)(CI)F' /T /C 2>&1 | Out-Null\n\n", share)

	// ── Per-scenario BASELINE ACL/attribute state ────────────────────────
	// Helper: each line invokes icacls with PS's call operator. We redirect
	// stderr->stdout->null so a stray icacls warning (e.g. "Successfully
	// processed 1 file" goes to stdout, but some informational notices go to
	// stderr) doesn't trip $ErrorActionPreference=Stop with NativeCommandError.
	ic := func(format string, a ...interface{}) {
		fmt.Fprintf(&b, "& icacls.exe "+format+" 2>&1 | Out-Null\n", a...)
	}

	// ── 1–3: Controls — set Owner=Administrators, Everyone:M ────────────
	b.WriteString("Write-Output '===== BASELINE 1-3 controls ====='\n")
	ic(`'%s\control\S01_ctrl_owner.txt' /setowner 'BUILTIN\Administrators'`, share)
	ic(`'%s\control\S01_ctrl_owner.txt' /grant 'Everyone:M'`, share)
	ic(`'%s\control\S02_ctrl_dacl.txt'  /grant 'Everyone:M'`, share)
	ic(`'%s\control\S03_ctrl_attrs.txt' /grant 'Everyone:M'`, share)

	// ── 4–5: Owner — set Owner=Administrators, Everyone:M ────────────────
	b.WriteString("Write-Output '===== BASELINE 4-5 owner ====='\n")
	ic(`'%s\owner\S04_owner_to_users.txt' /setowner 'BUILTIN\Administrators'`, share)
	ic(`'%s\owner\S04_owner_to_users.txt' /grant 'Everyone:M'`, share)
	ic(`'%s\owner\S05_owner_to_system.txt' /setowner 'BUILTIN\Administrators'`, share)
	ic(`'%s\owner\S05_owner_to_system.txt' /grant 'Everyone:M'`, share)

	// ── 6: Group — set Everyone:M (Group defaults to None) ───────────────
	b.WriteString("Write-Output '===== BASELINE 6 group ====='\n")
	ic(`'%s\group\S06_group_change.txt' /grant 'Everyone:M'`, share)

	// ── 7–8: DACL order ─────────────────────────────────────────────────
	b.WriteString("Write-Output '===== BASELINE 7-8 dacl_order ====='\n")
	// S07: canonical order — Deny first, Allow second
	ic(`'%s\dacl_order\S07_deny_before_allow.txt' /inheritance:r `+
		`/deny 'BUILTIN\Users:W' /grant 'BUILTIN\Administrators:R'`, share)
	// S08: canonical order — Deny Users:W, Allow Admins:R
	ic(`'%s\dacl_order\S08_order_swap.txt' /inheritance:r `+
		`/deny 'BUILTIN\Users:W' /grant 'BUILTIN\Administrators:R'`, share)

	// ── 9–17: DACL membership — set starting ACEs ────────────────────────
	b.WriteString("Write-Output '===== BASELINE 9-17 dacl_membership ====='\n")
	ic(`'%s\dacl_membership\S09_ace_add.txt' /grant 'Everyone:M'`, share)
	ic(`'%s\dacl_membership\S10_ace_remove.txt' /grant 'Everyone:M' /grant 'BUILTIN\Users:R'`, share)
	ic(`'%s\dacl_membership\S11_ace_sid_swap.txt'  /grant 'BUILTIN\Users:R'`, share)
	ic(`'%s\dacl_membership\S12_ace_type_flip.txt' /grant 'BUILTIN\Users:R'`, share)
	ic(`'%s\dacl_membership\S13_allow_to_deny.txt' /grant 'BUILTIN\Users:R'`, share)
	ic(`'%s\dacl_membership\S14_deny_to_allow.txt' /deny 'BUILTIN\Users:R'`, share)
	ic(`'%s\dacl_membership\S15_creator_owner_add' /grant 'Everyone:(OI)(CI)F'`, share)
	ic(`'%s\dacl_membership\S16_creator_owner_remove' /grant 'CREATOR OWNER:(OI)(CI)(IO)F' /grant 'Everyone:(OI)(CI)F'`, share)
	ic(`'%s\dacl_membership\S17_mass_reset.txt' /inheritance:r `+
		`/grant 'Everyone:R' /grant 'BUILTIN\Users:R' /grant 'BUILTIN\Administrators:F' `+
		`/grant 'NT AUTHORITY\SYSTEM:F' /grant 'NT AUTHORITY\Authenticated Users:M'`, share)

	// ── 18–21: DACL access mask — set starting masks ─────────────────────
	b.WriteString("Write-Output '===== BASELINE 18-21 dacl_mask ====='\n")
	ic(`'%s\dacl_mask\S18_mask_grow.txt' /grant:r 'Everyone:R'`, share)
	ic(`'%s\dacl_mask\S19_mask_shrink.txt' /grant:r 'Everyone:F'`, share)
	ic(`'%s\dacl_mask\S20_deny_add.txt' /grant 'BUILTIN\Users:F'`, share)
	ic(`'%s\dacl_mask\S21_deny_remove.txt' /grant 'BUILTIN\Users:F'`, share)
	ic(`'%s\dacl_mask\S21_deny_remove.txt' /deny 'BUILTIN\Users:W'`, share)

	// ── 22–27: DACL flags — set starting inheritance flags ────────────────
	b.WriteString("Write-Output '===== BASELINE 22-27 dacl_flags ====='\n")
	ic(`'%s\dacl_flags\S22_oi_drop' /inheritance:r /grant 'BUILTIN\Users:(OI)(CI)F'`, share)
	ic(`'%s\dacl_flags\S23_ci_drop' /inheritance:r /grant 'BUILTIN\Users:(OI)(CI)F'`, share)
	ic(`'%s\dacl_flags\S24_io_add' /grant 'BUILTIN\Users:(OI)(CI)F'`, share)
	ic(`'%s\dacl_flags\S25_np_add' /grant 'BUILTIN\Users:(OI)(CI)F'`, share)
	ic(`'%s\dacl_flags\S26_all_flags_cleared' /grant 'BUILTIN\Users:(OI)(CI)F'`, share)
	ic(`'%s\dacl_flags\S27_inherited_bit_flipped\file.txt' /inheritance:r /grant 'BUILTIN\Users:M'`, share)

	// ── 28–30: DACL present — set Everyone:M (S30 baseline: NULL DACL via SDDL)
	b.WriteString("Write-Output '===== BASELINE 28-30 dacl_present ====='\n")
	// S28 commented out — pending product fix for DaclPresent/NULL DACL stamp
	// ic(`'%s\dacl_present\S28_null_dacl.txt'  /grant 'Everyone:M'`, share)
	ic(`'%s\dacl_present\S29_empty_dacl.txt' /grant 'Everyone:M'`, share)
	// S30 commented out — pending product fix for DaclPresent bit comparison
	// fmt.Fprintf(&b, "$p = '%s\\dacl_present\\S30_null_vs_empty.txt'; "+
	// 	"$a = Get-Acl $p; $a.SetSecurityDescriptorSddlForm('D:NO_ACCESS_CONTROL'); Set-Acl $p $a\n", share)

	// ── 31–33: DACL protected — S32 disable inheritance, S33 add inherited ACE
	b.WriteString("Write-Output '===== BASELINE 31-33 dacl_protected ====='\n")
	ic(`'%s\dacl_protected\S32_protected_disable\file.txt' /inheritance:r /grant 'Everyone:M'`, share)
	ic(`'%s\dacl_protected\S33_inheritance_r_drops\file.txt' /grant 'BUILTIN\Users:R'`, share)

	// ── 34–39: Attributes — S35 set ReadOnly, S37 set Hidden ─────────────
	b.WriteString("Write-Output '===== BASELINE 34-39 attributes ====='\n")
	fmt.Fprintf(&b, "Set-ItemProperty -Path '%s\\attributes\\S35_readonly_remove.txt' -Name IsReadOnly -Value $true\n", share)
	fmt.Fprintf(&b, "(Get-Item '%s\\attributes\\S37_system_add.txt').Attributes = "+
		"((Get-Item '%s\\attributes\\S37_system_add.txt').Attributes -bor [System.IO.FileAttributes]::Hidden)\n", share, share)

	// ── 40–41: SID-mapping — grant aclmap_u1:R on both files ─────────────
	b.WriteString("Write-Output '===== BASELINE 40-41 sid_mapping ====='\n")
	b.WriteString("if ($script:SidMapAvailable) {\n")
	fmt.Fprintf(&b, "    & icacls.exe '%s\\sid_mapping\\S40_sid_map_noop.txt'    /grant '%s\\%s:R' 2>&1 | Out-Null\n",
		share, SidMapAdDomainStr, SidMapAdUser1)
	fmt.Fprintf(&b, "    & icacls.exe '%s\\sid_mapping\\S41_sid_map_changed.txt' /grant '%s\\%s:R' 2>&1 | Out-Null\n",
		share, SidMapAdDomainStr, SidMapAdUser1)
	b.WriteString("} else { Write-Output 'SID_MAP-BASELINE-SKIPPED (users missing)' }\n")

	// ── 42–44: Selection-layer — write content 'v1' ──────────────────────
	b.WriteString("Write-Output '===== BASELINE 42-44 selection ====='\n")
	fmt.Fprintf(&b, "Set-Content -Path '%s\\selection\\S42_ctime_bump.txt' -Value 'v1' -NoNewline\n", share)
	fmt.Fprintf(&b, "Set-Content -Path '%s\\selection\\S43_content_and_acl.txt' -Value 'v1' -NoNewline\n", share)
	fmt.Fprintf(&b, "Set-Content -Path '%s\\selection\\S44_dest_only_drift.txt' -Value 'v1' -NoNewline\n", share)

	b.WriteString("Write-Output '===== Verifying baseline tree ====='\n")
	fmt.Fprintf(&b, "Get-ChildItem -Recurse -Force '%s' | Select-Object -ExpandProperty FullName\n", share)
	fmt.Fprintf(&b, "try { & net.exe use %s /delete /y 2>&1 | Out-Null } catch { }\n", mappedDrive)
	fmt.Fprintf(&b, "Remove-Item -Recurse -Force '%s'\n", localTestDir)
	b.WriteString("Write-Output 'ACL-MISMATCH-SEED-DONE'\n")

	return b.String()
}

// =============================================================================
// 4. MUTATOR — MutateSMBFilesForAclMismatchTest
// =============================================================================

// MutateSMBFilesForAclMismatchTest applies one source-side mutation per
// non-control scenario. Control files are intentionally untouched. Ships a
// single PowerShell .ps1 to the worker (see sshRunPowerShellScript).
func MutateSMBFilesForAclMismatchTest(export string) error {
	script := mutateAclMismatchTestStructureScript(export)
	LogDebug(fmt.Sprintf("Applying ACL mismatch mutations on: %s", export))

	config := GetAttachedWorkerDetails()
	sshConfig := SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	output, err := sshRunPowerShellScript(sshConfig, "acl_mismatch_mutate_src", script)
	LogDebug(fmt.Sprintf("MutateSMBFilesForAclMismatchTest output: %s", output))
	if err != nil {
		LogDebug(fmt.Sprintf("MutateSMBFilesForAclMismatchTest ERROR: %v", err))
		return fmt.Errorf("MutateSMBFilesForAclMismatchTest failed: %w\noutput: %s", err, output)
	}
	LogDebug("Successfully applied ACL mutations")
	return nil
}

func mutateAclMismatchTestStructureScript(export string) string {
	split := strings.Split(export, ":")
	host := strings.TrimSpace(split[0])
	shareName := strings.TrimSpace(split[1])
	smbShare := fmt.Sprintf(`\\%s\%s`, host, shareName)

	mappedDrive := `Z:`
	share := fmt.Sprintf(`%s\%s`, mappedDrive, AclMismatchTestRoot)

	var b strings.Builder
	b.WriteString("$ErrorActionPreference = 'Stop'\n")
	b.WriteString("$ProgressPreference = 'SilentlyContinue'\n")
	b.WriteString("Write-Output 'ACL-MISMATCH-MUTATE-START'\n\n")

	// Re-verify SID-mapping AD users in this fresh PS process.
	fmt.Fprintf(&b, `$script:SidMapAvailable = $true
foreach ($u in '%s','%s') {
    try {
        $null = ([System.Security.Principal.NTAccount]"%s\$u").Translate([System.Security.Principal.SecurityIdentifier])
    } catch {
        Write-Output "AD-USER-MISSING: $u"
        $script:SidMapAvailable = $false
    }
}

`, SidMapAdUser1, SidMapAdUser2, SidMapAdDomainStr)

	// Best-effort unmount: net.exe writes to stderr if Z: isn't currently
	// mapped, which $ErrorActionPreference=Stop would turn into a fatal
	// NativeCommandError. Wrap so the script keeps going.
	fmt.Fprintf(&b, "try { & net.exe use %s /delete /y *>&1 | Out-Null } catch { }\n", mappedDrive)
	fmt.Fprintf(&b, "& net.exe use %s %s /user:%s '%s' 2>&1 | Out-Null\n",
		mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD)
	fmt.Fprintf(&b, "if ($LASTEXITCODE -ne 0) { throw \"net use mount failed: exit $LASTEXITCODE\" }\n\n")

	ic := func(format string, a ...interface{}) {
		fmt.Fprintf(&b, "& icacls.exe "+format+" 2>&1 | Out-Null\n", a...)
	}

	// ── 4–5: Owner — change owner ────────────────────────────────────────
	b.WriteString("Write-Output '===== MUTATE 4-5 owner ====='\n")
	ic(`'%s\owner\S04_owner_to_users.txt' /setowner 'BUILTIN\Users'`, share)
	ic(`'%s\owner\S05_owner_to_system.txt' /setowner 'NT AUTHORITY\SYSTEM'`, share)

	// ── 6: Group — change group to BUILTIN\Users ─────────────────────────
	b.WriteString("Write-Output '===== MUTATE 6 group ====='\n")
	fmt.Fprintf(&b, "$p='%s\\group\\S06_group_change.txt'; $a=Get-Acl $p; "+
		"$a.SetGroup([System.Security.Principal.NTAccount]'BUILTIN\\Users'); Set-Acl $p $a\n", share)

	// ── 7–8: DACL order — rebuild with swapped order ─────────────────────
	b.WriteString("Write-Output '===== MUTATE 7-8 dacl_order ====='\n")
	// S07: baseline is Deny-first, Allow-second → mutate to Allow-first, Deny-second
	fmt.Fprintf(&b, "$p='%s\\dacl_order\\S07_deny_before_allow.txt'; $a=Get-Acl $p; "+
		"$a.SetAccessRuleProtection($true,$false); foreach($r in @($a.Access)){ $a.RemoveAccessRule($r) | Out-Null }; "+
		"$a.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\\Administrators','Read','Allow'))); "+
		"$a.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\\Users','Write','Deny'))); "+
		"Set-Acl $p $a\n", share)
	// S08: baseline is Deny Users:W, Allow Admins:R → mutate to Allow-first, Deny-second
	fmt.Fprintf(&b, "$p='%s\\dacl_order\\S08_order_swap.txt'; $a=Get-Acl $p; "+
		"$a.SetAccessRuleProtection($true,$false); foreach($r in @($a.Access)){ $a.RemoveAccessRule($r) | Out-Null }; "+
		"$a.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\\Administrators','Read','Allow'))); "+
		"$a.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\\Users','Write','Deny'))); "+
		"Set-Acl $p $a\n", share)

	// ── 9–17: DACL membership — add/remove/swap ACEs ─────────────────────
	b.WriteString("Write-Output '===== MUTATE 9-17 dacl_membership ====='\n")
	ic(`'%s\dacl_membership\S09_ace_add.txt' /grant 'BUILTIN\Users:R'`, share)
	ic(`'%s\dacl_membership\S10_ace_remove.txt' /remove 'BUILTIN\Users'`, share)
	ic(`'%s\dacl_membership\S11_ace_sid_swap.txt'  /remove 'BUILTIN\Users' /grant 'BUILTIN\Administrators:R'`, share)
	ic(`'%s\dacl_membership\S12_ace_type_flip.txt' /remove 'BUILTIN\Users' /deny 'BUILTIN\Users:R'`, share)
	ic(`'%s\dacl_membership\S13_allow_to_deny.txt' /remove 'BUILTIN\Users' /deny 'BUILTIN\Users:R'`, share)
	ic(`'%s\dacl_membership\S14_deny_to_allow.txt' /remove:d 'BUILTIN\Users' /grant 'BUILTIN\Users:R'`, share)
	ic(`'%s\dacl_membership\S15_creator_owner_add' /grant 'CREATOR OWNER:(OI)(CI)(IO)F'`, share)
	ic(`'%s\dacl_membership\S16_creator_owner_remove' /remove 'CREATOR OWNER'`, share)
	ic(`'%s\dacl_membership\S17_mass_reset.txt' /reset`, share)

	// ── 18–21: DACL access mask — grow/shrink/add deny/remove deny ───────
	b.WriteString("Write-Output '===== MUTATE 18-21 dacl_mask ====='\n")
	ic(`'%s\dacl_mask\S18_mask_grow.txt' /grant:r 'Everyone:F'`, share)
	ic(`'%s\dacl_mask\S19_mask_shrink.txt' /grant:r 'Everyone:R'`, share)
	ic(`'%s\dacl_mask\S20_deny_add.txt' /deny 'BUILTIN\Users:W'`, share)
	ic(`'%s\dacl_mask\S21_deny_remove.txt' /remove:d 'BUILTIN\Users'`, share)

	// ── 22–27: DACL flags — change inheritance flags ─────────────────────
	b.WriteString("Write-Output '===== MUTATE 22-27 dacl_flags ====='\n")
	ic(`'%s\dacl_flags\S22_oi_drop' /remove 'BUILTIN\Users' /grant 'BUILTIN\Users:(CI)F'`, share)
	ic(`'%s\dacl_flags\S23_ci_drop' /remove 'BUILTIN\Users' /grant 'BUILTIN\Users:(OI)F'`, share)
	ic(`'%s\dacl_flags\S24_io_add' /remove 'BUILTIN\Users' /grant 'BUILTIN\Users:(OI)(CI)(IO)F'`, share)
	ic(`'%s\dacl_flags\S25_np_add' /remove 'BUILTIN\Users' /grant 'BUILTIN\Users:(OI)(CI)(NP)F'`, share)
	ic(`'%s\dacl_flags\S26_all_flags_cleared' /remove 'BUILTIN\Users' /grant 'BUILTIN\Users:F'`, share)
	ic(`'%s\dacl_flags\S27_inherited_bit_flipped\file.txt' /inheritance:e /remove 'BUILTIN\Users'`, share)

	// ── 28–30: DACL present — set NULL/empty DACL via SDDL ───────────────
	b.WriteString("Write-Output '===== MUTATE 28-30 dacl_present ====='\n")
	// S28 commented out — pending product fix for DaclPresent/NULL DACL stamp
	// fmt.Fprintf(&b, "$p='%s\\dacl_present\\S28_null_dacl.txt'; $a=Get-Acl $p; "+
	// 	"$a.SetSecurityDescriptorSddlForm('D:NO_ACCESS_CONTROL'); Set-Acl $p $a\n", share)
	fmt.Fprintf(&b, "$p='%s\\dacl_present\\S29_empty_dacl.txt'; $a=Get-Acl $p; "+
		"$a.SetSecurityDescriptorSddlForm('D:'); Set-Acl $p $a\n", share)
	// S30 commented out — pending product fix for DaclPresent bit comparison
	// fmt.Fprintf(&b, "$p='%s\\dacl_present\\S30_null_vs_empty.txt'; $a=Get-Acl $p; "+
	// 	"$a.SetSecurityDescriptorSddlForm('D:'); Set-Acl $p $a\n", share)

	// ── 31–33: DACL protected — toggle /inheritance:r and /inheritance:e ──
	b.WriteString("Write-Output '===== MUTATE 31-33 dacl_protected ====='\n")
	ic(`'%s\dacl_protected\S31_protected_enable\file.txt' /inheritance:r /grant 'BUILTIN\Users:R'`, share)
	ic(`'%s\dacl_protected\S32_protected_disable\file.txt' /inheritance:e`, share)
	ic(`'%s\dacl_protected\S33_inheritance_r_drops\file.txt' /inheritance:r`, share)

	// ── 34–39: Attributes — add/remove attribute bits ────────────────────
	b.WriteString("Write-Output '===== MUTATE 34-39 attributes ====='\n")
	fmt.Fprintf(&b, "Set-ItemProperty -Path '%s\\attributes\\S34_readonly_add.txt' -Name IsReadOnly -Value $true\n", share)
	fmt.Fprintf(&b, "Set-ItemProperty -Path '%s\\attributes\\S35_readonly_remove.txt' -Name IsReadOnly -Value $false\n", share)
	addAttr := func(rel, attr string) {
		fmt.Fprintf(&b, "$p='%s\\%s'; $c=[System.IO.File]::GetAttributes($p); "+
			"[System.IO.File]::SetAttributes($p, $c -bor [System.IO.FileAttributes]::%s)\n", share, rel, attr)
	}
	clearAttr := func(rel, attr string) {
		fmt.Fprintf(&b, "$p='%s\\%s'; $c=[System.IO.File]::GetAttributes($p); "+
			"[System.IO.File]::SetAttributes($p, $c -band (-bnot [System.IO.FileAttributes]::%s))\n", share, rel, attr)
	}
	addAttr(`attributes\S36_hidden_add.txt`, "Hidden")
	addAttr(`attributes\S37_system_add.txt`, "System")
	addAttr(`attributes\S38_multi_bit.txt`, "ReadOnly")
	addAttr(`attributes\S38_multi_bit.txt`, "Hidden")
	clearAttr(`attributes\S39_archive_remove.txt`, "Archive")

	// ── 40–41: SID-mapping — swap aclmap_u1→aclmap_u2 on #41 ────────────
	b.WriteString("Write-Output '===== MUTATE 40-41 sid_mapping ====='\n")
	b.WriteString("if ($script:SidMapAvailable) {\n")
	fmt.Fprintf(&b, "    & icacls.exe '%s\\sid_mapping\\S41_sid_map_changed.txt' /remove '%s\\%s' /grant '%s\\%s:R' 2>&1 | Out-Null\n",
		share, SidMapAdDomainStr, SidMapAdUser1, SidMapAdDomainStr, SidMapAdUser2)
	b.WriteString("} else { Write-Output 'SID_MAP-MUTATE-SKIPPED (users missing)' }\n")

	// ── 42: Set-Acl identical ACL (ctime bump only), 43: content→'v2' + add ACE
	b.WriteString("Write-Output '===== MUTATE 42-43 selection ====='\n")
	fmt.Fprintf(&b, "$p='%s\\selection\\S42_ctime_bump.txt'; $a=Get-Acl $p; Set-Acl -Path $p -AclObject $a\n", share)
	fmt.Fprintf(&b, "Set-Content -Path '%s\\selection\\S43_content_and_acl.txt' -Value 'v2-longer-content' -NoNewline\n", share)
	b.WriteString("if ($script:SidMapAvailable) {\n")
	fmt.Fprintf(&b, "    & icacls.exe '%s\\selection\\S43_content_and_acl.txt' /grant '%s\\%s:R' 2>&1 | Out-Null\n",
		share, SidMapAdDomainStr, SidMapAdUser1)
	b.WriteString("} else {\n")
	fmt.Fprintf(&b, "    & icacls.exe '%s\\selection\\S43_content_and_acl.txt' /grant 'BUILTIN\\Administrators:R' 2>&1 | Out-Null\n", share)
	b.WriteString("}\n")

	// ── 44: dest-only drift — source untouched (mutation applied in MutateDestinationForAclMismatchTest)
	b.WriteString("Write-Output '===== 1-3 controls left untouched ====='\n")

	fmt.Fprintf(&b, "try { & net.exe use %s /delete /y 2>&1 | Out-Null } catch { }\n", mappedDrive)
	b.WriteString("Write-Output 'ACL-MISMATCH-MUTATE-DONE'\n")

	return b.String()
}

// =============================================================================
// 4b. DESTINATION MUTATOR — MutateDestinationForAclMismatchTest (#44 only)
// =============================================================================

// MutateDestinationForAclMismatchTest applies the single destination-side
// mutation for #44 (SEL_DEST_ONLY_DRIFT). Separate function because:
//   - It runs against the DESTINATION share, not the source share.
//   - It must run AFTER the source mutator (so source and dest mutations don't
//     race) but BEFORE the ad-hoc incremental.
//
// destExport format: same "<host>:<share>" pattern as the source export.
func MutateDestinationForAclMismatchTest(destExport string) error {
	script := destinationMutationScript(destExport)
	LogDebug(fmt.Sprintf("Applying #44 destination-side mutation on: %s", destExport))

	config := GetAttachedWorkerDetails()
	sshConfig := SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	output, err := sshRunPowerShellScript(sshConfig, "acl_mismatch_mutate_dst", script)
	LogDebug(fmt.Sprintf("MutateDestinationForAclMismatchTest output: %s", output))
	if err != nil {
		LogDebug(fmt.Sprintf("MutateDestinationForAclMismatchTest ERROR: %v", err))
		return fmt.Errorf("MutateDestinationForAclMismatchTest failed: %w\noutput: %s", err, output)
	}
	LogDebug("Successfully applied #44 destination-side mutation")
	return nil
}

func destinationMutationScript(destExport string) string {
	split := strings.Split(destExport, ":")
	host := strings.TrimSpace(split[0])
	shareName := strings.TrimSpace(split[1])
	smbShare := fmt.Sprintf(`\\%s\%s`, host, shareName)

	mappedDrive := `Y:` // distinct from source's Z: to avoid collision
	share := fmt.Sprintf(`%s\%s`, mappedDrive, AclMismatchTestRoot)

	var b strings.Builder
	b.WriteString("$ErrorActionPreference = 'Stop'\n")
	b.WriteString("$ProgressPreference = 'SilentlyContinue'\n")
	b.WriteString("Write-Output 'ACL-MISMATCH-DEST-MUTATE-START'\n\n")

	// Best-effort unmount: net.exe writes to stderr if Z: isn't currently
	// mapped, which $ErrorActionPreference=Stop would turn into a fatal
	// NativeCommandError. Wrap so the script keeps going.
	fmt.Fprintf(&b, "try { & net.exe use %s /delete /y *>&1 | Out-Null } catch { }\n", mappedDrive)
	fmt.Fprintf(&b, "& net.exe use %s %s /user:%s '%s' 2>&1 | Out-Null\n",
		mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD)
	fmt.Fprintf(&b, "if ($LASTEXITCODE -ne 0) { throw \"net use mount failed: exit $LASTEXITCODE\" }\n")

	b.WriteString("Write-Output '===== MUTATE destination (#44 only) ====='\n")
	fmt.Fprintf(&b, "try {\n"+
		"    $null = ([System.Security.Principal.NTAccount]'%s\\%s').Translate([System.Security.Principal.SecurityIdentifier])\n"+
		"    & icacls.exe '%s\\selection\\S44_dest_only_drift.txt' /grant '%s\\%s:F' 2>&1 | Out-Null\n"+
		"} catch {\n"+
		"    & icacls.exe '%s\\selection\\S44_dest_only_drift.txt' /grant 'BUILTIN\\Administrators:F' 2>&1 | Out-Null\n"+
		"}\n",
		SidMapAdDomainStr, SidMapAdUser1,
		share, SidMapAdDomainStr, SidMapAdUser1,
		share)

	fmt.Fprintf(&b, "try { & net.exe use %s /delete /y 2>&1 | Out-Null } catch { }\n", mappedDrive)
	b.WriteString("Write-Output 'ACL-MISMATCH-DEST-MUTATE-DONE'\n")
	return b.String()
}

// =============================================================================
// 5. UTILITIES
// =============================================================================

// winParent returns the parent directory of a forward-slash relative path,
// converted to backslashes. Returns "" if the path has no parent.
func winParent(rel string) string {
	rel = strings.ReplaceAll(rel, "/", `\`)
	idx := strings.LastIndex(rel, `\`)
	if idx <= 0 {
		return ""
	}
	return rel[:idx]
}

// ContainsPath returns true if needle appears in haystack (case-insensitive
// for Windows-style paths).
func ContainsPath(haystack []string, needle string) bool {
	needle = strings.ToLower(needle)
	for _, h := range haystack {
		if strings.ToLower(h) == needle {
			return true
		}
	}
	return false
}
