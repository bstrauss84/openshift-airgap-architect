export interface MirrorImport {
  apiVersion?: string;
  kind?: string;
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
  };
  spec?: {
    imageSetConfig?: string;
    bundle?: {
      pvc?: string;
      filename?: string;
    };
    targetRegistry?: {
      url?: string;
    };
    publish?: {
      catalogSource?: boolean;
      imageContentSourcePolicy?: boolean;
    };
    storageSize?: string;
  };
  status?: {
    phase?: string;
    startTime?: string;
    completionTime?: string;
    message?: string;
    jobRef?: string;
  };
}

export interface DeploymentConfig {
  deploymentSide: 'connected' | 'disconnected';
  importPvcMountPath: string;
  targetRegistryDefaults: {
    url: string;
  };
}

export interface ImportPvcFile {
  name: string;
  size: number;
  modified: string;
}

export interface PvcInfo {
  name: string;
  capacity: string;
  accessModes: string[];
  phase: string;
}

export interface CollectionPipeline {
  apiVersion?: string;
  kind?: string;
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
  };
  spec?: {
    imageSetConfig?: string;
    triggerType?: 'manual' | 'scheduled';
    incremental?: boolean;
    baseVersion?: string;
    parentPipeline?: string;
    storage?: {
      output?: {
        pvc?: string;
      };
    };
    storageSize?: string;
  };
  status?: {
    phase: string;
    version?: string;
    startTime?: string;
    completionTime?: string;
    pipelineRunRef?: string;
    configMapRef?: string;
    bundleUrl?: string;
    signatureUrl?: string;
    sbomUrl?: string;
    workingPvcName?: string;
    parentPipelineVersion?: string;
  };
}
