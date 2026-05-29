package utils

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"ndm-ui-tests/config"
)

// EnsureSMBWorkerDomainJoined checks whether the Windows worker is already
// joined to the configured AD domain. If not, it domain-joins the worker via
// SSH (PowerShell Add-Computer), waits for the restart, and verifies.
// This mirrors ndm-api-tests/utils/domain_helper.go EnsureWindowsWorkerDomainJoined.
func EnsureSMBWorkerDomainJoined() error {
	if config.SMBWorkerHost == "" {
		return nil
	}
	if config.SMBDomainName == "" {
		logSetup("NDM_SMB_DOMAIN_NAME not set — skipping domain join")
		return nil
	}
	if config.SmbMigSourceUsername == "" || config.SmbMigSourcePassword == "" {
		logSetup("SMB credentials not set — skipping domain join")
		return nil
	}

	workerCfg := SSHConfig{
		Host:     config.SMBWorkerHost,
		Port:     config.SMBWorkerPort,
		Username: config.SMBWorkerUsername,
		Password: config.SMBWorkerPassword,
	}

	domainName := config.SMBDomainName
	domainUser := config.SmbMigSourceUsername
	domainPassword := config.SmbMigSourcePassword

	logSetup("Checking Windows worker %s domain join status...", workerCfg.Host)

	isJoined, currentDomain, err := checkWorkerDomainStatus(workerCfg)
	if err != nil {
		logSetup("  Could not check domain status: %v — attempting join anyway", err)
	} else if isJoined && strings.EqualFold(currentDomain, domainName) {
		logSetup("  Worker %s already joined to domain: %s", workerCfg.Host, currentDomain)
		return nil
	} else if isJoined {
		logSetup("  Worker %s joined to different domain: %s (expected: %s)", workerCfg.Host, currentDomain, domainName)
	} else {
		logSetup("  Worker %s is not domain-joined, joining to: %s", workerCfg.Host, domainName)
	}

	if err := joinWorkerToDomain(workerCfg, domainName, domainUser, domainPassword); err != nil {
		return err
	}
	return nil
}

func checkWorkerDomainStatus(cfg SSHConfig) (bool, string, error) {
	script := `powershell.exe -Command "Get-WmiObject Win32_ComputerSystem | Select-Object -Property PartOfDomain,Domain | ConvertTo-Json"`
	output, err := RunScript(cfg, script)
	if err != nil {
		return false, "", fmt.Errorf("domain status check failed: %w", err)
	}

	var result struct {
		PartOfDomain bool   `json:"PartOfDomain"`
		Domain       string `json:"Domain"`
	}
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		if strings.Contains(output, "True") {
			domainScript := `powershell.exe -Command "(Get-WmiObject Win32_ComputerSystem).Domain"`
			domainOutput, _ := RunScript(cfg, domainScript)
			return true, strings.TrimSpace(domainOutput), nil
		}
		return false, "", nil
	}
	return result.PartOfDomain, strings.TrimSpace(result.Domain), nil
}

func joinWorkerToDomain(cfg SSHConfig, domainName, domainUser, domainPassword string) error {
	logSetup("  Joining Windows worker %s to domain %s...", cfg.Host, domainName)

	escapedPassword := strings.ReplaceAll(domainPassword, `"`, `\"`)
	escapedPassword = strings.ReplaceAll(escapedPassword, `$`, "`$")

	script := fmt.Sprintf(`powershell.exe -Command "$ErrorActionPreference='Stop'; `+
		`try { `+
		`Write-Host 'Creating domain credentials...'; `+
		`$password = ConvertTo-SecureString '%s' -AsPlainText -Force; `+
		`$cred = New-Object System.Management.Automation.PSCredential('%s', $password); `+
		`Write-Host 'Joining domain %s...'; `+
		`Add-Computer -DomainName '%s' -Credential $cred -Force -Restart -ErrorAction Stop; `+
		`Write-Host 'Domain join initiated, restarting...'; `+
		`} catch { `+
		`Write-Host \"Domain join error: $_\"; `+
		`exit 1; `+
		`}"`,
		escapedPassword, domainUser, domainName, domainName)

	output, err := RunScript(cfg, script)
	if err != nil {
		if strings.Contains(err.Error(), "connection") || strings.Contains(err.Error(), "EOF") {
			logSetup("  Connection lost during restart (expected) — waiting for VM to come back...")
		} else {
			return fmt.Errorf("domain join failed for %s: %w\noutput: %s", cfg.Host, err, output)
		}
	}

	logSetup("  Waiting 180s for worker to restart after domain join...")
	time.Sleep(180 * time.Second)

	logSetup("  Verifying domain join status...")
	for attempt := 1; attempt <= 5; attempt++ {
		isJoined, currentDomain, err := checkWorkerDomainStatus(cfg)
		if err == nil && isJoined {
			logSetup("  Domain join verified: worker %s is now part of %s", cfg.Host, currentDomain)
			return nil
		}
		if err != nil {
			logSetup("  Verification attempt %d/5 failed: %v", attempt, err)
		} else {
			logSetup("  Verification attempt %d/5: not yet joined, retrying...", attempt)
		}
		time.Sleep(30 * time.Second)
	}

	return fmt.Errorf("domain join verification failed after restart for worker %s", cfg.Host)
}
