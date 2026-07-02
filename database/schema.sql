CREATE DATABASE IF NOT EXISTS assignment_tracker;
USE assignment_tracker;

CREATE TABLE IF NOT EXISTS assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  module_name VARCHAR(100) NOT NULL,
  assignment_title VARCHAR(255) NOT NULL,
  description TEXT,
  due_date DATE,
  priority VARCHAR(20) DEFAULT 'Low',
  status VARCHAR(30) DEFAULT 'Not Started',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
