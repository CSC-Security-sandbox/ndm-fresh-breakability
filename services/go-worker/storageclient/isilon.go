package storageclient

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/logger"
)

const (
	defaultAPIVersion = "7"
	apiTimeout        = 30 * time.Second
)

// IsilonClient implements StorageClient for Dell Isilon/PowerScale systems.
// It communicates with the OneFS Platform API over HTTPS.
type IsilonClient struct {
	hostname   string
	username   string
	password   string
	apiVersion string
	httpClient *http.Client
	logger     *logger.Logger
}

// NewIsilonClient creates a new IsilonClient. The httpClient is configured to
// skip TLS verification because Isilon clusters often use self-signed certs.
func NewIsilonClient(hostname, username, password string, log *logger.Logger) *IsilonClient {
	return &IsilonClient{
		hostname:   hostname,
		username:   username,
		password:   password,
		apiVersion: defaultAPIVersion,
		logger:     log,
		httpClient: &http.Client{
			Timeout: apiTimeout,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
	}
}

// ValidateConnection verifies connectivity to the Isilon cluster by fetching
// the cluster config endpoint.
func (c *IsilonClient) ValidateConnection() error {
	url := fmt.Sprintf("https://%s:8080/platform/1/cluster/config", c.hostname)
	resp, err := c.doGet(url)
	if err != nil {
		return fmt.Errorf("isilon validate connection: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("isilon validate connection returned %d: %s", resp.StatusCode, string(body))
	}

	c.logger.Info("Isilon connection validated", zap.String("hostname", c.hostname))
	return nil
}

// GetNFSExportPaths fetches NFS exports from the Isilon cluster and returns
// the export paths.
func (c *IsilonClient) GetNFSExportPaths(fileServerID string) ([]string, error) {
	url := fmt.Sprintf("https://%s:8080/platform/3/protocols/nfs/exports", c.hostname)
	resp, err := c.doGet(url)
	if err != nil {
		return nil, fmt.Errorf("isilon get NFS exports: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("isilon NFS exports returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Exports []struct {
			Paths []string `json:"paths"`
		} `json:"exports"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding NFS exports response: %w", err)
	}

	var paths []string
	for _, export := range result.Exports {
		paths = append(paths, export.Paths...)
	}

	c.logger.Info("Isilon NFS exports fetched",
		zap.String("hostname", c.hostname),
		zap.Int("count", len(paths)),
	)
	return paths, nil
}

// GetSMBShares fetches SMB shares from the Isilon cluster.
func (c *IsilonClient) GetSMBShares(fileServerID string) ([]SMBShare, error) {
	url := fmt.Sprintf("https://%s:8080/platform/3/protocols/smb/shares", c.hostname)
	resp, err := c.doGet(url)
	if err != nil {
		return nil, fmt.Errorf("isilon get SMB shares: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("isilon SMB shares returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Shares []struct {
			Name string `json:"name"`
			Path string `json:"path"`
		} `json:"shares"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding SMB shares response: %w", err)
	}

	shares := make([]SMBShare, 0, len(result.Shares))
	for _, s := range result.Shares {
		shares = append(shares, SMBShare{
			Name: s.Name,
			Path: s.Path,
		})
	}

	c.logger.Info("Isilon SMB shares fetched",
		zap.String("hostname", c.hostname),
		zap.Int("count", len(shares)),
	)
	return shares, nil
}

// FetchZones retrieves network zone information from the Isilon cluster,
// including subnets and SmartConnect pools.
func (c *IsilonClient) FetchZones() ([]Zone, error) {
	url := fmt.Sprintf("https://%s:8080/platform/%s/zones", c.hostname, c.apiVersion)
	resp, err := c.doGet(url)
	if err != nil {
		return nil, fmt.Errorf("isilon fetch zones: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("isilon zones returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Zones []Zone `json:"zones"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding zones response: %w", err)
	}

	// For each zone, fetch subnet details to populate pools.
	for i, zone := range result.Zones {
		for j, subnet := range zone.Subnets {
			pools, err := c.fetchSubnetPools(zone.Name, subnet.Name)
			if err != nil {
				c.logger.Warn("Error fetching pools for subnet",
					zap.String("zone", zone.Name),
					zap.String("subnet", subnet.Name),
					zap.Error(err),
				)
				continue
			}
			result.Zones[i].Subnets[j].Pools = pools
		}
	}

	c.logger.Info("Isilon zones fetched",
		zap.String("hostname", c.hostname),
		zap.Int("count", len(result.Zones)),
	)
	return result.Zones, nil
}

// FetchCertificate performs a TLS handshake to the given host:port and returns
// information about the server's certificate chain.
func (c *IsilonClient) FetchCertificate(hostname string, port int) (*CertInfo, error) {
	addr := fmt.Sprintf("%s:%d", hostname, port)
	conn, err := tls.DialWithDialer(
		&net.Dialer{Timeout: 10 * time.Second},
		"tcp",
		addr,
		&tls.Config{InsecureSkipVerify: true},
	)
	if err != nil {
		return nil, fmt.Errorf("TLS dial to %s: %w", addr, err)
	}
	defer conn.Close()

	state := conn.ConnectionState()
	if len(state.PeerCertificates) == 0 {
		return nil, fmt.Errorf("no certificates found for %s", addr)
	}

	cert := state.PeerCertificates[0]
	now := time.Now()

	info := &CertInfo{
		Subject:   getCertSubject(cert),
		Issuer:    getCertIssuer(cert),
		NotBefore: cert.NotBefore.Format(time.RFC3339),
		NotAfter:  cert.NotAfter.Format(time.RFC3339),
		IsValid:   now.After(cert.NotBefore) && now.Before(cert.NotAfter),
	}

	c.logger.Info("Certificate fetched",
		zap.String("hostname", hostname),
		zap.String("subject", info.Subject),
		zap.Bool("isValid", info.IsValid),
	)
	return info, nil
}

// ConfigureSmartConnectDNS modifies /etc/resolv.conf to add the SmartConnect
// DNS zone nameserver entry. This enables DNS-based load balancing for Isilon
// connections.
func (c *IsilonClient) ConfigureSmartConnectDNS(ssip, dnsZone string) error {
	const resolvPath = "/etc/resolv.conf"

	content, err := os.ReadFile(resolvPath)
	if err != nil {
		return fmt.Errorf("reading %s: %w", resolvPath, err)
	}

	entry := fmt.Sprintf("nameserver %s", ssip)
	if strings.Contains(string(content), entry) {
		c.logger.Info("SmartConnect DNS entry already exists",
			zap.String("ssip", ssip),
		)
		return nil
	}

	newContent := entry + "\n" + string(content)
	if err := os.WriteFile(resolvPath, []byte(newContent), 0644); err != nil {
		return fmt.Errorf("writing %s: %w", resolvPath, err)
	}

	c.logger.Info("SmartConnect DNS configured",
		zap.String("ssip", ssip),
		zap.String("dnsZone", dnsZone),
	)
	return nil
}

// getCertSubject returns a human-readable subject string from a certificate.
// Falls back to the full Subject.String() when CommonName is empty, which is
// common with modern certificates that rely on SANs instead.
func getCertSubject(cert *x509.Certificate) string {
	if cert.Subject.CommonName != "" {
		return cert.Subject.CommonName
	}
	return cert.Subject.String()
}

// getCertIssuer returns a human-readable issuer string from a certificate.
func getCertIssuer(cert *x509.Certificate) string {
	if cert.Issuer.CommonName != "" {
		return cert.Issuer.CommonName
	}
	return cert.Issuer.String()
}

// fetchSubnetPools retrieves the SmartConnect pools for a specific subnet.
func (c *IsilonClient) fetchSubnetPools(zoneName, subnetName string) ([]Pool, error) {
	url := fmt.Sprintf("https://%s:8080/platform/%s/network/groupnets/%s/subnets/%s/pools",
		c.hostname, c.apiVersion, zoneName, subnetName)
	resp, err := c.doGet(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("pools endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Pools []Pool `json:"pools"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding pools response: %w", err)
	}
	return result.Pools, nil
}

// doGet performs an authenticated HTTP GET request to the given URL.
func (c *IsilonClient) doGet(url string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request to %s: %w", url, err)
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Accept", "application/json")

	return c.httpClient.Do(req)
}
