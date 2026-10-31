
const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, ".env"),
});

const { Pool } = require("pg");

const isTestEnvironment = process.env.NODE_ENV === "test";
const databaseName = process.env.DB_NAME || "chronos_db";

// Never allow integration tests to connect to the real development database.
if (isTestEnvironment && databaseName !== "chronos_test_db") {
  console.error(
    "SAFETY ERROR: Tests must use the dedicated chronos_test_db database."
  );
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: databaseName,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
});

pool.on("error", (error) => {
  console.error("Unexpected database connection error:", error.message);
});

module.exports = pool;
