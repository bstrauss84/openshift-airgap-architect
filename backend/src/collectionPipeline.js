/**
 * OpenShift Airgap Architect - CollectionPipeline CR Management
 *
 * Creates CollectionPipeline custom resources for the mirror-operator.
 * Only available when running in operator-managed mode on OpenShift.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { KubeConfig, CustomObjectsApi } from "@kubernetes/client-node";
import logger from "./logger.js";

const GROUP = "mirror.mirror.mathianasj.github.com";
const VERSION = "v1";
const PLURAL = "collectionpipelines";

/**
 * Initialize Kubernetes client from in-cluster config
 * @returns {CustomObjectsApi|null} Kubernetes custom objects API client or null if not in cluster
 */
function getKubernetesClient() {
  try {
    const kc = new KubeConfig();
    kc.loadFromCluster();
    return kc.makeApiClient(CustomObjectsApi);
  } catch (error) {
    logger.warn({ error: error.message }, "Failed to load Kubernetes config - not running in cluster");
    return null;
  }
}

/**
 * Create a CollectionPipeline custom resource
 * @param {object} options - Creation options
 * @param {string} options.name - Name of the CollectionPipeline
 * @param {string} options.imageSetConfig - imageset-config.yaml content
 * @param {string} options.pvc - PVC name for storage output
 * @param {string} [options.triggerType='manual'] - Trigger type (manual, event, scheduled)
 * @param {string} [options.namespace] - Namespace (defaults to current namespace)
 * @returns {Promise<object>} Created CollectionPipeline CR
 */
export async function createCollectionPipeline({
  name,
  imageSetConfig,
  pvc,
  triggerType = "manual",
  namespace
}) {
  const client = getKubernetesClient();
  if (!client) {
    throw new Error("Kubernetes client not available - not running in cluster");
  }

  // Get current namespace from service account
  const ns = namespace || await getCurrentNamespace();

  const collectionPipeline = {
    apiVersion: `${GROUP}/${VERSION}`,
    kind: "CollectionPipeline",
    metadata: {
      name,
      labels: {
        "app.kubernetes.io/created-by": "openshift-airgap-architect",
        "app.kubernetes.io/managed-by": "airgap-architect"
      }
    },
    spec: {
      triggerType,
      imageSetConfig,
      storage: {
        output: {
          pvc
        }
      }
    }
  };

  logger.info({
    name,
    namespace: ns,
    pvc,
    triggerType,
    group: GROUP,
    version: VERSION,
    plural: PLURAL
  }, "Creating CollectionPipeline CR");

  try {
    logger.debug({
      params: {
        group: GROUP,
        version: VERSION,
        namespace: ns,
        plural: PLURAL,
        body: collectionPipeline
      }
    }, "Calling createNamespacedCustomObject with parameters");

    // Note: @kubernetes/client-node v1.4.0+ requires parameters as object
    const response = await client.createNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: ns,
      plural: PLURAL,
      body: collectionPipeline
    });

    logger.info({
      name,
      namespace: ns,
      uid: response.body?.metadata?.uid
    }, "CollectionPipeline CR created successfully");

    return response.body;
  } catch (error) {
    logger.error({
      name,
      namespace: ns,
      error: error.message,
      errorStack: error.stack,
      statusCode: error.response?.statusCode,
      responseBody: error.response?.body
    }, "Failed to create CollectionPipeline CR");

    throw new Error(`Failed to create CollectionPipeline: ${error.body?.message || error.message}`);
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
 * List CollectionPipeline CRs in the current namespace
 * @param {string} [namespace] - Namespace to list from
 * @returns {Promise<object[]>} List of CollectionPipeline CRs
 */
export async function listCollectionPipelines(namespace) {
  const client = getKubernetesClient();
  if (!client) {
    throw new Error("Kubernetes client not available - not running in cluster");
  }

  const ns = namespace || await getCurrentNamespace();

  try {
    const response = await client.listNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: ns,
      plural: PLURAL
    });

    return response.body?.items || [];
  } catch (error) {
    logger.error({
      namespace: ns,
      error: error.message
    }, "Failed to list CollectionPipelines");

    throw new Error(`Failed to list CollectionPipelines: ${error.body?.message || error.message}`);
  }
}

/**
 * Get a specific CollectionPipeline CR
 * @param {string} name - CollectionPipeline name
 * @param {string} [namespace] - Namespace
 * @returns {Promise<object>} CollectionPipeline CR
 */
export async function getCollectionPipeline(name, namespace) {
  const client = getKubernetesClient();
  if (!client) {
    throw new Error("Kubernetes client not available - not running in cluster");
  }

  const ns = namespace || await getCurrentNamespace();

  try {
    const response = await client.getNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: ns,
      plural: PLURAL,
      name
    });

    return response.body;
  } catch (error) {
    if (error.response?.statusCode === 404) {
      return null;
    }

    logger.error({
      name,
      namespace: ns,
      error: error.message
    }, "Failed to get CollectionPipeline");

    throw new Error(`Failed to get CollectionPipeline: ${error.body?.message || error.message}`);
  }
}
