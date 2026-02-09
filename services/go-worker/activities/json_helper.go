package activities

import "encoding/json"

// parseJSON is a small helper to avoid importing encoding/json in every file.
func parseJSON(data []byte, v interface{}) error {
	return json.Unmarshal(data, v)
}

// toJSON marshals v to JSON bytes.
func toJSON(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}
