package scenario

import (
	"io/ioutil"

	"gopkg.in/yaml.v2"
)

// Scenario defines a single test scenario.
type Scenario struct {
	URL         string                 `yaml:"url"`
	Method      string                 `yaml:"method"`
	ServiceName string                 `yaml:"service_name"`
	Delay       string                 `yaml:"delay"`
	Data        map[string]interface{} `yaml:"data"`
	Response    []interface{}          `yaml:"response"`
	Parse       map[string]string      `yaml:"parse"`
	Params      map[string]string      `yaml:"params"`
}

// Scenarios is a map with a scenario name as key.
type Scenarios map[string]Scenario

// ParseScenarios loads the YAML file and unmarshals the content into a Scenarios map.
func ParseScenarios(filePath string) (Scenarios, error) {
	data, err := ioutil.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	var scenarios Scenarios
	if err := yaml.Unmarshal(data, &scenarios); err != nil {
		return nil, err
	}
	return scenarios, nil
}
