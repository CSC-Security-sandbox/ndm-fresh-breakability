//go:build linux

package activities

import (
	"github.com/netapp/ndm/services/go-worker/stampmeta"
	"github.com/netapp/ndm/services/go-worker/types"
)

// executeStampMeta invokes the Linux-specific stampmeta.StampMetaData function.
func (a *Activities) executeStampMeta(input CommandExecInput, cmd *types.Cmd, sourceFull, targetFull string) *CommandExecOutput {
	stampInput := stampmeta.StampInput{
		SourcePath:  sourceFull,
		TargetPath:  targetFull,
		Command:     cmd,
		JobConfig:   input.JobContext.JobConfig,
		ErrorType:   input.ErrorType,
		RedisClient: a.Redis,
		JobRunID:    input.JobContext.JobRunID,
	}

	stampOutput := stampmeta.StampMetaData(stampInput)
	if stampOutput == nil {
		return nil
	}

	return &CommandExecOutput{
		SourceErrors:         stampOutput.SourceErrors,
		TargetErrors:         stampOutput.TargetErrors,
		ShouldUpdateItemInfo: stampOutput.ShouldUpdateItemInfo,
	}
}
