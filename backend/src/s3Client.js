/**
 * OpenShift Airgap Architect - S3 Client for Pre-signed URLs
 *
 * Provides S3 client initialization and pre-signed URL generation
 * for downloading collection artifacts from S3-compatible storage.
 * Reads credentials from Kubernetes secrets in operator-managed mode.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import logger from "./logger.js";

/**
 * Initialize Kubernetes client from in-cluster config
 * @returns {CoreV1Api|null} Kubernetes core API client or null if not in cluster
 */
function getKubernetesClient() {
  try {
    const kc = new KubeConfig();
    kc.loadFromCluster();
    return kc.makeApiClient(CoreV1Api);
  } catch (error) {
    logger.warn({ error: error.message }, "Failed to load Kubernetes config - not running in cluster");
    return null;
  }
}

/**
 * Get the current namespace from service account mount
 * @returns {Promise<string>} Current namespace
 */
async function getCurrentNamespace() {
  try {
    const fs = await import("fs/promises");
    const namespace = await fs.readFile("/var/run/secrets/kubernetes.io/serviceaccount/namespace", "utf8");
    return namespace.trim();
  } catch (error) {
    logger.warn({ error: error.message }, "Failed to read namespace from service account, using default");
    return "default";
  }
}

/**
 * Read S3 credentials from Kubernetes secret
 * @param {string} secretName - Name of the secret containing S3 credentials
 * @param {string} [namespace] - Namespace (defaults to current namespace)
 * @returns {Promise<object>} S3 credentials object
 * @throws {Error} If secret not found or required fields missing
 */
export async function readS3Credentials(secretName, namespace) {
  const client = getKubernetesClient();
  if (!client) {
    throw new Error("Kubernetes client not available - not running in cluster");
  }

  const ns = namespace || await getCurrentNamespace();

  try {
    const response = await client.readNamespacedSecret(secretName, ns);
    const secret = response.body;

    if (!secret.data) {
      throw new Error(`Secret ${secretName} has no data field`);
    }

    // Decode base64-encoded secret data
    const credentials = {
      accessKeyId: secret.data.AWS_ACCESS_KEY_ID
        ? Buffer.from(secret.data.AWS_ACCESS_KEY_ID, 'base64').toString('utf8')
        : undefined,
      secretAccessKey: secret.data.AWS_SECRET_ACCESS_KEY
        ? Buffer.from(secret.data.AWS_SECRET_ACCESS_KEY, 'base64').toString('utf8')
        : undefined,
      region: secret.data.AWS_REGION
        ? Buffer.from(secret.data.AWS_REGION, 'base64').toString('utf8')
        : 'us-east-1',
      endpoint: secret.data.S3_ENDPOINT
        ? Buffer.from(secret.data.S3_ENDPOINT, 'base64').toString('utf8')
        : undefined,
      bucket: secret.data.S3_BUCKET
        ? Buffer.from(secret.data.S3_BUCKET, 'base64').toString('utf8')
        : undefined
    };

    // Validate required fields
    if (!credentials.accessKeyId || !credentials.secretAccessKey) {
      throw new Error(`Secret ${secretName} missing required fields: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY`);
    }

    if (!credentials.bucket) {
      throw new Error(`Secret ${secretName} missing required field: S3_BUCKET`);
    }

    logger.info({
      secretName,
      namespace: ns,
      hasEndpoint: !!credentials.endpoint,
      bucket: credentials.bucket,
      region: credentials.region
    }, "Successfully read S3 credentials from secret");

    return credentials;
  } catch (error) {
    if (error.response?.statusCode === 404) {
      throw new Error(`Secret ${secretName} not found in namespace ${ns}`);
    }

    logger.error({
      secretName,
      namespace: ns,
      error: error.message
    }, "Failed to read S3 credentials from secret");

    throw error;
  }
}

/**
 * Create S3 client from credentials
 * @param {object} credentials - S3 credentials object
 * @returns {S3Client} Configured S3 client
 */
export function createS3Client(credentials) {
  const clientConfig = {
    region: credentials.region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey
    }
  };

  // Add custom endpoint for S3-compatible storage (MinIO, etc.)
  if (credentials.endpoint) {
    clientConfig.endpoint = credentials.endpoint;
    clientConfig.forcePathStyle = true; // Required for MinIO and some S3-compatible services
  }

  return new S3Client(clientConfig);
}

/**
 * Generate pre-signed URL for downloading an object from S3
 * @param {object} options - Options for URL generation
 * @param {string} options.bucket - S3 bucket name
 * @param {string} options.key - Object key (path) in S3
 * @param {S3Client} options.client - Configured S3 client
 * @param {number} [options.expiresIn=3600] - URL expiration in seconds (default: 1 hour)
 * @returns {Promise<string>} Pre-signed download URL
 */
export async function generatePresignedUrl({ bucket, key, client, expiresIn = 3600 }) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key
  });

  try {
    const url = await getSignedUrl(client, command, { expiresIn });

    logger.info({
      bucket,
      key,
      expiresIn
    }, "Generated pre-signed URL");

    return url;
  } catch (error) {
    logger.error({
      bucket,
      key,
      error: error.message
    }, "Failed to generate pre-signed URL");

    throw new Error(`Failed to generate pre-signed URL: ${error.message}`);
  }
}

/**
 * Generate pre-signed URLs for all artifacts in a collection
 * @param {object} options - Options for URL generation
 * @param {string} options.collectionName - Name of the collection
 * @param {string} [options.secretName] - Name of the secret containing S3 credentials (defaults to env var S3_SECRET_NAME or 'collection-artifacts')
 * @param {string} [options.namespace] - Namespace (defaults to current namespace)
 * @param {number} [options.expiresIn=3600] - URL expiration in seconds (default: 1 hour)
 * @returns {Promise<object>} Object containing pre-signed URLs for each artifact
 */
export async function generateCollectionDownloadUrls({
  collectionName,
  secretName,
  namespace,
  expiresIn = 3600
}) {
  // Determine secret name: parameter > env var > default
  const effectiveSecretName = secretName || process.env.S3_SECRET_NAME || 'collection-artifacts';

  logger.info({
    collectionName,
    secretName: effectiveSecretName,
    secretNameSource: secretName ? 'parameter' : (process.env.S3_SECRET_NAME ? 'environment' : 'default')
  }, "Generating collection download URLs");

  // Read S3 credentials from secret
  const credentials = await readS3Credentials(effectiveSecretName, namespace);

  // Create S3 client
  const s3Client = createS3Client(credentials);

  // Generate pre-signed URLs for common artifact files
  // Adjust paths based on your actual S3 structure
  const artifacts = [
    `${collectionName}/mirror_seq1_000000.tar`,
    `${collectionName}/imageset-config.yaml`,
    `${collectionName}/publish/imageContentSourcePolicy.yaml`,
    `${collectionName}/publish/catalogSource.yaml`,
    `${collectionName}/publish/release-signatures.json`
  ];

  const urls = {};

  for (const artifactPath of artifacts) {
    try {
      const url = await generatePresignedUrl({
        bucket: credentials.bucket,
        key: artifactPath,
        client: s3Client,
        expiresIn
      });

      // Store URL with a friendly name
      const fileName = artifactPath.split('/').pop();
      urls[fileName] = url;
    } catch (error) {
      // Log error but continue processing other artifacts
      logger.warn({
        collectionName,
        artifactPath,
        error: error.message
      }, "Failed to generate URL for artifact (may not exist)");
    }
  }

  return urls;
}
