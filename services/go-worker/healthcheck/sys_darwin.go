//go:build darwin

package healthcheck

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"sync/atomic"

	"golang.org/x/sys/unix"
)

// ---------------------------------------------------------------------------
// CPU — Darwin: parse `top -l 1 -n 0 -s 0` output
// ---------------------------------------------------------------------------

// monotonic is a simple incrementing counter used to synthesise cumulative
// tick values from the instantaneous CPU percentages that macOS `top` reports.
// This lets the shared calculateCPUPercent delta logic work unchanged.
var tickCounter atomic.Uint64

// readCPUTimes returns synthesised cumulative CPU idle and total ticks on
// macOS. Since macOS does not expose /proc/stat or kern.cp_time, we parse
// the "CPU usage:" line from `top -l 1 -n 0 -s 0` which reports
// instantaneous user/sys/idle percentages. We convert these into synthetic
// cumulative tick values so the shared calculateCPUPercent delta works.
func readCPUTimes() (cpuTimes, error) {
	out, err := exec.Command("top", "-l", "1", "-n", "0", "-s", "0").Output()
	if err != nil {
		return cpuTimes{}, fmt.Errorf("top: %w", err)
	}

	// Find the "CPU usage:" line.
	// Example: "CPU usage: 27.20% user, 17.18% sys, 55.60% idle"
	var userPct, sysPct, idlePct float64
	found := false
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.HasPrefix(line, "CPU usage:") {
			continue
		}
		found = true
		// Strip prefix: "27.20% user, 17.18% sys, 55.60% idle"
		rest := strings.TrimPrefix(line, "CPU usage:")
		rest = strings.TrimSpace(rest)
		parts := strings.Split(rest, ",")
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if strings.HasSuffix(p, "user") {
				userPct = parsePercentField(p)
			} else if strings.HasSuffix(p, "sys") {
				sysPct = parsePercentField(p)
			} else if strings.HasSuffix(p, "idle") {
				idlePct = parsePercentField(p)
			}
		}
		break
	}

	if !found {
		return cpuTimes{}, fmt.Errorf("CPU usage line not found in top output")
	}

	// Convert percentages into synthetic cumulative ticks. We use a
	// monotonically increasing counter so the delta calculation works.
	// Scale percentages by 100 to get integer-like precision.
	tick := tickCounter.Add(1)
	scale := float64(tick) * 100.0

	totalTicks := uint64(scale)
	busyPct := userPct + sysPct
	_ = busyPct
	idleTicks := uint64(idlePct / 100.0 * scale)

	return cpuTimes{idle: idleTicks, total: totalTicks}, nil
}

// parsePercentField extracts the numeric value from a string like "27.20% user".
func parsePercentField(s string) float64 {
	s = strings.TrimSpace(s)
	// Remove the label (user/sys/idle).
	idx := strings.Index(s, "%")
	if idx == -1 {
		return 0
	}
	val, err := strconv.ParseFloat(s[:idx], 64)
	if err != nil {
		return 0
	}
	return val
}

// ---------------------------------------------------------------------------
// Memory — Darwin: use sysctl hw.memsize for total, vm_stat for free
// ---------------------------------------------------------------------------

// getSystemMemory returns total and free system memory in bytes on macOS.
// Total memory comes from hw.memsize (always accurate).
// Free memory is read from vm_stat, matching Node.js os.freemem() on Darwin.
func getSystemMemory() (total uint64, free uint64, err error) {
	// Total physical memory.
	totalMem, err := unix.SysctlUint64("hw.memsize")
	if err != nil {
		return 0, 0, fmt.Errorf("sysctl hw.memsize: %w", err)
	}

	// Free memory — parse vm_stat to get free pages.
	freeMem, err := getFreeMem()
	if err != nil {
		// If we can't get free memory, return total with 0 free.
		return totalMem, 0, nil
	}

	return totalMem, freeMem, nil
}

// getFreeMem parses `vm_stat` output to calculate free memory.
// On macOS, Node.js os.freemem() reports "Pages free" * page size.
func getFreeMem() (uint64, error) {
	out, err := exec.Command("vm_stat").Output()
	if err != nil {
		return 0, fmt.Errorf("vm_stat: %w", err)
	}

	lines := strings.Split(string(out), "\n")

	// First line: "Mach Virtual Memory Statistics: (page size of 16384 bytes)"
	var pageSize uint64 = 16384 // default for Apple Silicon
	if len(lines) > 0 {
		first := lines[0]
		if idx := strings.Index(first, "page size of "); idx != -1 {
			rest := first[idx+len("page size of "):]
			rest = strings.TrimSuffix(rest, " bytes)")
			if ps, err := strconv.ParseUint(strings.TrimSpace(rest), 10, 64); err == nil {
				pageSize = ps
			}
		}
	}

	var freePages uint64
	for _, line := range lines[1:] {
		if strings.HasPrefix(line, "Pages free:") {
			freePages = parseVMStatValue(line)
			break
		}
	}

	return freePages * pageSize, nil
}

// parseVMStatValue extracts the numeric value from a vm_stat line like
// "Pages free:                            12345."
func parseVMStatValue(line string) uint64 {
	parts := strings.SplitN(line, ":", 2)
	if len(parts) < 2 {
		return 0
	}
	s := strings.TrimSpace(parts[1])
	s = strings.TrimSuffix(s, ".")
	val, _ := strconv.ParseUint(s, 10, 64)
	return val
}
