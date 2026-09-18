import * as React from 'react';
import { apiFetch } from '../api';
import { DeploymentConfig } from '../types';

let cachedConfig: DeploymentConfig | null = null;

export function useDeploymentConfig(): {
  config: DeploymentConfig | null;
  loading: boolean;
  error: string | null;
} {
  const [config, setConfig] = React.useState<DeploymentConfig | null>(cachedConfig);
  const [loading, setLoading] = React.useState(!cachedConfig);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (cachedConfig) return;

    let cancelled = false;

    const fetchConfig = async () => {
      try {
        const data = await apiFetch('/api/mirror-import/config');
        if (!cancelled) {
          cachedConfig = data;
          setConfig(data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to fetch deployment config');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchConfig();
    return () => { cancelled = true; };
  }, []);

  return { config, loading, error };
}
