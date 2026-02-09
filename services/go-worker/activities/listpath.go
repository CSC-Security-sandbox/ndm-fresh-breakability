package activities

import (
	"context"
	"fmt"

	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/protocols"
)

// ListPathResponse is the response returned by the ListPaths activity. It
// matches the TypeScript ListPathActivity.listPath() return shape exactly so
// that the config service and UI can parse the results.
type ListPathResponse struct {
	TraceID      string   `json:"traceId"`
	Status       string   `json:"status"`
	ProtocolType string   `json:"protocolType"`
	Hostname     string   `json:"hostname"`
	WorkerID     string   `json:"workerId"`
	Paths        []string `json:"paths"`
	Message      string   `json:"message"`
}

// ListPaths is the activity called from ListPathWorkerWorkflow to discover
// available export paths (NFS exports / SMB shares) for a single protocol.
// Its signature mirrors the TypeScript ListPathActivity.listPath() method:
//
//	listPath(traceId: string, protocolType: string, payload: any): Promise<any>
//
// The Temporal Go SDK maps positional workflow.ExecuteActivity args to function
// parameters, so the 3 args from the workflow map to (traceID, protocolType,
// payload) after the implicit context.Context.
//
// On success the response has status "success" with the discovered paths. On
// failure the response has status "error" with a descriptive message — errors
// are NOT returned via the error return value so that the parent workflow always
// gets a result object (matching the TypeScript behaviour where errors are caught
// and returned as a response).
func (a *Activities) ListPaths(
	ctx context.Context,
	traceID string,
	protocolType string,
	payload map[string]interface{},
) (*ListPathResponse, error) {
	hostname, _ := payload["hostname"].(string)

	a.Logger.Info("ListPaths activity started",
		zap.String("traceId", traceID),
		zap.String("protocolType", protocolType),
		zap.String("hostname", hostname),
		zap.String("workerId", a.Config.WorkerID),
	)

	response := &ListPathResponse{
		TraceID:      traceID,
		Status:       "success",
		ProtocolType: protocolType,
		Hostname:     hostname,
		WorkerID:     a.Config.WorkerID,
		Paths:        []string{},
		Message: fmt.Sprintf("[%s] Connection to %s from %s validated successfully",
			protocolType, hostname, a.Config.WorkerID),
	}

	// Check if exportPathSource is MANUAL_UPLOAD — if so, skip listing
	// (matching TS behaviour).
	exportPathSource, _ := payload["exportPathSource"].(string)
	if exportPathSource == "MANUAL_UPLOAD" {
		a.Logger.Info("ListPaths: skipping listing for MANUAL_UPLOAD",
			zap.String("traceId", traceID),
			zap.String("hostname", hostname),
		)
		return response, nil
	}

	// Build protocol payload from the raw map.
	username, _ := payload["username"].(string)
	password, _ := payload["password"].(string)

	protoPayload := protocols.ProtocolPayload{
		Hostname: hostname,
		Username: username,
		Password: password,
	}

	proto := protocols.NewProtocol(protocolType, a.Config, a.Logger)
	if proto == nil {
		response.Status = "error"
		response.Message = fmt.Sprintf("Failed to List Path for %s of type %s: unsupported protocol type",
			hostname, protocolType)
		a.Logger.Error("ListPaths: unsupported protocol",
			zap.String("traceId", traceID),
			zap.String("protocolType", protocolType),
		)
		return response, nil
	}

	// List available paths/exports.
	paths, err := proto.ListPaths(traceID, protoPayload)
	if err != nil {
		response.Status = "error"
		response.Message = fmt.Sprintf("Failed to List Path for %s of type %s: %v",
			hostname, protocolType, err)
		a.Logger.Error("ListPaths failed",
			zap.String("traceId", traceID),
			zap.String("hostname", hostname),
			zap.Error(err),
		)
		return response, nil
	}

	response.Paths = paths

	a.Logger.Info("ListPaths activity completed",
		zap.String("traceId", traceID),
		zap.String("hostname", hostname),
		zap.String("status", response.Status),
		zap.Int("pathCount", len(response.Paths)),
	)

	return response, nil
}
