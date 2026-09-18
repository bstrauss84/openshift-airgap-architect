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

  return (response?.items || []).map((pvc) => ({
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
import http.server, os, sys, json, tarfile

CHUNK_PREFIX = '.chunks-'

def read_body(rfile, length):
    data = b''
    while len(data) < length:
        buf = rfile.read(min(65536, length - len(data)))
        if not buf:
            break
        data += buf
    return data

def write_stream(rfile, dest, length):
    written = 0
    with open(dest, 'wb') as f:
        while written < length:
            buf = rfile.read(min(65536, length - written))
            if not buf:
                break
            f.write(buf)
            written += len(buf)
    return written

def json_response(handler, code, obj):
    body = json.dumps(obj).encode()
    handler.send_response(code)
    handler.send_header('Content-Type', 'application/json')
    handler.send_header('Content-Length', str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)

class UploadHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write('[receiver] ' + (fmt % args) + '\\n')

    def do_PUT(self):
        parts = self.path.strip('/').split('/')
        length = int(self.headers.get('Content-Length', 0))
        if len(parts) == 3 and parts[1] == 'chunk':
            upload_id, ci = parts[0], parts[2]
            chunk_dir = os.path.join('/data', CHUNK_PREFIX + upload_id)
            os.makedirs(chunk_dir, exist_ok=True)
            dest = os.path.join(chunk_dir, 'chunk-' + ci.zfill(6))
            written = write_stream(self.rfile, dest, length)
            json_response(self, 200, {'written': written, 'chunkIndex': int(ci)})
        else:
            filename = self.path.lstrip('/')
            if not filename:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'Missing filename')
                return
            dest = os.path.join('/data', filename)
            written = write_stream(self.rfile, dest, length)
            json_response(self, 200, {'written': written})

    def do_GET(self):
        parts = self.path.strip('/').split('/')
        if len(parts) == 2 and parts[1] == 'chunks-status':
            upload_id = parts[0]
            chunk_dir = os.path.join('/data', CHUNK_PREFIX + upload_id)
            chunks = []
            if os.path.isdir(chunk_dir):
                for f in sorted(os.listdir(chunk_dir)):
                    if f.startswith('chunk-'):
                        idx = int(f.split('-')[1])
                        sz = os.path.getsize(os.path.join(chunk_dir, f))
                        chunks.append({'index': idx, 'size': sz})
            json_response(self, 200, {'uploadId': upload_id, 'chunks': chunks})
        else:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'ready')

    def do_POST(self):
        parts = self.path.strip('/').split('/')
        if len(parts) == 2 and parts[1] == 'assemble':
            upload_id = parts[0]
            cl = int(self.headers.get('Content-Length', 0))
            body = json.loads(read_body(self.rfile, cl)) if cl > 0 else {}
            filename = body.get('filename', 'assembled.tar')
            chunk_dir = os.path.join('/data', CHUNK_PREFIX + upload_id)
            dest = os.path.join('/data', filename)
            if not os.path.isdir(chunk_dir):
                json_response(self, 400, {'error': 'No chunks found'})
                return
            cfiles = sorted([f for f in os.listdir(chunk_dir) if f.startswith('chunk-')])
            written = 0
            with open(dest, 'wb') as out:
                for cf in cfiles:
                    with open(os.path.join(chunk_dir, cf), 'rb') as inp:
                        while True:
                            data = inp.read(65536)
                            if not data:
                                break
                            out.write(data)
                            written += len(data)
            for cf in os.listdir(chunk_dir):
                os.remove(os.path.join(chunk_dir, cf))
            os.rmdir(chunk_dir)
            isc = None
            try:
                with tarfile.open(dest, 'r:*') as tf:
                    for m in tf:
                        if os.path.basename(m.name) == 'imageset-config.yaml' and m.isfile():
                            ef = tf.extractfile(m)
                            if ef:
                                raw = ef.read(1048576)
                                isc = raw.decode('utf-8')
                            break
            except Exception as e:
                sys.stderr.write('[receiver] tarfile extract warning: ' + str(e) + '\\n')
            result = {'written': written, 'filename': filename}
            if isc is not None:
                result['imageSetConfig'] = isc
            json_response(self, 200, result)
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'Not found')

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
    const phase = response?.status?.phase;
    const conditions = response?.status?.conditions || [];
    const ready = conditions.find((c) => c.type === "Ready" && c.status === "True");
    if (ready) {
      logger.info({ podName, namespace: ns, elapsed: Date.now() - start }, "Upload pod is ready");
      return true;
    }

    if (phase === "Failed" || phase === "Unknown") {
      const containerStatuses = response?.status?.containerStatuses || [];
      const reason = containerStatuses[0]?.state?.terminated?.reason || phase;
      const message = containerStatuses[0]?.state?.terminated?.message || "";
      throw new Error(`Upload pod entered ${phase} phase: ${reason} ${message}`.trim());
    }

    const containerStatuses = response?.status?.containerStatuses || [];
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
  const finalPhase = finalResponse?.status?.phase || "unknown";
  const finalWaiting = finalResponse?.status?.containerStatuses?.[0]?.state?.waiting;
  throw new Error(`Upload pod not ready within ${timeoutMs}ms (phase: ${finalPhase}${finalWaiting ? `, reason: ${finalWaiting.reason}` : ""})`);
}

export function streamChunkToUploadPod({ serviceName, namespace, uploadId, chunkIndex, reqStream, contentLength }) {
  return new Promise((resolve, reject) => {
    const url = `http://${serviceName}.${namespace}.svc.cluster.local:${UPLOAD_PORT}/${encodeURIComponent(uploadId)}/chunk/${chunkIndex}`;
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        ...(contentLength ? { "Content-Length": contentLength } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(body)); } catch { resolve({ written: 0 }); }
        } else {
          reject(new Error(`Upload pod chunk PUT returned ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on("error", reject);
    reqStream.pipe(req);
  });
}

export function getChunksStatus({ serviceName, namespace, uploadId }) {
  return new Promise((resolve, reject) => {
    const url = `http://${serviceName}.${namespace}.svc.cluster.local:${UPLOAD_PORT}/${encodeURIComponent(uploadId)}/chunks-status`;
    const parsed = new URL(url);

    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: "GET",
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(body)); } catch { resolve({ chunks: [] }); }
        } else {
          reject(new Error(`Upload pod chunks-status returned ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

const ASSEMBLY_TIMEOUT_MS = 30 * 60 * 1000;

export function triggerAssembly({ serviceName, namespace, uploadId, filename }) {
  return new Promise((resolve, reject) => {
    const url = `http://${serviceName}.${namespace}.svc.cluster.local:${UPLOAD_PORT}/${encodeURIComponent(uploadId)}/assemble`;
    const parsed = new URL(url);
    const postBody = JSON.stringify({ filename });

    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postBody),
      },
      timeout: ASSEMBLY_TIMEOUT_MS,
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(body)); } catch { resolve({ written: 0 }); }
        } else {
          reject(new Error(`Upload pod assembly returned ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Assembly request timed out"));
    });
    req.on("error", reject);
    req.write(postBody);
    req.end();
  });
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
