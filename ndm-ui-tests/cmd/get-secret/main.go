// get-secret fetches the Keycloak client secret from the NDM control plane
// via OpenBao and prints it — or writes it directly into the .env file.
//
// Usage:
//
//	# Print the secret
//	go run ./cmd/get-secret --cp 172.30.203.102 --ssh-user ubuntu --ssh-pass Ashish@123
//
//	# Write it directly into .env
//	go run ./cmd/get-secret --cp 172.30.203.102 --ssh-user ubuntu --ssh-pass Ashish@123 --write-env
//
// After running this once you can run any test from your Mac without needing
// SSH access to the CP again:
//
//	NDM_HEADLESS=false go test -v -run TestMigration_BasicNFS ./tests/ -timeout 30m
package main

import (
	"bufio"
	"bytes"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

const (
	openbaoKeysFile  = "/opt/datamigrator/openbao/cluster-keys.json"
	openbaoCredsPath = "v1/secrets/keycloak-secrets/keycloak-creds"
)

func main() {
	cpIP := flag.String("cp", "", "Control plane IP (required)")
	sshUser := flag.String("ssh-user", "ubuntu", "SSH username for the CP")
	sshPass := flag.String("ssh-pass", "", "SSH password for the CP")
	sshPort := flag.Int("ssh-port", 22, "SSH port for the CP")
	writeEnv := flag.Bool("write-env", false, "Write NDM_KEYCLOAK_CLIENT_SECRET into .env automatically")
	flag.Parse()

	if *cpIP == "" {
		fmt.Fprintln(os.Stderr, "ERROR: --cp is required (e.g. --cp 172.30.203.102)")
		flag.Usage()
		os.Exit(2)
	}
	if *sshPass == "" {
		fmt.Fprintln(os.Stderr, "ERROR: --ssh-pass is required")
		flag.Usage()
		os.Exit(2)
	}

	fmt.Printf("Connecting to CP %s:%d via SSH...\n", *cpIP, *sshPort)

	// ── Step 1: SSH to CP, read OpenBao root token ────────────────────────────
	rootToken, err := getOpenBaoRootToken(*cpIP, *sshPort, *sshUser, *sshPass)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: get OpenBao root token: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("✓ Got OpenBao root token")

	// ── Step 2: Call OpenBao API to fetch Keycloak client secret ─────────────
	secret, err := fetchClientSecret(*cpIP, rootToken)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: fetch Keycloak client secret: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("✓ Got Keycloak client secret")

	if !*writeEnv {
		fmt.Println("\nAdd this to your .env:")
		fmt.Printf("NDM_KEYCLOAK_CLIENT_SECRET=%s\n", secret)
		return
	}

	// ── Step 3: Write into .env ───────────────────────────────────────────────
	envPath := findEnvFile()
	if err := writeToEnv(envPath, secret); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: write to .env: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("✓ NDM_KEYCLOAK_CLIENT_SECRET written to %s\n", envPath)
	fmt.Println("\nYou can now run tests from your Mac:")
	fmt.Println("  NDM_HEADLESS=false go test -v -run TestMigration_BasicNFS ./tests/ -timeout 30m")
}

// getOpenBaoRootToken SSHes into the CP and reads the OpenBao cluster keys file.
func getOpenBaoRootToken(host string, port int, user, pass string) (string, error) {
	cfg := &ssh.ClientConfig{
		User: user,
		Auth: []ssh.AuthMethod{ssh.Password(pass)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), //nolint:gosec
		Timeout:         30 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	client, err := ssh.Dial("tcp", addr, cfg)
	if err != nil {
		return "", fmt.Errorf("SSH dial %s: %w", addr, err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("SSH session: %w", err)
	}
	defer session.Close()

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	if err := session.Run("sudo cat " + openbaoKeysFile); err != nil {
		return "", fmt.Errorf("read cluster-keys.json: %w\nstderr: %s", err, stderr.String())
	}

	var keys struct {
		RootToken string `json:"root_token"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &keys); err != nil {
		return "", fmt.Errorf("parse cluster-keys.json: %w", err)
	}
	if keys.RootToken == "" {
		return "", fmt.Errorf("root_token is empty in cluster-keys.json")
	}
	return keys.RootToken, nil
}

// fetchClientSecret calls the OpenBao HTTP API to get the Keycloak client secret.
func fetchClientSecret(cpIP, rootToken string) (string, error) {
	httpClient := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec
		},
		Timeout: 30 * time.Second,
	}

	url := fmt.Sprintf("https://%s/%s", cpIP, openbaoCredsPath)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("X-Vault-Token", rootToken)

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("OpenBao API request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("OpenBao returned %d: %s", resp.StatusCode, string(body))
	}

	var parsed struct {
		Data struct {
			ClientSecret string `json:"KEYCLOAK_CLIENT_SECRET"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("parse OpenBao response: %w", err)
	}
	if parsed.Data.ClientSecret == "" {
		return "", fmt.Errorf("KEYCLOAK_CLIENT_SECRET is empty in OpenBao response: %s", string(body))
	}
	return parsed.Data.ClientSecret, nil
}

// findEnvFile locates the .env file relative to this source file.
func findEnvFile() string {
	_, thisFile, _, ok := runtime.Caller(0)
	if ok {
		// thisFile = .../ndm-ui-tests/cmd/get-secret/main.go
		// .env is two levels up: .../ndm-ui-tests/.env
		candidate := filepath.Join(filepath.Dir(thisFile), "..", "..", ".env")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return ".env"
}

// writeToEnv updates or appends NDM_KEYCLOAK_CLIENT_SECRET in the .env file.
func writeToEnv(path, secret string) error {
	var lines []string
	found := false

	f, err := os.Open(path)
	if err == nil {
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(strings.TrimSpace(line), "NDM_KEYCLOAK_CLIENT_SECRET=") {
				lines = append(lines, "NDM_KEYCLOAK_CLIENT_SECRET="+secret)
				found = true
			} else {
				lines = append(lines, line)
			}
		}
		f.Close()
	}

	if !found {
		lines = append(lines, "NDM_KEYCLOAK_CLIENT_SECRET="+secret)
	}

	return os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600)
}
