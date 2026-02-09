package activities

import (
	"context"
	"fmt"
	"net/http"

	"go.uber.org/zap"
)

// mappingResponse represents the JSON response from the config service
// identity mapping endpoint.
type mappingResponse struct {
	Data struct {
		Items []identityMapping `json:"items"`
	} `json:"data"`
}

// identityMapping represents a single identity mapping entry.
type identityMapping struct {
	SourceID string `json:"sourceId"`
	TargetID string `json:"targetId"`
	IDType   string `json:"idType"`
}

// ResolveUsernamesToSids fetches identity mappings from the config service and
// stores them in Redis for use during metadata stamping.
func (a *Activities) ResolveUsernamesToSids(ctx context.Context, jobRunID string) error {
	a.Logger.Info("ResolveUsernamesToSids started", zap.String("jobRunId", jobRunID))

	jobContext, err := a.getJobManagerContext(ctx, jobRunID)
	if err != nil {
		return fmt.Errorf("getting job manager context: %w", err)
	}

	cfg := jobContext.JobConfig
	if cfg == nil {
		return fmt.Errorf("job config not found for %s", jobRunID)
	}

	// Only resolve if identity mapping is available.
	if cfg.Options == nil || !cfg.Options.IsIdentityMappingAvailable {
		a.Logger.Info("identity mapping not enabled, skipping",
			zap.String("jobRunId", jobRunID),
		)
		return nil
	}

	// Fetch mappings from config service.
	url := fmt.Sprintf("%s/api/v1/identity-mapping/%s", a.Config.ConfigServiceURL, cfg.JobID)

	resp, err := a.HTTP.Get(url, nil)
	if err != nil {
		return fmt.Errorf("fetching identity mappings: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("identity mapping endpoint returned %d: %s", resp.StatusCode, string(resp.Body))
	}

	var mappings mappingResponse
	if err := parseJSON(resp.Body, &mappings); err != nil {
		return fmt.Errorf("parsing identity mappings: %w", err)
	}

	// Store each mapping in Redis.
	for _, m := range mappings.Data.Items {
		if m.SourceID == "" || m.TargetID == "" {
			continue
		}

		if err := a.Redis.SetOwnerIdentity(jobRunID, m.SourceID, m.IDType, m.TargetID); err != nil {
			a.Logger.Error("failed to store identity mapping",
				zap.String("sourceId", m.SourceID),
				zap.String("targetId", m.TargetID),
				zap.String("idType", m.IDType),
				zap.Error(err),
			)
		}
	}

	a.Logger.Info("ResolveUsernamesToSids completed",
		zap.String("jobRunId", jobRunID),
		zap.Int("mappingCount", len(mappings.Data.Items)),
	)

	return nil
}
