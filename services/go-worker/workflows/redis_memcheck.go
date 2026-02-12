package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// RedisMemoryCheckWorkflow polls the CheckMemoryUsage activity until Redis
// memory is within acceptable limits. Uses ContinueAsNew after a maximum number
// of iterations to prevent history growth. The function name matches the
// TypeScript export "RedisMemoryCheckWorkflow" for wire compatibility.
func RedisMemoryCheckWorkflow(ctx workflow.Context, traceID string) (bool, error) {
	logger := workflow.GetLogger(ctx)

	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 1 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:    3,
			InitialInterval:   1 * time.Second,
			BackoffCoefficient: 2,
			MaximumInterval:   10 * time.Second,
		},
	})

	maxIterations := 30
	sleepTime := 10 * time.Second

	for iterations := 0; ; iterations++ {
		var isMemoryOk bool
		err := workflow.ExecuteActivity(actCtx, "CheckMemoryUsage", traceID).Get(ctx, &isMemoryOk)
		if err != nil {
			logger.Error(fmt.Sprintf("Error in RedisMemoryCheckWorkflow: %v", err))
			// Continue to next iteration on error.
		} else if isMemoryOk {
			return true, nil
		} else {
			logger.Info("Redis memory usage beyond threshold. Sleeping..")
			if err := workflow.Sleep(ctx, sleepTime); err != nil {
				return false, err
			}
		}

		if iterations > maxIterations {
			logger.Error("Max iterations reached. Redis memory check failed.")
			return false, workflow.NewContinueAsNewError(ctx, RedisMemoryCheckWorkflow, traceID)
		}
	}
}
