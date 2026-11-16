/**
 * Migration 004: verified catalog identity per scan (v2.2.0 M7, DOC-155)
 *
 * A catalog scan now fetches the catalog over verified TLS before oc-mirror
 * lists it, so each stored scan result can say exactly which catalog content
 * it describes: the reference as written (usually a tag), the digest that tag
 * resolved to at fetch time, the platform manifest actually listed, and when.
 * Kept beside operator_results so existing readers of results_json are
 * unchanged.
 *
 * @author Bill Strauss
 */

export const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS operator_catalog_identity (
      version TEXT NOT NULL,
      catalog TEXT NOT NULL,
      source_reference TEXT NOT NULL,
      resolved_digest TEXT NOT NULL,
      manifest_digest TEXT NOT NULL,
      verified_at INTEGER NOT NULL,
      PRIMARY KEY (version, catalog)
    )
  `);
};

export const down = (db) => {
  db.exec("DROP TABLE IF EXISTS operator_catalog_identity");
};
