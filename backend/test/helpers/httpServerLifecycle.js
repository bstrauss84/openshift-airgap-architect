import http from "node:http";

export function createTestServer(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const port = server.address().port;
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// closeAllConnections is necessary because undici's client-side keep-alive
// sockets survive closeIdleConnections; only closeAllConnections sends RST
// to force the client pool to release them.
export function closeTestServer(server) {
  return new Promise((resolve, reject) => {
    if (!server || !server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });

    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    } else if (typeof server.closeIdleConnections === "function") {
      server.closeIdleConnections();
    }
  });
}
