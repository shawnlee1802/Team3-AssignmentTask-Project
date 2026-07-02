require("dotenv").config({ quiet: true });

const mysql = require("mysql2/promise");

const dbName = process.env.DB_NAME || "assignment_tracker";

function validateDatabaseName(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error("DB_NAME can only contain letters, numbers, and underscores.");
  }
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: dbName,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
});

async function initDb() {
  validateDatabaseName(dbName);

  const serverConnection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
  });

  await serverConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await serverConnection.end();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS assignments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      module_name VARCHAR(100) NOT NULL,
      assignment_title VARCHAR(255) NOT NULL,
      description TEXT,
      due_date DATE,
      priority VARCHAR(20) DEFAULT 'Low',
      status VARCHAR(30) DEFAULT 'Not Started',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

module.exports = {
  pool,
  initDb,
};
