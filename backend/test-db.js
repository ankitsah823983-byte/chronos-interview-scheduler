const pool = require("./db");

async function testConnection() {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database,
        current_user AS username,
        NOW() AS server_time
    `);

    console.log("PostgreSQL connection successful!");
    console.table(result.rows);
  } catch (error) {
    console.error("PostgreSQL connection failed:");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

testConnection();