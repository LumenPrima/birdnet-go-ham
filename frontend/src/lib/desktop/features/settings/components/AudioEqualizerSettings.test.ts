import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/svelte';
import AudioEqualizerSettings from './AudioEqualizerSettings.svelte';

// Mock dependencies
// Common mocks are now handled globally in src/test/setup.ts
// ($lib/i18n, $lib/utils/security, $lib/utils/logger)

// Mock appState for CSRF token
vi.mock('$lib/stores/appState.svelte', () => ({
  appState: {
    csrfToken: 'mock-csrf-token',
    initialized: true,
    loading: false,
    error: null,
    retryCount: 0,
    version: 'test',
    security: {
      enabled: false,
      accessAllowed: true,
      authConfig: {
        basicEnabled: false,
        googleEnabled: false,
        githubEnabled: false,
        microsoftEnabled: false,
      },
    },
  },
  getCsrfToken: vi.fn().mockReturnValue('mock-csrf-token'),
  isSentryEnabled: () => false,
  refreshCsrfToken: vi.fn().mockResolvedValue(false),
  initApp: vi.fn().mockResolvedValue(true),
}));

// Mock FilterResponseGraph to avoid canvas issues
vi.mock('./FilterResponseGraph.svelte', () => {
  return {
    default: vi.fn(() => ({
      $set: vi.fn(),
      $destroy: vi.fn(),
      $on: vi.fn(),
    })),
  };
});

// Mock the icon components to avoid SVG import issues in tests
vi.mock('$lib/desktop/components/ui/LowPassIcon.svelte', () => ({
  default: vi.fn(() => ({ $set: vi.fn(), $destroy: vi.fn(), $on: vi.fn() })),
}));
vi.mock('$lib/desktop/components/ui/HighPassIcon.svelte', () => ({
  default: vi.fn(() => ({ $set: vi.fn(), $destroy: vi.fn(), $on: vi.fn() })),
}));
vi.mock('$lib/desktop/components/ui/BandRejectIcon.svelte', () => ({
  default: vi.fn(() => ({ $set: vi.fn(), $destroy: vi.fn(), $on: vi.fn() })),
}));

describe('AudioEqualizerSettings', () => {
  const mockUpdateCallback = vi.fn();

  const defaultEqualizerSettings = {
    enabled: true,
    filters: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock fetch for filter config API
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false, // Force fallback config usage
        json: () => Promise.resolve({}),
      } as unknown as Response)
    ) as typeof global.fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should render with empty filters initially', async () => {
    render(AudioEqualizerSettings, {
      props: {
        equalizerSettings: defaultEqualizerSettings,
        disabled: false,
        onUpdate: mockUpdateCallback,
      },
    });

    await waitFor(() => {
      expect(screen.getByText('settings.audio.audioFilters.enableEqualizer')).toBeInTheDocument();
    });

    // Should show "New Filter Type" label for the dropdown
    expect(screen.getByText('settings.audio.audioFilters.newFilterType')).toBeInTheDocument();
  });

  it('should display existing HighPass filter', async () => {
    const existingFilter = {
      type: 'HighPass' as const,
      frequency: 100,
      passes: 2, // 24dB attenuation
      q: 0.707,
    };

    render(AudioEqualizerSettings, {
      props: {
        equalizerSettings: {
          enabled: true,
          filters: [existingFilter],
        },
        disabled: false,
        onUpdate: mockUpdateCallback,
      },
    });

    // Wait for component to load
    await waitFor(() => {
      // The filter type button shows the filter type name
      expect(screen.getByText('HighPass')).toBeInTheDocument();
    });
  });

  it('should render Add Filter button disabled when no filter type selected', async () => {
    render(AudioEqualizerSettings, {
      props: {
        equalizerSettings: defaultEqualizerSettings,
        disabled: false,
        onUpdate: mockUpdateCallback,
      },
    });

    await waitFor(() => {
      expect(screen.getByText('settings.audio.audioFilters.newFilterType')).toBeInTheDocument();
    });

    // Add Filter button should be disabled when no filter type is selected
    const addButton = screen.getByText('settings.audio.audioFilters.addFilter');
    expect(addButton).toBeDisabled();
  });

  it('should render the enable equalizer checkbox', async () => {
    const { container } = render(AudioEqualizerSettings, {
      props: {
        equalizerSettings: defaultEqualizerSettings,
        disabled: false,
        onUpdate: mockUpdateCallback,
      },
    });

    await waitFor(() => {
      expect(screen.getByText('settings.audio.audioFilters.enableEqualizer')).toBeInTheDocument();
    });

    // Find the checkbox input via container query
    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
    expect(checkbox).toBeChecked();
  });

  it('should render disabled state correctly', async () => {
    render(AudioEqualizerSettings, {
      props: {
        equalizerSettings: defaultEqualizerSettings,
        disabled: true,
        onUpdate: mockUpdateCallback,
      },
    });

    await waitFor(() => {
      expect(screen.getByText('settings.audio.audioFilters.enableEqualizer')).toBeInTheDocument();
    });

    // Add Filter button should be disabled when component is disabled
    const addButton = screen.getByText('settings.audio.audioFilters.addFilter');
    expect(addButton).toBeDisabled();
  });
});

describe('AudioEqualizerSettings advanced gating', () => {
  const twoTypeConfig = {
    LowPass: {
      Simple: true,
      Parameters: [
        {
          Name: 'Frequency',
          Label: 'Cutoff Frequency',
          Type: 'number',
          Unit: 'Hz',
          Min: 20,
          Max: 20000,
          Default: 15000,
        },
      ],
    },
    Peaking: {
      Parameters: [
        {
          Name: 'Frequency',
          Label: 'Center Frequency',
          Type: 'number',
          Unit: 'Hz',
          Min: 20,
          Max: 20000,
          Default: 1000,
        },
        { Name: 'Gain', Label: 'Gain', Type: 'number', Unit: 'dB', Min: -30, Max: 30, Default: 0 },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(twoTypeConfig),
      } as unknown as Response)
    ) as typeof global.fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function offeredTypes(advanced: boolean): Promise<string[]> {
    render(AudioEqualizerSettings, {
      props: {
        equalizerSettings: { enabled: true, filters: [] },
        disabled: false,
        advanced,
        onUpdate: vi.fn(),
      },
    });
    await waitFor(() => {
      expect(screen.getByText('settings.audio.audioFilters.newFilterType')).toBeInTheDocument();
    });
    const trigger = screen.getByRole('button', { expanded: false });
    trigger.click();
    await waitFor(() => {
      expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    });
    return screen.getAllByRole('option').map(o => o.textContent?.trim() ?? '');
  }

  it('offers only the basic filter types when advanced is off', async () => {
    const types = await offeredTypes(false);
    expect(types).toContain('LowPass');
    expect(types).not.toContain('Peaking');
  });

  it('offers every filter type when advanced is on', async () => {
    const types = await offeredTypes(true);
    expect(types).toContain('LowPass');
    expect(types).toContain('Peaking');
  });
});
