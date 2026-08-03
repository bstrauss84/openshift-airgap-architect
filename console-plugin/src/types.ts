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
