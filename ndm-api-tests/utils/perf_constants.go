package utils

import (
	"os"
)

const (
	// worker config constants for MAX_BUFFER_SIZE
	OneMB   = 1 * 1024 * 1024 // 1,048,576 bytes // default value in worker.env is 1048576
	TwoMB   = 2 * 1024 * 1024 // 2,097,152 bytes
	ThreeMB = 3 * 1024 * 1024 // 3,145,728 bytes
	FourMB  = 4 * 1024 * 1024 // 4,194,304 bytes

	// SMB worker env path
	SMBWorkerEnvPath = `C:\datamigrator\binary\.env`
	// NFS worker env path
	NFSWorkerEnvPath = "/opt/datamigrator/conf/worker.env"
)

// UpdatePerfConfVariables updates the global variables used for performance testing based on the provided protocol type.
func UpdatePerfConfVariables(protocolType string) {
	PROTOCOL_TYPE = Protocol(protocolType)

	switch PROTOCOL_TYPE {
	case ProtocolSMB:
		NDM_WORKERS_HOST = os.Getenv("PERF_SMB_NDM_WORKERS_HOST")
		NDM_WORKERS_USER_NAME = os.Getenv("PERF_SMB_NDM_WORKERS_USER_NAME")
		NDM_WORKERS_PORT = os.Getenv("PERF_SMB_NDM_WORKERS_PORT")
		NDM_WORKERS_PASSWORD = os.Getenv("PERF_SMB_NDM_WORKERS_PASSWORD")
		SOURCE_VOLUMES_LIST = os.Getenv("PERF_SMB_SOURCE_VOLUMES")
		DESTINATION_VOLUMES_LIST = os.Getenv("PERF_SMB_DESTINATION_VOLUMES")
		SOURCE_HOST_IP = os.Getenv("PERF_SMB_SOURCE_HOST_IP")
		DESTINATION_HOST_IP = os.Getenv("PERF_SMB_DESTINATION_HOST_IP")

		PROTOCOL_USERNAME = os.Getenv("PERF_SMB_PROTOCOL_USERNAME")
		PROTOCOL_PASSWORD = os.Getenv("PERF_SMB_PROTOCOL_PASSWORD")

		SMB_EXECUTABLE_FILENAME = os.Getenv("PERF_SMB_EXECUTABLE_FILENAME")
		ProtocolVersion3 = ProtocolVersionSMB_V3

	case ProtocolNFS:
		NDM_WORKERS_HOST = os.Getenv("PERF_NFS_NDM_WORKERS_HOST")
		NDM_WORKERS_USER_NAME = os.Getenv("PERF_NFS_NDM_WORKERS_USER_NAME")
		NDM_WORKERS_PORT = os.Getenv("PERF_NFS_NDM_WORKERS_PORT")
		NDM_WORKERS_PASSWORD = os.Getenv("PERF_NFS_NDM_WORKERS_PASSWORD")

		SOURCE_VOLUMES_LIST = os.Getenv("PERF_NFS_SOURCE_VOLUMES")
		DESTINATION_VOLUMES_LIST = os.Getenv("PERF_NFS_DESTINATION_VOLUMES")

		SOURCE_HOST_IP = os.Getenv("PERF_NFS_SOURCE_HOST_IP")
		DESTINATION_HOST_IP = os.Getenv("PERF_NFS_DESTINATION_HOST_IP")

		PROTOCOL_USERNAME = os.Getenv("PERF_NFS_PROTOCOL_USERNAME")
		PROTOCOL_PASSWORD = os.Getenv("PERF_NFS_PROTOCOL_PASSWORD")

		ProtocolVersion3 = ProtocolVersionNFS_V3
	default:
		LogFatalf("Invalid protocol type: %s. Valid protocol types are: NFS / SMB.", protocolType)
	}

	InitWorkers(NDM_WORKERS_HOST, NDM_WORKERS_PORT, NDM_WORKERS_PASSWORD, NDM_WORKERS_USER_NAME)
	InitFileServer(SOURCE_VOLUMES_LIST, DESTINATION_VOLUMES_LIST, SOURCE_HOST_IP, DESTINATION_HOST_IP, 1)
}

// GetDatasetSize returns the dataset size based on protocol type from environment variables
func GetDatasetSize() string {
	var datasetSize string
	if PROTOCOL_TYPE == ProtocolNFS {
		datasetSize = os.Getenv("PERF_NFS_DATASET_SIZE")
		if datasetSize == "" {
			datasetSize = "28810.77 MiB" // Default NFS dataset size
		}
	} else {
		datasetSize = os.Getenv("PERF_SMB_DATASET_SIZE")
		if datasetSize == "" {
			datasetSize = "28038.02 MiB" // Default SMB dataset size
		}
	}
	return datasetSize
}

// GetControlPlaneVMSize returns the control plane VM size from environment variables
func GetControlPlaneVMSize() string {
	size := os.Getenv("PERF_CONTROL_PLANE_VM_SIZE")
	if size == "" {
		size = "Standard_D8s_v4" // Default (matches workflow default)
	}
	return size
}

// GetWorkerVMSize returns the worker VM size from environment variables
func GetWorkerVMSize() string {
	size := os.Getenv("PERF_WORKER_VM_SIZE")
	if size == "" {
		if PROTOCOL_TYPE == ProtocolNFS {
			size = "Standard_D4s_v4" // Default Linux worker
		} else {
			size = "Standard_D32s_v4" // Default Windows worker (matches workflow default)
		}
	}
	return size
}

// GetWorkerCount returns the worker count from environment variables
func GetWorkerCount() string {
	count := os.Getenv("PERF_WORKER_COUNT")
	if count == "" {
		count = "1" // Default
	}
	return count
}
