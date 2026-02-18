package workflows

import (
	"encoding/json"
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// PreCheckValidationWorkflow is the parent workflow for pre-check validation.
// It distributes pre-check tasks to worker child workflows and aggregates
// results.
//
// The function name matches the TypeScript "PreCheckValidationWorkflow".
//
// This mirrors the TS version which:
//  1. Builds serverCredentials map and workerTasks map from payload
//  2. Performs pre-validation (NO_COMMON_WORKERS, ALL_COMMON_WORKERS_UNHEALTHY, PROTOCOL_VERSION_MISMATCH)
//  3. Dispatches PreCheckWorkerValidationWorkflow for each healthy worker
//  4. Aggregates results and maps failures back to source/destination paths
//  5. Adds INSUFFICIENT_DESTINATION_SPACE warnings
func PreCheckValidationWorkflow(ctx workflow.Context, input PreCheckInput) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting PreCheckValidationWorkflow", "traceId", input.TraceID)

	payload, ok := input.Payload.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid payload type for PreCheckValidationWorkflow")
	}

	preChecks, _ := payload["preChecks"].([]interface{})
	serverCredsRaw, _ := payload["serverCredentials"].([]interface{})
	settings := payload["settings"]

	// Build serverCredentials map indexed by server ID.
	serverCredentials := make(map[string]map[string]interface{})
	for _, scRaw := range serverCredsRaw {
		sc, ok := scRaw.(map[string]interface{})
		if !ok {
			continue
		}
		id, _ := sc["id"].(string)
		if id != "" {
			serverCredentials[id] = sc
		}
	}

	// Build the response structure and worker task assignments.
	// This mirrors the TS pre-validation logic exactly.
	var response []PreCheckWorkflowResponse
	workerTasks := make(map[string][]map[string]interface{})
	workerSet := make(map[string]bool) // healthy workers

	for _, pcRaw := range preChecks {
		pc, ok := pcRaw.(map[string]interface{})
		if !ok {
			continue
		}

		pathID, _ := pc["pathId"].(string)
		serverID, _ := pc["serverId"].(string)
		pathName, _ := pc["pathName"].(string)

		serverResponse := PreCheckWorkflowResponse{
			SourcePathID: pathID,
			Status:       "success",
			Destination:  []PreCheckDestinationStatus{},
			Errors:       []string{},
		}

		// Build the source task path entry.
		workerSourceTaskPath := map[string]interface{}{
			"pathId":   pathID,
			"serverId": serverID,
			"pathName": pathName,
			"isSource": true,
		}
		if ds, exists := pc["discoveredSize"]; exists {
			workerSourceTaskPath["discoveredSize"] = ds
		}

		// Get the source server's protocol version.
		sourceVersion := ""
		if sourceCred, ok := serverCredentials[serverID]; ok {
			sourceVersion, _ = sourceCred["protocolVersion"].(string)
		}

		destinations, _ := pc["destinations"].([]interface{})
		for _, dRaw := range destinations {
			d, ok := dRaw.(map[string]interface{})
			if !ok {
				continue
			}

			dPathID, _ := d["pathId"].(string)
			dServerID, _ := d["serverId"].(string)
			dPathName, _ := d["pathName"].(string)

			// Parse worker records for this destination.
			workersRaw, _ := d["workers"].([]interface{})
			var commonWorkers []WorkerRecord
			for _, wRaw := range workersRaw {
				w, ok := wRaw.(map[string]interface{})
				if !ok {
					continue
				}
				wID, _ := w["workerId"].(string)
				isHealthy, _ := w["ishealthy"].(bool)
				commonWorkers = append(commonWorkers, WorkerRecord{
					WorkerID:  wID,
					IsHealthy: isHealthy,
				})
			}

			destStatus := PreCheckDestinationStatus{
				DestinationPathID: dPathID,
				Status:            "success",
				Errors:            []string{},
				CommonWorkers:     commonWorkers,
				Warnings:          []string{},
			}

			// Pre-validation: NO_COMMON_WORKERS
			if len(commonWorkers) == 0 {
				destStatus.Status = "failed"
				destStatus.Errors = append(destStatus.Errors, "NO_COMMON_WORKERS")
			}

			// Pre-validation: ALL_COMMON_WORKERS_UNHEALTHY
			if len(commonWorkers) > 0 {
				allUnhealthy := true
				for _, w := range commonWorkers {
					if w.IsHealthy {
						allUnhealthy = false
						break
					}
				}
				if allUnhealthy {
					destStatus.Status = "failed"
					destStatus.Errors = append(destStatus.Errors, "ALL_COMMON_WORKERS_UNHEALTHY")
				}
			}

			// Pre-validation: PROTOCOL_VERSION_MISMATCH
			destVersion := ""
			if destCred, ok := serverCredentials[dServerID]; ok {
				destVersion, _ = destCred["protocolVersion"].(string)
			}
			if sourceVersion != destVersion {
				destStatus.Status = "failed"
				destStatus.Errors = append(destStatus.Errors, "PROTOCOL_VERSION_MISMATCH")
			}

			// Build the destination task path entry.
			workerDestTaskPath := map[string]interface{}{
				"pathId":   dPathID,
				"serverId": dServerID,
				"pathName": dPathName,
				"isSource": false,
			}

			// Assign paths to each healthy worker.
			for _, w := range commonWorkers {
				if w.WorkerID == "" || !w.IsHealthy {
					continue
				}
				workerSet[w.WorkerID] = true
				if _, exists := workerTasks[w.WorkerID]; !exists {
					// First time seeing this worker — add source path too.
					workerTasks[w.WorkerID] = []map[string]interface{}{workerSourceTaskPath, workerDestTaskPath}
				} else {
					workerTasks[w.WorkerID] = append(workerTasks[w.WorkerID], workerDestTaskPath)
				}
			}

			serverResponse.Destination = append(serverResponse.Destination, destStatus)
		}
		response = append(response, serverResponse)
	}

	// Collect unique healthy worker IDs.
	workerIDs := make([]string, 0, len(workerSet))
	for wID := range workerSet {
		workerIDs = append(workerIDs, wID)
	}

	if len(workerIDs) == 0 {
		logger.Warn("PreCheckValidationWorkflow: no healthy workers found")
		return response, nil
	}

	// Dispatch PreCheckWorkerValidationWorkflow for each worker.
	// The TS version passes per-worker filtered serverCredentials (only the
	// credentials needed by that worker's paths) and the assigned paths.
	futures := make([]workflow.Future, len(workerIDs))
	for i, workerID := range workerIDs {
		paths := workerTasks[workerID]

		// Build the set of server credentials needed for this worker's paths.
		credSet := make(map[string]map[string]interface{})
		for _, p := range paths {
			sid, _ := p["serverId"].(string)
			if sid != "" {
				if cred, ok := serverCredentials[sid]; ok {
					credSet[sid] = cred
				}
			}
		}
		creds := make([]interface{}, 0, len(credSet))
		for _, c := range credSet {
			creds = append(creds, c)
		}

		childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:        fmt.Sprintf("PreCheckValidationWorkflow-%s-%s", input.TraceID, workerID),
			TaskQueue:         fmt.Sprintf("%s-TaskQueue", workerID),
			ParentClosePolicy: 1, // TERMINATE
		})
		futures[i] = workflow.ExecuteChildWorkflow(childCtx, "PreCheckWorkerValidationWorkflow",
			workerID,
			map[string]interface{}{
				"serverCredentials": creds,
				"serverPaths":       paths,
				"settings":          settings,
			},
			input.TraceID,
		)
	}

	// Collect results from all workers and parse into typed results.
	var allPaths []PreCheckPathResult
	for _, f := range futures {
		var rawResult interface{}
		if err := f.Get(ctx, &rawResult); err != nil {
			logger.Error(fmt.Sprintf("PreCheckWorkerValidationWorkflow failed: %v", err))
			continue
		}

		// Parse the raw result into PreCheckWorkerResult.
		workerResult, err := parseWorkerResult(rawResult)
		if err != nil {
			logger.Error(fmt.Sprintf("Failed to parse worker result: %v", err))
			continue
		}
		allPaths = append(allPaths, workerResult.Paths...)
	}

	// Post-processing: aggregate worker results into the response.
	// This mirrors the TS post-processing logic.
	for i := range response {
		current := &response[i]

		// Check if source path failed.
		sourceFailed := findPathResult(allPaths, current.SourcePathID, "failed")
		if sourceFailed != nil {
			current.Status = "failed"
			current.Errors = append(current.Errors, sourceFailed.ErrorCodes...)
		}

		// Find source result (for space comparison).
		sourceRes := findPathResult(allPaths, current.SourcePathID, "")

		for j := range current.Destination {
			dest := &current.Destination[j]

			// Check if destination path failed.
			destFailed := findPathResult(allPaths, dest.DestinationPathID, "failed")
			if destFailed != nil {
				dest.Status = "failed"
				dest.Errors = append(dest.Errors, destFailed.ErrorCodes...)
			}

			// Check INSUFFICIENT_DESTINATION_SPACE (warning, not error).
			destRes := findPathResult(allPaths, dest.DestinationPathID, "")
			if destRes != nil && sourceRes != nil &&
				destRes.DestinationAvailableSpace != nil && sourceRes.SourceDataSize != nil &&
				*destRes.DestinationAvailableSpace < *sourceRes.SourceDataSize {
				// Keep existing status — this is a warning, not an error.
				if dest.Status != "failed" {
					dest.Status = "success"
				}
				dest.Warnings = append(dest.Warnings, "INSUFFICIENT_DESTINATION_SPACE")
			}
		}
	}

	return response, nil
}

// PreCheckWorkerValidationWorkflow is the per-worker pre-check workflow.
// Registered with Temporal as "PreCheckWorkerValidationWorkflow".
//
// This matches the TypeScript PreCheckWorkerValidationWorkflow which:
//  1. Separates source paths from destination paths
//  2. For each source path, finds matching server credential by serverId
//  3. Calls preCheckActivity(settings, serverCredential, sourcePath, traceId)
//  4. Repeats for destination paths
//  5. Returns {workerId, paths: [...sourceResponse, ...destinationResponse]}
func PreCheckWorkerValidationWorkflow(ctx workflow.Context, workerID string, workerTaskPayload map[string]interface{}, traceID string) (interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting PreCheckWorkerValidationWorkflow", "traceId", traceID, "workerId", workerID)

	// TS: proxyActivities({ startToCloseTimeout: '3000s' })
	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 3000 * time.Second,
	})

	settings := workerTaskPayload["settings"]
	serverCredentials := workerTaskPayload["serverCredentials"]
	serverPathsRaw, _ := workerTaskPayload["serverPaths"].([]interface{})

	// Build the list of paths to check, separating source and destination.
	type pathEntry struct {
		PathID         string
		ServerID       string
		PathName       string
		IsSource       bool
		DiscoveredSize interface{}
	}

	var sourcePaths []pathEntry
	var destPaths []pathEntry

	for _, spRaw := range serverPathsRaw {
		sp, ok := spRaw.(map[string]interface{})
		if !ok {
			continue
		}

		pathID, _ := sp["pathId"].(string)
		serverID, _ := sp["serverId"].(string)
		pathName, _ := sp["pathName"].(string)
		isSource, _ := sp["isSource"].(bool)

		entry := pathEntry{
			PathID:         pathID,
			ServerID:       serverID,
			PathName:       pathName,
			IsSource:       isSource,
			DiscoveredSize: sp["discoveredSize"],
		}

		if isSource {
			sourcePaths = append(sourcePaths, entry)
		} else {
			destPaths = append(destPaths, entry)
		}
	}

	// Execute PreCheckPath for source paths first, then destination paths.
	// The TS version uses Promise.all() for each group. In Go Temporal
	// workflows we execute activities sequentially within each group.
	var allResults []interface{}

	// Source paths.
	for i, p := range sourcePaths {
		pathTraceID := fmt.Sprintf("%s-%d", traceID, i+1)
		result, err := executePreCheckActivity(actCtx, ctx, p.PathID, p.ServerID, p.PathName, p.IsSource, p.DiscoveredSize, settings, serverCredentials, pathTraceID)
		if err != nil {
			logger.Error(fmt.Sprintf("PreCheckPath failed for source path %s: %v", p.PathID, err))
			continue
		}
		allResults = append(allResults, result)
	}

	// Destination paths.
	for i, p := range destPaths {
		pathTraceID := fmt.Sprintf("%s-%d", traceID, i+1)
		result, err := executePreCheckActivity(actCtx, ctx, p.PathID, p.ServerID, p.PathName, p.IsSource, p.DiscoveredSize, settings, serverCredentials, pathTraceID)
		if err != nil {
			logger.Error(fmt.Sprintf("PreCheckPath failed for destination path %s: %v", p.PathID, err))
			continue
		}
		allResults = append(allResults, result)
	}

	return map[string]interface{}{
		"workerId": workerID,
		"paths":    allResults,
	}, nil
}

// executePreCheckActivity builds the activity input and executes PreCheckPath.
func executePreCheckActivity(actCtx, ctx workflow.Context, pathID, serverID, pathName string, isSource bool, discoveredSize interface{}, settings, serverCredentials interface{}, traceID string) (interface{}, error) {
	serverPathMap := map[string]interface{}{
		"pathId":   pathID,
		"serverId": serverID,
		"pathName": pathName,
		"isSource": isSource,
	}
	if discoveredSize != nil {
		serverPathMap["discoveredSize"] = discoveredSize
	}

	activityInput := map[string]interface{}{
		"settings":          settings,
		"serverCredentials": serverCredentials,
		"serverPaths":       serverPathMap,
		"traceId":           traceID,
	}

	var result interface{}
	err := workflow.ExecuteActivity(actCtx, "PreCheckPath", activityInput).Get(ctx, &result)
	return result, err
}

// parseWorkerResult converts a raw workflow result into a typed PreCheckWorkerResult.
func parseWorkerResult(raw interface{}) (PreCheckWorkerResult, error) {
	var result PreCheckWorkerResult

	// Marshal to JSON first, then unmarshal into the typed struct.
	jsonBytes, err := json.Marshal(raw)
	if err != nil {
		return result, fmt.Errorf("marshaling worker result: %w", err)
	}
	if err := json.Unmarshal(jsonBytes, &result); err != nil {
		return result, fmt.Errorf("unmarshaling worker result: %w", err)
	}
	return result, nil
}

// findPathResult searches for a path result by pathID. If statusFilter is
// non-empty, it only returns results matching that status. Returns nil if not
// found.
func findPathResult(paths []PreCheckPathResult, pathID, statusFilter string) *PreCheckPathResult {
	for i := range paths {
		if paths[i].PathID == pathID {
			if statusFilter == "" || paths[i].Status == statusFilter {
				return &paths[i]
			}
		}
	}
	return nil
}
