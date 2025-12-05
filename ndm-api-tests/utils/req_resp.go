package utils

import "time"

// ============Error Structs======================

// ErrorCsvResponse represents the response from generate-error-csv endpoint
type ErrorCsvResponse struct {
	Message string `json:"message"`
	Data    struct {
		Items interface{} `json:"items"`
	} `json:"data"`
}

// ErrorResponse represents error responses from the backend
type ErrorResponse struct {
	StatusCode     int    `json:"statusCode"`
	Message        string `json:"message"`
	DisplayMessage string `json:"displayMessage"`
	Error          string `json:"error"`
}

// ErrorCsvReadyResponse represents the response from is-error-csv-ready endpoint
type ErrorCsvReadyResponse struct {
	Data struct {
		Items struct {
			Ready      bool `json:"ready"`
			Processing bool `json:"processing"`
		} `json:"items"`
	} `json:"data"`
}

type ErrorCsvConfig struct {
	BaseURL      string
	Headers      map[string]string // Authorization and Content-Type headers
	PollInterval time.Duration     // How often to poll for readiness (default: 3s)
	Timeout      time.Duration     // Maximum time to wait for CSV generation (default: 5 minutes)
	DebugMode    bool              // Enable debug logging
}

// =============File Server Structs=====================
type CreateFileServerResponse struct {
	Data struct {
		ID string `json:"id"`
	} `json:"data"`
}

type Volume struct {
	ID             string `json:"id"`
	VolumePath     string `json:"volumePath"`
	IsValid        bool   `json:"isValid"`
	IsDisabled     bool   `json:"isDisabled"`
	ReachableCount int    `json:"reachableCount"`
}

type ExportPathSource string

type FileServer struct {
	Id               string           `json:"id"`
	Volumes          []Volume         `json:"volumes"`
	ExportPathSource ExportPathSource `json:"exportPathSource"`
	Protocol         Protocol         `json:"protocol"`
	ProtocolVersion  ProtocolVersion  `json:"protocolVersion"`
	ServerType       ServerType       `json:"serverType"`
	Host             string           `json:"host"`
}

type FileServerDetailsItems struct {
	ConfigName  string       `json:"configName"`
	ID          string       `json:"id"`
	ConfigType  ConfigType   `json:"configType"`
	ProjectID   string       `json:"projectId"`
	FileServers []FileServer `json:"fileServers"`
	Status      string       `json:"status"`
}

type FileServerDetails struct {
	error `json:"error"`
	Data  struct {
		Items FileServerDetailsItems `json:"items"`
	} `json:"data"`
}

type FileServerStatusDetails struct {
	error `json:"error"`
	Data  struct {
		Items struct {
			Status      string `json:"status"`
			FileServers []struct {
				ID string `json:"id"`
			} `json:"fileServers"`
		} `json:"items"`
	} `json:"data"`
}

// =============Support Bundle Structs=====================
type CanDownloadResp struct {
	Data struct {
		Items struct {
			IsProcessing  bool `json:"isProcessing"`
			IsBundleReady bool `json:"isBundleReady"`
			Filters       struct {
				EndDate      string   `json:"endDate"`
				StartDate    string   `json:"startDate"`
				OtherMetrics []string `json:"otherMetrics"`
			} `json:"filters"`
			CreatedAt string      `json:"createdAt"`
			Error     interface{} `json:"error"` // Keep if error may still be present
		} `json:"items"`
	} `json:"data"`
}

// =============Path-Upload Structs=====================
type PathFileUploadStatsItems struct {
	UploadId               string `json:"uploadId"`
	Message                string `json:"message"`
	NewPaths               int    `json:"newPaths"`
	AlreadyExitingPaths    int    `json:"alreadyExitingPaths"`
	NoLongerAvailablePaths int    `json:"noLongerAvailablePaths"`
}

type PathFileUploadStats struct {
	Error ErrorResponse `json:"error"`
	Data  struct {
		Items PathFileUploadStatsItems `json:"items"`
	} `json:"data"`
}

type ConfirmPathFileUploadResponseItems struct {
	WorkflowId string `json:"workflowId"`
}

type ConfirmPathFileUploadResponse struct {
	Data struct {
		Items ConfirmPathFileUploadResponseItems `json:"items"`
	} `json:"data"`
}

type FileContent struct {
	FileName string `json:"fileName"`
	Contents string `json:"contents"`
	FileSize int    `json:"fileSize"`
}

type AboutNDMResponse struct {
	Data struct {
		Items struct {
			Product struct {
				Name    string `json:"name"`
				Version string `json:"version"`
			} `json:"product"`
			Build struct {
				WorkerVersion struct {
					Version string      `json:"version"`
					Time    interface{} `json:"time"` // Use interface{} to allow null
				} `json:"worker_version"`
				ControlPlaneVersion struct {
					Version string      `json:"version"`
					Time    interface{} `json:"time"` // Use interface{} to allow null
				} `json:"controlPlane_version"`
			} `json:"build"`
			Contact struct {
				Email   string      `json:"email"`
				Phone   interface{} `json:"phone"`   // Use interface{} to allow null
				Website interface{} `json:"website"` // Use interface{} to allow null
			} `json:"contact"`
		} `json:"items"`
	} `json:"data"`
}

// ==============JOB Structs=====================
type GetJobRunResponseItems struct {
	JobRunID  string `json:"jobRunId"`
	Status    string `json:"status"`
	StartTime string `json:"startTime"`
	EndTime   string `json:"endTime"`
}

type GetJobRunResponse struct {
	TrackID string `json:"trackId"`
	Message string `json:"message"`
	Data    struct {
		Items GetJobRunResponseItems `json:"items"`
	} `json:"data"`
}
