package clientcrypto

import "encoding/json"

// jsonMarshal is a small helper so tests can invoke encoding/json without
// importing it directly (keeps the test file imports tidy).
func jsonMarshal(v any) ([]byte, error) { return json.Marshal(v) }
