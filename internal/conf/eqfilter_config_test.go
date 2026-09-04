package conf

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestEqFilterConfig_Consistency pins the UI-facing filter catalog: every offered type is one
// validation accepts, the three basic types are marked Simple for the non-advanced editor, every
// type carries a Frequency parameter, and every parameter range sits inside the validation limits.
func TestEqFilterConfig_Consistency(t *testing.T) {
	t.Parallel()

	simple := map[string]bool{"LowPass": true, "HighPass": true, "BandReject": true}
	for name, cfg := range EqFilterConfig {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			assert.True(t, IsKnownEQFilterType(name), "offered type must validate")
			assert.Equal(t, simple[name], cfg.Simple, "Simple marks exactly the basic types")
			params := map[string]EqFilterParameter{}
			for _, p := range cfg.Parameters {
				params[p.Name] = p
				assert.LessOrEqual(t, p.Min, p.Default, "%s default below min", p.Name)
				assert.GreaterOrEqual(t, p.Max, p.Default, "%s default above max", p.Name)
			}
			f, ok := params["Frequency"]
			require.True(t, ok, "every type has a Frequency parameter")
			assert.Less(t, f.Max, MaxEQFrequency)
			if q, ok := params["Q"]; ok {
				assert.LessOrEqual(t, q.Max, MaxEQQ)
				assert.Greater(t, q.Min, 0.0)
			}
			if g, ok := params["Gain"]; ok {
				assert.InDelta(t, -MaxEQGainDB, g.Min, 0)
				assert.InDelta(t, MaxEQGainDB, g.Max, 0)
			}
			if p, ok := params["Passes"]; ok {
				assert.InDelta(t, 1.0, p.Min, 0)
				assert.InDelta(t, float64(MaxEQPasses), p.Max, 0)
			}
			assert.Equal(t, eqFilterUsesWidth(name), params["Width"].Name == "Width", "Width parameter matches the types that take a bandwidth")
			assert.Equal(t, eqFilterUsesGain(name), params["Gain"].Name == "Gain", "Gain parameter matches the types that apply gain")
		})
	}
	assert.False(t, IsKnownEQFilterType("Comb"))
	assert.True(t, IsKnownEQFilterType("AllPass"))
}
