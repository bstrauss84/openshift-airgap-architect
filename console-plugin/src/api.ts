/**
 * API Client for Console Plugin
 *
 * Thin wrapper around fetch that points to the backend API service.
 * Compatible with the frontend's apiFetch() interface.
 */

// In production, this should point to the backend service
// In dev, it points to localhost:4000
const API_BASE_URL = process.env.NODE_ENV === 'production'
  ? 'http://airgap-architect-backend.openshift-airgap-architect.svc.cluster.local:4000'
  : 'http://localhost:4000';

export interface ApiFetchOptions extends RequestInit {
  body?: string | FormData | Blob;
}

export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<any> {
  const url = `${API_BASE_URL}${path}`;

  const headers: HeadersInit = {
    ...options.headers,
  };

  // Add Content-Type for JSON if body is a string
  if (typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error (${response.status}): ${errorText}`);
  }

  // Check if response is JSON
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return response.json();
  }

  return response.text();
}
