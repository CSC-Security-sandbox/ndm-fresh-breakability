package redisclient

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/config"
	"github.com/netapp/ndm/services/go-worker/logger"
)

// MemoryInfo holds Redis server memory usage statistics.
type MemoryInfo struct {
	UsedMemory   int64   `json:"usedMemory"`
	MaxMemory    int64   `json:"maxMemory"`
	UsagePercent float64 `json:"usagePercent"`
}

// redisSecretsResponse models the JSON response returned by the config service
// endpoint GET /api/v1/secrets/redis.
type redisSecretsResponse struct {
	Data struct {
		Items struct {
			Host     string `json:"host"`
			Port     string `json:"port"`
			Username string `json:"username"`
			Password string `json:"password"`
		} `json:"items"`
	} `json:"data"`
}

// RedisClient wraps a go-redis client with application-level helpers for
// identity mapping lookups and memory usage monitoring.
type RedisClient struct {
	rdb    *redis.Client
	cfg    *config.Config
	logger *logger.Logger
}

// NewRedisClient creates a connected Redis client. When cfg.RedisHost is set,
// the host, port, username, and password are read directly from the config.
// Otherwise the credentials are fetched from the Config Service at
// {ConfigServiceURL}/api/v1/secrets/redis.
func NewRedisClient(cfg *config.Config, log *logger.Logger) (*RedisClient, error) {
	host := cfg.RedisHost
	port := cfg.RedisPort
	username := cfg.RedisUsername
	password := cfg.RedisPassword

	// If RedisHost is empty, fetch credentials from the config service.
	if host == "" {
		log.Info("RedisHost not set, fetching credentials from config service")
		secrets, err := fetchRedisSecrets(cfg.ConfigServiceURL)
		if err != nil {
			return nil, fmt.Errorf("fetching redis secrets from config service: %w", err)
		}
		host = secrets.Data.Items.Host
		port = secrets.Data.Items.Port
		username = secrets.Data.Items.Username
		password = secrets.Data.Items.Password
	}

	if port == "" {
		port = "6379"
	}

	opts := &redis.Options{
		Addr:         fmt.Sprintf("%s:%s", host, port),
		DialTimeout:  10 * time.Second,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		PoolSize:     10,
	}
	if username != "" {
		opts.Username = username
	}
	if password != "" {
		opts.Password = password
	}

	rdb := redis.NewClient(opts)

	// Verify connectivity.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping failed (%s:%s): %w", host, port, err)
	}

	log.Info("Connected to Redis", zap.String("addr", opts.Addr))

	return &RedisClient{
		rdb:    rdb,
		cfg:    cfg,
		logger: log,
	}, nil
}

// Close gracefully shuts down the Redis connection.
func (rc *RedisClient) Close() error {
	rc.logger.Info("Closing Redis connection")
	return rc.rdb.Close()
}

// Client returns the underlying go-redis client for direct access.
func (rc *RedisClient) Client() *redis.Client {
	return rc.rdb
}

// GetOwnerIdentity looks up an identity mapping from the Redis hash map
// keyed by "{jobRunId}:mapping". The field is "{idType}:{id}". If no mapping
// is found, the original id is returned.
func (rc *RedisClient) GetOwnerIdentity(jobRunID, id, idType string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	key := fmt.Sprintf("%s:mapping", jobRunID)
	field := fmt.Sprintf("%s:%s", idType, id)

	val, err := rc.rdb.HGet(ctx, key, field).Result()
	if err == redis.Nil {
		return id, nil
	}
	if err != nil {
		return "", fmt.Errorf("getting owner identity %s from %s: %w", field, key, err)
	}
	return val, nil
}

// SetOwnerIdentity sets an identity mapping in the Redis hash map keyed by
// "{jobRunId}:mapping". The field is "{idType}:{id}" and value is the mapped
// identity string.
func (rc *RedisClient) SetOwnerIdentity(jobRunID, id, idType, value string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	key := fmt.Sprintf("%s:mapping", jobRunID)
	field := fmt.Sprintf("%s:%s", idType, id)

	if err := rc.rdb.HSet(ctx, key, field, value).Err(); err != nil {
		return fmt.Errorf("setting owner identity %s in %s: %w", field, key, err)
	}
	return nil
}

// GetMemoryInfo retrieves memory usage statistics from the Redis server by
// issuing the INFO MEMORY command and parsing the used_memory and maxmemory
// fields.
func (rc *RedisClient) GetMemoryInfo(ctx context.Context) (*MemoryInfo, error) {
	result, err := rc.rdb.Info(ctx, "memory").Result()
	if err != nil {
		return nil, fmt.Errorf("redis INFO memory: %w", err)
	}

	info := &MemoryInfo{}
	for _, line := range strings.Split(result, "\r\n") {
		if strings.HasPrefix(line, "used_memory:") {
			info.UsedMemory, _ = strconv.ParseInt(strings.TrimPrefix(line, "used_memory:"), 10, 64)
		}
		if strings.HasPrefix(line, "maxmemory:") {
			info.MaxMemory, _ = strconv.ParseInt(strings.TrimPrefix(line, "maxmemory:"), 10, 64)
		}
	}

	if info.MaxMemory > 0 {
		info.UsagePercent = float64(info.UsedMemory) / float64(info.MaxMemory) * 100.0
	}

	return info, nil
}

// fetchRedisSecrets calls the config service to obtain Redis connection
// credentials. The expected endpoint is GET {baseURL}/api/v1/secrets/redis
// which returns JSON with structure: { data: { items: { host, port, username, password } } }.
func fetchRedisSecrets(configServiceURL string) (*redisSecretsResponse, error) {
	url := fmt.Sprintf("%s/api/v1/secrets/redis", strings.TrimRight(configServiceURL, "/"))

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("HTTP GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("config service returned %d: %s", resp.StatusCode, string(body))
	}

	var secrets redisSecretsResponse
	if err := json.NewDecoder(resp.Body).Decode(&secrets); err != nil {
		return nil, fmt.Errorf("decoding redis secrets response: %w", err)
	}

	if secrets.Data.Items.Host == "" {
		return nil, fmt.Errorf("config service returned empty redis host")
	}

	return &secrets, nil
}
