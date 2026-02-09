package activities

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/redisclient"
	"github.com/netapp/ndm/services/go-worker/types"
)

// maxMigrationCommandBatch is the batch size for publishing commands during
// migration scans. It is loaded from config at runtime, but we use a sensible
// default when the config value is not set.
const defaultMaxMigrationCommand = 100

// MigrateScanDirectory scans a source directory and its corresponding target
// directory, comparing entries to determine which operations (copy, remove,
// stamp metadata) are needed. Commands are published to the Redis command
// stream in batches.
func (a *Activities) MigrateScanDirectory(
	jobContext *redisclient.JobManagerContext,
	sourcePath, sourcePrefix string,
	targetPath, targetPrefix string,
	command types.Cmd,
	excludePatterns string,
	skipFile string,
	olderThan time.Time,
	errorType string,
) (*ScanDirectoryOutput, error) {
	ctx := context.Background()
	output := &ScanDirectoryOutput{
		SubDirs: make([]string, 0),
	}

	maxBatch := a.Config.MaxMigrationCommand
	if maxBatch <= 0 {
		maxBatch = defaultMaxMigrationCommand
	}

	// Read source directory entries.
	sourceEntries, err := os.ReadDir(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("reading source directory %s: %w", sourcePath, err)
	}

	// Read target directory entries into a lookup map.
	targetMap := make(map[string]os.DirEntry)
	targetEntries, err := os.ReadDir(targetPath)
	if err != nil {
		// Target directory may not exist yet, which is fine.
		if !os.IsNotExist(err) {
			a.Logger.Warn("failed to read target directory",
				zap.String("targetPath", targetPath),
				zap.Error(err),
			)
		}
	} else {
		for _, entry := range targetEntries {
			targetMap[entry.Name()] = entry
		}
	}

	// Track which target entries have a corresponding source entry.
	sourceNames := make(map[string]bool)

	// Buffer for batching commands.
	cmdBuffer := make([]types.Cmd, 0, maxBatch)

	flushCommands := func() error {
		if len(cmdBuffer) == 0 {
			return nil
		}
		if err := jobContext.PublishBulkToCommandStream(ctx, cmdBuffer); err != nil {
			return fmt.Errorf("publishing command batch: %w", err)
		}
		cmdBuffer = cmdBuffer[:0]
		return nil
	}

	for _, entry := range sourceEntries {
		name := entry.Name()
		sourceNames[name] = true

		sourceFullPath := filepath.Join(sourcePath, name)

		// Get source file info.
		sourceInfo, err := entry.Info()
		if err != nil {
			a.Logger.Error("failed to get source file info",
				zap.String("path", sourceFullPath),
				zap.Error(err),
			)
			continue
		}

		// Check exclusions.
		relativePath := removePrefix(sourceFullPath, sourcePrefix)
		if shouldExcludeOrSkip(sourceFullPath, sourceInfo, excludePatterns, skipFile, olderThan, types.JobTypeMigration) {
			continue
		}

		// Check if this is a symlink.
		sourceLstat, lstatErr := os.Lstat(sourceFullPath)
		isSymlink := lstatErr == nil && sourceLstat.Mode()&os.ModeSymlink != 0

		if entry.IsDir() && !isSymlink {
			// Directory: add to sub-dirs for recursive scanning.
			output.DirCount++
			output.SubDirs = append(output.SubDirs, relativePath)

			// Create COPY_DIR command.
			cmd := types.Cmd{
				ID:     uuid.New().String(),
				FPath:  relativePath,
				Status: types.CommandStatusReady,
				IsDir:  true,
				Ops:    make(types.Operations),
			}
			cmd.Ops[types.OpsCopyDir] = types.Ops{
				Status: types.OpsStatusReady,
			}
			cmd.Ops[types.OpsStampMeta] = types.Ops{
				Status: types.OpsStatusReady,
			}
			cmd.Metadata = buildCmdMeta(sourceLstat, isSymlink)

			cmdBuffer = append(cmdBuffer, cmd)
		} else if isSymlink {
			// Symbolic link.
			output.FileCount++

			cmd := types.Cmd{
				ID:     uuid.New().String(),
				FPath:  relativePath,
				Status: types.CommandStatusReady,
				IsDir:  false,
				Ops:    make(types.Operations),
			}
			cmd.Ops[types.OpsCopySymlink] = types.Ops{
				Status: types.OpsStatusReady,
			}
			cmd.Ops[types.OpsStampMeta] = types.Ops{
				Status: types.OpsStatusReady,
			}
			cmd.Metadata = buildCmdMeta(sourceLstat, true)

			cmdBuffer = append(cmdBuffer, cmd)
		} else {
			// Regular file.
			output.FileCount++

			cmd := types.Cmd{
				ID:     uuid.New().String(),
				FPath:  relativePath,
				Status: types.CommandStatusReady,
				IsDir:  false,
				Ops:    make(types.Operations),
			}

			// Check if target exists and decide what ops are needed.
			targetEntry, targetExists := targetMap[name]
			if targetExists {
				targetInfo, tErr := targetEntry.Info()
				if tErr == nil {
					if isContentUpdate(sourceInfo, targetInfo) {
						cmd.Ops[types.OpsCopyFile] = types.Ops{
							Status: types.OpsStatusReady,
						}
						cmd.Ops[types.OpsStampMeta] = types.Ops{
							Status: types.OpsStatusReady,
						}
					} else if isMetaUpdated(sourceInfo, targetInfo, a.Config.MetaToleranceMs) {
						cmd.Ops[types.OpsStampMeta] = types.Ops{
							Status: types.OpsStatusReady,
						}
					} else {
						// Nothing to do; skip this file.
						continue
					}
				} else {
					// Cannot stat target, treat as needing full copy.
					cmd.Ops[types.OpsCopyFile] = types.Ops{
						Status: types.OpsStatusReady,
					}
					cmd.Ops[types.OpsStampMeta] = types.Ops{
						Status: types.OpsStatusReady,
					}
				}
			} else {
				// Target does not exist; full copy.
				cmd.Ops[types.OpsCopyFile] = types.Ops{
					Status: types.OpsStatusReady,
				}
				cmd.Ops[types.OpsStampMeta] = types.Ops{
					Status: types.OpsStatusReady,
				}
			}

			cmd.Metadata = buildCmdMeta(sourceInfo, false)
			cmdBuffer = append(cmdBuffer, cmd)
		}

		// Flush when buffer is full.
		if len(cmdBuffer) >= maxBatch {
			if err := flushCommands(); err != nil {
				return nil, err
			}
		}
	}

	// Handle delete detection: items in target not in source get REMOVE commands.
	jobCfg := jobContext.JobConfig
	if jobCfg != nil && !jobCfg.SkipDelete {
		for name, targetEntry := range targetMap {
			if sourceNames[name] {
				continue
			}

			targetFullPath := filepath.Join(targetPath, name)
			relativePath := removePrefix(targetFullPath, targetPrefix)

			if shouldExcludeForDelete(targetFullPath, excludePatterns) {
				continue
			}

			cmd := types.Cmd{
				ID:     uuid.New().String(),
				FPath:  relativePath,
				Status: types.CommandStatusReady,
				IsDir:  targetEntry.IsDir(),
				Ops:    make(types.Operations),
			}

			if targetEntry.IsDir() {
				cmd.Ops[types.OpsRemoveDir] = types.Ops{
					Status: types.OpsStatusReady,
				}
			} else {
				cmd.Ops[types.OpsRemoveFile] = types.Ops{
					Status: types.OpsStatusReady,
				}
			}

			cmdBuffer = append(cmdBuffer, cmd)

			if len(cmdBuffer) >= maxBatch {
				if err := flushCommands(); err != nil {
					return nil, err
				}
			}
		}
	}

	// Flush remaining commands.
	if err := flushCommands(); err != nil {
		return nil, err
	}

	return output, nil
}

// buildCmdMeta constructs a CmdMeta from an os.FileInfo.
func buildCmdMeta(info os.FileInfo, isSymlink bool) *types.CmdMeta {
	if info == nil {
		return nil
	}

	meta := &types.CmdMeta{
		Size:      info.Size(),
		Mtime:     info.ModTime(),
		Mode:      int(info.Mode().Perm()),
		IsSymLink: isSymlink,
	}

	// Inode extraction is platform-specific; use a helper that returns 0 on
	// unsupported platforms.
	meta.Inode = getInode(info)

	return meta
}

// getInode extracts the inode number from an os.FileInfo. On platforms where
// the underlying Sys() does not return *syscall.Stat_t, it returns 0.
func getInode(info os.FileInfo) int64 {
	if info == nil {
		return 0
	}
	sys := info.Sys()
	if sys == nil {
		return 0
	}

	// We use a type switch to avoid importing syscall directly, which allows
	// the code to compile on all platforms.
	type statIno interface {
		Ino() uint64
	}
	if s, ok := sys.(statIno); ok {
		return int64(s.Ino())
	}

	// Fallback: try to read from the struct field via reflection-free approach.
	// On Linux, Sys() returns *syscall.Stat_t with an Ino field, but since we
	// cannot import syscall without a build tag, we return 0 here.
	// The stampmeta package (linux-only) handles inode stamping.
	return 0
}

// resolveRelativePath computes the relative path by removing the prefix.
func resolveRelativePath(fullPath, prefix string) string {
	return strings.TrimPrefix(fullPath, prefix)
}
