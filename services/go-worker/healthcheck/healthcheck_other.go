//go:build !linux

package healthcheck

import (
	"context"

	"github.com/netapp/ndm/services/go-worker/config"
	"github.com/netapp/ndm/services/go-worker/httpclient"
	"github.com/netapp/ndm/services/go-worker/logger"
)

// Start is a no-op on non-Linux platforms. The health check relies on
// /proc/stat and unix.Statfs which are Linux-specific.
func Start(_ context.Context, _ *config.Config, _ *httpclient.Client, log *logger.Logger) {
	log.Warn("healthcheck: not supported on this platform, skipping")
}
