package main

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"
)

// parseRESPArray parses a RESP array and returns the elements as strings
// Example: *3\r\n$4\r\nAUTH\r\n$7\r\ndefault\r\n$20\r\nUOowTkoi3QZNwTinQcwV\r\n
// Returns: ["AUTH", "default", "UOowTkoi3QZNwTinQcwV"], nil
func parseRESPArray(data []byte) ([]string, error) {
	if len(data) < 4 || data[0] != '*' {
		return nil, fmt.Errorf("invalid RESP array format")
	}

	// Find first \r\n to get array count
	idx := bytes.Index(data, []byte("\r\n"))
	if idx == -1 {
		return nil, fmt.Errorf("incomplete RESP array")
	}
	// Parse array count
	countStr := string(data[1:idx])
	count, err := strconv.Atoi(countStr)
	if err != nil {
		return nil, fmt.Errorf("invalid array count: %v", err)
	}

	elements := make([]string, 0, count)
	offset := idx + 2 // Skip *N\r\n

	// Parse each bulk string element
	for i := 0; i < count; i++ {
		if offset >= len(data) {
			return nil, fmt.Errorf("incomplete array element %d", i)
		}

		// Parse bulk string length: $<len>\r\n
		if data[offset] != '$' {
			return nil, fmt.Errorf("expected bulk string at element %d", i)
		}

		idx = bytes.Index(data[offset:], []byte("\r\n"))
		if idx == -1 {
			return nil, fmt.Errorf("incomplete bulk string length at element %d", i)
		}

		lengthStr := string(data[offset+1 : offset+idx])
		length, err := strconv.Atoi(lengthStr)
		if err != nil {
			return nil, fmt.Errorf("invalid bulk string length at element %d: %v", i, err)
		}

		offset += idx + 2 // Skip $<len>\r\n

		// Extract bulk string data
		if offset+length+2 > len(data) {
			return nil, fmt.Errorf("incomplete bulk string data at element %d", i)
		}

		element := string(data[offset : offset+length])
		elements = append(elements, element)
		offset += length + 2 // Skip data\r\n
	}

	return elements, nil
}

// extractJWTOrPasswordFromRESP parses RESP AUTH command and returns whether it's JWT, the username, the value, and success
// Returns: (isJWT, username, value, ok)
//   - isJWT: true if the value looks like a JWT token
//   - username: the username extracted from AUTH command
//   - value: the password/JWT extracted
//   - ok: true if AUTH command was successfully parsed
func extractJWTOrPasswordFromRESP(data []byte) (bool, string, string, bool) {
	// Parse RESP array
	elements, err := parseRESPArray(data)
	if err != nil {
		return false, "", "", false // Not a complete AUTH command yet
	}

	// Check if it's an AUTH command
	if len(elements) < 2 || strings.ToUpper(elements[0]) != "AUTH" {
		return false, "", "", false // Not an AUTH command
	}

	// Expect: AUTH <username> <password> (3 elements)
	if len(elements) != 3 {
		return false, "", "", false // Invalid AUTH format
	}

	username := elements[1] // Username is the 2nd element
	password := elements[2] // Password is the 3rd element

	// Check if password is a JWT
	isJWT := isJWTFormat(password)
	return isJWT, username, password, true
}

// isJWTFormat checks if a string looks like a JWT (three base64 parts separated by dots)
func isJWTFormat(token string) bool {
	parts := strings.Split(token, ".")
	// JWT must have exactly 3 parts (header.payload.signature)
	if len(parts) != 3 {
		return false
	}
	// Each part should be non-empty
	for _, part := range parts {
		if len(part) == 0 {
			return false
		}
	}
	return true
}
