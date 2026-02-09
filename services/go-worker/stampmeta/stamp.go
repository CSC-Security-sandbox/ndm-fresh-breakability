//go:build linux

package stampmeta

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"golang.org/x/sys/unix"

	"github.com/netapp/ndm/services/go-worker/types"
)

// RedisIdentityLookup provides identity mapping resolution from Redis.
// Given a job run ID, an identity value, and an identity type (e.g. "GID" or "UID"),
// it returns the mapped identity string.
type RedisIdentityLookup interface {
	GetOwnerIdentity(jobRunID, id, idType string) (string, error)
}

// StampInput holds all inputs required by the StampMetaData function.
type StampInput struct {
	SourcePath  string
	TargetPath  string
	Command     *types.Cmd
	JobConfig   *types.JobConfig
	ErrorType   string
	RedisClient RedisIdentityLookup
	JobRunID    string
}

// StampOutput holds the results of a metadata stamping operation.
type StampOutput struct {
	SourceErrors         []string
	TargetErrors         []string
	ShouldUpdateItemInfo bool
}

// stampResult is an internal helper for collecting errors from individual
// stamping sub-operations.
type stampResult struct {
	SourceErrors []string
	TargetErrors []string
}

// StampMetaData performs Linux-only metadata stamping on a target file.
// It executes the following steps in order:
//  1. Checks if the STAMP_META operation exists and is not already COMPLETED.
//  2. Stamps GID and UID (with optional identity mapping via Redis).
//  3. Preserves access and modified time on the SOURCE path (if preserveAccessTime is set).
//  4. Stamps access and modified time on the TARGET path.
//  5. Stamps file permissions on the TARGET path (skipped for symlinks).
//  6. Updates the operation status to COMPLETED or ERROR.
func StampMetaData(input StampInput) *StampOutput {
	output := &StampOutput{
		SourceErrors:         make([]string, 0),
		TargetErrors:         make([]string, 0),
		ShouldUpdateItemInfo: true,
	}

	// Step 1: Check if STAMP_META op exists and is not COMPLETED.
	stampOp, exists := input.Command.Ops[types.OpsStampMeta]
	if !exists || stampOp.Status == types.OpsStatusCompleted {
		return output
	}

	// Step 2: Stamp GID and UID.
	gidUidResult := stampGIDandUID(input)
	output.SourceErrors = append(output.SourceErrors, gidUidResult.SourceErrors...)
	output.TargetErrors = append(output.TargetErrors, gidUidResult.TargetErrors...)

	// Step 3: Preserve access and modified time on source.
	preserveResult := preserveAccessAndModifiedTime(input)
	output.SourceErrors = append(output.SourceErrors, preserveResult.SourceErrors...)
	output.TargetErrors = append(output.TargetErrors, preserveResult.TargetErrors...)

	// Step 4: Stamp access and modified time on target.
	timeResult := stampAccessAndModifiedTime(input)
	output.SourceErrors = append(output.SourceErrors, timeResult.SourceErrors...)
	output.TargetErrors = append(output.TargetErrors, timeResult.TargetErrors...)

	// Step 5: Stamp permissions on target.
	permResult := stampPermission(input)
	output.SourceErrors = append(output.SourceErrors, permResult.SourceErrors...)
	output.TargetErrors = append(output.TargetErrors, permResult.TargetErrors...)

	// Step 6: Update operation status.
	if len(output.SourceErrors) > 0 || len(output.TargetErrors) > 0 {
		stampOp.Status = types.OpsStatusError
	} else {
		stampOp.Status = types.OpsStatusCompleted
	}
	input.Command.Ops[types.OpsStampMeta] = stampOp

	return output
}

// stampGIDandUID sets the group and user ownership on the target path.
// If identity mapping is available, it resolves mapped GID/UID via Redis.
// For symlinks it uses os.Lchown; otherwise os.Chown.
func stampGIDandUID(input StampInput) stampResult {
	result := stampResult{
		SourceErrors: make([]string, 0),
		TargetErrors: make([]string, 0),
	}

	meta := input.Command.Metadata
	if meta == nil {
		return result
	}

	// Only stamp if both GID and UID are present (non-zero).
	if meta.GID == 0 && meta.UID == 0 {
		return result
	}

	gid := meta.GID
	uid := meta.UID

	// If identity mapping is available, resolve mapped identities.
	if input.JobConfig != nil && input.JobConfig.Options != nil && input.JobConfig.Options.IsIdentityMappingAvailable {
		if input.RedisClient != nil {
			mappedGID, err := input.RedisClient.GetOwnerIdentity(
				input.JobRunID,
				strconv.Itoa(meta.GID),
				"GID",
			)
			if err == nil && mappedGID != "" {
				if parsed, parseErr := strconv.Atoi(mappedGID); parseErr == nil {
					gid = parsed
				}
			}

			mappedUID, err := input.RedisClient.GetOwnerIdentity(
				input.JobRunID,
				strconv.Itoa(meta.UID),
				"UID",
			)
			if err == nil && mappedUID != "" {
				if parsed, parseErr := strconv.Atoi(mappedUID); parseErr == nil {
					uid = parsed
				}
			}
		}
	}

	var err error
	if meta.IsSymLink {
		err = os.Lchown(input.TargetPath, uid, gid)
	} else {
		err = os.Chown(input.TargetPath, uid, gid)
	}

	if err != nil {
		result.TargetErrors = append(result.TargetErrors, errorCode(err))
	}

	return result
}

// preserveAccessAndModifiedTime restores the original access and modified times
// on the SOURCE path. This is only performed if the preserveAccessTime job
// option is enabled and valid timestamps are present in the command metadata.
// For symlinks it uses unix.UtimesNanoAt with AT_SYMLINK_NOFOLLOW; otherwise os.Chtimes.
func preserveAccessAndModifiedTime(input StampInput) stampResult {
	result := stampResult{
		SourceErrors: make([]string, 0),
		TargetErrors: make([]string, 0),
	}

	meta := input.Command.Metadata
	if meta == nil {
		return result
	}

	// Only preserve if the option is set.
	if input.JobConfig == nil || input.JobConfig.Options == nil || !input.JobConfig.Options.PreserveAccessTime {
		return result
	}

	if meta.Mtime.IsZero() && meta.Atime.IsZero() {
		return result
	}

	var err error
	if meta.IsSymLink {
		err = lutimes(input.SourcePath, meta.Atime, meta.Mtime)
	} else {
		err = os.Chtimes(input.SourcePath, meta.Atime, meta.Mtime)
	}

	if err != nil {
		result.SourceErrors = append(result.SourceErrors, errorCode(err))
	}

	return result
}

// stampAccessAndModifiedTime sets the access and modified times on the TARGET path.
// For symlinks it uses unix.UtimesNanoAt with AT_SYMLINK_NOFOLLOW; otherwise os.Chtimes.
func stampAccessAndModifiedTime(input StampInput) stampResult {
	result := stampResult{
		SourceErrors: make([]string, 0),
		TargetErrors: make([]string, 0),
	}

	meta := input.Command.Metadata
	if meta == nil {
		return result
	}

	if meta.Mtime.IsZero() && meta.Atime.IsZero() {
		return result
	}

	var err error
	if meta.IsSymLink {
		err = lutimes(input.TargetPath, meta.Atime, meta.Mtime)
	} else {
		err = os.Chtimes(input.TargetPath, meta.Atime, meta.Mtime)
	}

	if err != nil {
		result.TargetErrors = append(result.TargetErrors, errorCode(err))
	}

	return result
}

// stampPermission sets the file mode/permissions on the target path.
// This operation is skipped for symlinks because Linux does not support
// changing permissions on symbolic links themselves.
func stampPermission(input StampInput) stampResult {
	result := stampResult{
		SourceErrors: make([]string, 0),
		TargetErrors: make([]string, 0),
	}

	meta := input.Command.Metadata
	if meta == nil {
		return result
	}

	// Skip permission stamping for symlinks.
	if meta.IsSymLink {
		return result
	}

	if meta.Mode == 0 {
		return result
	}

	if err := os.Chmod(input.TargetPath, os.FileMode(meta.Mode)); err != nil {
		result.TargetErrors = append(result.TargetErrors, errorCode(err))
	}

	return result
}

// lutimes sets the access and modification times on a path without following
// symlinks. It uses unix.UtimesNanoAt with AT_FDCWD and AT_SYMLINK_NOFOLLOW.
func lutimes(path string, atime, mtime time.Time) error {
	atimeTs := unix.NsecToTimespec(atime.UnixNano())
	mtimeTs := unix.NsecToTimespec(mtime.UnixNano())

	return unix.UtimesNanoAt(unix.AT_FDCWD, path, []unix.Timespec{atimeTs, mtimeTs}, unix.AT_SYMLINK_NOFOLLOW)
}

// errorCode extracts a short error code string from an error. For *os.PathError
// and *os.LinkError it returns the underlying Err string (e.g. "EACCES").
// For other errors it returns the full error message.
func errorCode(err error) string {
	if err == nil {
		return ""
	}

	if pe, ok := err.(*os.PathError); ok {
		return fmt.Sprintf("%v", pe.Err)
	}
	if le, ok := err.(*os.LinkError); ok {
		return fmt.Sprintf("%v", le.Err)
	}
	return err.Error()
}
