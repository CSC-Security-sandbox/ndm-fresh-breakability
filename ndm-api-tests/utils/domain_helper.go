package utils

import (
	"encoding/json"
	"fmt"
	"strings"
)

// This function will cause the VM to restart, so it should be called early in test setup
func JoinWindowsWorkerToDomain(domainName, domainUser, domainPassword string, restartTimeout int) error {
	LogDebug(fmt.Sprintf("Joining Windows worker to domain: %s", domainName))

	config := GetAttachedWorkerDetails()
	sshConfig := SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	// First check if already domain-joined
	checkScript := `powershell.exe -Command "(Get-WmiObject Win32_ComputerSystem).PartOfDomain"`
	output, err := sshRunScript(sshConfig, checkScript)
	if err == nil && strings.Contains(output, "True") {
		LogDebug("Windows worker is already domain-joined, checking domain name...")
		checkDomainScript := `powershell.exe -Command "(Get-WmiObject Win32_ComputerSystem).Domain"`
		domainOutput, err := sshRunScript(sshConfig, checkDomainScript)
		if err == nil && strings.Contains(strings.ToLower(domainOutput), strings.ToLower(domainName)) {
			LogDebug(fmt.Sprintf("Worker is already joined to domain: %s", strings.TrimSpace(domainOutput)))
			return nil
		}
	}

	// Create credentials and join domain
	script := joinDomainScript(domainName, domainUser, domainPassword)
	LogDebug("Executing domain join command...")

	output, err = sshRunScript(sshConfig, script)
	LogDebug(fmt.Sprintf("Domain join output: %s", output))

	if err != nil {
		// Check if the error is due to restart (expected behavior)
		if strings.Contains(err.Error(), "connection") || strings.Contains(err.Error(), "EOF") {
			LogDebug("Connection lost during restart (expected) - waiting for VM to come back online...")
		} else {
			return fmt.Errorf("domain join failed: %w\noutput: %s", err, output)
		}
	}

	// Wait for restart
	if restartTimeout == 0 {
		restartTimeout = 180 // Default 3 minutes
	}

	LogDebug(fmt.Sprintf("Waiting %d seconds for VM to restart and rejoin network...", restartTimeout))
	Wait(restartTimeout)

	// Verify domain join was successful
	LogDebug("Verifying domain join status...")
	for attempts := 0; attempts < 5; attempts++ {
		output, err = sshRunScript(sshConfig, checkScript)
		if err == nil && strings.Contains(output, "True") {
			LogDebug("Domain join verification successful!")

			// Get domain name for confirmation
			domainOutput, _ := sshRunScript(sshConfig, `powershell.exe -Command "(Get-WmiObject Win32_ComputerSystem).Domain"`)
			LogDebug(fmt.Sprintf("Worker is now part of domain: %s", strings.TrimSpace(domainOutput)))
			return nil
		}

		LogDebug(fmt.Sprintf("Domain join verification attempt %d/5 failed, retrying...", attempts+1))
		Wait(30)
	}

	return fmt.Errorf("domain join verification failed after restart - worker may not be fully joined")
}

func joinDomainScript(domainName, domainUser, domainPassword string) string {
	// Escape special characters in password
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

	return script
}

// CheckDomainJoinStatus checks if the Windows worker is joined to a domain
// Returns: (isJoined bool, domainName string, error)
func CheckDomainJoinStatus() (bool, string, error) {
	config := GetAttachedWorkerDetails()
	sshConfig := SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	checkScript := `powershell.exe -Command "Get-WmiObject Win32_ComputerSystem | Select-Object -Property PartOfDomain,Domain | ConvertTo-Json"`
	output, err := sshRunScript(sshConfig, checkScript)
	if err != nil {
		return false, "", fmt.Errorf("failed to check domain join status: %w\noutput: %s", err, output)
	}

	// Parse JSON output
	var result struct {
		PartOfDomain bool   `json:"PartOfDomain"`
		Domain       string `json:"Domain"`
	}

	err = json.Unmarshal([]byte(output), &result)
	if err != nil {
		// Try alternate parsing if JSON fails
		if strings.Contains(output, "True") {
			domainScript := `powershell.exe -Command "(Get-WmiObject Win32_ComputerSystem).Domain"`
			domainOutput, _ := sshRunScript(sshConfig, domainScript)
			return true, strings.TrimSpace(domainOutput), nil
		}
		return false, "", nil
	}

	return result.PartOfDomain, result.Domain, nil
}

// EnsureWindowsWorkerDomainJoined ensures the Windows worker is domain-joined before running AD-dependent tests
// This is a convenience wrapper that checks status and joins if needed
func EnsureWindowsWorkerDomainJoined(domainName, domainUser, domainPassword string) error {
	LogDebug("Checking Windows worker domain join status...")

	isJoined, currentDomain, err := CheckDomainJoinStatus()
	if err != nil {
		LogDebug(fmt.Sprintf("Warning: Could not check domain status: %v", err))
		LogDebug("Attempting domain join anyway...")
		return JoinWindowsWorkerToDomain(domainName, domainUser, domainPassword, 180)
	}

	if isJoined && strings.EqualFold(currentDomain, domainName) {
		LogDebug(fmt.Sprintf("Worker is already joined to domain: %s", currentDomain))
		return nil
	}

	if isJoined && !strings.EqualFold(currentDomain, domainName) {
		LogDebug(fmt.Sprintf("Worker is joined to different domain: %s (expected: %s)", currentDomain, domainName))
		LogDebug("Note: Rejoining to a different domain may require manual intervention")
	}

	LogDebug(fmt.Sprintf("Worker is not domain-joined (workgroup mode), joining to: %s", domainName))
	return JoinWindowsWorkerToDomain(domainName, domainUser, domainPassword, 180)
}
