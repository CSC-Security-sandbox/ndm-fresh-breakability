package main

import (
	"fmt"
	. "ndm-api-tests/utils"
	"os"
)

func main() {
	// Get command line arguments
	args := os.Args[1:]

	var cpIP, workerID string

	if len(args) >= 2 {
		// Arguments provided: use them
		cpIP = args[0]
		workerID = args[1]
		fmt.Printf(" Testing worker metrics integration with provided arguments...\n")
	} else {
		// No arguments: use defaults for standalone testing
		cpIP = "172.30.203.15"
		workerID = "fa11324d-af83-4fe7-a0f5-6c4f11d45d86"
		fmt.Printf(" Testing worker metrics integration with default values...\n")
	}

	fmt.Printf("Control Plane IP: %s\n", cpIP)
	fmt.Printf("Worker ID: %s\n", workerID)

	err := CallWorkerMetricsScript(cpIP, workerID)
	if err != nil {
		fmt.Printf(" Test failed: %v\n", err)
		os.Exit(1)
	} else {
		fmt.Printf(" Test passed: Worker metrics integration works!\n")
	}
}

// CallWorkerMetricsScript calls the Go worker metrics collection instead of Node.js
func CallWorkerMetricsScript(cpIP, workerID string) error {
	fmt.Printf(" Collecting worker metrics for %s...\n", workerID)

	// Use the Go implementation directly instead of Node.js
	err := CollectAndDisplayWorkerMetrics(cpIP, workerID, "Migration Performance Test")
	if err != nil {
		return fmt.Errorf("failed to collect worker metrics: %v", err)
	}

	return nil
}
