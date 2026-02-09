package config

import "os"

// CommandPattern constants identify the shell command patterns used for
// mounting, validating, and managing SMB and NFS file-server connections.
// These match the TypeScript CommandPattern enum in command.config.ts.
const (
	PatternValidateCred      = "validateCred"
	PatternListPaths         = "listPath"
	PatternCreatePathLink    = "createPathLink"
	PatternCheckMountPath    = "checkMountPath"
	PatternUnmountPath       = "unmountPath"
	PatternMountPath         = "mountPath"
	PatternUnlinkPath        = "unlinkPath"
	PatternVersionDetail     = "versionDetail"
	PatternDisconnectSession = "disconnectSession"
	PatternMountedFolderSize = "mountedFolderSize"
	PatternAvailableDiskSpace = "availableDiskSpace"
	PatternFstabPath         = "fstabPath"
	PatternSaveCreds         = "saveCreds"
)

// smbLinuxEnvMap maps command pattern names to the environment variable names
// that hold the corresponding SMB Linux shell command templates.
var smbLinuxEnvMap = map[string]string{
	PatternListPaths:         "SMB_LINUX_LIST_PATH_CMD",
	PatternMountPath:         "SMB_LINUX_MOUNT_PATH_CMD",
	PatternUnmountPath:       "SMB_LINUX_UNMOUNT_PATH_CMD",
	PatternVersionDetail:     "SMB_LINUX_VERSION_DETAIL_CMD",
	PatternAvailableDiskSpace: "LINUX_AVAILABLE_DISK_SPACE_CMD",
	PatternMountedFolderSize: "LINUX_USED_DISK_SPACE",
	PatternSaveCreds:         "LINUX_SAVE_CREDS_CMD",
}

// nfsLinuxEnvMap maps command pattern names to the environment variable names
// that hold the corresponding NFS Linux shell command templates.
var nfsLinuxEnvMap = map[string]string{
	PatternListPaths:         "NFS_LINUX_LIST_PATH_CMD",
	PatternMountPath:         "NFS_LINUX_MOUNT_PATH_CMD",
	PatternCheckMountPath:    "NFS_LINUX_CHECK_MOUNT_PATH_CMD",
	PatternUnmountPath:       "NFS_LINUX_UNMOUNT_PATH_CMD",
	PatternVersionDetail:     "NFS_LINUX_VERSION_DETAIL_CMD",
	PatternAvailableDiskSpace: "LINUX_AVAILABLE_DISK_SPACE_CMD",
	PatternMountedFolderSize: "LINUX_USED_DISK_SPACE",
	PatternFstabPath:         "LINUX_FSTAB_PATH",
}

// GetSMBCommand returns the shell command template for the given SMB command
// pattern by reading the corresponding Linux environment variable. Returns an
// empty string when the environment variable is not set.
func GetSMBCommand(pattern string) string {
	envKey, ok := smbLinuxEnvMap[pattern]
	if !ok {
		return ""
	}
	return os.Getenv(envKey)
}

// GetNFSCommand returns the shell command template for the given NFS command
// pattern by reading the corresponding Linux environment variable. Returns an
// empty string when the environment variable is not set.
func GetNFSCommand(pattern string) string {
	envKey, ok := nfsLinuxEnvMap[pattern]
	if !ok {
		return ""
	}
	return os.Getenv(envKey)
}
