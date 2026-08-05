import * as React from 'react';

export { default as AirgapArchitectPage } from './AirgapArchitectPage';
export { default as CreateImageSetPage } from './CreateImageSetPage';
export { default as CollectionPipelineDetailPage } from './CollectionPipelineDetailPage';

export const CreateImportPage = React.lazy(() => import('./CreateImportPage'));
export const MirrorImportDetailPage = React.lazy(() => import('./MirrorImportDetailPage'));
