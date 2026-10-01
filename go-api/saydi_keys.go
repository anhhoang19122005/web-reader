package readerapi

import (
	"strings"
	"sync"
	"time"
)

const saydiKeyCooldown = time.Minute

type saydiKeyState struct {
	key           string
	disabled      bool
	cooldownUntil time.Time
}

type saydiKeyManager struct {
	mu      sync.Mutex
	keys    []saydiKeyState
	current int
}

func parseSaydiKeys(value string) []string {
	keys := make([]string, 0)
	for _, raw := range strings.Split(value, ",") {
		if key := strings.TrimSpace(raw); key != "" {
			keys = append(keys, key)
		}
	}
	return keys
}

func newSaydiKeyManager(keys []string) *saydiKeyManager {
	states := make([]saydiKeyState, 0, len(keys))
	for _, key := range keys {
		if key = strings.TrimSpace(key); key != "" {
			states = append(states, saydiKeyState{key: key})
		}
	}
	return &saydiKeyManager{keys: states}
}

func (m *saydiKeyManager) next() (int, string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.keys) == 0 {
		return -1, "", false
	}
	now := time.Now()
	for offset := 0; offset < len(m.keys); offset++ {
		index := (m.current + offset) % len(m.keys)
		state := &m.keys[index]
		if state.disabled || now.Before(state.cooldownUntil) {
			continue
		}
		m.current = index
		return index, state.key, true
	}
	return -1, "", false
}

func (m *saydiKeyManager) fail(index int, permanent bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if index < 0 || index >= len(m.keys) {
		return
	}
	if permanent {
		m.keys[index].disabled = true
	} else {
		m.keys[index].cooldownUntil = time.Now().Add(saydiKeyCooldown)
	}
	if len(m.keys) > 0 {
		m.current = (index + 1) % len(m.keys)
	}
}
