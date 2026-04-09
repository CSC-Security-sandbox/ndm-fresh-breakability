package utils

import (
	"encoding/json"
	"fmt"
	"strings"
)

var (
	windowsCurrentDomainScript = `powershell.exe -Command "(Get-WmiObject Win32_ComputerSystem).Domain"`
	windowsDomainJoinStatusScript = `powershell.exe -Command "Get-WmiObject Win32_ComputerSystem | Select-Object -Property PartOfDomain,Domain | ConvertTo-Json"`
)

func orderedAttachedWorkerConfigsForDomainJoin() []SSHConfig {
	attachedWorkers := GetAttachedWorkersConfig()
	ordered := []SSHConfig{}
	seenHosts := make(map[string]bool)

	for _, workerConfig := range EnvWorkersConfigList {
		for _, attachedConfig := range attachedWorkers {
			if attachedConfig.Host == workerConfig.Host && !seenHosts[attachedConfig.Host] {
				ordered = append(ordered, attachedConfig)
				seenHosts[attachedConfig.Host] = true
				break
			}
		}
	}

	for _, attachedConfig := range attachedWorkers {
		if !seenHosts[attachedConfig.Host] {
			ordered = append(ordered, attachedConfig)
			seenHosts[attachedConfig.Host] = true
		}
	}

	return ordered
}

func checkDomainJoinStatusForWorker(sshConfig SSHConfig) (bool, string, error) {
	output, err := sshRunScript(sshConfig, windowsDomainJoinStatusScript)
	if err != nil {
		return false, "", fmt.Errorf("failed to check domain join status: %w\noutput: %s", err, output)
	}

	var result struct {
		PartOfDomain bool   `json:"PartOfDomain"`
		Domain       string `json:"Domain"`
	}

	if err := json.Unmarshal([]byte(output), &result); err != nil {
		if strings.Contains(output, "True") {
			domainOutput, _ := sshRunScript(sshConfig, windowsCurrentDomainScript)
			return true, strings.TrimSpace(domainOutput), nil
		}
		return false, "", nil
	}

	return result.PartOfDomain, strings.TrimSpace(result.Domain), nil
}

func joinWindowsWorkerToDomainWithConfig(sshConfig SSHConfig, domainName, domainUser, domainPassword string, restartTimeout int) error {
	LogDebug(fmt.Sprintf("Joining Windows worker %s to domain: %s", sshConfig.Host, domainName))

	isJoined, currentDomain, err := checkDomainJoinStatusForWorker(sshConfig)
	if err == nil {
		if isJoined && strings.EqualFold(currentDomain, domainName) {
			LogDebug(fmt.Sprintf("Worker %s is already joined to domain: %s", sshConfig.Host, currentDomain))
			return nil
		}

		if isJoined && !strings.EqualFold(currentDomain, domainName) {
			LogDebug(fmt.Sprintf("Worker %s is already domain-joined, but to %s (expected: %s)", sshConfig.Host, currentDomain, domainName))
		}
	}

	script := joinDomainScript(domainName, domainUser, domainPassword)
	LogDebug(fmt.Sprintf("Executing domain join command on worker %s...", sshConfig.Host))

	output, err := sshRunScript(sshConfig, script)
	LogDebug(fmt.Sprintf("Domain join output for worker %s: %s", sshConfig.Host, output))

	if err != nil {
		// Check if the error is due to restart (expected behavior)
		if strings.Contains(err.Error(), "connection") || strings.Contains(err.Error(), "EOF") {
			LogDebug(fmt.Sprintf("Connection to worker %s lost during restart (expected) - waiting for VM to come back online...", sshConfig.Host))
		} else {
			return fmt.Errorf("domain join failed for worker %s: %w\noutput: %s", sshConfig.Host, err, output)
		}
	}

	if restartTimeout == 0 {
		restartTimeout = 180 // Default 3 minutes
	}

	LogDebug(fmt.Sprintf("Waiting %d seconds for worker %s to restart and rejoin network...", restartTimeout, sshConfig.Host))
	Wait(restartTimeout)

	LogDebug(fmt.Sprintf("Verifying domain join status for worker %s...", sshConfig.Host))
	for attempts := 0; attempts < 5; attempts++ {
		isJoined, currentDomain, err = checkDomainJoinStatusForWorker(sshConfig)
		if err == nil && isJoined {
			LogDebug(fmt.Sprintf("Domain join verification successful for worker %s!", sshConfig.Host))
			LogDebug(fmt.Sprintf("Worker %s is now part of domain: %s", sshConfig.Host, currentDomain))
			return nil
		}

		if err != nil {
			LogDebug(fmt.Sprintf("Domain join verification attempt %d/5 failed for worker %s: %v", attempts+1, sshConfig.Host, err))
		} else {
			LogDebug(fmt.Sprintf("Domain join verification attempt %d/5 failed for worker %s, retrying...", attempts+1, sshConfig.Host))
		}
		Wait(30)
	}

	return fmt.Errorf("domain join verification failed after restart for worker %s - worker may not be fully joined", sshConfig.Host)
}

// This function will cause the VM(s) to restart, so it should be called early in test setup.
func JoinWindowsWorkerToDomain(domainName, domainUser, domainPassword string, restartTimeout int) error {
	workerConfigs := orderedAttachedWorkerConfigsForDomainJoin()
	if len(workerConfigs) == 0 {
		return fmt.Errorf("no attached workers available for domain join")
	}

	for _, sshConfig := range workerConfigs {
		if err := joinWindowsWorkerToDomainWithConfig(sshConfig, domainName, domainUser, domainPassword, restartTimeout); err != nil {
			return err
		}
	}

	return nil
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

// CheckDomainJoinStatus checks if all attached Windows workers are joined to the same domain.
// Returns true only when every attached worker is domain-joined.
func CheckDomainJoinStatus() (bool, string, error) {
	workerConfigs := orderedAttachedWorkerConfigsForDomainJoin()
	if len(workerConfigs) == 0 {
		return false, "", fmt.Errorf("no attached workers available for domain join status check")
	}

	allJoined := true
	commonDomain := ""

	for _, sshConfig := range workerConfigs {
		isJoined, currentDomain, err := checkDomainJoinStatusForWorker(sshConfig)
		if err != nil {
			return false, "", fmt.Errorf("worker %s: %w", sshConfig.Host, err)
		}

		if !isJoined {
			allJoined = false
			continue
		}

		if currentDomain == "" {
			continue
		}

		if commonDomain == "" {
			commonDomain = currentDomain
			continue
		}

		if !strings.EqualFold(commonDomain, currentDomain) {
			allJoined = false
		}
	}

	return allJoined, commonDomain, nil
}

// EnsureWindowsWorkerDomainJoined ensures all attached Windows workers are domain-joined before running AD-dependent tests.
func EnsureWindowsWorkerDomainJoined(domainName, domainUser, domainPassword string) error {
	LogDebug("Checking Windows workers domain join status...")

	workerConfigs := orderedAttachedWorkerConfigsForDomainJoin()
	if len(workerConfigs) == 0 {
		return fmt.Errorf("no attached workers available for domain join")
	}

	for _, sshConfig := range workerConfigs {
		isJoined, currentDomain, err := checkDomainJoinStatusForWorker(sshConfig)
		if err != nil {
			LogDebug(fmt.Sprintf("Warning: Could not check domain status for worker %s: %v", sshConfig.Host, err))
			LogDebug(fmt.Sprintf("Attempting domain join for worker %s anyway...", sshConfig.Host))
			if err := joinWindowsWorkerToDomainWithConfig(sshConfig, domainName, domainUser, domainPassword, 180); err != nil {
				return err
			}
			continue
		}

		if isJoined && strings.EqualFold(currentDomain, domainName) {
			LogDebug(fmt.Sprintf("Worker %s is already joined to domain: %s", sshConfig.Host, currentDomain))
			continue
		}

		if isJoined && !strings.EqualFold(currentDomain, domainName) {
			LogDebug(fmt.Sprintf("Worker %s is joined to different domain: %s (expected: %s)", sshConfig.Host, currentDomain, domainName))
			LogDebug("Note: Rejoining to a different domain may require manual intervention")
		} else {
			LogDebug(fmt.Sprintf("Worker %s is not domain-joined (workgroup mode), joining to: %s", sshConfig.Host, domainName))
		}

		if err := joinWindowsWorkerToDomainWithConfig(sshConfig, domainName, domainUser, domainPassword, 180); err != nil {
			return err
		}
	}

	return nil
}
