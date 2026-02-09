package storageclient

// StorageClient defines the interface for interacting with storage systems
// (e.g., Dell Isilon/PowerScale) to discover zones, shares, and exports.
type StorageClient interface {
	ValidateConnection() error
	GetNFSExportPaths(fileServerID string) ([]string, error)
	GetSMBShares(fileServerID string) ([]SMBShare, error)
	FetchZones() ([]Zone, error)
	FetchCertificate(hostname string, port int) (*CertInfo, error)
}

// Zone represents a network zone on the storage system containing subnets
// and SmartConnect pools.
type Zone struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Subnets []Subnet `json:"subnets"`
}

// Subnet represents a network subnet within a zone.
type Subnet struct {
	Name  string `json:"name"`
	Pools []Pool `json:"pools"`
}

// Pool represents a SmartConnect pool within a subnet.
type Pool struct {
	Name   string   `json:"name"`
	Ranges []string `json:"ranges"`
	SCZone string   `json:"sc_dns_zone"`
	SSIP   string   `json:"sc_subnet"`
}

// SMBShare represents an SMB share exported by the storage system.
type SMBShare struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// CertInfo holds certificate details fetched from a storage system.
type CertInfo struct {
	Subject   string `json:"subject"`
	Issuer    string `json:"issuer"`
	NotBefore string `json:"notBefore"`
	NotAfter  string `json:"notAfter"`
	IsValid   bool   `json:"isValid"`
}
