package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/activities"
	"github.com/netapp/ndm/services/go-worker/auth"
	"github.com/netapp/ndm/services/go-worker/config"
	"github.com/netapp/ndm/services/go-worker/filecopy"
	"github.com/netapp/ndm/services/go-worker/healthcheck"
	"github.com/netapp/ndm/services/go-worker/httpclient"
	"github.com/netapp/ndm/services/go-worker/logger"
	"github.com/netapp/ndm/services/go-worker/metrics"
	"github.com/netapp/ndm/services/go-worker/redisclient"
	"github.com/netapp/ndm/services/go-worker/workmanager"

	// Register protocol implementations via init().
	_ "github.com/netapp/ndm/services/go-worker/protocols/nfs"
	_ "github.com/netapp/ndm/services/go-worker/protocols/smb"
)

func main() {
	// 1. Load configuration from environment variables.
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load config: %v\n", err)
		os.Exit(1)
	}

	// 2. Initialize structured logger.
	log := logger.NewLogger("go-worker")
	defer log.Sync()

	log.Info("Starting go-worker",
		zap.String("workerId", cfg.WorkerID),
		zap.String("buildId", cfg.BuildID),
	)

	// A root context that will be cancelled on shutdown signal. All background
	// goroutines use this context so they stop cleanly.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 3. Initialize Keycloak auth.
	keycloak := auth.NewKeycloakAuth(cfg)

	// 4. Initialize HTTP client (with auth token injection).
	httpClient := httpclient.NewClient(keycloak, log)

	// 5. Initialize Redis client.
	redis, err := redisclient.NewRedisClient(cfg, log)
	if err != nil {
		log.Error("Failed to initialize Redis client", zap.Error(err))
		os.Exit(1)
	}
	defer redis.Close()

	// 6. Initialize CopyPool and start worker goroutines.
	copyPool := filecopy.NewCopyPool(cfg.ThreadCount, cfg.ThreadBands, cfg.MaxBufferSize)
	copyPool.Start()
	defer copyPool.Stop()

	// 7. Initialize Activities struct with all shared dependencies.
	acts := &activities.Activities{
		Config:   cfg,
		Redis:    redis,
		Auth:     keycloak,
		CopyPool: copyPool,
		HTTP:     httpClient,
		Logger:   log,
	}

	// 8. Initialize Prometheus metrics.
	metrics.Init(cfg.WorkerID, cfg.BuildID)

	// 9. Start health check goroutine (Linux-only; no-op on other platforms).
	healthcheck.Start(ctx, cfg, httpClient, log)

	// 10. Start metrics push goroutine.
	metrics.StartPushLoop(ctx, cfg, log)

	// 11. Initialize and start WorkManager (registers with Config Service,
	//     creates Temporal client, begins polling for worker configurations).
	wm := workmanager.NewWorkManager(cfg, keycloak, httpClient, acts, log)
	if err := wm.Start(ctx); err != nil {
		log.Error("Failed to start WorkManager", zap.Error(err))
		os.Exit(1)
	}

	// 12. Block until a shutdown signal is received, then clean up.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	log.Info(fmt.Sprintf("Received signal %v, shutting down...", sig))

	// Cancel the root context to signal all background goroutines.
	cancel()

	// Stop the WorkManager (stops Temporal workers and closes the client).
	wm.Stop()

	log.Info("Shutdown complete")
}
