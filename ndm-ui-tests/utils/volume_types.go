package utils

import (
	"os"
	"strings"
)

// VolumeCloneProvider identifies which cloud/storage platform provides clones.
type VolumeCloneProvider string

const (
	VolumeCloneProviderONTAP VolumeCloneProvider = "ontap"
	VolumeCloneProviderANF   VolumeCloneProvider = "anf"
	VolumeCloneProviderFSxN  VolumeCloneProvider = "aws-fsxn"
)

// uiProtocolType is the active protocol for this UI test run.
// It is set by InitUIVolumeSetup and consulted by the ANF/ONTAP clone helpers.
var uiProtocolType Protocol = ProtocolNFS

// resolveVolumeCloneProvider reads VOLUME_CLONE_PROVIDER from the environment.
func resolveVolumeCloneProvider() VolumeCloneProvider {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("VOLUME_CLONE_PROVIDER"))) {
	case "anf":
		return VolumeCloneProviderANF
	case "aws-fsxn":
		return VolumeCloneProviderFSxN
	default:
		return VolumeCloneProviderONTAP
	}
}

// CloneSelection describes which volume indices within the master lists
// need to be cloned for a specific test.
type CloneSelection struct {
	SourceIndices []int
	DestIndices   []int
}

// allIndices returns [0, 1, …, length-1].
func allIndices(length int) []int {
	indices := make([]int, 0, length)
	for i := 0; i < length; i++ {
		indices = append(indices, i)
	}
	return indices
}
