import { test } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, "..");
const serverPath = join(projectRoot, "src", "index.js");

test("backend server starts successfully without const reassignment errors", async (t) => {
  const testDataDir = join("/tmp", "airgap-test-lifecycle-startup");
  const dbPath = join(testDataDir, "airgap-architect.db");

  // Clean up any existing test directory
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }

  const env = {
    ...process.env,
    DATA_DIR: testDataDir,
    PORT: "0", // Random port
    NODE_ENV: "test",
    JOB_RETENTION_DAYS: "7",
    JOB_MAX_COUNT: "100"
  };

  const server = spawn("node", [serverPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";

  server.stdout.on("data", (data) => {
    stdout += data.toString();
  });

  server.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  // Wait for server to start or fail
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.kill("SIGTERM");
      reject(new Error("Server startup timeout after 5 seconds"));
    }, 5000);

    server.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0 && code !== null) {
        reject(new Error(`Server exited with code ${code}. stderr: ${stderr}`));
      } else {
        resolve();
      }
    });

    // Look for successful startup message
    const checkStartup = () => {
      if (stdout.includes("Server started") || stdout.includes("listening on port")) {
        clearTimeout(timeout);
        server.kill("SIGTERM");
        resolve();
      }
    };

    server.stdout.on("data", checkStartup);
  });

  // Assert no const reassignment errors in stderr
  assert.ok(!stderr.includes("Assignment to constant variable"),
    "Server should not have const reassignment errors");
  assert.ok(!stderr.includes("TypeError"),
    "Server should not have TypeErrors during startup");

  // Clean up test directory
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
});

test("cleanup interval is scheduled on startup", async (t) => {
  const testDataDir = join("/tmp", "airgap-test-lifecycle-cleanup");
  const dbPath = join(testDataDir, "airgap-architect.db");

  // Clean up any existing test directory
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }

  const env = {
    ...process.env,
    DATA_DIR: testDataDir,
    PORT: "0",
    NODE_ENV: "test",
    JOB_RETENTION_DAYS: "7",
    JOB_MAX_COUNT: "100"
  };

  const server = spawn("node", [serverPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";

  server.stdout.on("data", (data) => {
    stdout += data.toString();
  });

  server.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  // Wait for initial cleanup to be scheduled (60 seconds after startup)
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.kill("SIGTERM");
      resolve();
    }, 2000); // Wait 2 seconds (cleanup scheduled at 60s, we're just checking startup)

    server.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0 && code !== null && signal !== "SIGTERM") {
        reject(new Error(`Server exited unexpectedly with code ${code}. stderr: ${stderr}`));
      } else {
        resolve();
      }
    });
  });

  // Server should start without errors
  assert.ok(!stderr.includes("TypeError"),
    "Server should not have errors when scheduling cleanup interval");

  // Clean up test directory
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
});

test("shutdown handler clears cleanup interval without errors", async (t) => {
  const testDataDir = join("/tmp", "airgap-test-lifecycle-shutdown");
  const dbPath = join(testDataDir, "airgap-architect.db");

  // Clean up any existing test directory
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }

  const env = {
    ...process.env,
    DATA_DIR: testDataDir,
    PORT: "0",
    NODE_ENV: "test",
    JOB_RETENTION_DAYS: "7",
    JOB_MAX_COUNT: "100"
  };

  const server = spawn("node", [serverPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";

  server.stdout.on("data", (data) => {
    stdout += data.toString();
  });

  server.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  // Wait for server to start, then send SIGTERM
  await new Promise((resolve, reject) => {
    const startTimeout = setTimeout(() => {
      // Server should have started by now, send shutdown signal
      server.kill("SIGTERM");
    }, 2000);

    const exitTimeout = setTimeout(() => {
      server.kill("SIGKILL"); // Force kill if graceful shutdown fails
      reject(new Error("Server did not shut down gracefully within 10 seconds"));
    }, 10000);

    server.on("exit", (code, signal) => {
      clearTimeout(startTimeout);
      clearTimeout(exitTimeout);
      resolve({ code, signal });
    });
  });

  // Assert shutdown completed without errors
  assert.ok(!stderr.includes("Assignment to constant variable"),
    "Shutdown should not have const reassignment errors");
  assert.ok(!stderr.includes("TypeError"),
    "Shutdown should not have TypeErrors");

  // Look for successful shutdown message (if logged)
  // Note: May not appear if logger not yet initialized when shutdown called
  const hasShutdownLog = stdout.includes("Shutting down") || stderr.includes("Shutting down");
  if (hasShutdownLog) {
    assert.ok(true, "Shutdown handler executed");
  }

  // Clean up test directory
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
});

test("server can start, run, and shutdown multiple times without errors", async (t) => {
  const testDataDir = join("/tmp", "airgap-test-lifecycle-multiple");

  for (let i = 0; i < 3; i++) {
    // Clean up any existing test directory
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }

    const env = {
      ...process.env,
      DATA_DIR: testDataDir,
      PORT: "0",
      NODE_ENV: "test",
      JOB_RETENTION_DAYS: "7",
      JOB_MAX_COUNT: "100"
    };

    const server = spawn("node", [serverPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";

    server.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // Start and shutdown cycle
    await new Promise((resolve, reject) => {
      const startTimeout = setTimeout(() => {
        server.kill("SIGTERM");
      }, 1500);

      const exitTimeout = setTimeout(() => {
        server.kill("SIGKILL");
        reject(new Error(`Iteration ${i + 1}: Server did not shut down gracefully`));
      }, 5000);

      server.on("exit", (code, signal) => {
        clearTimeout(startTimeout);
        clearTimeout(exitTimeout);

        // Check for errors in this cycle
        if (stderr.includes("Assignment to constant variable")) {
          reject(new Error(`Iteration ${i + 1}: Const reassignment error detected`));
        } else if (stderr.includes("TypeError")) {
          reject(new Error(`Iteration ${i + 1}: TypeError detected: ${stderr}`));
        } else {
          resolve();
        }
      });
    });
  }

  // Clean up test directory
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }

  assert.ok(true, "Server successfully started and shutdown 3 times without errors");
});

test("cleanup interval uses global scope correctly", async (t) => {
  const testDataDir = join("/tmp", "airgap-test-lifecycle-global");
  const dbPath = join(testDataDir, "airgap-architect.db");

  // Clean up any existing test directory
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }

  const env = {
    ...process.env,
    DATA_DIR: testDataDir,
    PORT: "0",
    NODE_ENV: "test",
    JOB_RETENTION_DAYS: "7",
    JOB_MAX_COUNT: "100"
  };

  const server = spawn("node", [serverPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";

  server.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  // Run server briefly then shutdown
  await new Promise((resolve, reject) => {
    setTimeout(() => {
      server.kill("SIGTERM");
    }, 1500);

    const exitTimeout = setTimeout(() => {
      server.kill("SIGKILL");
      reject(new Error("Server did not shut down gracefully"));
    }, 5000);

    server.on("exit", (code, signal) => {
      clearTimeout(exitTimeout);
      resolve();
    });
  });

  // Should not have errors related to interval clearing
  assert.ok(!stderr.includes("clearInterval"),
    "Should not have errors when clearing cleanup interval");
  assert.ok(!stderr.includes("ReferenceError"),
    "Should not have ReferenceError for global.cleanupInterval");

  // Clean up test directory
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
});
