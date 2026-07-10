// Loads local .env settings such as DB_HOST, DB_USER, and DB_PASSWORD.
require("dotenv").config({ quiet: true });

const mysql = require("mysql2/promise");

// Database used by the app. It can be changed in .env with DB_NAME.
const dbName = process.env.DB_NAME || "assignment_tracker";

// Keeps CREATE DATABASE safe by allowing only letters, numbers, and underscores.
function validateDatabaseName(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error("DB_NAME can only contain letters, numbers, and underscores.");
  }
}

// Shared MySQL connection pool used by routes in app.js.
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

// Creates the database and required tables when the app starts.
async function initDb() {
  validateDatabaseName(dbName);

  // Connect to MySQL server first so the database can be created if missing.
  const serverConnection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
  });

  await serverConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await serverConnection.end();

  // Stores accounts created from the signup page.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Stores assignment details and links each record to a user through user_id.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assignments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      module_name VARCHAR(100) NOT NULL,
      assignment_title VARCHAR(255) NOT NULL,
      description TEXT,
      due_date DATE,
      priority VARCHAR(20) DEFAULT 'Low',
      status VARCHAR(30) DEFAULT 'Not Started',
      user_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Keeps older local databases working if they were created before user_id existed.
  const [columns] = await pool.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'assignments'`,
    [dbName]
  );

  if (!columns.some((column) => column.COLUMN_NAME === "user_id")) {
    await pool.query("ALTER TABLE assignments ADD COLUMN user_id INT");
  }
}

module.exports = {
  pool,
  initDb,
};
