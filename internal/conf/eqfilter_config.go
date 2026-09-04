package conf

// EqFilterConfig describes every equalizer filter type the UI may offer, with the parameters each
// one takes and their ranges. The three Simple types are what the basic form lists; the console
// editor (realtime.audio.equalizer.advanced) lists them all. Every type here is built by the
// audiocore equalizer package; the audio path does not depend on this map.
var EqFilterConfig = map[string]EqFilterTypeConfig{
	"LowPass": {
		Simple: true,
		Parameters: []EqFilterParameter{
			{Name: "Frequency", Label: "Cutoff Frequency", Type: "number", Unit: "Hz", Min: MinEQFrequency, Max: MaxEQUIFrequency, Default: 15000, Tooltip: "Cutoff frequency above which the signal is attenuated"},
			{Name: "Q", Label: "Q Factor", Type: "number", Min: MinEQQ, Max: MaxEQUIQ, Default: DefaultEQQFactor, Tooltip: "Quality factor that determines the sharpness of the filter's response"},
			{Name: "Passes", Label: "Slope", Type: "number", Min: 1, Max: MaxEQPasses, Default: 1, Tooltip: "Number of cascaded passes: 1 = 12 dB/oct, 2 = 24 dB/oct, 4 = 48 dB/oct"},
		},
		Tooltip: "Low-pass filter attenuates frequencies above the cutoff frequency.",
	},
	"HighPass": {
		Simple: true,
		Parameters: []EqFilterParameter{
			{Name: "Frequency", Label: "Cutoff Frequency", Type: "number", Unit: "Hz", Min: MinEQFrequency, Max: MaxEQUIFrequency, Default: 100, Tooltip: "Cutoff frequency below which the signal is attenuated"},
			{Name: "Q", Label: "Q Factor", Type: "number", Min: MinEQQ, Max: MaxEQUIQ, Default: DefaultEQQFactor, Tooltip: "Quality factor that determines the sharpness of the filter's response"},
			{Name: "Passes", Label: "Slope", Type: "number", Min: 1, Max: MaxEQPasses, Default: 1, Tooltip: "Number of cascaded passes: 1 = 12 dB/oct, 2 = 24 dB/oct, 4 = 48 dB/oct"},
		},
		Tooltip: "High-pass filter attenuates frequencies below the cutoff frequency.",
	},
	"BandReject": {
		Simple: true,
		Parameters: []EqFilterParameter{
			{Name: "Frequency", Label: "Center Frequency", Type: "number", Unit: "Hz", Min: MinEQFrequency, Max: MaxEQUIFrequency, Default: 1000, Tooltip: "Center frequency of the reject band (notch)"},
			{Name: "Width", Label: "Bandwidth", Type: "number", Unit: "Hz", Min: MinEQWidth, Max: MaxEQWidth, Default: 100, Tooltip: "Width of the frequency band that is attenuated"},
			{Name: "Passes", Label: "Depth", Type: "number", Min: 1, Max: MaxEQPasses, Default: 1, Tooltip: "Number of cascaded passes; each pass deepens the notch"},
		},
		Tooltip: "Band-reject (notch) filter attenuates a narrow range of frequencies, useful for removing interference or hum.",
	},
	"BandPass": {
		Parameters: []EqFilterParameter{
			{Name: "Frequency", Label: "Center Frequency", Type: "number", Unit: "Hz", Min: MinEQFrequency, Max: MaxEQUIFrequency, Default: 2000, Tooltip: "Center frequency of the pass band"},
			{Name: "Width", Label: "Bandwidth", Type: "number", Unit: "Hz", Min: MinEQWidth, Max: MaxEQWidth, Default: 2000, Tooltip: "Width of the frequency band that is allowed to pass"},
			{Name: "Passes", Label: "Slope", Type: "number", Min: 1, Max: MaxEQPasses, Default: 1, Tooltip: "Number of cascaded passes; each pass steepens both skirts"},
		},
		Tooltip: "Band-pass filter allows a range of frequencies to pass while attenuating others.",
	},
	"LowShelf": {
		Parameters: []EqFilterParameter{
			{Name: "Frequency", Label: "Transition Frequency", Type: "number", Unit: "Hz", Min: MinEQFrequency, Max: MaxEQUIFrequency, Default: 200, Tooltip: "Frequency at which the shelf transitions"},
			{Name: "Q", Label: "Q Factor", Type: "number", Min: MinEQQ, Max: MaxEQUIQ, Default: DefaultEQQFactor, Tooltip: "Quality factor that determines the transition slope"},
			{Name: "Gain", Label: "Gain", Type: "number", Unit: "dB", Min: -MaxEQGainDB, Max: MaxEQGainDB, Default: 0, Tooltip: "Boost or cut applied to frequencies below the transition frequency"},
		},
		Tooltip: "Low-shelf filter boosts or cuts frequencies below the transition frequency.",
	},
	"HighShelf": {
		Parameters: []EqFilterParameter{
			{Name: "Frequency", Label: "Transition Frequency", Type: "number", Unit: "Hz", Min: MinEQFrequency, Max: MaxEQUIFrequency, Default: 8000, Tooltip: "Frequency at which the shelf transitions"},
			{Name: "Q", Label: "Q Factor", Type: "number", Min: MinEQQ, Max: MaxEQUIQ, Default: DefaultEQQFactor, Tooltip: "Quality factor that determines the transition slope"},
			{Name: "Gain", Label: "Gain", Type: "number", Unit: "dB", Min: -MaxEQGainDB, Max: MaxEQGainDB, Default: 0, Tooltip: "Boost or cut applied to frequencies above the transition frequency"},
		},
		Tooltip: "High-shelf filter boosts or cuts frequencies above the transition frequency.",
	},
	"Peaking": {
		Parameters: []EqFilterParameter{
			{Name: "Frequency", Label: "Center Frequency", Type: "number", Unit: "Hz", Min: MinEQFrequency, Max: MaxEQUIFrequency, Default: 1000, Tooltip: "Center frequency of the peak or dip"},
			{Name: "Width", Label: "Bandwidth", Type: "number", Unit: "Hz", Min: MinEQWidth, Max: MaxEQWidth, Default: 400, Tooltip: "Width of the peak or dip"},
			{Name: "Gain", Label: "Gain", Type: "number", Unit: "dB", Min: -MaxEQGainDB, Max: MaxEQGainDB, Default: 0, Tooltip: "Boost or cut applied around the center frequency"},
		},
		Tooltip: "Parametric (peaking) filter boosts or cuts a band of frequencies around a center frequency.",
	},
}

// EqFilterTypeConfig defines the configuration for a specific filter type.
type EqFilterTypeConfig struct {
	// Simple marks the types the basic (non-advanced) editor offers.
	Simple     bool `json:"Simple"`
	Parameters []EqFilterParameter
	Tooltip    string
}

// EqFilterParameter defines a single parameter for a filter.
type EqFilterParameter struct {
	Name    string
	Label   string
	Type    string
	Unit    string
	Min     float64
	Max     float64
	Default float64
	Tooltip string
}

// IsKnownEQFilterType reports whether the type name is one the equalizer builds. AllPass is
// built by the audio path but not offered by the UI, so it is accepted here as well.
func IsKnownEQFilterType(name string) bool {
	if name == "AllPass" {
		return true
	}
	_, ok := EqFilterConfig[name]
	return ok
}

// eqFilterUsesWidth reports whether the type takes its bandwidth in Hz (Width) rather than Q.
func eqFilterUsesWidth(name string) bool {
	switch name {
	case "BandPass", "BandReject", "Peaking":
		return true
	default:
		return false
	}
}

// eqFilterUsesGain reports whether the type applies a dB gain.
func eqFilterUsesGain(name string) bool {
	switch name {
	case "LowShelf", "HighShelf", "Peaking":
		return true
	default:
		return false
	}
}
