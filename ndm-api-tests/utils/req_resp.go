package utils

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

type FileServerInfo struct {
	Data struct {
		Items struct {
			FileServers []FileServer `json:"fileServers"`
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
	Data struct {
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
