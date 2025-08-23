package utils

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"os"
)

func main() {
	// Hardcoded CSV file path
	csvFilePath := "input.csv" // Change this to your CSV file path

	// Hardcoded columns to extract
	columnsToExtract := []string{"Source Path", "Target Checksum"} // Change as needed

	// Open the CSV file
	file, err := os.Open(csvFilePath)
	if err != nil {
		log.Fatalf("Failed to open CSV file: %v", err)
	}
	defer file.Close()

	reader := csv.NewReader(file)
	records, err := reader.ReadAll()
	if err != nil {
		log.Fatalf("Failed to read CSV file: %v", err)
	}

	if len(records) < 1 {
		log.Fatalf("CSV file is empty")
	}

	// Map column names to their indices
	header := records[0]
	colIndices := make(map[string]int)
	for i, col := range header {
		colIndices[col] = i
	}

	// Prepare output
	var result []map[string]string
	for _, row := range records[1:] {
		item := make(map[string]string)
		for _, col := range columnsToExtract {
			idx, ok := colIndices[col]
			if ok && idx < len(row) {
				item[col] = row[idx]
			}
		}
		result = append(result, item)
	}

	// Marshal to JSON
	jsonData, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		log.Fatalf("Failed to marshal JSON: %v", err)
	}

	// Write to output.json
	err = os.WriteFile("output.json", jsonData, 0644)
	if err != nil {
		log.Fatalf("Failed to write output.json: %v", err)
	}

	fmt.Println("JSON output written to output.json")
}
