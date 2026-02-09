//go:build !linux

package activities

import (
	"github.com/netapp/ndm/services/go-worker/types"
)

// executeStampMeta is a no-op on non-Linux platforms. The stampmeta package
// requires Linux-specific syscalls (unix.UtimesNanoAt, etc.) and is therefore
// only available with the linux build tag.
func (a *Activities) executeStampMeta(input CommandExecInput, cmd *types.Cmd, sourceFull, targetFull string) *CommandExecOutput {
	// Mark the STAMP_META op as completed since we cannot perform it.
	if op, exists := cmd.Ops[types.OpsStampMeta]; exists {
		op.Status = types.OpsStatusCompleted
		cmd.Ops[types.OpsStampMeta] = op
	}
	return &CommandExecOutput{
		SourceErrors:         make([]string, 0),
		TargetErrors:         make([]string, 0),
		ShouldUpdateItemInfo: true,
	}
}
