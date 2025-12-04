package utils

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
)

// Usage: go run scan_dirs.go <directory-path>"

type entry struct {
	Path string `json:"path"`
	Hash string `json:"hash,omitempty"`
}

const maxGoroutines = 100

func scanDirectories(path string) {
	var results []entry
	var mu sync.Mutex
	var wg sync.WaitGroup
	var semaphore = make(chan struct{}, maxGoroutines)

	err := filepath.Walk(path, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		semaphore <- struct{}{}
		wg.Add(1)
		go func(p string) {
			defer wg.Done()
			defer func() { <-semaphore }()
			calculateChecksum(p, &results, &mu)
		}(path)
		return nil
	})
	if err != nil {
		fmt.Println("Error scanning directories:", err)
	}

	f, err := os.Create("results.json")
	if err != nil {
		fmt.Println("Error creating results file:", err)
		return
	}
	defer f.Close()
	wg.Wait()
	if err := json.NewEncoder(f).Encode(results); err != nil {
		fmt.Println("Error writing results to file:", err)
		return
	}
	fmt.Println("Scan complete. Results written to results.json")
}

func calculateChecksum(path string, results *[]entry, mu *sync.Mutex) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	sum := hash.Sum(nil)
	mu.Lock()
	*results = append(*results, entry{Path: path, Hash: fmt.Sprintf("%x", sum)})
	mu.Unlock()
	return nil
}
