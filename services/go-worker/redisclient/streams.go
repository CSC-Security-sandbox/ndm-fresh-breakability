package redisclient

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/vmihailenco/msgpack/v5"
	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/logger"
)

// StreamMessage wraps a decoded record together with its Redis stream message
// ID, allowing callers to acknowledge processing after consumption.
type StreamMessage[T any] struct {
	ID   string
	Data T
}

// StreamCollection is a generic Redis stream wrapper that encodes records with
// msgpack followed by base64, matching the wire format used by the TypeScript
// jobs-lib (msgpack-lite + Buffer.toString('base64')).
//
// Each record is stored in a stream message with a single field named "obj"
// whose value is the base64-encoded msgpack bytes. The field name "obj" matches
// the TypeScript jobs-lib redis-stream-collection.ts.
type StreamCollection[T any] struct {
	rdb       *redis.Client
	streamKey string
	logger    *logger.Logger
}

// NewStreamCollection creates a new StreamCollection bound to the given Redis
// client and stream key.
func NewStreamCollection[T any](rdb *redis.Client, streamKey string, log *logger.Logger) *StreamCollection[T] {
	return &StreamCollection[T]{
		rdb:       rdb,
		streamKey: streamKey,
		logger:    log,
	}
}

// Init creates the consumer groups required for both the "worker" and
// "db-writer" group reader types. The group name format is
// "{jobRunId}-{groupType}" where groupType is "worker" or "db-writer".
// If a consumer group already exists (BUSYGROUP error), the error is silently
// ignored.
func (s *StreamCollection[T]) Init(jobRunID string) error {
	groupTypes := []string{"worker", "db-writer"}
	ctx := context.Background()

	for _, groupType := range groupTypes {
		groupName := fmt.Sprintf("%s-%s", jobRunID, groupType)
		err := s.rdb.XGroupCreateMkStream(ctx, s.streamKey, groupName, "0").Err()
		if err != nil {
			if strings.Contains(err.Error(), "BUSYGROUP") {
				s.logger.Warn("Consumer group already exists",
					zap.String("group", groupName),
					zap.String("stream", s.streamKey))
				continue
			}
			return fmt.Errorf("creating consumer group %s on stream %s: %w", groupName, s.streamKey, err)
		}
		s.logger.Info("Created consumer group",
			zap.String("group", groupName),
			zap.String("stream", s.streamKey))
	}
	return nil
}

// Cleanup destroys the consumer groups and deletes the stream key along with
// its associated ack-counter hash.
func (s *StreamCollection[T]) Cleanup(jobRunID string) error {
	ctx := context.Background()
	groupTypes := []string{"worker", "db-writer"}

	for _, groupType := range groupTypes {
		groupName := fmt.Sprintf("%s-%s", jobRunID, groupType)
		err := s.rdb.XGroupDestroy(ctx, s.streamKey, groupName).Err()
		if err != nil {
			s.logger.Warn("Could not destroy consumer group",
				zap.String("group", groupName),
				zap.Error(err))
		} else {
			s.logger.Info("Destroyed consumer group",
				zap.String("group", groupName),
				zap.String("stream", s.streamKey))
		}
	}

	if err := s.rdb.Del(ctx, s.streamKey).Err(); err != nil {
		return fmt.Errorf("deleting stream %s: %w", s.streamKey, err)
	}
	s.logger.Info("Deleted stream", zap.String("stream", s.streamKey))

	ackKey := fmt.Sprintf("%s:ackCounter", s.streamKey)
	if err := s.rdb.Del(ctx, ackKey).Err(); err != nil {
		return fmt.Errorf("deleting ack counter %s: %w", ackKey, err)
	}
	s.logger.Info("Deleted ack counter", zap.String("key", ackKey))

	return nil
}

// Append encodes a single record with msgpack then base64 and appends it to
// the stream via XADD. The field name in the stream message is "obj",
// matching the TypeScript jobs-lib wire format.
// Retries up to 3 times on connection reset errors.
func (s *StreamCollection[T]) Append(ctx context.Context, record T) error {
	encoded, err := encode(record)
	if err != nil {
		return fmt.Errorf("encoding record for stream %s: %w", s.streamKey, err)
	}

	const maxRetries = 3
	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		lastErr = s.rdb.XAdd(ctx, &redis.XAddArgs{
			Stream: s.streamKey,
			Values: map[string]interface{}{
				"obj": encoded,
			},
			ID: "*",
		}).Err()

		if lastErr == nil {
			return nil
		}

		s.logger.Error("Error writing record to stream",
			zap.String("stream", s.streamKey),
			zap.Int("attempt", attempt),
			zap.Error(lastErr))

		if strings.Contains(lastErr.Error(), "ECONNRESET") || strings.Contains(lastErr.Error(), "connection reset") {
			if attempt < maxRetries {
				s.logger.Warn("Connection reset, retrying...",
					zap.String("stream", s.streamKey),
					zap.Int("attempt", attempt))
				continue
			}
		}
		break
	}
	return lastErr
}

// AppendBulk encodes multiple records and adds them to the stream using a
// Redis pipeline for better throughput.
func (s *StreamCollection[T]) AppendBulk(ctx context.Context, records []T) error {
	if len(records) == 0 {
		return nil
	}

	pipe := s.rdb.Pipeline()
	for _, record := range records {
		encoded, err := encode(record)
		if err != nil {
			return fmt.Errorf("encoding record for bulk append to stream %s: %w", s.streamKey, err)
		}
		pipe.XAdd(ctx, &redis.XAddArgs{
			Stream: s.streamKey,
			Values: map[string]interface{}{
				"obj": encoded,
			},
			ID: "*",
		})
	}

	cmds, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("executing bulk append pipeline on stream %s: %w", s.streamKey, err)
	}

	for _, cmd := range cmds {
		if cmd.Err() != nil {
			return fmt.Errorf("bulk append command failed on stream %s: %w", s.streamKey, cmd.Err())
		}
	}

	s.logger.Debug("Bulk appended records to stream",
		zap.String("stream", s.streamKey),
		zap.Int("count", len(records)))

	return nil
}

// GroupRead reads messages from the stream using the XREADGROUP command. The
// consumer group name is "{jobRunId}-{groupType}" and the consumer is
// identified by consumerName. Up to batchSize messages are read. Each message
// is decoded from base64+msgpack back into the generic type T. If no messages
// are available, an empty slice is returned.
func (s *StreamCollection[T]) GroupRead(ctx context.Context, jobRunID string, groupType string, consumerName string, batchSize int64) ([]StreamMessage[T], error) {
	groupName := fmt.Sprintf("%s-%s", jobRunID, groupType)

	streams, err := s.rdb.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    groupName,
		Consumer: consumerName,
		Streams:  []string{s.streamKey, ">"},
		Count:    batchSize,
		Block:    500 * time.Millisecond,
	}).Result()

	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, fmt.Errorf("XREADGROUP on stream %s group %s: %w", s.streamKey, groupName, err)
	}

	var messages []StreamMessage[T]
	for _, stream := range streams {
		for _, msg := range stream.Messages {
			dataStr, ok := msg.Values["obj"].(string)
			if !ok {
				s.logger.Warn("Stream message missing 'obj' field",
					zap.String("stream", s.streamKey),
					zap.String("id", msg.ID))
				continue
			}

			record, err := decode[T](dataStr)
			if err != nil {
				s.logger.Error("Failed to decode stream message",
					zap.String("stream", s.streamKey),
					zap.String("id", msg.ID),
					zap.Error(err))
				continue
			}

			messages = append(messages, StreamMessage[T]{
				ID:   msg.ID,
				Data: record,
			})
		}
	}

	return messages, nil
}

// GroupAck acknowledges one or more messages in the stream using XACK.
func (s *StreamCollection[T]) GroupAck(ctx context.Context, jobRunID string, groupType string, ids ...string) error {
	if len(ids) == 0 {
		return nil
	}

	groupName := fmt.Sprintf("%s-%s", jobRunID, groupType)
	if err := s.rdb.XAck(ctx, s.streamKey, groupName, ids...).Err(); err != nil {
		return fmt.Errorf("XACK on stream %s group %s: %w", s.streamKey, groupName, err)
	}
	return nil
}

// GetLength returns the number of messages currently in the stream (XLEN).
func (s *StreamCollection[T]) GetLength(ctx context.Context) (int64, error) {
	length, err := s.rdb.XLen(ctx, s.streamKey).Result()
	if err != nil {
		return -1, fmt.Errorf("XLEN on stream %s: %w", s.streamKey, err)
	}
	return length, nil
}

// encode marshals a value with msgpack then base64-encodes the resulting bytes.
// This matches the TypeScript encoding:
//
//	msgpack.encode(record) -> Buffer.toString('base64')
func encode[T any](record T) (string, error) {
	data, err := msgpack.Marshal(record)
	if err != nil {
		return "", fmt.Errorf("msgpack marshal: %w", err)
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// decode base64-decodes a string then unmarshals the resulting bytes with
// msgpack. This matches the TypeScript decoding:
//
//	Buffer.from(data, 'base64') -> msgpack.decode(buffer)
func decode[T any](data string) (T, error) {
	var zero T
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return zero, fmt.Errorf("base64 decode: %w", err)
	}

	var result T
	if err := msgpack.Unmarshal(raw, &result); err != nil {
		return zero, fmt.Errorf("msgpack unmarshal: %w", err)
	}
	return result, nil
}
