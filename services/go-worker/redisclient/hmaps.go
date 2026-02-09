package redisclient

import (
	"context"
	"encoding/base64"
	"fmt"

	"github.com/redis/go-redis/v9"
	"github.com/vmihailenco/msgpack/v5"
	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/logger"
)

// HMapCollection provides operations on a single Redis hash map, encoding
// values with msgpack+base64 for wire compatibility with the TypeScript
// RedisHMapCollection from jobs-lib.
type HMapCollection struct {
	rdb    *redis.Client
	mapKey string
	logger *logger.Logger
}

// NewHMapCollection creates a new HMapCollection bound to the given Redis
// client and hash map key.
func NewHMapCollection(rdb *redis.Client, mapKey string, log *logger.Logger) *HMapCollection {
	return &HMapCollection{
		rdb:    rdb,
		mapKey: mapKey,
		logger: log,
	}
}

// SetValue encodes the value with msgpack+base64 and stores it in the hash map
// at the given field using HSET.
func (h *HMapCollection) SetValue(ctx context.Context, field string, value interface{}) error {
	encoded, err := encodeHMapValue(value)
	if err != nil {
		return fmt.Errorf("encoding value for field %s in %s: %w", field, h.mapKey, err)
	}

	if err := h.rdb.HSet(ctx, h.mapKey, field, encoded).Err(); err != nil {
		return fmt.Errorf("HSET %s %s: %w", h.mapKey, field, err)
	}
	return nil
}

// GetValue retrieves the value at the given field from the hash map, decodes it
// from base64+msgpack, and populates dest. dest must be a pointer type.
// Returns an error wrapping redis.Nil if the field does not exist.
func (h *HMapCollection) GetValue(ctx context.Context, field string, dest interface{}) error {
	val, err := h.rdb.HGet(ctx, h.mapKey, field).Result()
	if err != nil {
		if err == redis.Nil {
			return fmt.Errorf("field %s not found in %s: %w", field, h.mapKey, err)
		}
		return fmt.Errorf("HGET %s %s: %w", h.mapKey, field, err)
	}

	raw, err := base64.StdEncoding.DecodeString(val)
	if err != nil {
		return fmt.Errorf("base64 decoding value for field %s in %s: %w", field, h.mapKey, err)
	}

	if err := msgpack.Unmarshal(raw, dest); err != nil {
		return fmt.Errorf("msgpack unmarshal value for field %s in %s: %w", field, h.mapKey, err)
	}

	return nil
}

// DeleteValue removes a single field from the hash map using HDEL.
func (h *HMapCollection) DeleteValue(ctx context.Context, field string) error {
	if err := h.rdb.HDel(ctx, h.mapKey, field).Err(); err != nil {
		return fmt.Errorf("HDEL %s %s: %w", h.mapKey, field, err)
	}
	return nil
}

// GetAll returns all field-value pairs in the hash map using HGETALL. The
// values are returned as raw base64-encoded strings; callers can decode them
// individually using base64+msgpack.
func (h *HMapCollection) GetAll(ctx context.Context) (map[string]string, error) {
	result, err := h.rdb.HGetAll(ctx, h.mapKey).Result()
	if err != nil {
		return nil, fmt.Errorf("HGETALL %s: %w", h.mapKey, err)
	}
	return result, nil
}

// SetValueIfNotExists encodes the value with msgpack+base64 and stores it in
// the hash map only if the field does not already exist (HSETNX). Returns true
// if the field was set, false if it already existed.
func (h *HMapCollection) SetValueIfNotExists(ctx context.Context, field string, value interface{}) (bool, error) {
	encoded, err := encodeHMapValue(value)
	if err != nil {
		return false, fmt.Errorf("encoding value for field %s in %s: %w", field, h.mapKey, err)
	}

	set, err := h.rdb.HSetNX(ctx, h.mapKey, field, encoded).Result()
	if err != nil {
		return false, fmt.Errorf("HSETNX %s %s: %w", h.mapKey, field, err)
	}
	return set, nil
}

// IsEmpty returns true if the hash map has no fields (HLEN == 0).
func (h *HMapCollection) IsEmpty(ctx context.Context) (bool, error) {
	length, err := h.rdb.HLen(ctx, h.mapKey).Result()
	if err != nil {
		return false, fmt.Errorf("HLEN %s: %w", h.mapKey, err)
	}
	return length == 0, nil
}

// GetSize returns the number of fields in the hash map (HLEN).
func (h *HMapCollection) GetSize(ctx context.Context) (int64, error) {
	length, err := h.rdb.HLen(ctx, h.mapKey).Result()
	if err != nil {
		return 0, fmt.Errorf("HLEN %s: %w", h.mapKey, err)
	}
	return length, nil
}

// DeleteAll removes the entire hash map key from Redis using DEL.
func (h *HMapCollection) DeleteAll(ctx context.Context) error {
	if err := h.rdb.Del(ctx, h.mapKey).Err(); err != nil {
		return fmt.Errorf("DEL %s: %w", h.mapKey, err)
	}
	h.logger.Debug("Deleted hash map", zap.String("key", h.mapKey))
	return nil
}

// encodeHMapValue marshals a value with msgpack then base64-encodes the
// resulting bytes.
func encodeHMapValue(value interface{}) (string, error) {
	data, err := msgpack.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("msgpack marshal: %w", err)
	}
	return base64.StdEncoding.EncodeToString(data), nil
}
