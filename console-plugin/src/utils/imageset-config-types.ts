export interface PlatformChannel {
  name: string;
  minVersion: string;
  maxVersion: string;
}

export interface OperatorChannel {
  name: string;
  includeConfig?: {
    minVersion?: string;
    maxVersion?: string;
  };
}

export interface OperatorPackage {
  name: string;
  channels?: OperatorChannel[];
}

export interface OperatorCatalog {
  catalog: string;
  packages: OperatorPackage[];
}

export interface ParsedImageSetConfig {
  platformChannels: PlatformChannel[];
  operators: OperatorCatalog[];
  additionalImages: string[];
  graph?: boolean;
  archiveSize?: number;
}
