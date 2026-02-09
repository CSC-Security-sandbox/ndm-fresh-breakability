package workflows

import (
	"fmt"

	"go.temporal.io/sdk/workflow"
)

// handleReporting waits for a "reportingSignal" to determine the type of
// report to generate, then executes the appropriate report generation
// activities. It also registers an "isReported" query handler. Matches the
// TypeScript handleReporting function.
func handleReporting(ctx workflow.Context, traceID, status string) (string, error) {
	logger := workflow.GetLogger(ctx)

	isBlocked := true
	var reportType string

	// Register query handler for isReported.
	err := workflow.SetQueryHandler(ctx, QueryIsReported, func() (bool, error) {
		return !isBlocked, nil
	})
	if err != nil {
		return "", fmt.Errorf("failed to set isReported query handler: %w", err)
	}

	// Set up reporting signal handler.
	reportingCh := workflow.GetSignalChannel(ctx, SignalReporting)
	workflow.Go(ctx, func(gCtx workflow.Context) {
		var input string
		reportingCh.Receive(gCtx, &input)
		if input == JobReportTypeCutOver || input == JobReportTypeMigrate || input == JobReportTypeDiscover {
			reportType = input
		}
		isBlocked = false
	})

	logger.Info("Waiting for reporting signal...")

	// Wait until the reporting signal is received.
	_ = workflow.Await(ctx, func() bool {
		return !isBlocked
	})

	// Map the job run status based on report type.
	jobRunStatus := getMappedJobRunStatus(status, reportType)

	// Update status.
	actCtx := workflow.WithActivityOptions(ctx, shortActivityOptions())
	if err := workflow.ExecuteActivity(actCtx, "UpdateStatus", UpdateStatusInput{
		JobRunID: traceID,
		Status:   jobRunStatus,
	}).Get(ctx, nil); err != nil {
		return "", fmt.Errorf("failed to update status during reporting: %w", err)
	}

	// Generate the appropriate report.
	switch reportType {
	case JobReportTypeCutOver:
		if err := workflow.ExecuteActivity(actCtx, "GenerateCOCReport", traceID).Get(ctx, nil); err != nil {
			return "", fmt.Errorf("failed to generate COC report: %w", err)
		}
		if err := workflow.ExecuteActivity(actCtx, "GenerateJobsReport", traceID).Get(ctx, nil); err != nil {
			return "", fmt.Errorf("failed to generate jobs report: %w", err)
		}

	case JobReportTypeDiscover:
		// Discovery report is generated via a child workflow on the reports
		// task queue.
		reportChildCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:        fmt.Sprintf("GenerateDiscoveryReportWorkflow-%s-report", traceID),
			TaskQueue:         "reports-TaskQueue",
			ParentClosePolicy: 2, // ABANDON
		})
		reportFuture := workflow.ExecuteChildWorkflow(reportChildCtx, "GenerateDiscoveryReportWorkflow", ReportingInput{
			JobRunID: traceID,
		})
		// We start the child but do not necessarily wait for it to complete
		// (matching the TS startChild behavior). However, since startChild in
		// TS returns a handle whose result is not awaited here, we just fire
		// and forget.
		_ = reportFuture

	case JobReportTypeMigrate:
		if err := workflow.ExecuteActivity(actCtx, "GenerateCOCReport", traceID).Get(ctx, nil); err != nil {
			return "", fmt.Errorf("failed to generate COC report for migration: %w", err)
		}

	default:
		return "", fmt.Errorf("unknown REPORT TYPE: %s", reportType)
	}

	return "REPORTING COMPLETED", nil
}
