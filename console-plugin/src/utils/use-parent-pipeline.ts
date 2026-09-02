import * as React from 'react';
import { ParsedImageSetConfig } from './imageset-config-types';
import { parseImageSetConfigYaml } from './parse-imageset-config';

interface UseParentPipelineResult {
  parentConfig: ParsedImageSetConfig | null;
  loading: boolean;
  error: string | null;
}

const NAMESPACE = 'mirror-operator-system';

export function useParentPipeline(parentPipelineName: string | null): UseParentPipelineResult {
  const [parentConfig, setParentConfig] = React.useState<ParsedImageSetConfig | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!parentPipelineName) {
      setParentConfig(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(
      `/api/kubernetes/apis/mirror.mirror.mathianasj.github.com/v1/namespaces/${NAMESPACE}/collectionpipelines/${parentPipelineName}`
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch parent pipeline: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        const yamlString = data.spec?.imageSetConfig || '';
        const config = parseImageSetConfigYaml(yamlString);
        setParentConfig(config);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Failed to load parent pipeline configuration');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [parentPipelineName]);

  return { parentConfig, loading, error };
}
