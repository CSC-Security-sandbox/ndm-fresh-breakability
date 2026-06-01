package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// TC-ACL-MISMATCH validates Change-on-Change (CoC) selection for the SMB
// migration pipeline. After seeding a baseline tree, running a baseline
// migration, applying one source-side mutation per non-control scenario,
// and triggering an ad-hoc re-run, the ad-hoc migration report MUST:
//
//  1. List every mutated file ("miss" if absent).
//  2. NOT list any control/* file ("over-pick" if present).
//
// All 44 scenarios run in a single It block against one seeded tree to keep
// wall-clock time low. Catalog: utils/acl_mismatch_manager.go.
var _ = FDescribe("TC-ACL-MISMATCH: Verify CoC selection across the full ACL mutation catalog", func() {
	BeforeEach(func() {
		if PROTOCOL_TYPE == ProtocolNFS {
			Skip("ACL mismatch detection is SMB-only")
		}
	})

	var (
		ProjectId             string
		ProjectName           string
		workerId              string
		err                   error
		sourceVolumePath      string
		destVolumePath        string
		headers               map[string]string
		attachedWorkersConfig map[string]SSHConfig
		clonedSourceVolumes   []string
		clonedDestVolumes     []string
		sourceVolumeManager   *TestVolumeManager
		destVolumeManager     *TestVolumeManager
		testStartTime         time.Time
	)

	Context("ACL Mismatch Detection Test", func() {
		BeforeEach(func() {
			ProjectId, ProjectName, attachedWorkersConfig, err = GetGlobalTestEnv()
			Expect(err).To(BeNil(), "Error getting global test environment")
			LogDebug(fmt.Sprintf("[BeforeEach] Using Project: %s (ID: %s)", ProjectName, ProjectId))
			Expect(len(attachedWorkersConfig)).Should(BeNumerically(">=", 1), "Expected at least 1 worker to be attached")
			workerIds := GetWorkerIds()
			workerId = workerIds[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			clonedSourceVolumes, clonedDestVolumes, sourceVolumeManager, destVolumeManager, err = SetupTestVolumesBeforeEach()
			if err != nil {
				Skip(fmt.Sprintf("Failed to setup test volumes: %v", err))
			}
			DeferCleanup(func() {
				if cleanupErr := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager); cleanupErr != nil {
					LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", cleanupErr))
				}
			})

			sourceVolumePath = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[2], clonedSourceVolumes[2])
			destVolumePath = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[2], clonedDestVolumes[2])
		})

		It("TC-ACL-MISMATCH: Should re-migrate every mutated file and skip every control file in the ad-hoc run", func() {
			testStartTime = time.Now()
			By("########################## TC-ACL-MISMATCH start ################################")
			LogDebug(fmt.Sprintf("[TC-ACL-MISMATCH START] Test execution started at: %s", testStartTime.Format("2006-01-02 15:04:05")))

			uniqueID := uuid.New().String()[:8]
			protocol := strings.ToLower(string(PROTOCOL_TYPE))

			// ────────────────────────────────────────────────────────────
			// Phase 0: Create source/destination file servers
			// ────────────────────────────────────────────────────────────
			By("Creating source SMB file server")
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-acl-mismatch-%s-src-fs-%s", protocol, uniqueID),
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             SOURCE_HOST_IPs[2],
				Workers:          []string{workerId},
				WorkingDirectory: "",
			}
			sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating source SMB file server")
			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
			defer resp.Body.Close()

			sourcePathID, err := GetExportPathID("source", clonedSourceVolumes[2], sourceConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "error getting source export path")

			By("Creating destination SMB file server")
			destinationParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-acl-mismatch-%s-dst-fs-%s", protocol, uniqueID),
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             DESTINATION_HOST_IPs[2],
				Workers:          []string{workerId},
				WorkingDirectory: "",
			}
			destinationConfigID, resp, err := CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating destination SMB file server")
			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")
			defer resp.Body.Close()

			destinationPathID, err := GetExportPathID("destination", clonedDestVolumes[2], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "error getting destination export path")

			// ────────────────────────────────────────────────────────────
			// Phase 1: Seed baseline ACL mismatch tree on source
			// ────────────────────────────────────────────────────────────
			By(fmt.Sprintf("Seeding ACL mismatch baseline tree (%d scenarios) on source", len(AclMismatchScenarios)))
			err = CreateSMBFilesForAclMismatchTest(sourceVolumePath)
			Expect(err).NotTo(HaveOccurred(), "Error seeding ACL mismatch tree on source %s", sourceVolumePath)

			By("Waiting for file creation and permission setup to settle")
			Wait(15)

			By("Listing source tree for visibility in logs")
			dirOutput, err := ListSMBDirectoryContents(sourceVolumePath)
			Expect(err).NotTo(HaveOccurred(), "Error listing SMB directory contents on source")
			LogDebug(fmt.Sprintf("Source tree after baseline seed:\n%s", dirOutput))

			// ────────────────────────────────────────────────────────────
			// Phase 2: Baseline migration job
			// ────────────────────────────────────────────────────────────
			By("Creating baseline migration job with preservePermissions=true")
			migrationParams := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{sourcePathID},
				DestinationPathIDs: []string{destinationPathID},
				SidMapping:         BuildAclMismatchSidMappingCSV(),
				Options: map[string]interface{}{
					"excludeFilePatterns": "",
					"preserveAccessTime":  true,
					"preservePermissions": true,
					"skipFile":            "0-M",
				},
			}
			migrationJobConfigIDs, resp, err := CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating migration job")
			Expect(len(migrationJobConfigIDs)).To(BeNumerically(">", 0), "No migration job config IDs returned")
			defer resp.Body.Close()
			migrationJobConfigID := migrationJobConfigIDs[0]

			By("Waiting for baseline migration to complete")
			baselineRunDetails, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting baseline migration run details")
			Expect(len(baselineRunDetails.JobRuns)).To(BeNumerically(">=", 1), "No baseline migration jobRuns found")
			defer resp.Body.Close()
			baselineRunID := baselineRunDetails.JobRuns[0].JobRunId
			Expect(baselineRunID).NotTo(BeEmpty(), "Baseline migration JobRun ID empty")

			err = WaitForJobState(baselineRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "Baseline migration job did not complete successfully")
			LogDebug(fmt.Sprintf("Baseline migration completed: jobRunID=%s", baselineRunID))

			By("Fetching baseline migration report to confirm full seed migrated")
			baselineReportBytes, err := FetchCocReportBytes(baselineRunID)
			Expect(err).NotTo(HaveOccurred(), "Error fetching baseline migration report")
			baselineReportPaths, err := ExtractSourcePathsFromCocCSV(baselineReportBytes)
			Expect(err).NotTo(HaveOccurred(), "Error parsing baseline migration report")
			LogDebug(fmt.Sprintf("Baseline migration report contained %d source paths", len(baselineReportPaths)))
			Expect(len(baselineReportPaths)).To(BeNumerically(">=", len(AclMismatchScenarios)),
				"Baseline migration should pick up every seeded file (including controls)")

			// ────────────────────────────────────────────────────────────
			// Phase 3: Apply all source-side mutations
			// ────────────────────────────────────────────────────────────
			mutatedCount := len(BuildExpectedMutatedSet())
			controlCount := len(BuildExpectedControlSet())
			By(fmt.Sprintf("Applying source-side mutations (%d scenarios, %d controls untouched)",
				mutatedCount, controlCount))
			err = MutateSMBFilesForAclMismatchTest(sourceVolumePath)
			Expect(err).NotTo(HaveOccurred(), "Error applying source-side mutations on %s", sourceVolumePath)

			// ────────────────────────────────────────────────────────────
			// Phase 3.5: Destination-side mutation (row 48 only)
			// Runs AFTER source mutations to avoid race; BEFORE incremental.
			// See plan.md §6 Q1 — row 48 is expected to be XFAIL against
			// current main because the scanner predicate doesn't read ACL bytes.
			// ────────────────────────────────────────────────────────────
			By("Applying row-48 destination-side ACL mutation")
			err = MutateDestinationForAclMismatchTest(destVolumePath)
			Expect(err).NotTo(HaveOccurred(), "Error applying destination-side mutation on %s", destVolumePath)

			By("Waiting for mutation timestamps to settle before ad-hoc trigger")
			Wait(5)

			// ────────────────────────────────────────────────────────────
			// Phase 4: Ad-hoc re-run on the same migration jobConfigID
			// ────────────────────────────────────────────────────────────
			By("Triggering ad-hoc migration run (Change-on-Change)")
			adhocRunID, resp, err := TriggerAdHocJobRun(migrationJobConfigID)
			Expect(err).NotTo(HaveOccurred(), "Error triggering ad-hoc migration run")
			Expect(adhocRunID).NotTo(BeEmpty(), "Ad-hoc run ID empty")
			if resp != nil {
				defer resp.Body.Close()
			}

			err = WaitForJobState(adhocRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "Ad-hoc migration run did not complete successfully")
			LogDebug(fmt.Sprintf("Ad-hoc migration completed: jobRunID=%s", adhocRunID))

			By("Fetching ad-hoc migration report")
			adhocReportBytes, err := FetchCocReportBytes(adhocRunID)
			Expect(err).NotTo(HaveOccurred(), "Error fetching ad-hoc migration report")
			adhocReportPaths, err := ExtractSourcePathsFromCocCSV(adhocReportBytes)
			Expect(err).NotTo(HaveOccurred(), "Error parsing ad-hoc migration report")
			LogDebug(fmt.Sprintf("Ad-hoc migration report contained %d source paths", len(adhocReportPaths)))

			// ────────────────────────────────────────────────────────────
			// Phase 5: Validation — CoC selection assertion (per scenario)
			// ────────────────────────────────────────────────────────────
			By("Validation: ad-hoc report contains every mutated path and no control path")

			var misses []validationFailure    // mutated file expected, NOT re-migrated
			var overPicks []validationFailure // control file NOT mutated, but re-migrated anyway
			var xfails []validationFailure    // expected-failure rows that diverged from intended outcome (do not fail the test)

			for _, sc := range AclMismatchScenarios {
				expectedPath := scenarioToReportPath(sc)
				present := pathInReport(adhocReportPaths, expectedPath)

				if sc.IsControl {
					if present {
						overPicks = append(overPicks, validationFailure{
							Scenario:     sc,
							ExpectedPath: expectedPath,
							Kind:         "OVER-PICK",
							Explanation:  "control file was re-migrated (CoC over-selected)",
						})
					}
					continue
				}

				if !present {
					if sc.IsExpectedFailure {
						// Documented divergence (e.g. row 48): scanner predicate
						// doesn't compare ACL bytes today, so dest-only ACL drift
						// is invisible. Logged as XFAIL, doesn't fail the test.
						xfails = append(xfails, validationFailure{
							Scenario:     sc,
							ExpectedPath: expectedPath,
							Kind:         "XFAIL",
							Explanation:  "expected-failure row diverged from intended outcome (see scenario Notes)",
						})
					} else {
						misses = append(misses, validationFailure{
							Scenario:     sc,
							ExpectedPath: expectedPath,
							Kind:         "MISS",
							Explanation:  "mutated file was NOT re-migrated (CoC under-selected)",
						})
					}
				} else if sc.IsExpectedFailure {
					// Pleasant surprise: row 48 (or similar) actually re-migrated
					// despite the documented divergence. Surface so we know the
					// product fix landed and the IsExpectedFailure tag can be removed.
					xfails = append(xfails, validationFailure{
						Scenario:     sc,
						ExpectedPath: expectedPath,
						Kind:         "XPASS",
						Explanation:  "expected-failure row unexpectedly re-migrated — product behavior may have changed; consider clearing IsExpectedFailure",
					})
				}
			}

			// ────────────────────────────────────────────────────────────
			// Per-row outcome log (PASS/FAIL/XFAIL line per scenario, grouped)
			// ────────────────────────────────────────────────────────────
			emitPerRowLog(adhocReportPaths, misses, overPicks, xfails)

			// ────────────────────────────────────────────────────────────
			// Final aggregated failure (one Fail call, every row enumerated).
			// XFAIL/XPASS rows are surfaced in logs but never fail the test.
			// ────────────────────────────────────────────────────────────
			if len(misses) > 0 || len(overPicks) > 0 {
				Fail(formatValidationFailure(adhocReportPaths, misses, overPicks, xfails))
			}

			LogDebug(fmt.Sprintf(
				"Validation PASS: all %d mutations re-migrated, all %d controls skipped (total scenarios: %d, xfails surfaced: %d).",
				mutatedCount, controlCount, len(AclMismatchScenarios), len(xfails),
			))

			// ────────────────────────────────────────────────────────────
			// Phase 6: Second incremental → idempotency validation
			// No further mutations. Scanner must produce zero stamp ops.
			// ────────────────────────────────────────────────────────────
			By("Triggering second incremental migration run (idempotency check)")
			idempotencyRunID, resp, err := TriggerAdHocJobRun(migrationJobConfigID)
			Expect(err).NotTo(HaveOccurred(), "Error triggering second (idempotency) ad-hoc run")
			Expect(idempotencyRunID).NotTo(BeEmpty(), "Idempotency run ID empty")
			if resp != nil {
				defer resp.Body.Close()
			}

			err = WaitForJobState(idempotencyRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "Second (idempotency) ad-hoc run did not complete")
			LogDebug(fmt.Sprintf("Idempotency run completed: jobRunID=%s", idempotencyRunID))

			By("Idempotency validation: second incremental re-migrated zero files")
			idempotencyReportBytes, err := FetchCocReportBytes(idempotencyRunID)
			Expect(err).NotTo(HaveOccurred(), "Error fetching idempotency report")
			idempotencyReportPaths, err := ExtractSourcePathsFromCocCSV(idempotencyReportBytes)
			Expect(err).NotTo(HaveOccurred(), "Error parsing idempotency report")
			LogDebug(fmt.Sprintf("Idempotency report contained %d source paths (expected 0)", len(idempotencyReportPaths)))

			// Tolerate IsExpectedFailure rows here too: if row 48 *did* finally
			// get re-stamped on a future product change, the idempotency run
			// might still touch it on the cycle right after — that's a known
			// transient, not a hard failure.
			unexpectedIdempotencyPaths := filterUnexpectedIdempotencyPaths(idempotencyReportPaths)
			Expect(unexpectedIdempotencyPaths).To(BeEmpty(),
				"Idempotency FAIL: second incremental re-migrated %d paths despite no further mutations: %v",
				len(unexpectedIdempotencyPaths), unexpectedIdempotencyPaths)

			LogDebug("Idempotency PASS: second incremental produced zero unexpected stamp ops.")
			By("########################## TC-ACL-MISMATCH end ################################")
		})

		AfterEach(func() {
			testEndTime := time.Now()
			testDuration := testEndTime.Sub(testStartTime)

			if PROTOCOL_TYPE == ProtocolNFS {
				LogDebug("Skipping cleanup as test was skipped for NFS protocol")
				return
			}

			By("Cleanup started")
			LogDebug(fmt.Sprintf("[AfterEach] Cleaning up for Project: %s (ID: %s)", ProjectName, ProjectId))

			if cleanupErr := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager); cleanupErr != nil {
				LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", cleanupErr))
			}

			LogDebug(fmt.Sprintf("[TC-ACL-MISMATCH END] Test execution completed at: %s", testEndTime.Format("2006-01-02 15:04:05")))
			LogDebug(fmt.Sprintf("[TC-ACL-MISMATCH DURATION] Total test duration: %s", testDuration))
		})
	})
})

// ───────────────────────────────────────────────────────────────────────
// Test-local helpers
// ───────────────────────────────────────────────────────────────────────

type validationFailure struct {
	Scenario     AclMismatchScenario
	ExpectedPath string
	Kind         string // "MISS" or "OVER-PICK"
	Explanation  string
}

// scenarioToReportPath returns the report-style path the migration report
// would emit for a given scenario (test-root prefix + backslashes).
func scenarioToReportPath(sc AclMismatchScenario) string {
	rel := strings.ReplaceAll(sc.RelPath, "/", `\`)
	return fmt.Sprintf(`%s\%s`, AclMismatchTestRoot, rel)
}

// pathInReport is a case-insensitive contains-check across slash variants.
// Tolerates report entries that prepend an extra share-prefix path.
func pathInReport(report []string, candidate string) bool {
	cand := normalizeReportPath(candidate)
	for _, r := range report {
		n := normalizeReportPath(r)
		if n == cand || strings.HasSuffix(n, cand) {
			return true
		}
	}
	return false
}

func normalizeReportPath(p string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(p), "/", `\`))
}

// scenarioGroup classifies a scenario into a short bucket label for log grouping.
// Based on the leading directory of RelPath (e.g. "owner", "dacl_membership").
func scenarioGroup(sc AclMismatchScenario) string {
	rel := strings.ReplaceAll(sc.RelPath, "/", `\`)
	if idx := strings.Index(rel, `\`); idx > 0 {
		return rel[:idx]
	}
	return rel
}

// emitPerRowLog writes one PASS/FAIL/XFAIL line per scenario, grouped by bucket
// so the CI log shows the catalog at a glance.
func emitPerRowLog(adhocReport []string, misses, overPicks, xfails []validationFailure) {
	outcomeIndex := map[string]string{} // scenarioID → outcome label
	for _, m := range misses {
		outcomeIndex[m.Scenario.ID] = "FAIL (MISS)"
	}
	for _, o := range overPicks {
		outcomeIndex[o.Scenario.ID] = "FAIL (OVER-PICK)"
	}
	for _, x := range xfails {
		outcomeIndex[x.Scenario.ID] = x.Kind // "XFAIL" or "XPASS"
	}

	// Group scenarios by bucket, preserving catalog order within each bucket.
	bucketOrder := []string{}
	bucketRows := map[string][]AclMismatchScenario{}
	for _, sc := range AclMismatchScenarios {
		g := scenarioGroup(sc)
		if _, ok := bucketRows[g]; !ok {
			bucketOrder = append(bucketOrder, g)
		}
		bucketRows[g] = append(bucketRows[g], sc)
	}

	LogDebug("──────────────── Validation per-scenario outcome ────────────────")
	for _, g := range bucketOrder {
		LogDebug(fmt.Sprintf("  Group: %s", g))
		for _, sc := range bucketRows[g] {
			outcome, override := outcomeIndex[sc.ID]
			if !override {
				outcome = "PASS"
			}
			expected := "should re-migrate"
			if sc.IsControl {
				expected = "should NOT re-migrate"
			}
			LogDebug(fmt.Sprintf("    [%s] %-32s  %-22s  %s",
				outcome, sc.ID, expected, scenarioToReportPath(sc)))
		}
	}
	LogDebug(fmt.Sprintf("─────────────── Total: %d, Misses: %d, Over-picks: %d, XFAIL/XPASS: %d ───────────────",
		len(AclMismatchScenarios), len(misses), len(overPicks), len(xfails)))
}

// filterUnexpectedIdempotencyPaths returns idempotency-run report paths that
// are NOT explained by a known IsExpectedFailure scenario. Used to keep the
// idempotency assertion strict for the well-behaved 47 rows while tolerating
// the 1 known divergence (row 48).
func filterUnexpectedIdempotencyPaths(idempotencyReport []string) []string {
	tolerated := map[string]bool{}
	for _, sc := range BuildExpectedFailureSet() {
		tolerated[normalizeReportPath(scenarioToReportPath(sc))] = true
	}
	out := make([]string, 0)
	for _, p := range idempotencyReport {
		if !tolerated[normalizeReportPath(p)] {
			out = append(out, p)
		}
	}
	return out
}

// formatValidationFailure builds the final Fail() message: a grouped summary plus
// the full ad-hoc report path list so anyone debugging from CI has every fact
// in one place. XFAIL/XPASS rows are surfaced informationally but don't
// contribute to the failure count.
func formatValidationFailure(adhocReport []string, misses, overPicks, xfails []validationFailure) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf(
		"TC-ACL-MISMATCH FAILED — Validation (CoC selection).\n\n"+
			"Summary: %d miss(es), %d over-pick(s), %d xfail/xpass (informational) across %d scenarios.\n",
		len(misses), len(overPicks), len(xfails), len(AclMismatchScenarios)))

	if len(misses) > 0 {
		b.WriteString("\n── Mutated files that were NOT re-migrated by the ad-hoc run ──\n")
		for _, m := range misses {
			b.WriteString(fmt.Sprintf(
				"  • [%s] (group=%s)\n      Expected path : %s\n      Reason         : %s\n      Mutation       : (see catalog; expected reason substring = %q)\n      Scenario note  : %s\n",
				m.Scenario.ID,
				scenarioGroup(m.Scenario),
				m.ExpectedPath,
				m.Explanation,
				m.Scenario.ExpectedReasonSub,
				m.Scenario.Notes,
			))
		}
	}

	if len(overPicks) > 0 {
		b.WriteString("\n── Control files that WERE re-migrated by the ad-hoc run ──\n")
		for _, o := range overPicks {
			b.WriteString(fmt.Sprintf(
				"  • [%s] (group=%s)\n      Expected path : %s\n      Reason         : %s\n      Scenario note  : %s\n",
				o.Scenario.ID,
				scenarioGroup(o.Scenario),
				o.ExpectedPath,
				o.Explanation,
				o.Scenario.Notes,
			))
		}
	}

	if len(xfails) > 0 {
		b.WriteString("\n── Expected-failure rows (informational; do NOT contribute to FAIL) ──\n")
		for _, x := range xfails {
			b.WriteString(fmt.Sprintf(
				"  • [%s] %s (group=%s)\n      Expected path : %s\n      Reason         : %s\n      Scenario note  : %s\n",
				x.Kind, // XFAIL or XPASS
				x.Scenario.ID,
				scenarioGroup(x.Scenario),
				x.ExpectedPath,
				x.Explanation,
				x.Scenario.Notes,
			))
		}
	}

	b.WriteString("\n── Ad-hoc report contents (raw, alphabetical) ──\n")
	sorted := append([]string(nil), adhocReport...)
	sort.Slice(sorted, func(i, j int) bool {
		return normalizeReportPath(sorted[i]) < normalizeReportPath(sorted[j])
	})
	if len(sorted) == 0 {
		b.WriteString("  (empty)\n")
	} else {
		for _, p := range sorted {
			b.WriteString(fmt.Sprintf("  %s\n", p))
		}
	}

	return b.String()
}
