# E2E Test Parallel Execution Strategy

## Overview

This document outlines the three-stage approach to enable parallel execution of E2E tests for the NetApp Data Migrator (NDM) project. The goal is to reduce test execution time while maintaining test isolation and reliability.

---

## Stage 1: Test Case Consolidation (Completed)

### Objective
Consolidate redundant test cases to reduce the total number of migrations and discoveries while preserving comprehensive feature coverage.

### Approach
- **Merged Similar Tests**: Combined test cases that were testing similar features with slight variations
  - Example: TC-SMB-PERMISSIONS-001 and TC-SMB-PERMISSIONS-004 merged into a single test
  - Example: TC-SMB-PERMISSIONS-002 and TC-SMB-PERMISSIONS-003 merged into a single test
  
- **Benefits Achieved**:
  - Reduced total test execution time by eliminating duplicate setup/teardown operations
  - Simplified test maintenance by reducing code duplication
  - Maintained full feature coverage through comprehensive assertions within consolidated tests

### Examples of Consolidation

**Before:**
```
TC-001: Discovery + Migration + Cutover
TC-002: Discovery + Migration + Different Options
TC-003: Discovery + Migration + Another Variation
```

**After:**
```
TC-001-002-003: Single test covering all scenarios with multiple assertions
```

### Impact
- Reduced number of file server creations
- Reduced number of discovery jobs
- Reduced number of migration jobs
- Faster sequential execution time

---

## Stage 2: ONTAP Volume Cloning for Test Isolation (Current Implementation)

### Objective
Enable multiple developers/pipelines to run E2E tests in parallel without interfering with each other's test data.

### Problem Statement
**Before Stage 2:**
- All tests used the same shared volumes (e.g., `volSrcAuto`, `vol_dest_automation`)
- Multiple test runs would interfere with each other:
  - Test A writes data → Test B discovers it → Test failures
  - Race conditions on volume content
  - Unpredictable test results
- Only one person/pipeline could run tests at a time

### Solution: ONTAP FlexClone Technology

#### Architecture

```
Master Volumes (Read-Only, Never Modified)
├── master_nfs_vol_dnd_src_automation_1
├── master_nfs_vol_dnd_src_automation_2
├── master_nfs_vol_dnd_src_automation_3
├── master_smb_vol_dnd_src_automation_1
├── master_smb_vol_dnd_src_automation_2
├── master_smb_vol_dnd_src_automation_3
└── master_smb_vol_dnd_src_automation_4_perms1

Each Test Run Creates Clones
├── Test Run 1 (Developer A)
│   ├── master_nfs_vol_dnd_src_automation_1_tc_001_a1b2c3d4
│   ├── master_nfs_vol_dnd_src_automation_2_tc_001_e5f6g7h8
│   └── ...
└── Test Run 2 (Developer B - Parallel)
    ├── master_nfs_vol_dnd_src_automation_1_tc_001_i9j0k1l2
    ├── master_nfs_vol_dnd_src_automation_2_tc_001_m3n4o5p6
    └── ...
```

#### Implementation Details

**1. Volume Naming Convention**
```
Format: {baseVolumeName}_{testCase_max10chars}_{uniqueID_8chars}

Examples:
- master_nfs_vol_dnd_src_automation_1_tc_001_a1b2c3d4
- master_smb_vol_dnd_src_automation_2_tc_permis_e5f6g7h8
```

**2. Protocol-Specific Configuration**

**NFS Configuration:**
```bash
# Master Volumes
ONTAP_NFS_SOURCE_VOLUMES="master_nfs_vol_dnd_src_automation_1,master_nfs_vol_dnd_src_automation_2,master_nfs_vol_dnd_src_automation_3"
ONTAP_NFS_DEST_VOLUMES="master_nfs_vol_dnd_dest_automation_1,master_nfs_vol_dnd_dest_automation_2"

# Host IPs (must match volume count)
ONTAP_NFS_SRC_HOST_IP="10.192.7.111,10.192.7.111,10.192.7.111"
ONTAP_NFS_DST_HOST_IP="10.192.7.44,10.192.7.44"
```

**SMB Configuration:**
```bash
# ONTAP Volumes (Cloneable)
ONTAP_SMB_SOURCE_VOLUMES="master_smb_vol_dnd_src_automation_1,master_smb_vol_dnd_src_automation_2,master_smb_vol_dnd_src_automation_3,master_smb_vol_dnd_src_automation_4_perms1"
ONTAP_SMB_DEST_VOLUMES="master_smb_vol_dnd_dest_automation_1,master_smb_vol_dnd_dest_automation_2,master_smb_vol_dnd_dest_automation_3_perms2"

# Host IPs (must match volume count)
ONTAP_SMB_SRC_HOST_IP="10.192.7.111,10.192.7.111,10.192.7.111,10.192.7.111"
ONTAP_SMB_DST_HOST_IP="10.192.7.44,10.192.7.44,10.192.7.44"

# AD Server Volumes (Not Cloneable - Direct Access)
AD_SMB_SOURCE_VOLUMES="SMB-completion,auto_smb_restrictedVol,auto_shorts_name"
AD_SMB_SOURCE_HOST_IP="172.30.202.5,172.30.202.5,172.30.202.5"
```

**3. Volume Cloning Workflow**

```go
// BeforeEach - Setup cloned volumes
clonedSourceVolumes, clonedDestVolumes, sourceManager, destManager, err := SetupTestVolumesBeforeEach()

// Behind the scenes:
// 1. Creates FlexClone of master volumes
// 2. Sets junction path: /{clonedVolumeName}
// 3. Creates NFS export OR SMB share (protocol-aware)
// 4. Returns cloned volume names

// Test execution uses cloned volumes
sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[0], clonedSourceVolumes[0])

// Cleanup - Automatic via DeferCleanup
DeferCleanup(func() {
    CleanupTestVolumesAfterEach(sourceManager, destManager)
})
```

**4. Protocol-Aware Share/Export Creation**

**NFS:**
```go
func CreateNFSExportForVolume(svmName, volumeName string) error {
    // Creates export policy via ONTAP API
    // POST /api/protocols/nfs/export-policies/{policy_id}/rules
    // Allows 0.0.0.0/0 access for test flexibility
}
```

**SMB:**
```go
func CreateSMBShareForVolume(svmName, volumeName string) error {
    // Creates CIFS share via ONTAP API
    // POST /api/protocols/cifs/shares
    // Share name = volume name (max 80 chars)
    // Share path = /{volumeName}
}
```

### Key Advantages We Get From This Approach

1. **Parallel Execution**: Multiple developers can run tests simultaneously
2. **Test Isolation**: Each test run has its own data, no interference
3. **Fast Cloning**: FlexClone is instant (copy-on-write technology)
4. **Storage Efficient**: Clones share blocks with master volumes
5. **Automatic Cleanup**: Cloned volumes deleted after test completion
6. **Protocol Support**: Works for both NFS and SMB protocols
7. **Reliability**: DeferCleanup ensures cleanup even on test failures/interrupts

### Limitations & Special Cases

**AD Server Volumes (SMB Only):**
- Cannot be cloned (not on ONTAP)
- Used directly by specific tests (TC-SMB-REDIRECTS)
- Require sequential execution for tests using these volumes

**Test-Level Considerations:**
- TC-SUPPORT-BUNDLE: Has 3 `It` blocks, uses same clones across all
- TC-001 to TC-006: Each has 1 `It` block, new clones per test

---

## Stage 3: Test Suite Parallelization

### Objective
Run multiple test suites in parallel to further reduce total execution time.

### Current State
- All tests run sequentially within a single Ginkgo process
- Total execution time = Sum of all test times
- Example: 10 tests × 5 minutes = 50 minutes total

### Target State
- Multiple test suites run in parallel Ginkgo processes
- Total execution time ≈ Longest test time
- Example: 10 tests × 5 minutes / 4 workers = ~12.5 minutes total

### Approach

**1. Ginkgo Parallel Execution**

```bash
# Current (Sequential)
ginkgo -v ./tests/e2e/ -- --protocol_type=NFS --environment=Azure

# Future (Parallel with 4 processes)
ginkgo -v -p -procs=4 ./tests/e2e/ -- --protocol_type=NFS --environment=Azure
```

**2. Expected Benefits**

With 4 parallel processes:
- **Execution Time**: 4× faster (50 min → ~12.5 min)
- **Resource Usage**: Higher CPU/memory during execution
- **CI/CD Impact**: Faster feedback loop for developers
- **Developer Productivity**: Faster local test runs

**3. Volume Cloning in Parallel Mode**

**Already Compatible!** Stage 2 implementation automatically works:

```go
// Each parallel process gets unique clone names due to UUID
master_vol_1_tc_001_a1b2c3d4  // Process 1
master_vol_1_tc_001_e5f6g7h8  // Process 2 (different UUID)
master_vol_1_tc_001_i9j0k1l2  // Process 3 (different UUID)
master_vol_1_tc_001_m3n4o5p6  // Process 4 (different UUID)
```

No cloning changes needed - isolation is automatic!

---

## Summary Comparison

| Aspect | Stage 1 | Stage 2 | Stage 3 |
|--------|---------|---------|---------|
| **Goal** | Reduce total work | Enable parallel users | Enable parallel tests |
| **Approach** | Consolidate tests | Volume cloning | Ginkgo -p flag |
| **Speed Gain** | ~30% faster | No speed gain* | 4× faster** |
| **Isolation** | Shared volumes | Isolated volumes | Isolated everything |
| **Complexity** | Low | Medium | High |
| **Status** | Complete | Complete | Planned |

\* Stage 2 enables parallel execution but doesn't speed up a single test run  
\*\* Stage 3 assumes 4 parallel processes

---
