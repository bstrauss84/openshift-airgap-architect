import * as React from 'react';
import type { EncodedCodeRefs } from '@openshift-console/dynamic-plugin-sdk';

// Import pages
import AirgapArchitectPage from './pages/AirgapArchitectPage';
import CreateImageSetPage from './pages/CreateImageSetPage';
import CollectionPipelineDetailPage from './pages/CollectionPipelineDetailPage';
import CreateImportPage from './pages/CreateImportPage';
import MirrorImportDetailPage from './pages/MirrorImportDetailPage';

// Plugin code references
export const pages = {
  AirgapArchitectPage,
  CreateImageSetPage,
  CollectionPipelineDetailPage,
  CreateImportPage,
  MirrorImportDetailPage,
};

// Plugin metadata
export const metadata = {
  name: '@airgap-architect/console-plugin',
  version: '1.0.0',
  displayName: 'Airgap Architect',
  description: 'OpenShift Airgap Architect Console Plugin',
  dependencies: {
    '@console/pluginAPI': '*'
  }
};
