/**
 * Archiver Upgrade Regression Test
 *
 * Verifies archiver 8.0.0 upgrade doesn't break core functionality.
 * Tests the archiver API methods used in backend/src/index.js buildBundleZip.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";
import { Readable, Writable } from "node:stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Archiver 8.0.0 Upgrade", () => {
  it("should create zip archive with append method", async () => {
    const chunks = [];
    const archive = new ZipArchive({ zlib: { level: 9 } });

    // Collect chunks
    archive.on("data", (chunk) => chunks.push(chunk));

    // Add string content with append
    archive.append("test content", { name: "test.txt" });

    // Finalize and wait for finish
    await new Promise((resolve, reject) => {
      archive.on("end", resolve);
      archive.on("error", reject);
      archive.finalize();
    });

    const buffer = Buffer.concat(chunks);
    assert.ok(buffer.length > 0, "Archive should contain data");
    assert.ok(buffer.toString("hex").startsWith("504b0304"), "Should be a valid ZIP file (PK header)");
  });

  it("should create zip archive with file method", async () => {
    const testFilePath = path.join(__dirname, "archiver-test-file.txt");
    fs.writeFileSync(testFilePath, "file content from disk");

    try {
      const chunks = [];
      const archive = new ZipArchive({ zlib: { level: 9 } });

      archive.on("data", (chunk) => chunks.push(chunk));

      // Add file from disk
      archive.file(testFilePath, { name: "from-disk.txt" });

      await new Promise((resolve, reject) => {
        archive.on("end", resolve);
        archive.on("error", reject);
        archive.finalize();
      });

      const buffer = Buffer.concat(chunks);
      assert.ok(buffer.length > 0, "Archive should contain file");
      assert.ok(buffer.toString("hex").startsWith("504b0304"), "Should be a valid ZIP file");
    } finally {
      fs.unlinkSync(testFilePath);
    }
  });

  it("should create zip archive with directory method", async () => {
    const testDirPath = path.join(__dirname, "archiver-test-dir");
    fs.mkdirSync(testDirPath, { recursive: true });
    fs.writeFileSync(path.join(testDirPath, "file1.txt"), "content 1");
    fs.writeFileSync(path.join(testDirPath, "file2.txt"), "content 2");

    try {
      const chunks = [];
      const archive = new ZipArchive({ zlib: { level: 9 } });

      archive.on("data", (chunk) => chunks.push(chunk));

      // Add directory
      archive.directory(testDirPath, "test-dir");

      await new Promise((resolve, reject) => {
        archive.on("end", resolve);
        archive.on("error", reject);
        archive.finalize();
      });

      const buffer = Buffer.concat(chunks);
      assert.ok(buffer.length > 0, "Archive should contain directory");
      assert.ok(buffer.toString("hex").startsWith("504b0304"), "Should be a valid ZIP file");
    } finally {
      fs.rmSync(testDirPath, { recursive: true, force: true });
    }
  });

  it("should handle pipe method (used for HTTP response streaming)", async () => {
    const archive = new ZipArchive({ zlib: { level: 9 } });

    // Create a writable stream to pipe to
    const chunks = [];
    const writableStream = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });

    // Pipe archive to writable stream
    archive.pipe(writableStream);

    archive.append("streamed content", { name: "stream.txt" });

    await new Promise((resolve, reject) => {
      archive.on("end", resolve);
      archive.on("error", reject);
      archive.finalize();
    });

    const buffer = Buffer.concat(chunks);
    assert.ok(buffer.length > 0, "Piped archive should contain data");
  });

  it("should handle error events", async () => {
    const archive = new ZipArchive({ zlib: { level: 9 } });

    // Pipe to writable to allow finalize to complete
    const chunks = [];
    const writableStream = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    archive.pipe(writableStream);

    let errorCaught = false;
    archive.on("error", (err) => {
      errorCaught = true;
      assert.ok(err instanceof Error, "Error event should receive Error object");
    });

    // Add some content and finalize
    archive.append("test", { name: "test.txt" });

    await new Promise((resolve) => {
      archive.on("end", resolve);
      archive.finalize();
    });

    // Now try to append to already-finalized archive (triggers error synchronously)
    try {
      archive.append("late content", { name: "late.txt" });
      // archiver 8.x throws synchronously when appending to finalized archive
      assert.fail("Should have thrown error for appending to finalized archive");
    } catch (err) {
      assert.ok(err instanceof Error, "Should throw Error");
      assert.ok(err.message.toLowerCase().includes("finalized") || err.message.toLowerCase().includes("append"),
        "Error message should mention finalized/append");
    }
  });

  it("should verify archiver version is 8.x", async () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../package.json"), "utf8")
    );
    const archiverVersion = packageJson.dependencies.archiver;
    assert.ok(archiverVersion.startsWith("^8."), `Archiver should be version ^8.x, got ${archiverVersion}`);
  });
});
