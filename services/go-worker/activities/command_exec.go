package activities

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/filecopy"
	"github.com/netapp/ndm/services/go-worker/redisclient"
	"github.com/netapp/ndm/services/go-worker/types"
)

// CommandExecInput contains the parameters for executing a single command.
type CommandExecInput struct {
	Command    types.Cmd                      `json:"command"`
	JobContext *redisclient.JobManagerContext  `json:"-"`
	SourcePath string                         `json:"sourcePath"`
	TargetPath string                         `json:"targetPath"`
	ErrorType  string                         `json:"errorType"`
}

// CommandExecOutput contains the results of executing a single command.
type CommandExecOutput struct {
	SourceErrors         []string `json:"sourceErrors"`
	TargetErrors         []string `json:"targetErrors"`
	ShouldUpdateItemInfo bool     `json:"shouldUpdateItemInfo"`
}

// ExecuteCommand routes a single command to the appropriate handler based on
// its operations (COPY_FILE, COPY_DIR, COPY_SYMLINK, REMOVE_FILE, REMOVE_DIR)
// and publishes item info after completion.
func (a *Activities) ExecuteCommand(input CommandExecInput) (*CommandExecOutput, error) {
	cmd := input.Command
	ctx := context.Background()

	output := &CommandExecOutput{
		SourceErrors:         make([]string, 0),
		TargetErrors:         make([]string, 0),
		ShouldUpdateItemInfo: true,
	}

	sourceFull := filepath.Join(input.SourcePath, cmd.FPath)
	targetFull := filepath.Join(input.TargetPath, cmd.FPath)

	// Execute COPY_SYMLINK operation.
	if op, exists := cmd.Ops[types.OpsCopySymlink]; exists && op.Status == types.OpsStatusReady {
		if err := a.execCopySymlink(sourceFull, targetFull); err != nil {
			a.Logger.Error("copy symlink failed",
				zap.String("source", sourceFull),
				zap.String("target", targetFull),
				zap.Error(err),
			)
			output.SourceErrors = append(output.SourceErrors, err.Error())
			op.Status = types.OpsStatusError
			cmd.Ops[types.OpsCopySymlink] = op

			// Publish error.
			dmErr := NewDMError(
				"COPY_SYMLINK_ERROR",
				types.OriginSource,
				types.OperationCopyContent,
				input.ErrorType,
				cmd.ID,
				err,
				types.ErroredFile{FileName: filepath.Base(cmd.FPath), FilePath: cmd.FPath},
			)
			if pubErr := input.JobContext.PublishToErrorStream(ctx, dmErr); pubErr != nil {
				a.Logger.Error("failed to publish symlink error", zap.Error(pubErr))
			}
		} else {
			op.Status = types.OpsStatusCompleted
			cmd.Ops[types.OpsCopySymlink] = op
		}
	}

	// Execute COPY_FILE operation.
	if op, exists := cmd.Ops[types.OpsCopyFile]; exists && op.Status == types.OpsStatusReady {
		checksums, err := a.execCopyFile(sourceFull, targetFull, cmd)
		if err != nil {
			a.Logger.Error("copy file failed",
				zap.String("source", sourceFull),
				zap.String("target", targetFull),
				zap.Error(err),
			)
			output.TargetErrors = append(output.TargetErrors, err.Error())
			op.Status = types.OpsStatusError
			cmd.Ops[types.OpsCopyFile] = op

			dmErr := NewDMError(
				"COPY_FILE_ERROR",
				types.OriginDestination,
				types.OperationCopyContent,
				input.ErrorType,
				cmd.ID,
				err,
				types.ErroredFile{FileName: filepath.Base(cmd.FPath), FilePath: cmd.FPath},
			)
			if pubErr := input.JobContext.PublishToErrorStream(ctx, dmErr); pubErr != nil {
				a.Logger.Error("failed to publish copy file error", zap.Error(pubErr))
			}
		} else {
			// Verify checksums match.
			if checksums != nil && checksums.SourceChecksum != checksums.TargetChecksum {
				errMsg := fmt.Sprintf("checksum mismatch: source=%s target=%s", checksums.SourceChecksum, checksums.TargetChecksum)
				a.Logger.Error(errMsg, zap.String("file", cmd.FPath))
				output.TargetErrors = append(output.TargetErrors, errMsg)
				op.Status = types.OpsStatusError
			} else {
				op.Status = types.OpsStatusCompleted
				if checksums != nil && op.Params == nil {
					op.Params = make(map[string]any)
				}
				if checksums != nil {
					op.Params["sourceChecksum"] = checksums.SourceChecksum
					op.Params["targetChecksum"] = checksums.TargetChecksum
				}
			}
			cmd.Ops[types.OpsCopyFile] = op
		}
	}

	// Execute COPY_DIR operation.
	if op, exists := cmd.Ops[types.OpsCopyDir]; exists && op.Status == types.OpsStatusReady {
		if err := a.execCopyDir(targetFull); err != nil {
			a.Logger.Error("copy dir failed",
				zap.String("target", targetFull),
				zap.Error(err),
			)
			output.TargetErrors = append(output.TargetErrors, err.Error())
			op.Status = types.OpsStatusError
			cmd.Ops[types.OpsCopyDir] = op

			dmErr := NewDMError(
				"COPY_DIR_ERROR",
				types.OriginDestination,
				types.OperationCopyContent,
				input.ErrorType,
				cmd.ID,
				err,
				types.ErroredFile{FileName: filepath.Base(cmd.FPath), FilePath: cmd.FPath},
			)
			if pubErr := input.JobContext.PublishToErrorStream(ctx, dmErr); pubErr != nil {
				a.Logger.Error("failed to publish copy dir error", zap.Error(pubErr))
			}
		} else {
			op.Status = types.OpsStatusCompleted
			cmd.Ops[types.OpsCopyDir] = op
		}
	}

	// Execute REMOVE_FILE operation.
	if op, exists := cmd.Ops[types.OpsRemoveFile]; exists && op.Status == types.OpsStatusReady {
		if err := os.Remove(targetFull); err != nil && !os.IsNotExist(err) {
			a.Logger.Error("remove file failed",
				zap.String("target", targetFull),
				zap.Error(err),
			)
			output.TargetErrors = append(output.TargetErrors, err.Error())
			op.Status = types.OpsStatusError
			cmd.Ops[types.OpsRemoveFile] = op
		} else {
			op.Status = types.OpsStatusCompleted
			cmd.Ops[types.OpsRemoveFile] = op
		}
	}

	// Execute REMOVE_DIR operation.
	if op, exists := cmd.Ops[types.OpsRemoveDir]; exists && op.Status == types.OpsStatusReady {
		if err := os.RemoveAll(targetFull); err != nil {
			a.Logger.Error("remove dir failed",
				zap.String("target", targetFull),
				zap.Error(err),
			)
			output.TargetErrors = append(output.TargetErrors, err.Error())
			op.Status = types.OpsStatusError
			cmd.Ops[types.OpsRemoveDir] = op
		} else {
			op.Status = types.OpsStatusCompleted
			cmd.Ops[types.OpsRemoveDir] = op
		}
	}

	// Execute STAMP_META operation via stampmeta package.
	// Note: stampmeta.StampMetaData is Linux-only (build tag). We call a
	// wrapper that is conditionally compiled.
	if _, exists := cmd.Ops[types.OpsStampMeta]; exists {
		stampOutput := a.executeStampMeta(input, &cmd, sourceFull, targetFull)
		if stampOutput != nil {
			output.SourceErrors = append(output.SourceErrors, stampOutput.SourceErrors...)
			output.TargetErrors = append(output.TargetErrors, stampOutput.TargetErrors...)
			output.ShouldUpdateItemInfo = stampOutput.ShouldUpdateItemInfo
		}
	}

	// Publish item info to file stream after processing.
	if output.ShouldUpdateItemInfo && input.JobContext != nil {
		a.publishItemInfo(ctx, input.JobContext, cmd, sourceFull, targetFull)
	}

	// Update command status based on ops.
	allCompleted := true
	hasError := false
	for _, op := range cmd.Ops {
		if op.Status == types.OpsStatusError {
			hasError = true
		}
		if op.Status != types.OpsStatusCompleted {
			allCompleted = false
		}
	}

	if hasError {
		cmd.Status = types.CommandStatusError
	} else if allCompleted {
		cmd.Status = types.CommandStatusCompleted
	}

	return output, nil
}

// execCopySymlink reads the symlink target from source and creates a symlink
// at the target path.
func (a *Activities) execCopySymlink(source, target string) error {
	linkTarget, err := os.Readlink(source)
	if err != nil {
		return fmt.Errorf("reading symlink %s: %w", source, err)
	}

	// Remove existing target if it exists.
	if _, err := os.Lstat(target); err == nil {
		if rmErr := os.Remove(target); rmErr != nil {
			return fmt.Errorf("removing existing target %s: %w", target, rmErr)
		}
	}

	// Ensure parent directory exists.
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return fmt.Errorf("creating parent dir for %s: %w", target, err)
	}

	if err := os.Symlink(linkTarget, target); err != nil {
		return fmt.Errorf("creating symlink %s -> %s: %w", target, linkTarget, err)
	}

	return nil
}

// execCopyFile submits a copy task to the CopyPool and waits for the result.
func (a *Activities) execCopyFile(source, target string, cmd types.Cmd) (*filecopy.Checksums, error) {
	var fileSize int64
	if cmd.Metadata != nil {
		fileSize = cmd.Metadata.Size
	}

	task := filecopy.CopyTask{
		ID:            cmd.ID,
		Source:        source,
		Dest:          target,
		Size:          fileSize,
		MaxBufferSize: a.Config.MaxBufferSize,
		ResultCh:      make(chan filecopy.CopyResult, 1),
	}

	resultCh := a.CopyPool.Submit(task)
	result := <-resultCh

	if result.Err != nil {
		return nil, result.Err
	}

	return result.Checksums, nil
}

// execCopyDir creates the target directory with default permissions.
func (a *Activities) execCopyDir(target string) error {
	return os.MkdirAll(target, 0755)
}

// publishItemInfo builds and publishes an ItemInfo record to the file stream.
func (a *Activities) publishItemInfo(ctx context.Context, jobContext *redisclient.JobManagerContext, cmd types.Cmd, sourceFull, targetFull string) {
	item := types.ItemInfo{
		FileName:    filepath.Base(cmd.FPath),
		IsDirectory: cmd.IsDir,
	}

	// Populate source metadata.
	if sourceInfo, err := os.Lstat(sourceFull); err == nil {
		item.Size = sourceInfo.Size()
		item.SourceMeta = types.ItemMeta{
			ModifiedTime: sourceInfo.ModTime(),
			Permission:   fmt.Sprintf("%04o", sourceInfo.Mode().Perm()),
		}
		item.IsSymbolicLink = sourceInfo.Mode()&os.ModeSymlink != 0
	}

	// Populate target metadata.
	if targetInfo, err := os.Lstat(targetFull); err == nil {
		item.TargetMeta = types.ItemMeta{
			ModifiedTime: targetInfo.ModTime(),
			Permission:   fmt.Sprintf("%04o", targetInfo.Mode().Perm()),
		}
	}

	ext := filepath.Ext(cmd.FPath)
	item.Extension = ext

	if item.IsDirectory {
		item.FileType = types.FileTypeDirectory
	} else if item.IsSymbolicLink {
		item.FileType = types.FileTypeSymbolicLink
	} else {
		item.FileType = types.FileTypeFile
	}

	depth := 0
	parts := cmd.FPath
	for _, c := range parts {
		if c == '/' {
			depth++
		}
	}
	item.Depth = depth

	if err := jobContext.PublishToFileStream(ctx, item); err != nil {
		a.Logger.Error("failed to publish item info",
			zap.String("file", cmd.FPath),
			zap.Error(err),
		)
	}
}
