package activities

import (
	"context"
	"fmt"

	"go.uber.org/zap"
)

// IsRedisMemoryOk checks the Redis memory usage and returns true if it is
// below the configured threshold percentage.
func (a *Activities) IsRedisMemoryOk(ctx context.Context, jobRunID string) (bool, error) {
	a.Logger.Info("IsRedisMemoryOk", zap.String("jobRunId", jobRunID))

	memInfo, err := a.Redis.GetMemoryInfo(ctx)
	if err != nil {
		return false, fmt.Errorf("getting Redis memory info: %w", err)
	}

	threshold := float64(a.Config.RedisMemThreshold)
	if threshold <= 0 {
		threshold = 90
	}

	isOk := memInfo.UsagePercent < threshold

	a.Logger.Info("Redis memory check",
		zap.String("jobRunId", jobRunID),
		zap.Float64("usagePercent", memInfo.UsagePercent),
		zap.Float64("threshold", threshold),
		zap.Bool("isOk", isOk),
	)

	return isOk, nil
}
