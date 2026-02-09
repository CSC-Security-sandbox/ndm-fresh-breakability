package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGetSMBCommand_WithEnvVarSet(t *testing.T) {
	t.Setenv("SMB_LINUX_LIST_PATH_CMD", "smbclient -L //${HOST} -U ${USERNAME}%${PASSWORD}")

	result := GetSMBCommand(PatternListPaths)
	assert.Equal(t, "smbclient -L //${HOST} -U ${USERNAME}%${PASSWORD}", result)
}

func TestGetSMBCommand_WithMissingEnvVar(t *testing.T) {
	// Do not set the env var; it should return empty string
	result := GetSMBCommand(PatternListPaths)
	assert.Equal(t, "", result)
}

func TestGetSMBCommand_UnknownPattern(t *testing.T) {
	result := GetSMBCommand("unknownPattern")
	assert.Equal(t, "", result)
}

func TestGetSMBCommand_AllPatterns(t *testing.T) {
	tests := []struct {
		pattern string
		envKey  string
	}{
		{PatternListPaths, "SMB_LINUX_LIST_PATH_CMD"},
		{PatternMountPath, "SMB_LINUX_MOUNT_PATH_CMD"},
		{PatternUnmountPath, "SMB_LINUX_UNMOUNT_PATH_CMD"},
		{PatternVersionDetail, "SMB_LINUX_VERSION_DETAIL_CMD"},
		{PatternAvailableDiskSpace, "LINUX_AVAILABLE_DISK_SPACE_CMD"},
		{PatternMountedFolderSize, "LINUX_USED_DISK_SPACE"},
		{PatternSaveCreds, "LINUX_SAVE_CREDS_CMD"},
	}

	for _, tt := range tests {
		t.Run(tt.pattern, func(t *testing.T) {
			t.Setenv(tt.envKey, "test-command-"+tt.pattern)
			result := GetSMBCommand(tt.pattern)
			assert.Equal(t, "test-command-"+tt.pattern, result)
		})
	}
}

func TestGetNFSCommand_WithEnvVarSet(t *testing.T) {
	t.Setenv("NFS_LINUX_LIST_PATH_CMD", "showmount -e ${HOST}")

	result := GetNFSCommand(PatternListPaths)
	assert.Equal(t, "showmount -e ${HOST}", result)
}

func TestGetNFSCommand_WithMissingEnvVar(t *testing.T) {
	result := GetNFSCommand(PatternListPaths)
	assert.Equal(t, "", result)
}

func TestGetNFSCommand_UnknownPattern(t *testing.T) {
	result := GetNFSCommand("unknownPattern")
	assert.Equal(t, "", result)
}

func TestGetNFSCommand_AllPatterns(t *testing.T) {
	tests := []struct {
		pattern string
		envKey  string
	}{
		{PatternListPaths, "NFS_LINUX_LIST_PATH_CMD"},
		{PatternMountPath, "NFS_LINUX_MOUNT_PATH_CMD"},
		{PatternCheckMountPath, "NFS_LINUX_CHECK_MOUNT_PATH_CMD"},
		{PatternUnmountPath, "NFS_LINUX_UNMOUNT_PATH_CMD"},
		{PatternVersionDetail, "NFS_LINUX_VERSION_DETAIL_CMD"},
		{PatternAvailableDiskSpace, "LINUX_AVAILABLE_DISK_SPACE_CMD"},
		{PatternMountedFolderSize, "LINUX_USED_DISK_SPACE"},
		{PatternFstabPath, "LINUX_FSTAB_PATH"},
	}

	for _, tt := range tests {
		t.Run(tt.pattern, func(t *testing.T) {
			t.Setenv(tt.envKey, "nfs-cmd-"+tt.pattern)
			result := GetNFSCommand(tt.pattern)
			assert.Equal(t, "nfs-cmd-"+tt.pattern, result)
		})
	}
}

func TestGetSMBCommand_PatternNotInNFS(t *testing.T) {
	// PatternCheckMountPath is only in NFS map, not SMB
	t.Setenv("NFS_LINUX_CHECK_MOUNT_PATH_CMD", "check-mount")
	result := GetSMBCommand(PatternCheckMountPath)
	assert.Equal(t, "", result)
}

func TestGetNFSCommand_PatternNotInSMB(t *testing.T) {
	// PatternSaveCreds is only in SMB map, not NFS
	t.Setenv("LINUX_SAVE_CREDS_CMD", "save-creds")
	result := GetNFSCommand(PatternSaveCreds)
	assert.Equal(t, "", result)
}
