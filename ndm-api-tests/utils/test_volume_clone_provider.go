package utils

import (
	"os"
	"strings"
)

type VolumeCloneProvider string

const (
	VolumeCloneProviderONTAP VolumeCloneProvider = "ontap"
	VolumeCloneProviderANF   VolumeCloneProvider = "anf"
	VolumeCloneProviderFSxN  VolumeCloneProvider = "aws-fsxn"
	VolumeCloneProviderGCNV  VolumeCloneProvider = "gcnv"
)

type CloneSelection struct {
	SourceIndices []int
	DestIndices   []int
}

func ResolveVolumeCloneProvider() VolumeCloneProvider {
	requested := strings.ToLower(strings.TrimSpace(os.Getenv("VOLUME_CLONE_PROVIDER")))

	switch VolumeCloneProvider(requested) {
	case VolumeCloneProviderANF:
		return VolumeCloneProviderANF
	case VolumeCloneProviderONTAP:
		return VolumeCloneProviderONTAP
	case VolumeCloneProviderFSxN:
		return VolumeCloneProviderFSxN
	case VolumeCloneProviderGCNV:
		return VolumeCloneProviderGCNV
	}

	// Default to ONTAP unless we are explicitly running a nightly GitHub workflow.
	if os.Getenv("GITHUB_ACTIONS") == "true" {
		buildVersion := strings.ToLower(strings.TrimSpace(os.Getenv("BUILD_VERSION")))
		if strings.Contains(buildVersion, "-nightly") {
			return VolumeCloneProviderANF
		}
	}

	return VolumeCloneProviderONTAP
}

func RequiredCloneSelectionForTest(testIdentifier string, protocol Protocol) CloneSelection {
	normalized := strings.ToUpper(strings.TrimSpace(testIdentifier))

	switch protocol {
	case ProtocolNFS:
		switch {
		case strings.Contains(normalized, "RTC-003"):
			return CloneSelection{
				SourceIndices: []int{0},
				DestIndices:   []int{},
			}
		case strings.Contains(normalized, "RTC-004"), strings.Contains(normalized, "RTC-005"):
			return CloneSelection{
				SourceIndices: []int{0},
				DestIndices:   []int{0},
			}
		case strings.Contains(normalized, "GCNV FLEX") && strings.Contains(normalized, "REGRESSION"):
			return CloneSelection{
				SourceIndices: []int{0, 1},
				DestIndices:   []int{0, 1},
			}
		case strings.Contains(normalized, "GCNV FLEX"):
			return CloneSelection{
				SourceIndices: []int{0, 1},
				DestIndices:   []int{1},
			}
		case strings.Contains(normalized, "PROJECT ADMIN"), strings.Contains(normalized, "APP ADMIN"):
			return CloneSelection{
				SourceIndices: []int{0},
				DestIndices:   []int{0},
			}
		case strings.Contains(normalized, "TC-007"):
			return CloneSelection{
				SourceIndices: []int{0, 1},
				DestIndices:   []int{0, 1},
			}
		default:
			return CloneSelection{
				SourceIndices: []int{0, 1},
				DestIndices:   []int{0, 1},
			}
		}
	case ProtocolSMB:
		switch {
		case strings.Contains(normalized, "TC-ACL-MISMATCH"):
			return CloneSelection{
				SourceIndices: []int{2},
				DestIndices:   []int{2},
			}
		case strings.Contains(normalized, "TC-SMB-DIR-STAMPING"):
			// Dir-stamping test sources from index 4 and uses dest index 2.
			return CloneSelection{
				SourceIndices: []int{4},
				DestIndices:   []int{2},
			}
		case strings.Contains(normalized, "TC-SMB-PERMISSIONS"),
			strings.Contains(normalized, "TC-SMB-SID-MAPPING"),
			strings.Contains(normalized, "TC-SMB-NO-SID-MAPPING"):
			return CloneSelection{
				SourceIndices: []int{3},
				DestIndices:   []int{2},
			}
		case strings.Contains(normalized, "DLM"):
			// TC-001 DLM test: sources from index 4 and uses dest index 0.
			// Indices 0 and 1 are not needed since DLM only migrates a single directory.
			return CloneSelection{
				SourceIndices: []int{4},
				DestIndices:   []int{0},
			}
		case strings.Contains(normalized, "RTC-004"), strings.Contains(normalized, "RTC-005"):
			return CloneSelection{
				SourceIndices: []int{0},
				DestIndices:   []int{0},
			}
		case strings.Contains(normalized, "PROJECT ADMIN"), strings.Contains(normalized, "APP ADMIN"):
			return CloneSelection{
				SourceIndices: []int{0},
				DestIndices:   []int{0},
			}
		case strings.Contains(normalized, "TC-007"):
			return CloneSelection{
				SourceIndices: []int{0, 1},
				DestIndices:   []int{0, 1},
			}
		default:
			return CloneSelection{
				SourceIndices: []int{0, 1},
				DestIndices:   []int{0, 1},
			}
		}
	default:
		return CloneSelection{}
	}
}

func allIndices(length int) []int {
	indices := make([]int, 0, length)
	for i := 0; i < length; i++ {
		indices = append(indices, i)
	}

	return indices
}
