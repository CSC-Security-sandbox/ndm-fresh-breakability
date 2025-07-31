package tests

// CreateUserRequest represents the request payload for creating a new user
type CreateUserRequest struct {
	Username  string `json:"username"`   // Email address used as username
	FirstName string `json:"firstName"`  // User's first name
	LastName  string `json:"lastName"`   // User's last name
}

// UserResponse represents the structure of user data returned from API responses
type UserResponse struct {
	ID        string `json:"id"`         // Unique identifier for the user
	FirstName string `json:"first_name"` // User's first name
	LastName  string `json:"last_name"`  // User's last name
	Username  string `json:"username"`   // User's username
	Email     string `json:"email"`      // User's email address
}

// UserRoleRequest represents the request payload for assigning roles to users
type UserRoleRequest struct {
	ProjectID string `json:"project_id"` // ID of the project where role is assigned
	AccountID string `json:"account_id"` // Account ID that owns the project
	UserID    string `json:"user_id"`    // ID of the user being assigned the role
	RoleID    string `json:"role_id"`    // Role ID being assigned (project admin, viewer, etc.)
}

// UserRoleResponse represents the response when creating or getting user roles
type UserRoleResponse struct {
	ID        string `json:"id"`         // Unique identifier for the user role assignment
	ProjectID string `json:"project_id"` // ID of the project where the role is assigned
	AccountID string `json:"account_id"` // Account ID that owns the project
	UserID    string `json:"user_id"`    // ID of the user assigned the role
	RoleID    string `json:"role_id"`    // Role ID assigned to the user
}

// CreateProjectRequest represents the payload structure for creating a new project
type CreateProjectRequest struct {
	AccountID          string `json:"account_id"`           // Account ID that owns the project
	ProjectName        string `json:"project_name"`         // Name of the project
	ProjectDescription string `json:"project_description"`  // Description of the project
	StartDate          string `json:"start_date"`           // Project start date in RFC3339 format
}

// CreateFileServerRequest represents the request payload for creating file servers
type CreateFileServerRequest struct {
	ConfigName       string                `json:"configName"`       // Name for the file server configuration
	ConfigType       string                `json:"configType"`       // Type of configuration (FILE, DATABASE, etc.)
	ProjectID        string                `json:"projectId"`        // ID of the project this server belongs to
	FileServers      []FileServerConfig    `json:"fileServers"`      // Array of file server configurations
	WorkingDirectory WorkingDirectoryConfig `json:"workingDirectory"` // Working directory configuration
}

// CreateSourceFileServerRequest represents the request payload for creating a source file server
type CreateSourceFileServerRequest struct {
	ConfigName       string                `json:"configName"`       // Name identifier for the file server configuration
	ConfigType       string                `json:"configType"`       // Type of configuration (FILE, DATABASE, etc.)
	ProjectID        string                `json:"projectId"`        // ID of the project this server belongs to
	FileServers      []FileServerConfig    `json:"fileServers"`      // Array of file server configurations
	WorkingDirectory WorkingDirectoryConfig `json:"workingDirectory"` // Working directory configuration
}

// FileServerConfig represents individual file server configuration
type FileServerConfig struct {
	ServerType      string   `json:"serverType"`      // Type of server (OtherNAS, NetApp, etc.)
	UserName        string   `json:"userName"`        // Username for server authentication
	Password        string   `json:"password"`        // Password for server authentication
	Protocol        string   `json:"protocol"`        // Protocol used (NFS, SMB, etc.)
	ProtocolVersion string   `json:"protocolVersion"` // Version of the protocol
	Host            string   `json:"host"`            // IP address of the file server
	Volumes         []string `json:"volumes"`         // List of volumes on the server
	Workers         []string `json:"workers"`         // List of worker IDs assigned to server
}

// WorkingDirectoryConfig represents working directory settings
type WorkingDirectoryConfig struct {
	WorkingDirectory string      `json:"workingDirectory"` // Path to working directory
	PathID           interface{} `json:"pathId"`           // ID of the path (can be null)
	PathName         string      `json:"pathName"`         // Name of the path
}

// CreateDiscoveryJobRequest represents the request payload for creating a discovery job
type CreateDiscoveryJobRequest struct {
	ExcludeOlderThan    interface{}         `json:"excludeOlderThan"`     // Timestamp to exclude older files (can be null)
	ExcludeFilePatterns string              `json:"excludeFilePatterns"`  // Pattern to exclude certain files
	PreserveAccessTime  bool                `json:"preserveAccessTime"`   // Whether to preserve file access times
	FirstRunAt          string              `json:"firstRunAt"`           // ISO timestamp for first job execution
	SourcePathIDs       []string            `json:"sourcePathIds"`        // Array of source path IDs to discover
	CreatedBy           interface{}         `json:"createdBy"`            // User who created the job (can be null)
	Options             DiscoveryJobOptions `json:"options"`              // Additional job execution options
}

// DiscoveryJobOptions represents options for discovery job execution
type DiscoveryJobOptions struct {
	WorkflowExecutionTimeout string `json:"workflowExecutionTimeout"` // Timeout for entire workflow execution
	WorkflowTaskTimeout      string `json:"workflowTaskTimeout"`      // Timeout for individual workflow tasks
	WorkflowRunTimeout       string `json:"workflowRunTimeout"`       // Timeout for workflow run
	StartDelay               string `json:"startDelay"`               // Delay before starting the job
}

// MigrationPrecheckRequest represents the request for migration precheck
type MigrationPrecheckRequest struct {
	MigrateConfigs     []MigrateConfig `json:"migrateConfigs"`     // Array of migration configurations
	PreserveAccessTime bool            `json:"preserveAccessTime"` // Whether to preserve access times
}

// CreateMigrationJobRequest represents the request for creating migration jobs
type CreateMigrationJobRequest struct {
	FirstRunAt        string           `json:"firstRunAt"`        // When to first run the migration
	FutureRunSchedule string           `json:"futureRunSchedule"` // Schedule for future runs
	MigrateConfigs    []MigrateConfig  `json:"migrateConfigs"`    // Array of migration configurations
	SIDMapping        bool             `json:"sid_mapping"`       // Whether to enable SID mapping
	Options           MigrationOptions `json:"options"`           // Additional migration options
}

// MigrateConfig represents configuration for source to destination mapping
type MigrateConfig struct {
	SourcePathID      string   `json:"sourcePathId"`      // ID of the source path
	DestinationPathID []string `json:"destinationPathId"` // Array of destination path IDs
}

// MigrationOptions represents additional options for migration
type MigrationOptions struct {
	ExcludeFilePatterns string `json:"excludeFilePatterns"` // Patterns to exclude files
	PreserveAccessTime  bool   `json:"preserveAccessTime"`  // Whether to preserve access times
	SkipFile            string `json:"skipFile"`            // File size threshold to skip
}

// CreateCutoverJobRequest represents the request for creating cutover jobs
type CreateCutoverJobRequest struct {
	CutoverConfig []MigrateConfig `json:"cutoverConfig"` // Array of cutover configurations
}

// CutoverApprovalRequest represents the request for approving/rejecting cutover
type CutoverApprovalRequest struct {
	Action   string `json:"action"`    // Action to take (APPROVED, REJECTED)
	JobRunID string `json:"jobRunId"`  // ID of the job run to approve/reject
}

// GetFileServerData represents the data for getting file server information
type GetFileServerData struct {
	Type       string `json:"type"`        // Type of server (source, destination)
	VolumeName string `json:"volume_name"` // Name of the volume to query
}