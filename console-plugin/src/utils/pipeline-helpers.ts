import { CollectionPipeline } from '../types';

export function generateChildName(parentName: string): string {
  return `${parentName}-update-${Date.now()}`;
}

export function isDeltaCollection(pipeline: CollectionPipeline): boolean {
  return !!pipeline.spec?.parentPipeline;
}

export function getCsrfToken(): string | undefined {
  const csrfCookie = document.cookie
    .split('; ')
    .find(row => row.startsWith('csrf-token='));

  return csrfCookie
    ? decodeURIComponent(csrfCookie.split('=')[1])
    : undefined;
}
