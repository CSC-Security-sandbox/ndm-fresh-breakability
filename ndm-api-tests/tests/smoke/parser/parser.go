package parser

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v2"
)

// Scenario defines a single test scenario.
type Scenario struct {
	Name        string                   `yaml:"name"`
	URL         string                   `yaml:"url"`
	Method      string                   `yaml:"method"`
	ServiceName string                   `yaml:"service_name"`
	Delay       string                   `yaml:"delay"`
	Headers     map[string]string        `yaml:"headers"`
	Data        interface{}              `yaml:"data"`
	Response    []map[string]interface{} `yaml:"response"`
	Parse       map[string]string        `yaml:"parse"`
	Params      map[string]string        `yaml:"params"`
}

// ScenarioDefinition represents the top-level YAML file structure.
type ScenarioDefinition struct {
	Scenarios []Scenario `yaml:"scenarios"`
}

type ScenarioConfig struct {
	Files []string `yaml:"files"`
}

// parseScenarioDefinition reads a YAML file and unmarshals it into a ScenarioDefinition structure.
func ParseScenarioDefinition(fp string) (ScenarioDefinition, error) {
	var sd ScenarioDefinition
	data, err := os.ReadFile(fp)
	if err != nil {
		return sd, fmt.Errorf("could not read file %s: %w", fp, err)
	}
	if err = yaml.Unmarshal(data, &sd); err != nil {
		return sd, fmt.Errorf("error unmarshaling YAML from %s: %w", fp, err)
	}
	return sd, nil
}
