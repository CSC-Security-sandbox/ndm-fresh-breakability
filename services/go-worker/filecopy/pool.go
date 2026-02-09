package filecopy

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

// Band defines a file-size band with a name, maximum file size threshold, and
// the maximum number of files to fetch from the queue per worker iteration.
type Band struct {
	Name     string
	MaxSize  int64
	MaxFetch int
}

// CopyTask represents a single file copy operation to be executed by the pool.
type CopyTask struct {
	ID            string
	Source        string
	Dest          string
	Size          int64
	MaxBufferSize int
	ResultCh      chan CopyResult
}

// CopyResult holds the outcome of a single copy operation.
type CopyResult struct {
	Checksums *Checksums
	Err       error
}

// PoolMetrics tracks runtime statistics for the copy pool.
type PoolMetrics struct {
	TotalWorkers     int
	AvailableWorkers int64
	ActiveTasks      int64
	QueueDepth       int64
}

// CopyPool manages a set of goroutine workers that execute file copy tasks.
// Tasks are submitted to a shared channel and executed concurrently.
type CopyPool struct {
	bands       []Band
	workerCount int
	taskCh      chan CopyTask
	wg          sync.WaitGroup
	metrics     *PoolMetrics
	mu          sync.RWMutex
	stopped     bool
}

// parseSizeName converts a human-readable size string to bytes.
// Supported names: 1kb, 1mb, 10mb, 100mb, 1gb.
// Falls back to strconv.ParseInt for unrecognized names.
func parseSizeName(name string) (int64, error) {
	lower := strings.ToLower(strings.TrimSpace(name))
	switch lower {
	case "1kb":
		return 1024, nil
	case "1mb":
		return 1048576, nil
	case "10mb":
		return 10485760, nil
	case "100mb":
		return 104857600, nil
	case "1gb":
		return 1073741824, nil
	default:
		val, err := strconv.ParseInt(lower, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("unrecognized size name %q: %w", name, err)
		}
		return val, nil
	}
}

// parseBandsConfig parses a bands configuration string into a slice of Band.
// The format is semicolon-separated entries of "sizeName,maxFetch".
// Example: "1kb,1500;1mb,1000;10mb,100;100mb,10;1gb,1"
func parseBandsConfig(config string) ([]Band, error) {
	config = strings.TrimSpace(config)
	if config == "" {
		return defaultBands(), nil
	}

	entries := strings.Split(config, ";")
	bands := make([]Band, 0, len(entries))

	for _, entry := range entries {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}

		parts := strings.SplitN(entry, ",", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid band entry %q: expected format 'sizeName,maxFetch'", entry)
		}

		name := strings.TrimSpace(parts[0])
		maxSize, err := parseSizeName(name)
		if err != nil {
			return nil, fmt.Errorf("invalid band size in %q: %w", entry, err)
		}

		maxFetch, err := strconv.Atoi(strings.TrimSpace(parts[1]))
		if err != nil {
			return nil, fmt.Errorf("invalid maxFetch in %q: %w", entry, err)
		}

		bands = append(bands, Band{
			Name:     name,
			MaxSize:  maxSize,
			MaxFetch: maxFetch,
		})
	}

	if len(bands) == 0 {
		return defaultBands(), nil
	}

	return bands, nil
}

// defaultBands returns the default band configuration matching the TypeScript
// worker thread service defaults.
func defaultBands() []Band {
	return []Band{
		{Name: "1kb", MaxSize: 1024, MaxFetch: 1500},
		{Name: "1mb", MaxSize: 1048576, MaxFetch: 1000},
		{Name: "10mb", MaxSize: 10485760, MaxFetch: 100},
		{Name: "100mb", MaxSize: 104857600, MaxFetch: 10},
		{Name: "1gb", MaxSize: 1073741824, MaxFetch: 1},
	}
}

// NewCopyPool creates a new CopyPool with the specified number of worker
// goroutines and band configuration. The bandsConfig string uses semicolon-
// separated entries of "sizeName,maxFetch" (e.g. "1kb,1500;1mb,1000;10mb,100;100mb,10;1gb,1").
// If bandsConfig is empty or invalid, default bands are used.
// The maxBufferSize parameter is retained for reference but each CopyTask
// carries its own MaxBufferSize for flexibility.
func NewCopyPool(threadCount int, bandsConfig string, maxBufferSize int) *CopyPool {
	bands, err := parseBandsConfig(bandsConfig)
	if err != nil {
		bands = defaultBands()
	}

	if threadCount <= 0 {
		threadCount = 5
	}

	// Use a buffered channel to allow some queuing without blocking submitters.
	// The buffer size is generous to avoid backpressure on submitters.
	channelSize := threadCount * 100
	if channelSize < 1000 {
		channelSize = 1000
	}

	return &CopyPool{
		bands:       bands,
		workerCount: threadCount,
		taskCh:      make(chan CopyTask, channelSize),
		metrics: &PoolMetrics{
			TotalWorkers: threadCount,
		},
	}
}

// Start launches the worker goroutines. Each goroutine reads tasks from the
// shared channel and executes SmartCopy, sending the result back on the task's
// ResultCh channel.
func (p *CopyPool) Start() {
	atomic.StoreInt64(&p.metrics.AvailableWorkers, int64(p.workerCount))

	for i := 0; i < p.workerCount; i++ {
		p.wg.Add(1)
		go p.worker()
	}
}

// worker is the main loop for a single pool goroutine. It reads CopyTask
// values from the shared task channel until the channel is closed, executes
// the copy, and sends the result.
func (p *CopyPool) worker() {
	defer p.wg.Done()

	for task := range p.taskCh {
		atomic.AddInt64(&p.metrics.AvailableWorkers, -1)
		atomic.AddInt64(&p.metrics.ActiveTasks, 1)
		atomic.AddInt64(&p.metrics.QueueDepth, -1)

		checksums, err := SmartCopy(task.Source, task.Dest, task.Size, task.MaxBufferSize)

		result := CopyResult{
			Checksums: checksums,
			Err:       err,
		}

		// Send result. The ResultCh is expected to be buffered (capacity 1)
		// so this will not block indefinitely.
		task.ResultCh <- result

		atomic.AddInt64(&p.metrics.ActiveTasks, -1)
		atomic.AddInt64(&p.metrics.AvailableWorkers, 1)
	}
}

// Stop signals all workers to finish by closing the task channel and waits
// for all in-flight work to complete.
func (p *CopyPool) Stop() {
	p.mu.Lock()
	if p.stopped {
		p.mu.Unlock()
		return
	}
	p.stopped = true
	p.mu.Unlock()

	close(p.taskCh)
	p.wg.Wait()
}

// Submit enqueues a copy task for execution by the pool and returns a channel
// on which the result will be delivered. The caller must read from the returned
// channel to receive the result.
//
// If the pool has been stopped, the result channel will receive an error
// immediately.
func (p *CopyPool) Submit(task CopyTask) <-chan CopyResult {
	// Ensure the task has a result channel. Create one if not provided.
	if task.ResultCh == nil {
		task.ResultCh = make(chan CopyResult, 1)
	}

	p.mu.RLock()
	stopped := p.stopped
	p.mu.RUnlock()

	if stopped {
		task.ResultCh <- CopyResult{
			Err: fmt.Errorf("copy pool is stopped, cannot accept task %s", task.ID),
		}
		return task.ResultCh
	}

	atomic.AddInt64(&p.metrics.QueueDepth, 1)
	p.taskCh <- task

	return task.ResultCh
}

// Metrics returns a snapshot of the current pool metrics.
func (p *CopyPool) Metrics() PoolMetrics {
	return PoolMetrics{
		TotalWorkers:     p.metrics.TotalWorkers,
		AvailableWorkers: atomic.LoadInt64(&p.metrics.AvailableWorkers),
		ActiveTasks:      atomic.LoadInt64(&p.metrics.ActiveTasks),
		QueueDepth:       atomic.LoadInt64(&p.metrics.QueueDepth),
	}
}

// Bands returns the configured bands for this pool.
func (p *CopyPool) Bands() []Band {
	return p.bands
}
