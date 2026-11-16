/**
 * Migration 003: operator package details cache (v2.2.0 M5)
 *
 * The catalog scan (`oc-mirror --v2 list operators --catalog=…`, operator_results)
 * records each package's DEFAULT channel only. Catalog validation needs a
 * package's channels and a channel's versions, which oc-mirror lists per
 * package (`--package`) and per channel (`--channel`). Results are cached per
 * catalog image reference and package so repeated checks do not re-query a
 * registry, and so a later offline check can say what was last seen and when.
 *
 * @author Bill Strauss
 */

export const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS operator_package_details (
      catalog_image TEXT NOT NULL,
      package TEXT NOT NULL,
      details_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (catalog_image, package)
    )
  `);
};

export const down = (db) => {
  db.exec("DROP TABLE IF EXISTS operator_package_details");
};
