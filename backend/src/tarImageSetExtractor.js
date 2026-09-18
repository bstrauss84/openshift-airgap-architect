import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import tar from "tar-stream";
import logger from "./logger.js";

const MAX_YAML_SIZE = 1024 * 1024; // 1MB cap

export async function extractImageSetConfigFromTar(tarPath, targetName = "imageset-config.yaml") {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(tarPath);
    const extract = tar.extract();
    let found = false;

    extract.on("entry", (header, stream, next) => {
      const basename = path.basename(header.name);
      if (!found && basename === targetName && header.type === "file") {
        found = true;
        const chunks = [];
        let size = 0;

        stream.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_YAML_SIZE) {
            stream.destroy(new Error(`${targetName} exceeds ${MAX_YAML_SIZE} bytes`));
            return;
          }
          chunks.push(chunk);
        });

        stream.on("end", () => {
          const content = Buffer.concat(chunks).toString("utf8");
          logger.info({ tarPath: path.basename(tarPath), entryPath: header.name, bytes: size }, "Extracted imageset-config from tar");
          readStream.destroy();
          resolve(content);
        });

        stream.on("error", (err) => {
          readStream.destroy();
          reject(err);
        });
      } else {
        stream.on("end", next);
        stream.resume();
      }
    });

    extract.on("finish", () => {
      if (!found) {
        logger.warn({ tarPath: path.basename(tarPath) }, "imageset-config.yaml not found in tar");
        resolve(null);
      }
    });

    extract.on("error", (err) => {
      if (found && (err.code === "ERR_STREAM_PREMATURE_CLOSE" || err.message?.includes("premature"))) {
        return;
      }
      reject(err);
    });

    readStream.on("error", (err) => {
      if (found) return;
      reject(err);
    });

    const ext = tarPath.toLowerCase();
    if (ext.endsWith(".tar.gz") || ext.endsWith(".tgz")) {
      const gunzip = zlib.createGunzip();
      gunzip.on("error", (err) => {
        if (found) return;
        reject(err);
      });
      readStream.pipe(gunzip).pipe(extract);
    } else {
      readStream.pipe(extract);
    }
  });
}
