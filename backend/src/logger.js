/**
 * OpenShift Airgap Architect - Structured Logging (PROD-002)
 *
 * Pino-based structured logger with environment-aware configuration.
 * Outputs JSON in production, pretty-printed in development.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import pino from "pino";
import crypto from "node:crypto";

const isDevelopment = process.env.NODE_ENV !== "production";
const isTest = process.env.NODE_ENV === "test";
const logLevel = process.env.LOG_LEVEL || (isTest ? "silent" : isDevelopment ? "debug" : "info");
const logFormat = process.env.LOG_FORMAT || (isDevelopment ? "pretty" : "json");

const logger = pino({
  level: logLevel,
  transport:
    logFormat === "pretty" && isDevelopment && !isTest
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
});

/**
 * Generate a unique error ID for correlating error responses with log entries.
 * @returns {string} Error ID in format `err_<uuid>`
 */
export function generateErrorId() {
  return `err_${crypto.randomUUID()}`;
}

export default logger;
