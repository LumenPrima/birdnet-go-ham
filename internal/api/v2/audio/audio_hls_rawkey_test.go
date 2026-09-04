package audio

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestHLSStreamKey pins the raw monitor stream's registry key: distinct from the normal
// stream of the same source, and reversible so the audio route still targets the real
// source with the raw flag preserved.
func TestHLSStreamKey(t *testing.T) {
	t.Parallel()
	const src = "rtsp://cam.local:8554/north_birdnet"

	assert.Equal(t, src, hlsStreamKey(src, false))
	rawKey := hlsStreamKey(src, true)
	assert.NotEqual(t, src, rawKey)

	id, raw := splitHLSStreamKey(rawKey)
	assert.Equal(t, src, id)
	assert.True(t, raw)

	id, raw = splitHLSStreamKey(src)
	assert.Equal(t, src, id)
	assert.False(t, raw)
}
