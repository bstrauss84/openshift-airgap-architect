import { KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import logger from "./logger.js";
import http from "node:http";

const UPLOAD_LABEL = "app.kubernetes.io/managed-by";
const UPLOAD_LABEL_VALUE = "airgap-architect-upload";
const UPLOAD_PORT = 8080;

function getCoreClient() {
  try {
    const kc = new KubeConfig();
    kc.loadFromCluster();
    return kc.makeApiClient(CoreV1Api);
  } catch (error) {
    logger.warn({ error: error.message }, "Failed to load Kubernetes config");
    return null;
  }
}

async function getCurrentNamespace() {
  try {
    const fs = await import("fs/promises");
    const namespace = await fs.readFile("/var/run/secrets/kubernetes.io/serviceaccount/namespace", "utf8");
    return namespace.trim();
  } catch {
    return "mirror-operator-system";
  }
}

export async function createPvc({ name, size, namespace, storageClassName }) {
  const client = getCoreClient();
  if (!client) throw new Error("Kubernetes client not available");

  const ns = namespace || await getCurrentNamespace();

  const pvc = {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name,
      namespace: ns,
      labels: { [UPLOAD_LABEL]: UPLOAD_LABEL_VALUE },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: { requests: { storage: size } },
      ...(storageClassName ? { storageClassName } : {}),
    },
  };

  try {
    const response = await client.createNamespacedPersistentVolumeClaim({ namespace: ns, body: pvc });
    logger.info({ name, namespace: ns, size }, "Created PVC for import");
    return response;
  } catch (error) {
    const is409 = error.code === 409
        || error.statusCode === 409
        || error.message?.includes("409")
        || error.message?.includes("AlreadyExists");
    if (is409) {
      logger.info({ name, namespace: ns }, "PVC already exists, reusing");
      return await client.readNamespacedPersistentVolumeClaim({ name, namespace: ns });
    }
    throw error;
  }
}

export async function listPvcs(namespace) {
  const client = getCoreClient();
  if (!client) throw new Error("Kubernetes client not available");

  const ns = namespace || await getCurrentNamespace();
  const response = await client.listNamespacedPersistentVolumeClaim({ namespace: ns });

  return (response.body?.items || []).map((pvc) => ({
    name: pvc.metadata?.name,
    capacity: pvc.status?.capacity?.storage || pvc.spec?.resources?.requests?.storage || "unknown",
    accessModes: pvc.spec?.accessModes || [],
    phase: pvc.status?.phase || "Unknown",
  }));
}

export async function createUploadPod({ pvcName, namespace }) {
  const client = getCoreClient();
  if (!client) throw new Error("Kubernetes client not available");

  const ns = namespace || await getCurrentNamespace();
  const suffix = `-${Date.now().toString(36)}`;
  const podName = `upload-${pvcName}`.substring(0, 63 - suffix.length) + suffix;
  const serviceName = `upload-${pvcName}`.substring(0, 63 - suffix.length - 4) + suffix + "-svc";

  const uploadImage = process.env.UPLOAD_POD_IMAGE || "registry.access.redhat.com/ubi9/ubi:latest";

  const pod = {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: podName,
      namespace: ns,
      labels: {
        [UPLOAD_LABEL]: UPLOAD_LABEL_VALUE,
        "upload-target": pvcName,
      },
    },
    spec: {
      containers: [
        {
          name: "receiver",
          image: uploadImage,
          command: [
            "python3",
            "-c",
            `
import http.server, os, sys

class UploadHandler(http.server.BaseHTTPRequestHandler):
    def do_PUT(self):
        filename = self.path.lstrip('/')
        if not filename:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'Missing filename')
            return
        dest = os.path.join('/data', filename)
        length = int(self.headers.get('Content-Length', 0))
        written = 0
        with open(dest, 'wb') as f:
            while written < length:
                chunk = self.rfile.read(min(65536, length - written))
                if not chunk:
                    break
                f.write(chunk)
                written += len(chunk)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(f'{{"written":{written}}}'.encode())

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ready')

http.server.HTTPServer(('0.0.0.0', ${UPLOAD_PORT}), UploadHandler).serve_forever()
`,
          ],
          ports: [{ containerPort: UPLOAD_PORT }],
          volumeMounts: [{ name: "import-data", mountPath: "/data" }],
          readinessProbe: {
            httpGet: { path: "/", port: UPLOAD_PORT },
            initialDelaySeconds: 1,
            periodSeconds: 2,
          },
          resources: {
            requests: { cpu: "100m", memory: "64Mi" },
            limits: { cpu: "500m", memory: "256Mi" },
          },
        },
      ],
      volumes: [
        {
          name: "import-data",
          persistentVolumeClaim: { claimName: pvcName },
        },
      ],
      restartPolicy: "Never",
    },
  };

  const service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: serviceName,
      namespace: ns,
      labels: { [UPLOAD_LABEL]: UPLOAD_LABEL_VALUE },
    },
    spec: {
      selector: {
        [UPLOAD_LABEL]: UPLOAD_LABEL_VALUE,
        "upload-target": pvcName,
      },
      ports: [{ port: UPLOAD_PORT, targetPort: UPLOAD_PORT }],
    },
  };

  try {
    await client.createNamespacedPod({ namespace: ns, body: pod });
    logger.info({ podName, namespace: ns, pvcName, image: uploadImage }, "Created upload pod");
  } catch (error) {
    const is409 = error.code === 409 || error.message?.includes("409");
    if (is409) {
      logger.info({ podName, namespace: ns }, "Upload pod already exists, reusing");
    } else {
      throw error;
    }
  }

  try {
    await client.createNamespacedService({ namespace: ns, body: service });
    logger.info({ serviceName, namespace: ns }, "Created upload service");
  } catch (error) {
    const is409 = error.code === 409 || error.message?.includes("409");
    if (is409) {
      logger.info({ serviceName, namespace: ns }, "Upload service already exists, reusing");
    } else {
      throw error;
    }
  }

  return { podName, serviceName, namespace: ns };
}

const DEFAULT_POD_READY_TIMEOUT = parseInt(process.env.UPLOAD_POD_READY_TIMEOUT || "300000", 10);

export async function waitForPodReady({ podName, namespace, timeoutMs = DEFAULT_POD_READY_TIMEOUT }) {
  const client = getCoreClient();
  if (!client) throw new Error("Kubernetes client not available");

  const ns = namespace || await getCurrentNamespace();
  const start = Date.now();
  let lastLoggedState = "";

  while (Date.now() - start < timeoutMs) {
    const response = await client.readNamespacedPod({ name: podName, namespace: ns });
    const phase = response.body?.status?.phase;
    const conditions = response.body?.status?.conditions || [];
    const ready = conditions.find((c) => c.type === "Ready" && c.status === "True");
    if (ready) {
      logger.info({ podName, namespace: ns, elapsed: Date.now() - start }, "Upload pod is ready");
      return true;
    }

    if (phase === "Failed" || phase === "Unknown") {
      const containerStatuses = response.body?.status?.containerStatuses || [];
      const reason = containerStatuses[0]?.state?.terminated?.reason || phase;
      const message = containerStatuses[0]?.state?.terminated?.message || "";
      throw new Error(`Upload pod entered ${phase} phase: ${reason} ${message}`.trim());
    }

    const containerStatuses = response.body?.status?.containerStatuses || [];
    const waitingState = containerStatuses[0]?.state?.waiting;
    const stateKey = `${phase}:${waitingState?.reason || ""}`;
    if (stateKey !== lastLoggedState) {
      lastLoggedState = stateKey;
      const logData = { podName, namespace: ns, phase, elapsed: Date.now() - start };
      if (waitingState) {
        logData.waitingReason = waitingState.reason;
        if (waitingState.message) logData.waitingMessage = waitingState.message;
      }
      logger.info(logData, "Waiting for upload pod");

      if (waitingState?.reason === "ErrImagePull" || waitingState?.reason === "ImagePullBackOff") {
        throw new Error(`Upload pod image pull failed: ${waitingState.reason} - ${waitingState.message || "check that the image is available in your mirror registry"}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const finalResponse = await client.readNamespacedPod({ name: podName, namespace: ns }).catch(() => null);
  const finalPhase = finalResponse?.body?.status?.phase || "unknown";
  const finalWaiting = finalResponse?.body?.status?.containerStatuses?.[0]?.state?.waiting;
  throw new Error(`Upload pod not ready within ${timeoutMs}ms (phase: ${finalPhase}${finalWaiting ? `, reason: ${finalWaiting.reason}` : ""})`);
}

export function streamToUploadPod({ serviceName, namespace, filename, fileStream, contentLength }) {
  return new Promise((resolve, reject) => {
    const url = `http://${serviceName}.${namespace}.svc.cluster.local:${UPLOAD_PORT}/${encodeURIComponent(filename)}`;

    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: "PUT",
      headers: {
        "Content-Length": contentLength,
      },
    };

    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Upload pod returned ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on("error", reject);
    fileStream.pipe(req);
  });
}

export async function deletePvc({ name, namespace }) {
  const client = getCoreClient();
  if (!client) return;

  const ns = namespace || await getCurrentNamespace();

  try {
    await client.deleteNamespacedPersistentVolumeClaim({ name, namespace: ns });
    logger.info({ name, namespace: ns }, "Deleted PVC");
  } catch (error) {
    logger.warn({ name, error: error.message }, "Failed to delete PVC");
  }
}

export async function cleanupUploadPod({ podName, serviceName, namespace }) {
  const client = getCoreClient();
  if (!client) return;

  const ns = namespace || await getCurrentNamespace();

  try {
    await client.deleteNamespacedService({ name: serviceName, namespace: ns });
    logger.info({ serviceName, namespace: ns }, "Deleted upload service");
  } catch (error) {
    logger.warn({ serviceName, error: error.message }, "Failed to delete upload service");
  }

  try {
    await client.deleteNamespacedPod({ name: podName, namespace: ns });
    logger.info({ podName, namespace: ns }, "Deleted upload pod");
  } catch (error) {
    logger.warn({ podName, error: error.message }, "Failed to delete upload pod");
  }
}
