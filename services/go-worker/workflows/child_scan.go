package workflows

import (
	"fmt"
	"strings"
	"time"

	"go.temporal.io/sdk/workflow"
)

const (
	// MAX_CONCURRENT_BATCHES limits how many directory batches are scanned
	// concurrently within a single iteration. Matches the TypeScript constant.
	MAX_CONCURRENT_BATCHES = 20

	// ITERATIONS_LIMIT triggers a ContinueAsNew to avoid hitting Temporal's
	// history size limit. Matches the TypeScript constant.
	ITERATIONS_LIMIT = 1000

	// CMD_LENGTH_VALIDATION_ITERATIONS is the iteration budget consumed by
	// command stream length validation checks. Matches the TypeScript constant.
	CMD_LENGTH_VALIDATION_ITERATIONS = 10
)

// ChildScanWorkflow scans directories in batches, optionally as part of a
// migration. It supports pause/stop/resume via the "scanActionSignal" signal
// and uses ContinueAsNew to avoid unbounded history growth.
//
// Registered with Temporal as "ChildScanWorkflow" for wire compatibility with
// the TypeScript version.
func ChildScanWorkflow(ctx workflow.Context, input ChildScanWorkflowInput) (*ChildScanWorkflowOutput, error) {
	logger := workflow.GetLogger(ctx)

	// Apply defaults matching TypeScript default parameter values.
	// In TypeScript: isInitialScan = true by default. In Go, bool zero value
	// is false. The only caller that intentionally sets IsInitialScan=false
	// is ContinueAsNew (which also sets DirBatchIds). So when both are at
	// their zero values, this is the first invocation and we must default to
	// true to match the TypeScript behaviour.
	if !input.IsInitialScan && len(input.DirBatchIds) == 0 {
		input.IsInitialScan = true
	}
	if len(input.DirsToScan) == 0 {
		input.DirsToScan = []string{"/"}
	}
	if input.BatchSize == 0 {
		input.BatchSize = 100
	}
	if input.ActionState == "" {
		input.ActionState = StatusRunning
	}
	if input.WorkerConcurrency == 0 {
		input.WorkerConcurrency = 20
	}

	// 1. Update status to Running.
	actCtx := workflow.WithActivityOptions(ctx, defaultActivityOptions())
	err := workflow.ExecuteActivity(actCtx, "UpdateStatus", UpdateStatusInput{
		JobRunID: input.JobRunID,
		Status:   StatusRunning,
	}).Get(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to update status to running: %w", err)
	}

	// 2. If migration, resolve SIDs and setup export path permissions.
	if input.IsMigration {
		resolveCtx := workflow.WithActivityOptions(ctx, shortActivityOptions())
		if err := workflow.ExecuteActivity(resolveCtx, "ResolveUsernamesToSids", input.JobRunID).Get(ctx, nil); err != nil {
			return nil, fmt.Errorf("failed to resolve usernames to SIDs: %w", err)
		}
		if err := workflow.ExecuteActivity(resolveCtx, "SetupExportPathPermission", input.JobRunID).Get(ctx, nil); err != nil {
			return nil, fmt.Errorf("failed to setup export path permission: %w", err)
		}
	}

	// 3. If initial scan, create the first directory batch.
	if input.IsInitialScan {
		createBatchCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: 10 * time.Minute,
		})
		var batchID string
		err := workflow.ExecuteActivity(createBatchCtx, "CreateInitialDirBatch", CreateInitialDirBatchInput{
			DirsToScan: input.DirsToScan,
			JobRunID:   input.JobRunID,
		}).Get(ctx, &batchID)
		if err != nil {
			return nil, fmt.Errorf("failed to create initial dir batch: %w", err)
		}
		input.DirBatchIds = append(input.DirBatchIds, batchID)
	}

	// Initialize output.
	output := &ChildScanWorkflowOutput{
		JobRunID:  input.JobRunID,
		FileCount: input.FileCount,
		DirCount:  input.DirCount,
		Status:    StatusRunning,
	}

	// Set up the action signal handler for pause/stop/resume.
	actionState := input.ActionState
	actionCh := workflow.GetSignalChannel(ctx, SignalScanAction)

	// Drain signals in a goroutine so they are processed between iterations.
	workflow.Go(ctx, func(gCtx workflow.Context) {
		for {
			var action string
			actionCh.Receive(gCtx, &action)
			actionState = action
			logger.Info(fmt.Sprintf("%s action signal called with value: %s", input.JobRunID, action))
		}
	})

	isStopRequested := false
	var errors []string
	iterations := 0
	dirBatchIds := input.DirBatchIds

	// 4. Main loop: process directory batches.
	for len(dirBatchIds) > 0 {
		// Check stop.
		if actionState == StatusStopped {
			isStopRequested = true
			logger.Info(fmt.Sprintf("Stopping ChildScanWorkflow %s as requested. %s", input.JobRunID, actionState))
			break
		}

		// Update status if paused or other non-running state.
		if err := updateJobStatusIfNotRunning(ctx, actionState, input.JobRunID); err != nil {
			logger.Error(fmt.Sprintf("Failed to update status for %s: %v", input.JobRunID, err))
		}

		// Wait while paused.
		_ = workflow.Await(ctx, func() bool {
			return actionState != StatusPaused
		})

		iterations += len(dirBatchIds) + CMD_LENGTH_VALIDATION_ITERATIONS

		// Execute batch scan.
		batchResult, err := executeBatchScan(ctx, ExecuteBatchScanInput{
			Batches:     dirBatchIds,
			BatchSize:   input.BatchSize,
			IsMigration: input.IsMigration,
			JobRunID:    input.JobRunID,
		})
		if err != nil {
			return nil, fmt.Errorf("batch scan failed: %w", err)
		}

		output.FileCount += batchResult.FileCount
		output.DirCount += batchResult.DirCount
		dirBatchIds = batchResult.BatchDirs

		if batchResult.Error != "" {
			errors = append(errors, batchResult.Error)
		}

		// ContinueAsNew to prevent history from growing too large.
		if iterations > ITERATIONS_LIMIT {
			logger.Warn(fmt.Sprintf("ChildScanWorkflow %s has exceeded %d iterations, continuing as new.", input.JobRunID, ITERATIONS_LIMIT))
			return nil, workflow.NewContinueAsNewError(ctx, ChildScanWorkflow, ChildScanWorkflowInput{
				JobRunID:          input.JobRunID,
				DirsToScan:        input.DirsToScan,
				DirBatchIds:       dirBatchIds,
				BatchSize:         input.BatchSize,
				DirCount:          output.DirCount,
				FileCount:         output.FileCount,
				IsMigration:       input.IsMigration,
				ActionState:       actionState,
				IsInitialScan:     false,
				WorkerConcurrency: input.WorkerConcurrency,
			})
		}
	}

	// 5. Determine final status.
	if len(errors) > 0 {
		logger.Error(fmt.Sprintf("[ERROR]ChildScanWorkflow %s encountered errors: %s", input.JobRunID, strings.Join(errors, ", ")))
		output.Error = strings.Join(errors, ", ")
		output.Status = StatusErrored
	} else {
		if isStopRequested {
			output.Status = StatusStopped
		} else {
			output.Status = StatusCompleted
		}
	}

	return output, nil
}

// validateCommandStreamLength polls the isCmdStreamLenValid activity until the
// command stream is within acceptable length, sleeping between checks. Matches
// the TypeScript validateCommandStreamLength function.
func validateCommandStreamLength(ctx workflow.Context, jobRunID string) {
	logger := workflow.GetLogger(ctx)
	checkCtx := workflow.WithActivityOptions(ctx, cmdStreamCheckOptions())

	maxChecks := 100
	for checkCount := 0; checkCount < maxChecks; checkCount++ {
		var isValid bool
		err := workflow.ExecuteActivity(checkCtx, "IsCmdStreamLenValid", jobRunID).Get(ctx, &isValid)
		if err != nil {
			logger.Error(fmt.Sprintf("[ERROR] Error validating command stream length for jobRunId %s: %v", jobRunID, err))
			continue
		}
		if isValid {
			return
		}
		logger.Warn(fmt.Sprintf("[WARNING] For jobRunId %s, Waiting for stream to be valid.", jobRunID))
		_ = workflow.Sleep(ctx, 30*time.Second)
	}
	logger.Warn(fmt.Sprintf("[WARNING] For jobRunId %s, Maximum checks reached. Exiting validation loop.", jobRunID))
}

// executeBatchScan processes directory batch IDs in chunks of
// MAX_CONCURRENT_BATCHES, executing scan activities concurrently within each
// chunk. Matches the TypeScript executeBatchScan function.
func executeBatchScan(ctx workflow.Context, input ExecuteBatchScanInput) (*ExecuteBatchScansOutput, error) {
	output := &ExecuteBatchScansOutput{}
	scanCtx := workflow.WithActivityOptions(ctx, scanActivityOptions())

	for i := 0; i < len(input.Batches); i += MAX_CONCURRENT_BATCHES {
		// For migrations, validate command stream length before each chunk.
		if input.IsMigration {
			validateCommandStreamLength(ctx, input.JobRunID)
		}

		end := i + MAX_CONCURRENT_BATCHES
		if end > len(input.Batches) {
			end = len(input.Batches)
		}
		batchSlice := input.Batches[i:end]

		// Execute scans concurrently for this chunk using futures.
		futures := make([]workflow.Future, len(batchSlice))
		for j, batchID := range batchSlice {
			futures[j] = workflow.ExecuteActivity(scanCtx, "ScanDirectories", ScanActivityInput{
				JobRunID:    input.JobRunID,
				BatchID:     batchID,
				BatchSize:   input.BatchSize,
				IsMigration: input.IsMigration,
			})
		}

		// Collect results.
		for _, f := range futures {
			var result ScanActivityOutput
			if err := f.Get(ctx, &result); err != nil {
				return nil, fmt.Errorf("scan activity failed: %w", err)
			}
			output.FileCount += result.FileCount
			output.DirCount += result.DirCount
			output.BatchDirs = append(output.BatchDirs, result.BatchDirs...)
			if result.Error != "" {
				output.Error = result.Error
			}
		}
	}

	return output, nil
}
