package performance

import (
	"fmt"
	"log"
	"regexp"
	"strings"
)

// varRe matches strings that are an entire variable reference, e.g. "$workerId"
var varRe = regexp.MustCompile(`^\$([a-zA-Z0-9_.]+)$`)

// convertToStringMap recursively converts a map with interface{} keys (from YAML unmarshalling)
// into a map[string]interface{}.
func ConvertToStringMap(in interface{}) (map[string]interface{}, bool) {
	out := make(map[string]interface{})
	switch m := in.(type) {
	case map[interface{}]interface{}:
		for k, v := range m {
			keyStr := fmt.Sprintf("%v", k)
			convVal, ok := convertValue(v)
			if !ok {
				return nil, false
			}
			out[keyStr] = convVal
		}
		return out, true
	case map[string]interface{}:
		return m, true
	default:
		return nil, false
	}
}

func convertValue(in interface{}) (interface{}, bool) {
	switch x := in.(type) {
	case map[interface{}]interface{}:
		return ConvertToStringMap(x)
	case []interface{}:
		for i, elem := range x {
			convElem, ok := convertValue(elem)
			if !ok {
				return nil, false
			}
			x[i] = convElem
		}
		return x, true
	default:
		return in, true
	}
}

// resolveValue looks up a nested variable reference (e.g. "user.email") in sharedVars.
func resolveValue(ref string, sharedVars map[string]interface{}) (interface{}, bool) {
	parts := strings.Split(ref, ".")
	if len(parts) == 0 {
		return nil, false
	}
	val, ok := sharedVars[parts[0]]
	if !ok {
		return nil, false
	}
	for i := 1; i < len(parts); i++ {
		m, ok := val.(map[string]interface{})
		if !ok {
			return nil, false
		}
		val, ok = m[parts[i]]
		if !ok {
			return nil, false
		}
	}
	return val, true
}

// resolveDataRecursive recursively processes a value and, if a string exactly matches a variable reference
// (e.g., "$workerId"), it replaces that string with the corresponding value from sharedVars. It recurses
// into maps and slices.
func ResolveDataRecursive(v interface{}, sharedVars map[string]interface{}) interface{} {

	switch x := v.(type) {
	case string:
		if strings.TrimSpace(x) == "$autogen_project_name" {
			generated := AutoGenerateProjectName("test")
			log.Printf("Generated project name: %s\n", generated)
			// Optionally, store the generated value into sharedVars if you want to use it later.
			sharedVars["autogen_project_name"] = generated
			return generated
		}
		if matches := varRe.FindStringSubmatch(x); len(matches) == 2 {
			varName := matches[1]
			if resolved, ok := resolveValue(varName, sharedVars); ok {
				return resolved
			}
		}
		return x
	case map[string]interface{}:
		newMap := make(map[string]interface{})
		for key, val := range x {
			newMap[key] = ResolveDataRecursive(val, sharedVars)
		}
		return newMap
	case []interface{}:
		newSlice := make([]interface{}, len(x))
		for i, elem := range x {
			newSlice[i] = ResolveDataRecursive(elem, sharedVars)
		}
		return newSlice
	default:
		return x
	}
}
