import * as yaml from 'js-yaml';
import {
  ParsedImageSetConfig,
  PlatformChannel,
  OperatorCatalog,
  OperatorPackage,
  OperatorChannel,
} from './imageset-config-types';

const EMPTY_CONFIG: ParsedImageSetConfig = {
  platformChannels: [],
  operators: [],
  additionalImages: [],
};

export function parseImageSetConfigYaml(yamlString: string): ParsedImageSetConfig {
  try {
    const doc = yaml.load(yamlString) as any;
    if (!doc?.mirror) return { ...EMPTY_CONFIG };

    const mirror = doc.mirror;

    const platformChannels: PlatformChannel[] = (mirror.platform?.channels || []).map(
      (ch: any) => ({
        name: ch.name || '',
        minVersion: ch.minVersion || '',
        maxVersion: ch.maxVersion || '',
      })
    );

    const operators: OperatorCatalog[] = (mirror.operators || []).map((op: any) => ({
      catalog: op.catalog || '',
      packages: (op.packages || []).map((pkg: any): OperatorPackage => ({
        name: pkg.name || '',
        channels: (pkg.channels || []).map((ch: any): OperatorChannel => ({
          name: ch.name || '',
          ...(ch.includeConfig ? { includeConfig: ch.includeConfig } : {}),
        })),
      })),
    }));

    const additionalImages: string[] = (mirror.additionalImages || [])
      .map((img: any) => img.name || '')
      .filter(Boolean);

    return {
      platformChannels,
      operators,
      additionalImages,
      graph: mirror.platform?.graph,
      archiveSize: doc.archiveSize,
    };
  } catch (err) {
    console.error('Failed to parse ImageSetConfig YAML:', err);
    return { ...EMPTY_CONFIG };
  }
}
