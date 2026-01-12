package utils

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// Dell Isilon-specific constants
const (
	FETCH_CERTIFICATE_ENDPOINT            = "/api/v1/servers/fetch-certificate"
	MANAGEMENT_SERVER_ENDPOINT            = "/api/v1/servers/management-server"
	FETCH_ZONES_ENDPOINT                  = "/api/v1/servers/fetch-zones"
	ServerTypeDellIsilon       ServerType = "Dell"
)

// IsilonZoneCredentials represents NFS/SMB credentials for a zone
type IsilonZoneCredentials struct {
	Host            string   `json:"host"`
	Username        string   `json:"userName"`
	Password        string   `json:"password"`
	ProtocolVersion string   `json:"protocolVersion,omitempty"`
	Workers         []string `json:"workers"`
}

// IsilonZonePayload represents a single zone configuration
type IsilonZonePayload struct {
	ZoneId              string                 `json:"zoneId"`
	NumericZoneId       int                    `json:"numericZoneId"`
	ZoneName            string                 `json:"zoneName"`
	SmartConnectSsip    string                 `json:"smartConnectSsip,omitempty"`
	SmartConnectDnsZone string                 `json:"smartConnectDnsZone,omitempty"`
	NFS                 *IsilonZoneCredentials `json:"nfs,omitempty"`
	SMB                 *IsilonZoneCredentials `json:"smb,omitempty"`
}

// CreateIsilonServerParams contains all parameters needed to create a Dell Isilon file server
type CreateIsilonServerParams struct {
	// Config level
	ConfigName string
	ProjectID  string

	// Management console credentials
	ManagementHost     string
	ManagementPort     int
	ManagementUsername string
	ManagementPassword string
	TlsCertificate     string
	TlsExpiry          string
	TlsAccepted        bool

	// Zones
	Zones []IsilonZonePayload
}

// CertificateResponse represents the response from fetch-certificate endpoint
type CertificateResponse struct {
	Data struct {
		Items struct {
			IsSelfSigned    bool     `json:"isSelfSigned"`
			ValidFrom       string   `json:"validFrom"`
			ValidTo         string   `json:"validTo"`
			SerialNumber    string   `json:"serialNumber"`
			Fingerprint     string   `json:"fingerprint"`
			Fingerprint256  string   `json:"fingerprint256"`
			SubjectAltNames []string `json:"subjectAltNames"`
			DaysRemaining   int      `json:"daysRemaining"`
			IsExpired       bool     `json:"isExpired"`
			CertificatePEM  string   `json:"certificatePEM"`
			Host            string   `json:"host"`
			Port            int      `json:"port"`
		} `json:"items"`
	} `json:"data"`
}

// ZonesResponse represents the response from fetch-zones endpoint
type ZonesResponse struct {
	Data struct {
		Items struct {
			Zones            []ZoneInfo `json:"zones"`
			TotalZones       int        `json:"totalZones"`
			TotalIpAddresses int        `json:"totalIpAddresses"`
		} `json:"items"`
	} `json:"data"`
}

// ZoneInfo represents a single zone from the Isilon API
type ZoneInfo struct {
	ZoneId           int      `json:"zoneId"`
	ZoneName         string   `json:"zoneName"`
	IpAddresses      []string `json:"ipAddresses"`
	SmartConnectFqdn string   `json:"smartConnectFqdn,omitempty"`
	Ssip             string   `json:"ssip,omitempty"`
}

// FetchIsilonCertificate fetches the TLS certificate from the Dell Isilon management console
func FetchIsilonCertificate(host string, headers map[string]string) (*CertificateResponse, error) {
	url := fmt.Sprintf("%s%s?host=%s&serverType=Dell", CONFIG_SERVICE_URL, FETCH_CERTIFICATE_ENDPOINT, host)

	LogDebug(fmt.Sprintf("Fetching Isilon certificate from: %s", url))

	resp, err := SendAPIRequest(http.MethodGet, url, nil, headers)
	if err != nil {
		return nil, fmt.Errorf("error fetching certificate: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("error reading certificate response: %w", err)
	}

	LogDebug(fmt.Sprintf("Certificate response status: %d, body: %s", resp.StatusCode, string(bodyBytes)))

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch certificate failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var certResp CertificateResponse
	if err := json.Unmarshal(bodyBytes, &certResp); err != nil {
		return nil, fmt.Errorf("error parsing certificate response: %w", err)
	}

	LogDebug(fmt.Sprintf("Certificate fetched successfully. Expires: %s", certResp.Data.Items.ValidTo))
	return &certResp, nil
}

// FetchIsilonZones fetches the zones from the Dell Isilon management console
func FetchIsilonZones(host, username, password, certificate string, headers map[string]string) (*ZonesResponse, error) {
	url := fmt.Sprintf("%s%s", CONFIG_SERVICE_URL, FETCH_ZONES_ENDPOINT)

	payload := map[string]interface{}{
		"serverType":  "Dell",
		"host":        host,
		"port":        8080,
		"username":    username,
		"password":    password,
		"certificate": certificate,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("error marshaling zones request: %w", err)
	}

	LogDebug(fmt.Sprintf("Fetching Isilon zones from: %s", url))

	resp, err := SendAPIRequest(http.MethodPost, url, payloadBytes, headers)
	if err != nil {
		return nil, fmt.Errorf("error fetching zones: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fetch zones failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("error reading zones response: %w", err)
	}

	var zonesResp ZonesResponse
	if err := json.Unmarshal(bodyBytes, &zonesResp); err != nil {
		return nil, fmt.Errorf("error parsing zones response: %w", err)
	}

	LogDebug(fmt.Sprintf("Found %d zones with %d total IP addresses",
		zonesResp.Data.Items.TotalZones, zonesResp.Data.Items.TotalIpAddresses))
	return &zonesResp, nil
}

// CreateIsilonFileServer creates a Dell Isilon file server with zones
// This follows the complete API flow:
// 1. Fetch certificate
// 2. Fetch zones
// 3. Create config with management info and file servers for each zone/protocol
func CreateIsilonFileServer(params CreateIsilonServerParams, headers map[string]string) (string, *http.Response, error) {
	createURL := CONFIG_SERVICE_URL + FILESERVER_ENDPOINT

	// Build fileServers array from zones
	fileServers := []map[string]interface{}{}

	for _, zone := range params.Zones {
		// Create NFS file server if zone has NFS config
		if zone.NFS != nil {
			nfsFileServer := map[string]interface{}{
				"serverType":       "Dell",
				"protocol":         "NFS",
				"protocolVersion":  zone.NFS.ProtocolVersion,
				"fileServerName":   zone.ZoneName,
				"host":             zone.NFS.Host,
				"userName":         zone.NFS.Username,
				"password":         zone.NFS.Password,
				"zone_id":          zone.NumericZoneId,
				"exportPathSource": "AUTO_DISCOVER",
				"workers":          zone.NFS.Workers,
				"volumes":          []interface{}{},
			}
			// Add SmartConnect fields if available
			if zone.SmartConnectSsip != "" {
				nfsFileServer["smartConnectSsip"] = zone.SmartConnectSsip
			}
			if zone.SmartConnectDnsZone != "" {
				nfsFileServer["smartConnectDnsZone"] = zone.SmartConnectDnsZone
			}
			fileServers = append(fileServers, nfsFileServer)
		}

		// Create SMB file server if zone has SMB config
		if zone.SMB != nil {
			smbFileServer := map[string]interface{}{
				"serverType":       "Dell",
				"protocol":         "SMB",
				"protocolVersion":  "v3.0",
				"fileServerName":   zone.ZoneName,
				"host":             zone.SMB.Host,
				"userName":         zone.SMB.Username,
				"password":         zone.SMB.Password,
				"zone_id":          zone.NumericZoneId,
				"exportPathSource": "AUTO_DISCOVER",
				"workers":          zone.SMB.Workers,
				"volumes":          []interface{}{},
			}
			// Add SmartConnect fields if available
			if zone.SmartConnectSsip != "" {
				smbFileServer["smartConnectSsip"] = zone.SmartConnectSsip
			}
			if zone.SmartConnectDnsZone != "" {
				smbFileServer["smartConnectDnsZone"] = zone.SmartConnectDnsZone
			}
			fileServers = append(fileServers, smbFileServer)
		}
	}

	// Build the main payload
	payload := map[string]interface{}{
		"configName":  params.ConfigName,
		"configType":  "FILE",
		"projectId":   params.ProjectID,
		"serverType":  "Dell",
		"fileServers": fileServers,
		"workingDirectory": map[string]interface{}{
			"workingDirectory": "",
			"pathId":           nil,
			"pathName":         "",
		},
		// Management console fields
		"managementHost":     params.ManagementHost,
		"managementPort":     params.ManagementPort,
		"managementUsername": params.ManagementUsername,
		"managementPassword": params.ManagementPassword,
		"tlsAccepted":        params.TlsAccepted,
		"tlsCertificate":     params.TlsCertificate,
		"tlsExpiry":          params.TlsExpiry,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return "", nil, fmt.Errorf("error marshaling create payload: %w", err)
	}

	LogDebug(fmt.Sprintf("Creating Dell Isilon file server: %s with %d file servers", params.ConfigName, len(fileServers)))

	resp, err := SendAPIRequest(http.MethodPost, createURL, payloadBytes, headers)
	if err != nil {
		return "", nil, fmt.Errorf("error creating Isilon file server: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", resp, fmt.Errorf("Isilon file server creation failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", resp, fmt.Errorf("error reading creation response: %w", err)
	}

	var createResp CreateFileServerResponse
	if err := json.Unmarshal(bodyBytes, &createResp); err != nil {
		return "", resp, fmt.Errorf("error parsing creation response: %w", err)
	}

	fileConfigID := createResp.Data.ID
	LogDebug(fmt.Sprintf("Dell Isilon file server created with config ID: %s", fileConfigID))

	// Wait for file server to become ACTIVE (reuse existing logic)
	_, err = checkFileServerStatus(fileConfigID, headers)
	if err != nil {
		// Retry with update if initial creation fails
		LogDebug(fmt.Sprintf("Initial status check failed, will attempt update: %v", err))
	}

	return fileConfigID, resp, nil
}

// CreateIsilonFileServerWithFlow performs the complete Isilon creation flow:
// 1. Fetch certificate from management console
// 2. Fetch zones from management console
// 3. Create file server with specified zones and protocols
func CreateIsilonFileServerWithFlow(
	projectID string,
	configName string,
	managementHost string,
	managementUsername string,
	managementPassword string,
	managementPort int,
	selectedZoneIds []int, // Which zone IDs to configure (e.g., [1] for System zone)
	nfsCredentials map[int]*IsilonZoneCredentials, // Zone ID -> NFS credentials
	smbCredentials map[int]*IsilonZoneCredentials, // Zone ID -> SMB credentials
	headers map[string]string,
) (string, error) {
	// Step 1: Fetch certificate
	LogDebug("Step 1: Fetching certificate from management console...")
	certResp, err := FetchIsilonCertificate(managementHost, headers)
	if err != nil {
		return "", fmt.Errorf("failed to fetch certificate: %w", err)
	}
	LogDebug(fmt.Sprintf("Certificate fetched successfully. Valid to: %s", certResp.Data.Items.ValidTo))

	// Step 2: Fetch zones
	LogDebug("Step 2: Fetching zones from management console...")
	zonesResp, err := FetchIsilonZones(
		managementHost,
		managementUsername,
		managementPassword,
		certResp.Data.Items.CertificatePEM,
		headers,
	)
	if err != nil {
		return "", fmt.Errorf("failed to fetch zones: %w", err)
	}
	LogDebug(fmt.Sprintf("Found %d zones", zonesResp.Data.Items.TotalZones))

	// Build a map of zone ID -> zone info for easy lookup
	zoneMap := make(map[int]ZoneInfo)
	for _, zone := range zonesResp.Data.Items.Zones {
		zoneMap[zone.ZoneId] = zone
	}

	// Step 3: Build zone payloads for selected zones
	var zones []IsilonZonePayload
	for _, zoneId := range selectedZoneIds {
		zoneInfo, exists := zoneMap[zoneId]
		if !exists {
			return "", fmt.Errorf("zone ID %d not found in available zones", zoneId)
		}

		zonePayload := IsilonZonePayload{
			ZoneId:              fmt.Sprintf("%d", zoneId),
			NumericZoneId:       zoneId,
			ZoneName:            zoneInfo.ZoneName,
			SmartConnectSsip:    zoneInfo.Ssip,
			SmartConnectDnsZone: zoneInfo.SmartConnectFqdn,
		}

		// Add NFS credentials if provided for this zone
		if nfsCreds, ok := nfsCredentials[zoneId]; ok && nfsCreds != nil {
			zonePayload.NFS = nfsCreds
		}

		// Add SMB credentials if provided for this zone
		if smbCreds, ok := smbCredentials[zoneId]; ok && smbCreds != nil {
			zonePayload.SMB = smbCreds
		}

		zones = append(zones, zonePayload)
	}

	// Step 4: Create the file server
	LogDebug("Step 3: Creating Dell Isilon file server...")
	params := CreateIsilonServerParams{
		ConfigName:         configName,
		ProjectID:          projectID,
		ManagementHost:     managementHost,
		ManagementPort:     managementPort,
		ManagementUsername: managementUsername,
		ManagementPassword: managementPassword,
		TlsCertificate:     certResp.Data.Items.CertificatePEM,
		TlsExpiry:          certResp.Data.Items.ValidTo,
		TlsAccepted:        true,
		Zones:              zones,
	}

	configID, _, err := CreateIsilonFileServer(params, headers)
	if err != nil {
		return "", fmt.Errorf("failed to create Isilon file server: %w", err)
	}

	LogDebug(fmt.Sprintf("Dell Isilon file server created successfully with config ID: %s", configID))
	return configID, nil
}

// ValidateIsilonFileServerStatus checks if the Isilon file server is active
func ValidateIsilonFileServerStatus(configID string, headers map[string]string) error {
	getURL := fmt.Sprintf("%s%s/%s", CONFIG_SERVICE_URL, FILESERVER_ENDPOINT, configID)

	resp, err := SendAPIRequest(http.MethodGet, getURL, nil, headers)
	if err != nil {
		return fmt.Errorf("error getting file server status: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("error reading response body: %w", err)
	}

	var details FileServerStatusDetails
	if err := json.Unmarshal(bodyBytes, &details); err != nil {
		return fmt.Errorf("error parsing response: %w", err)
	}

	status := FileServerStatus(details.Data.Items.Status)
	if status != FileServerStatusActive {
		return fmt.Errorf("file server status is %s, expected ACTIVE", status)
	}

	// Verify it's a Dell Isilon server
	if len(details.Data.Items.FileServers) == 0 {
		return fmt.Errorf("no file servers found in config")
	}

	LogDebug(fmt.Sprintf("Dell Isilon file server %s is ACTIVE with %d file servers",
		configID, len(details.Data.Items.FileServers)))
	return nil
}
