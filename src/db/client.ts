import { Pool, types } from "pg";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// node-postgres parses the DATE type (OID 1082) into a JS Date at local midnight. Converting
// that back with toISOString() shifts across timezones with a non-zero UTC offset, silently
// moving the date by a day. We only ever want the plain "YYYY-MM-DD" string Postgres already
// sends, so disable the Date parsing entirely.
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value: string) => value);

// node-postgres also returns NUMERIC (OID 1700, used by the `cls` column) as a string by
// default, to avoid silent float precision loss on arbitrary-precision values. CLS values are
// always small floats in practice, so parse them as numbers rather than handling strings
// throughout the app.
const NUMERIC_OID = 1700;
types.setTypeParser(NUMERIC_OID, (value: string) => Number.parseFloat(value));

export const pool = new Pool({
  connectionString: requireEnv("NEON_DATABASE_URL"),
  ssl: true,
});
