//go:build linux

package healthcheck

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

// ---------------------------------------------------------------------------
// CPU — Linux: read from /proc/stat
// ---------------------------------------------------------------------------

// readCPUTimes parses the aggregate CPU line from /proc/stat and returns the
// idle and total tick counters.
func readCPUTimes() (cpuTimes, error) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return cpuTimes{}, fmt.Errorf("opening /proc/stat: %w", err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 5 {
			return cpuTimes{}, fmt.Errorf("unexpected /proc/stat cpu line: %s", line)
		}

		// Fields: cpu user nice system idle iowait irq softirq steal guest guest_nice
		var total uint64
		var idle uint64
		for i, f := range fields[1:] {
			val, err := strconv.ParseUint(f, 10, 64)
			if err != nil {
				continue
			}
			total += val
			if i == 3 { // idle is the 4th numeric field (index 3)
				idle = val
			}
		}

		return cpuTimes{idle: idle, total: total}, nil
	}

	return cpuTimes{}, fmt.Errorf("cpu line not found in /proc/stat")
}

// ---------------------------------------------------------------------------
// Memory — Linux: read from sysinfo syscall
// ---------------------------------------------------------------------------

// getSystemMemory returns total and free (available) system memory in bytes.
// On Linux this uses the sysinfo syscall which reports system-wide memory,
// matching the TypeScript os.totalmem() / os.freemem() behaviour.
func getSystemMemory() (total uint64, free uint64, err error) {
	var info unix.Sysinfo_t
	if err := unix.Sysinfo(&info); err != nil {
		return 0, 0, fmt.Errorf("sysinfo: %w", err)
	}

	unit := uint64(info.Unit)
	total = info.Totalram * unit
	free = info.Freeram * unit
	return total, free, nil
}
