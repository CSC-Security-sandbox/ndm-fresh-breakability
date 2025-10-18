# ADS Implementation - Detailed Technical Documentation

## Overview
This document provides a comprehensive technical overview of the Alternate Data Streams (ADS) implementation in NDM using temporal workflows. The implementation follows NDM's existing patterns and leverages its temporal infrastructure for reliable, scalable ADS processing.

## Architecture Overview

```mermaid
graph TB
    subgraph "NDM Temporal Infrastructure"
        subgraph "ADS Layer"
            AW[AdsWorkflow]
            BAW[BatchAdsWorkflow]
            AAS[AdsActivityService]
            
            AW --> AAS
            BAW --> AW
        end
        
        subgraph "Activities"
            DA[discoverAdsStreams]
            TA[transferAdsStream] 
            VA[validateAdsStreams]
            
            AAS --> DA
            AAS --> TA
            AAS --> VA
        end
        
        subgraph "PowerShell Layer"
            DFA[Discover-FileADS]
            GFA[Get-FileADS]
            SFA[Set-FileADS]
            
            DA --> DFA
            TA --> GFA
            TA --> SFA
        end
    end
    
    subgraph "Existing NDM Infrastructure"
        WOS[WinOperationService]
        WSS[WinShellService]
        RED[Redis Cache]
        JMS[Job Management]
        
        DFA --> WOS
        WOS --> WSS
        AAS --> WOS
        AW --> JMS
    end
    
    subgraph "External Systems"
        SF[Source Files with ADS]
        DF[Destination Files]
        TUI[Temporal UI]
        
        SF --> DA
        TA --> DF
        AW --> TUI
    end
    
    classDef workflow fill:#e1f5fe
    classDef activity fill:#f3e5f5
    classDef powershell fill:#fff3e0
    classDef infrastructure fill:#e8f5e8
    
    class AW,BAW workflow
    class AAS,DA,TA,VA activity
    class DFA,GFA,SFA powershell
    class WOS,WSS,RED,JMS infrastructure
```

### System Architecture Layers

```mermaid
graph LR
    subgraph "Layer 1: Temporal Workflows"
        W1[AdsWorkflow<br/>Single File Processing]
        W2[BatchAdsWorkflow<br/>Multi-File Processing]
    end
    
    subgraph "Layer 2: Activities"
        A1[Discovery Activity]
        A2[Transfer Activity]
        A3[Validation Activity]
    end
    
    subgraph "Layer 3: Services"
        S1[AdsActivityService<br/>Orchestration]
        S2[WinOperationService<br/>Windows Operations]
        S3[WinShellService<br/>PowerShell Execution]
    end
    
    subgraph "Layer 4: PowerShell Scripts"
        P1[Discover-FileADS<br/>Stream Enumeration]
        P2[Get-Content/Set-Content<br/>Stream Transfer]
        P3[Stream Validation<br/>Integrity Checks]
    end
    
    subgraph "Layer 5: Windows APIs"
        API1[NTFS File System]
        API2[PowerShell Core]
        API3[Windows Security]
    end
    
    W1 --> A1
    W1 --> A2
    W1 --> A3
    W2 --> W1
    
    A1 --> S1
    A2 --> S1
    A3 --> S1
    
    S1 --> S2
    S2 --> S3
    
    S3 --> P1
    S3 --> P2
    S3 --> P3
    
    P1 --> API1
    P2 --> API2
    P3 --> API3
```

## Core Components

### 1. ADS Activity Service (`ads-activity.service.ts`)

**Purpose**: Provides temporal activities for ADS operations
**Location**: `services/worker/src/activities/core/ads/ads-activity.service.ts`

#### Key Methods:

##### `discoverAdsStreams(input: AdsDiscoveryInput): Promise<AdsDiscoveryOutput>`
```typescript
// Discovers ADS streams for a file using WinOperationService
const adsResult = await this.winOperationService.discoverAdsForFile(input.filePath);
return {
  fileId: adsResult.fileId,
  filePath: adsResult.filePath,
  streamCount: adsResult.streamCount,
  totalSize: adsResult.totalAdsSize,
  requiresProcessing: adsResult.streamCount > 0
};
```

##### `transferAdsStream(input: AdsTransferInput): Promise<AdsTransferOutput>`
```typescript
// Transfers a single ADS stream using PowerShell
const transferScript = `
  $ErrorActionPreference = 'Stop'
  try {
    $source = "${input.filePath.replace(/"/g, '`"')}"
    $dest = "${input.destinationPath.replace(/"/g, '`"')}"
    $streamName = "${input.streamName}"
    
    # Read source ADS content
    $content = Get-Content -Path $source -Stream $streamName -Raw
    $size = (Get-Item $source -Stream $streamName).Length
    
    # Write to destination ADS
    Set-Content -Path $dest -Stream $streamName -Value $content
    
    # Verify transfer
    $destStream = Get-Item $dest -Stream $streamName
    if ($destStream.Length -ne $size) {
      throw "Transfer verification failed"
    }
    
    Write-Output "SUCCESS:$size"
  } catch {
    Write-Output "ERROR:$($_.Exception.Message)"
  }
`;
```

##### `validateAdsStreams(input: AdsValidationInput): Promise<AdsValidationOutput>`
```typescript
// Validates that expected ADS streams exist at destination
for (const streamName of input.expectedStreams) {
  // Check existence and integrity of each stream
}
```

**Integration Points**:
- Uses `WinOperationService` for PowerShell execution
- Follows NDM's error handling patterns
- Leverages existing logging infrastructure

### 2. ADS Workflows (`ads-workflow.ts`)

**Purpose**: Orchestrates ADS processing using temporal workflows
**Location**: `services/worker/src/workflows/core/ads/ads-workflow.ts`

#### AdsWorkflow - Single File Processing

```typescript
export const AdsWorkflow = async ({
  traceId,
  filePath,
  destinationPath,
  options = {},
}: AdsWorkflowInput): Promise<AdsWorkflowOutput> => {
```

**Workflow Steps**:

1. **Discovery Phase**
   ```typescript
   // Check if file has ADS streams
   const hasAds = await shouldProcessAdsActivity(filePath);
   if (!hasAds) return completed_output;
   
   // Discover all ADS streams
   const discoveryResult = await discoverAdsStreamsActivity({ filePath });
   ```

2. **Transfer Phase**
   ```typescript
   // Transfer each discovered stream
   for (const streamName of streamNames) {
     const transferResult = await transferAdsStreamActivity({
       filePath,
       destinationPath,
       streamName,
       options: { validateChecksum: true, chunkSize: 10 * 1024 * 1024 }
     });
   }
   ```

3. **Validation Phase**
   ```typescript
   // Validate transferred streams if requested
   if (options.validateTransfer && output.streamsTransferred > 0) {
     const validationResult = await validateAdsStreamsActivity({
       filePath,
       destinationPath,
       expectedStreams: streamNames
     });
   }
   ```

4. **Status Reporting**
   ```typescript
   // Update job status through NDM's job management
   await updateJobStatusActivity({ 
     jobRunId: traceId, 
     status: output.status
   });
   ```

#### BatchAdsWorkflow - Multi-File Processing

```typescript
export const BatchAdsWorkflow = async ({
  traceId,
  filePaths,
  destinationBasePath,
  options = {},
}: BatchAdsWorkflowInput): Promise<BatchAdsWorkflowOutput> => {
```

**Features**:
- **Concurrency Control**: Process files in batches with configurable concurrency
- **Child Workflows**: Each file processed as separate workflow for isolation
- **Progress Tracking**: Aggregate results from all file workflows

```typescript
// Process files in batches to control concurrency
for (let i = 0; i < filePaths.length; i += maxConcurrency) {
  const batch = filePaths.slice(i, i + maxConcurrency);
  
  for (const filePath of batch) {
    const filePromise = wf.executeChild(AdsWorkflow, {
      args: [{ traceId: `${traceId}-file-${i}`, filePath, destinationPath }],
      workflowId: `ads-${traceId}-${i}`,
    });
    filePromises.push(filePromise);
  }
  
  // Wait for current batch to complete
  const batchResults = await Promise.allSettled(filePromises);
}
```

### 3. WinOperationService Integration

**Purpose**: Provides ADS discovery and validation within existing ACL operations
**Location**: `services/worker/src/activities/core/migrate/command-execution/win-opeartions/win-operation.service.ts`

#### `discoverAdsForFile(filePath: string): Promise<AdsDiscoveryResult>`

```typescript
async discoverAdsForFile(filePath: string): Promise<AdsDiscoveryResult> {
  try {
    const script = `$srcFile = '${filePath.replace(/'/g, "''")}'\nDiscover-FileADS $srcFile`;
    const output = await this.winShellService.executeCommand(script);
    
    const streamMetadata: AdsStreamMetadata[] = JSON.parse(output.stdout) || [];
    const totalAdsSize = streamMetadata.reduce((sum, stream) => sum + stream.size, 0);
    
    return {
      fileId: this.generateFileId(filePath),
      filePath,
      streamCount: streamMetadata.length,
      totalAdsSize,
      streams: streamMetadata,
      estimatedTotalTime: streamMetadata.reduce((sum, stream) => sum + stream.estimatedTransferTime, 0),
      requiresSpecialHandling: false // Temporal handles all sizes
    };
  } catch (error) {
    this.logger.error(`Failed to discover ADS for ${filePath}: ${error.message}`);
    return { /* empty result */ };
  }
}
```

**Integration with ACL Operations**:
```typescript
// ADS validation integrated into existing ACL validation
const sourceAds = acl1.AdsStreams || [];
const targetAds = acl2.AdsStreams || [];

// Validate each source ADS exists in target with matching content
for (const srcAds of sourceAds) {
  const found = targetAds.some(tgtAds =>
    tgtAds.StreamName === srcAds.StreamName &&
    tgtAds.Content === srcAds.Content &&
    tgtAds.IsBinary === srcAds.IsBinary
  );
  if (!found) {
    output.inValid += `Missing ADS in target: Stream(${srcAds.StreamName})`;
  }
}
```

### 4. PowerShell Scripts (`powershell.script.ts`)

**Purpose**: Low-level PowerShell functions for ADS operations
**Location**: `services/worker/src/activities/core/migrate/command-execution/win-opeartions/powershell.script.ts`

#### `Discover-FileADS` Function

```powershell
function Discover-FileADS([string]$path) {
    $adsMetadata = @()
    
    try {
        # Get all streams excluding main data stream
        $streams = Get-Item -LiteralPath $path -Stream * -ErrorAction SilentlyContinue | 
                   Where-Object { $_.Stream -ne ':$DATA' -and $_.Stream -ne '' }
        
        foreach ($stream in $streams) {
            # Type estimation based on stream name and size
            $estimatedType = 'unknown'
            $priority = 'normal'
            
            # Heuristic detection
            switch -Regex ($stream.Stream) {
                '(?i)(thumb|icon|image)' { 
                    $estimatedType = 'binary'; $priority = 'low' 
                }
                '(?i)(security|manifest|signature)' { 
                    $estimatedType = 'binary'; $priority = 'critical' 
                }
                '(?i)(meta|desc|comment|author)' { 
                    $estimatedType = 'text'; $priority = 'normal' 
                }
                '(?i)(zone\.identifier|quarantine)' { 
                    $priority = 'low' # System streams
                }
                default { 
                    if ($stream.Length -lt 1024) { $estimatedType = 'text' }
                    elseif ($stream.Length -gt 1048576) { $estimatedType = 'binary' }
                }
            }
            
            # Estimate transfer time (rough calculation)
            $estimatedTransferTime = [math]::Max(100, $stream.Length / 10240)
            
            $adsMetadata += [PSCustomObject]@{
                StreamName = $stream.Stream
                Size = $stream.Length
                EstimatedType = $estimatedType
                Priority = $priority
                EstimatedTransferTime = $estimatedTransferTime
            }
        }
    } catch {
        # Return empty array on discovery failure
    }
    
    return $adsMetadata
}
```

#### Simple Get/Set Functions (for ACL compatibility)

```powershell
function Get-FileADS([string]$path) {
    # Basic ADS enumeration for ACL operations
    $streams = Get-Item -LiteralPath $path -Stream * -ErrorAction SilentlyContinue | 
               Where-Object { $_.Stream -ne ':$DATA' }
    return $streams | ConvertTo-Json -Depth 3
}

function Set-FileADS([string]$path, [string]$streamName, [string]$content) {
    # Simple ADS setter for ACL operations
    Set-Content -Path $path -Stream $streamName -Value $content
}
```

## Module Integration

### Activity Registration (`activities.module.ts`)

```typescript
@Module({
  providers: [
    // ... existing activities
    AdsActivityService,  // ← New ADS activities
    // ... other activities
  ],
  exports: [
    // ... existing exports  
    AdsActivityService,  // ← Export for temporal worker
    // ... other exports
  ]
})
export class ActivitiesModule {}
```

### Workflow Export (`workflows.ts`)

```typescript
export * from './core/migrate/sync-workflow';
export * from './core/ads/ads-workflow';  // ← Export ADS workflows
```

## Data Flow

### 1. ADS Processing Flow - Single File

```mermaid
sequenceDiagram
    participant Client as NDM Client
    participant JobMgr as Job Manager
    participant TW as Temporal Worker
    participant AW as AdsWorkflow
    participant AAS as AdsActivityService
    participant WOS as WinOperationService
    participant WSS as WinShellService
    participant FS as File System

    Client->>JobMgr: File Migration Request
    JobMgr->>TW: Schedule ADS Task
    TW->>AW: Start AdsWorkflow
    
    Note over AW: Discovery Phase
    AW->>AAS: discoverAdsStreams()
    AAS->>WOS: discoverAdsForFile()
    WOS->>WSS: Execute PowerShell
    WSS->>FS: Discover-FileADS script
    FS-->>WSS: Stream metadata
    WSS-->>WOS: Script output
    WOS-->>AAS: AdsDiscoveryResult
    AAS-->>AW: Discovery output
    
    Note over AW: Transfer Phase
    loop For each ADS stream
        AW->>AAS: transferAdsStream()
        AAS->>WSS: Execute transfer script
        WSS->>FS: Get-Content (source)
        FS-->>WSS: Stream content
        WSS->>FS: Set-Content (destination)
        FS-->>WSS: Transfer result
        WSS-->>AAS: Transfer output
        AAS-->>AW: Transfer result
    end
    
    Note over AW: Validation Phase
    AW->>AAS: validateAdsStreams()
    AAS->>WSS: Execute validation script
    WSS->>FS: Check destination streams
    FS-->>WSS: Validation results
    WSS-->>AAS: Validation output
    AAS-->>AW: Validation result
    
    Note over AW: Status Update
    AW->>JobMgr: Update job status
    AW-->>TW: Workflow result
    TW-->>JobMgr: Task completion
    JobMgr-->>Client: Migration status
```

### 2. Batch Processing Flow

```mermaid
graph TD
    Start([Batch Request]) --> BatchWF[BatchAdsWorkflow]
    BatchWF --> Split{Split Files into Batches}
    
    Split --> Batch1[Batch 1<br/>Files 1-5]
    Split --> Batch2[Batch 2<br/>Files 6-10]
    Split --> Batch3[Batch N<br/>Files N...]
    
    Batch1 --> CW1[Child Workflow 1]
    Batch1 --> CW2[Child Workflow 2]
    Batch1 --> CW3[Child Workflow 3]
    
    Batch2 --> CW4[Child Workflow 4]
    Batch2 --> CW5[Child Workflow 5]
    
    Batch3 --> CWN[Child Workflow N]
    
    CW1 --> AW1[AdsWorkflow<br/>File 1]
    CW2 --> AW2[AdsWorkflow<br/>File 2]
    CW3 --> AW3[AdsWorkflow<br/>File 3]
    CW4 --> AW4[AdsWorkflow<br/>File 4]
    CW5 --> AW5[AdsWorkflow<br/>File 5]
    CWN --> AWN[AdsWorkflow<br/>File N]
    
    AW1 --> Wait1{Wait for Batch 1}
    AW2 --> Wait1
    AW3 --> Wait1
    AW4 --> Wait2{Wait for Batch 2}
    AW5 --> Wait2
    AWN --> WaitN{Wait for Batch N}
    
    Wait1 --> Aggregate[Aggregate Results]
    Wait2 --> Aggregate
    WaitN --> Aggregate
    
    Aggregate --> Status[Update Batch Status]
    Status --> End([Batch Complete])
    
    classDef workflow fill:#e1f5fe
    classDef batch fill:#f3e5f5
    classDef child fill:#fff3e0
    
    class BatchWF,AW1,AW2,AW3,AW4,AW5,AWN workflow
    class Batch1,Batch2,Batch3 batch
    class CW1,CW2,CW3,CW4,CW5,CWN child
```

### 3. Error Handling and Retry Flow

```mermaid
graph TD
    Start([Activity Execution]) --> Execute[Execute Activity]
    Execute --> Success{Success?}
    
    Success -->|Yes| Complete[Activity Complete]
    Success -->|No| CheckRetry{Retries Left?}
    
    CheckRetry -->|Yes| Backoff[Exponential Backoff]
    CheckRetry -->|No| Failed[Mark Activity Failed]
    
    Backoff --> Wait[Wait Interval]
    Wait --> Retry[Retry Activity]
    Retry --> Execute
    
    Failed --> WorkflowError[Workflow Error Handling]
    WorkflowError --> PartialSuccess{Other Activities OK?}
    
    PartialSuccess -->|Yes| PartialComplete[Mark Partial Success]
    PartialSuccess -->|No| WorkflowFailed[Mark Workflow Failed]
    
    Complete --> NextActivity[Continue Workflow]
    PartialComplete --> StatusUpdate[Update Job Status]
    WorkflowFailed --> StatusUpdate
    
    StatusUpdate --> End([Return Results])
    NextActivity --> End
    
    classDef success fill:#e8f5e8
    classDef error fill:#ffebee
    classDef retry fill:#fff3e0
    classDef decision fill:#e3f2fd
    
    class Complete,NextActivity success
    class Failed,WorkflowFailed error
    class Backoff,Wait,Retry retry
    class Success,CheckRetry,PartialSuccess decision
```

### 4. Component Interaction Diagram

```mermaid
graph TB
    subgraph "Temporal Infrastructure"
        TW[Temporal Worker]
        TS[Temporal Server]
        TUI[Temporal UI]
    end
    
    subgraph "NDM ADS Components"
        AW[AdsWorkflow]
        BAW[BatchAdsWorkflow]
        AAS[AdsActivityService]
    end
    
    subgraph "NDM Core Services"
        WOS[WinOperationService]
        WSS[WinShellService]
        JMS[Job Management Service]
        Redis[Redis Cache]
    end
    
    subgraph "PowerShell Layer"
        PS[PowerShell Scripts]
        DFA[Discover-FileADS]
        Transfer[Transfer Functions]
    end
    
    subgraph "File System"
        SF[Source Files]
        DF[Destination Files]
        ADS[ADS Streams]
    end
    
    TS --> TW
    TW --> AW
    TW --> BAW
    TW --> AAS
    
    AW --> AAS
    BAW --> AW
    
    AAS --> WOS
    WOS --> WSS
    WSS --> PS
    
    PS --> DFA
    PS --> Transfer
    
    DFA --> SF
    Transfer --> SF
    Transfer --> DF
    
    SF --> ADS
    DF --> ADS
    
    AW --> JMS
    AAS --> Redis
    
    TW --> TUI
    
    classDef temporal fill:#e1f5fe
    classDef ads fill:#f3e5f5
    classDef ndm fill:#e8f5e8
    classDef ps fill:#fff3e0
    classDef fs fill:#fce4ec
    
    class TW,TS,TUI temporal
    class AW,BAW,AAS ads
    class WOS,WSS,JMS,Redis ndm
    class PS,DFA,Transfer ps
    class SF,DF,ADS fs
```

## Configuration

### Temporal Configuration Architecture

```mermaid
graph TB
    subgraph "Workflow Configuration"
        WC[Workflow Config]
        WTO[Workflow Timeout<br/>1 hour max]
        WTT[Task Timeout<br/>10 seconds]
        WID[Workflow ID<br/>ads-{traceId}-{index}]
        
        WC --> WTO
        WC --> WTT
        WC --> WID
    end
    
    subgraph "Activity Configuration"
        AC[Activity Config]
        STCT[Start-to-Close<br/>10 minutes]
        HT[Heartbeat<br/>1 minute]
        RC[Retry Config]
        
        AC --> STCT
        AC --> HT
        AC --> RC
    end
    
    subgraph "Retry Configuration"
        RC --> MA[Max Attempts: 3]
        RC --> II[Initial Interval: 10s]
        RC --> BC[Backoff Coefficient: 2.0]
        RC --> MI[Max Interval: 5m]
        RC --> NRET[Non-Retryable:<br/>ApplicationFailure]
    end
    
    subgraph "Batch Configuration"
        BatchC[Batch Config]
        BatchC --> Conc[Max Concurrency: 5]
        BatchC --> Size[Batch Size: 10 files]
        BatchC --> Val[Validate Transfer: true]
        BatchC --> Pri[Priority Processing]
    end
    
    classDef config fill:#e8f5e8
    classDef timeout fill:#fff3e0
    classDef retry fill:#ffebee
    classDef batch fill:#e1f5fe
    
    class WC,AC,RC,BatchC config
    class WTO,WTT,STCT,HT timeout
    class MA,II,BC,MI,NRET retry
    class Conc,Size,Val,Pri batch
```

### Configuration Flow

```mermaid
sequenceDiagram
    participant App as Application
    participant TW as Temporal Worker
    participant Config as Configuration
    participant WF as Workflow
    participant Act as Activity
    
    App->>Config: Load Configuration
    Config->>TW: Register Activities
    Config->>TW: Set Timeouts & Retries
    
    Note over TW: Worker Ready
    
    App->>TW: Start Workflow
    TW->>WF: Create Workflow Instance
    
    WF->>Act: Execute Activity (with config)
    Note over Act: Uses configured timeouts<br/>and retry policies
    
    Act-->>WF: Activity Result
    WF-->>TW: Workflow Result
    TW-->>App: Final Result
```

### Temporal Activity Configuration

```typescript
const adsActivities = wf.proxyActivities<AdsActivityService>({
  startToCloseTimeout: '10m',      // Max 10 minutes per activity
  heartbeatTimeout: '1m',          // Heartbeat every minute
  retry: {
    maximumAttempts: 3,            // Retry failed activities up to 3 times
    initialInterval: '10s',        // Wait 10s before first retry
    backoffCoefficient: 2.0,       // Double wait time each retry
    maximumInterval: '5m',         // Max 5 minute wait between retries
    nonRetryableErrorTypes: ['ApplicationFailure']  // Don't retry app errors
  }
});
```

### Workflow Configuration

```typescript
// Child workflow options for batch processing
const filePromise = wf.executeChild(AdsWorkflow, {
  args: [{ traceId, filePath, destinationPath, options }],
  workflowId: `ads-${traceId}-${fileIndex}`,
  workflowExecutionTimeout: '1h',  // Max 1 hour per file
  workflowTaskTimeout: '10s',      // Task processing timeout
});
```

## Testing and Monitoring

### Testing Architecture

```mermaid
graph TB
    subgraph "Test Environment"
        TF[Test Files with ADS]
        TS[Test Scripts]
        TM[Test Monitoring]
    end
    
    subgraph "Test Types"
        UT[Unit Tests<br/>Individual Activities]
        IT[Integration Tests<br/>End-to-End Workflows] 
        PT[Performance Tests<br/>Load & Stress]
        ET[Error Tests<br/>Failure Scenarios]
    end
    
    subgraph "Test Execution"
        PS[PowerShell Tests]
        TS_Test[TypeScript Tests]
        Bash[Bash Tests]
        Manual[Manual Tests]
    end
    
    subgraph "Validation"
        TUI[Temporal UI Monitoring]
        Logs[Log Analysis]
        Metrics[Performance Metrics]
        Reports[Test Reports]
    end
    
    TF --> UT
    TF --> IT
    TF --> PT
    TF --> ET
    
    UT --> PS
    IT --> TS_Test
    PT --> Bash
    ET --> Manual
    
    PS --> TUI
    TS_Test --> Logs
    Bash --> Metrics
    Manual --> Reports
    
    classDef test fill:#e8f5e8
    classDef execution fill:#fff3e0
    classDef validation fill:#e1f5fe
    
    class UT,IT,PT,ET test
    class PS,TS_Test,Bash,Manual execution
    class TUI,Logs,Metrics,Reports validation
```

### Monitoring and Observability

```mermaid
graph TB
    subgraph "Temporal UI Dashboard"
        WD[Workflow Dashboard]
        AD[Activity Dashboard]
        SD[Schedule Dashboard]
        
        WD --> WS[Workflow Status]
        WD --> WH[Workflow History]
        WD --> WM[Workflow Metrics]
        
        AD --> AS[Activity Status]
        AD --> AR[Activity Retries]
        AD --> AT[Activity Timing]
        
        SD --> SS[Schedule Status]
        SD --> SP[Schedule Performance]
    end
    
    subgraph "NDM Logging"
        AL[Activity Logs]
        WL[Workflow Logs]
        EL[Error Logs]
        PL[Performance Logs]
        
        AL --> LL[Log Level: INFO/DEBUG]
        WL --> TS[Timestamp Tracking]
        EL --> ST[Stack Traces]
        PL --> Met[Execution Metrics]
    end
    
    subgraph "Metrics Collection"
        PM[Performance Metrics]
        EM[Error Metrics]
        UM[Usage Metrics]
        
        PM --> ET[Execution Time]
        PM --> TP[Throughput]
        
        EM --> FR[Failure Rate]
        EM --> RR[Retry Rate]
        
        UM --> FC[File Count]
        UM --> SC[Stream Count]
    end
    
    subgraph "Alerting"
        Alert[Alert System]
        Alert --> HF[High Failure Rate]
        Alert --> LT[Long Execution Time]
        Alert --> SE[System Errors]
    end
    
    WS --> Alert
    AR --> Alert
    EL --> Alert
    
    classDef ui fill:#e1f5fe
    classDef logging fill:#e8f5e8
    classDef metrics fill:#fff3e0
    classDef alerts fill:#ffebee
    
    class WD,AD,SD,WS,WH,WM,AS,AR,AT,SS,SP ui
    class AL,WL,EL,PL,LL,TS,ST,Met logging
    class PM,EM,UM,ET,TP,FR,RR,FC,SC metrics
    class Alert,HF,LT,SE alerts
```

### Test Scripts

1. **PowerShell Test** (`test-ads-workflows.ps1`)
   ```powershell
   # Create test files with ADS
   # Trigger temporal workflows
   # Monitor execution via Temporal UI
   ```

2. **TypeScript Test** (`test-ads-integration.ts`)
   ```typescript
   // Integration tests for activities
   // Workflow execution tests
   // Error scenario testing
   ```

3. **Bash Test** (`test-ads-performance.sh`)
   ```bash
   # Performance and load testing
   # Concurrent workflow execution
   # Resource utilization monitoring
   ```

### Monitoring via Temporal UI

```mermaid
graph LR
    subgraph "Temporal UI Views"
        WF[Workflows View]
        WF --> Running[Running Workflows]
        WF --> Completed[Completed Workflows]
        WF --> Failed[Failed Workflows]
        
        ACT[Activities View]
        ACT --> Pending[Pending Activities]
        ACT --> Active[Active Activities]
        ACT --> Retrying[Retrying Activities]
        
        SCHED[Schedules View]
        SCHED --> Upcoming[Upcoming Schedules]
        SCHED --> Paused[Paused Schedules]
    end
    
    subgraph "Detailed Views"
        WDetails[Workflow Details]
        WDetails --> History[Execution History]
        WDetails --> Timeline[Event Timeline]
        WDetails --> Input[Input/Output Data]
        
        ADetails[Activity Details]
        ADetails --> Attempts[Retry Attempts]
        ADetails --> Errors[Error Messages]
        ADetails --> Duration[Execution Duration]
    end
    
    Running --> WDetails
    Failed --> WDetails
    Active --> ADetails
    Retrying --> ADetails
    
    classDef view fill:#e1f5fe
    classDef details fill:#e8f5e8
    
    class WF,ACT,SCHED,Running,Completed,Failed,Pending,Active,Retrying,Upcoming,Paused view
    class WDetails,ADetails,History,Timeline,Input,Attempts,Errors,Duration details
```

- **Workflow Execution**: Monitor `AdsWorkflow` and `BatchAdsWorkflow` execution
- **Activity Details**: View individual activity results and retry attempts  
- **Error Tracking**: Detailed error logs and stack traces
- **Performance Metrics**: Execution time, retry rates, success/failure ratios

### Logging Integration

```typescript
// Activity logging
this.logger.log(`Discovering ADS streams for: ${input.filePath}`);
this.logger.error(`Failed to transfer ADS stream ${streamName}:`, error);

// Workflow logging (via temporal)
wf.log.info(`Started ADS processing for ${filePath}`);
wf.log.error(`Workflow failed: ${error.message}`);
```

## Performance Characteristics

### Performance Architecture

```mermaid
graph TB
    subgraph "Scalability Factors"
        HS[Horizontal Scaling]
        WP[Worker Parallelism]
        BP[Batch Processing]
        CC[Concurrency Control]
        
        HS --> MW[Multiple Workers]
        WP --> PT[Parallel Tasks]
        BP --> BM[Batch Management]
        CC --> RL[Resource Limiting]
    end
    
    subgraph "Performance Metrics"
        TH[Throughput]
        LAT[Latency]
        RES[Resource Usage]
        
        TH --> FPS[Files/Second]
        TH --> SPS[Streams/Second]
        
        LAT --> RT[Response Time]
        LAT --> QT[Queue Time]
        
        RES --> CPU[CPU Usage]
        RES --> MEM[Memory Usage]
        RES --> IO[I/O Usage]
    end
    
    subgraph "Optimization Strategies"
        OPT[Optimization]
        OPT --> CACHE[Caching]
        OPT --> POOL[Connection Pooling]
        OPT --> BATCH[Batching]
        OPT --> ASYNC[Async Processing]
    end
    
    MW --> FPS
    PT --> SPS
    BM --> RT
    RL --> CPU
    
    classDef scale fill:#e8f5e8
    classDef metrics fill:#fff3e0
    classDef optimize fill:#e1f5fe
    
    class HS,WP,BP,CC,MW,PT,BM,RL scale
    class TH,LAT,RES,FPS,SPS,RT,QT,CPU,MEM,IO metrics
    class OPT,CACHE,POOL,BATCH,ASYNC optimize
```

### Scalability Model

```mermaid
graph LR
    subgraph "Single Worker"
        W1[Worker 1]
        W1 --> T1[Task Queue]
        T1 --> A1[Activities 1-5]
    end
    
    subgraph "Multi Worker"
        W2[Worker 2]
        W3[Worker 3]
        W4[Worker 4]
        
        W2 --> T2[Task Queue]
        W3 --> T3[Task Queue]  
        W4 --> T4[Task Queue]
        
        T2 --> A2[Activities 6-10]
        T3 --> A3[Activities 11-15]
        T4 --> A4[Activities 16-20]
    end
    
    subgraph "Load Balancer"
        LB[Temporal Load Balancer]
        LB --> W1
        LB --> W2
        LB --> W3
        LB --> W4
    end
    
    subgraph "Resource Management"
        RM[Resource Manager]
        RM --> CPU_Pool[CPU Pool]
        RM --> MEM_Pool[Memory Pool]
        RM --> IO_Pool[I/O Pool]
    end
    
    A1 --> CPU_Pool
    A2 --> MEM_Pool
    A3 --> IO_Pool
    A4 --> CPU_Pool
    
    classDef worker fill:#e8f5e8
    classDef queue fill:#fff3e0
    classDef activity fill:#e1f5fe
    classDef resource fill:#ffebee
    
    class W1,W2,W3,W4 worker
    class T1,T2,T3,T4,LB queue
    class A1,A2,A3,A4 activity
    class RM,CPU_Pool,MEM_Pool,IO_Pool resource
```

### Reliability Architecture

```mermaid
graph TB
    subgraph "Failure Resilience"
        FR[Failure Resilience]
        FR --> RL[Retry Logic]
        FR --> SP[State Persistence]
        FR --> FT[Fault Tolerance]
        
        RL --> AR[Automatic Retry]
        RL --> EB[Exponential Backoff]
        
        SP --> WS[Workflow State]
        SP --> AS[Activity State]
        
        FT --> PS[Partial Success]
        FT --> GF[Graceful Failure]
    end
    
    subgraph "Monitoring & Recovery"
        MR[Monitoring & Recovery]
        MR --> HM[Health Monitoring]
        MR --> AD[Anomaly Detection]
        MR --> AR_Recovery[Auto Recovery]
        
        HM --> HC[Health Checks]
        HM --> HA[Heartbeat Alerts]
        
        AD --> PT[Performance Tracking]
        AD --> ET[Error Tracking]
        
        AR_Recovery --> RS[Restart Service]
        AR_Recovery --> RW[Retry Workflows]
    end
    
    subgraph "Data Integrity"
        DI[Data Integrity]
        DI --> CS[Checksum Validation]
        DI --> BK[Backup & Recovery]
        DI --> TX[Transactional]
        
        CS --> MD5[MD5 Hashing]
        CS --> SHA[SHA Validation]
        
        BK --> Snapshot[State Snapshots]
        BK --> Recovery[Recovery Points]
        
        TX --> AC[ACID Compliance]
        TX --> RB[Rollback Support]
    end
    
    classDef resilience fill:#e8f5e8
    classDef monitoring fill:#fff3e0
    classDef integrity fill:#e1f5fe
    
    class FR,RL,SP,FT,AR,EB,WS,AS,PS,GF resilience
    class MR,HM,AD,AR_Recovery,HC,HA,PT,ET,RS,RW monitoring
    class DI,CS,BK,TX,MD5,SHA,Snapshot,Recovery,AC,RB integrity
```

### Scalability
- **Horizontal Scaling**: Multiple temporal workers can process ADS tasks in parallel
- **Batch Processing**: Configurable concurrency for multi-file operations
- **Resource Management**: Temporal handles task distribution and load balancing

### Reliability
- **Retry Logic**: Automatic retry on transient failures
- **State Persistence**: Temporal maintains workflow state across failures
- **Partial Success**: Individual file failures don't affect batch processing
- **Monitoring**: Full visibility into execution via Temporal UI

### Integration Benefits
- **Existing Infrastructure**: Leverages NDM's PowerShell, logging, and job management
- **Consistent Patterns**: Follows established NDM temporal workflow patterns
- **Minimal Overhead**: Simple discovery-only approach with temporal handling complexity

## Future Enhancements

### Enhancement Roadmap

```mermaid
timeline
    title ADS Implementation Enhancement Roadmap
    
    section Phase 1 : Current Implementation
        Basic ADS Processing    : Temporal workflows
                               : PowerShell integration
                               : Error handling
                               : Basic monitoring
        
    section Phase 2 : Validation & Security
        Checksum Validation     : MD5/SHA256 hashing
                               : Content integrity checks
                               : Transfer verification
        Enhanced Security       : Encrypted transfers
                               : Access control validation
                               : Audit logging
                               
    section Phase 3 : Performance & Scale
        Compression Support     : Binary stream compression
                               : Compression algorithms
                               : Size optimization
        Parallel Processing     : Stream-level parallelism
                               : Multi-threaded transfers
                               : Load balancing
                               
    section Phase 4 : Advanced Features
        Incremental Transfer    : Resumable transfers
                               : Delta synchronization
                               : Bandwidth optimization
        Content Analysis        : Intelligent filtering
                               : Type detection
                               : Priority processing
                               
    section Phase 5 : Enterprise Features
        Advanced Monitoring     : Real-time dashboards
                               : Predictive analytics
                               : Automated optimization
        Cloud Integration       : Multi-cloud support
                               : Hybrid deployments
                               : Global distribution
```

### Enhancement Architecture

```mermaid
graph TB
    subgraph "Current Implementation"
        CI[Current ADS System]
        CI --> BW[Basic Workflows]
        CI --> PA[PowerShell Activities]
        CI --> SM[Simple Monitoring]
    end
    
    subgraph "Phase 2: Validation & Security"
        P2[Phase 2 Enhancements]
        P2 --> CV[Checksum Validation]
        P2 --> ES[Enhanced Security]
        P2 --> AL[Audit Logging]
        
        CV --> MD5[MD5 Hashing]
        CV --> SHA[SHA256 Validation]
        
        ES --> ENC[Encryption]
        ES --> ACL[Access Control]
        
        AL --> AT[Audit Trails]
        AL --> CR[Compliance Reports]
    end
    
    subgraph "Phase 3: Performance & Scale"
        P3[Phase 3 Enhancements]
        P3 --> COMP[Compression]
        P3 --> PAR[Parallel Processing]
        P3 --> OPT[Optimization]
        
        COMP --> GZIP[GZIP Compression]
        COMP --> LZ4[LZ4 Algorithm]
        
        PAR --> MT[Multi-Threading]
        PAR --> LB[Load Balancing]
        
        OPT --> CACHE[Intelligent Caching]
        OPT --> PRED[Predictive Scaling]
    end
    
    subgraph "Phase 4: Advanced Features"
        P4[Phase 4 Enhancements]
        P4 --> IT[Incremental Transfer]
        P4 --> CA[Content Analysis]
        P4 --> AI[AI/ML Integration]
        
        IT --> RT[Resumable Transfer]
        IT --> DELTA[Delta Sync]
        
        CA --> TD[Type Detection]
        CA --> IF[Intelligent Filtering]
        
        AI --> PA_AI[Pattern Analysis]
        AI --> AO[Auto Optimization]
    end
    
    subgraph "Phase 5: Enterprise"
        P5[Phase 5 Enhancements]
        P5 --> AM[Advanced Monitoring]
        P5 --> CI_Cloud[Cloud Integration]
        P5 --> GS[Global Scale]
        
        AM --> RTD[Real-time Dashboards]
        AM --> PRED_A[Predictive Analytics]
        
        CI_Cloud --> MC[Multi-Cloud]
        CI_Cloud --> HYB[Hybrid Deployment]
        
        GS --> GEO[Geo-distribution]
        GS --> CDN[CDN Integration]
    end
    
    CI --> P2
    P2 --> P3
    P3 --> P4
    P4 --> P5
    
    classDef current fill:#e8f5e8
    classDef phase2 fill:#fff3e0
    classDef phase3 fill:#e1f5fe
    classDef phase4 fill:#f3e5f5
    classDef phase5 fill:#ffebee
    
    class CI,BW,PA,SM current
    class P2,CV,ES,AL,MD5,SHA,ENC,ACL,AT,CR phase2
    class P3,COMP,PAR,OPT,GZIP,LZ4,MT,LB,CACHE,PRED phase3
    class P4,IT,CA,AI,RT,DELTA,TD,IF,PA_AI,AO phase4
    class P5,AM,CI_Cloud,GS,RTD,PRED_A,MC,HYB,GEO,CDN phase5
```

### Detailed Enhancement Features

```mermaid
mindmap
  root((ADS Enhancements))
    
    Validation & Security
      Checksum Validation
        MD5 Hashing
        SHA256 Verification
        CRC32 Checks
        Content Integrity
      Security Features
        Stream Encryption
        Access Control
        Permission Validation
        Secure Transfer
      Compliance
        Audit Logging
        Compliance Reports
        Data Governance
        Privacy Controls
    
    Performance & Scale
      Compression
        GZIP Compression
        LZ4 Algorithm
        Adaptive Compression
        Size Optimization
      Parallel Processing
        Multi-Threading
        Stream Parallelism
        Worker Scaling
        Load Distribution
      Optimization
        Intelligent Caching
        Bandwidth Management
        Resource Pooling
        Performance Tuning
    
    Advanced Features
      Incremental Transfer
        Resumable Transfers
        Delta Synchronization
        Change Detection
        Bandwidth Optimization
      Content Analysis
        Type Detection
        Content Classification
        Priority Assignment
        Intelligent Filtering
      AI/ML Integration
        Pattern Recognition
        Predictive Analytics
        Auto-Optimization
        Anomaly Detection
    
    Enterprise Features
      Monitoring
        Real-time Dashboards
        Performance Metrics
        Health Monitoring
        Alert Systems
      Cloud Integration
        Multi-Cloud Support
        Hybrid Deployments
        Cloud Storage
        Global Distribution
      Management
        Centralized Control
        Policy Management
        Resource Governance
        Cost Optimization
```

### Implementation Priorities

1. **Phase 2 - Validation & Security** (Next 3 months)
   - **Checksum Validation**: Add MD5/SHA256 validation for transferred streams
   - **Enhanced Security**: Implement encrypted transfers and access validation
   - **Audit Logging**: Comprehensive audit trails for compliance

2. **Phase 3 - Performance & Scale** (Months 4-6)
   - **Compression**: Implement compression for large binary streams
   - **Parallel Processing**: Stream-level parallelism for faster transfers
   - **Performance Optimization**: Advanced caching and optimization

3. **Phase 4 - Advanced Features** (Months 7-12)
   - **Incremental Transfer**: Support resumable transfers for large streams
   - **Content Analysis**: More sophisticated stream filtering based on content analysis
   - **AI/ML Integration**: Intelligent optimization and anomaly detection

4. **Phase 5 - Enterprise Features** (Year 2+)
   - **Advanced Monitoring**: Real-time dashboards and predictive analytics
   - **Cloud Integration**: Multi-cloud support and global distribution
   - **Enterprise Management**: Centralized control and governance

## Conclusion

This implementation provides a robust, scalable foundation for ADS processing that integrates seamlessly with NDM's existing architecture while providing the reliability and monitoring capabilities of temporal workflows. The detailed Mermaid diagrams illustrate the comprehensive architecture, data flows, and future enhancement roadmap, making it easy to understand the system's design and evolution path.