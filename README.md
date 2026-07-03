# Assignment Tracker

Assignment Tracker is a Node.js web app that uses Express, EJS templates, and a MySQL database.

## Requirements

- Node.js 18 or newer
- MySQL 8 or newer

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local environment file:

   ```bash
   cp .env.example .env
   ```

3. Update `.env` with your own MySQL username, password, and database name.

   Each teammate should keep their own `.env` file on their own computer. Do not commit `.env` to GitHub.

4. Create the MySQL database manually if you want to inspect it before starting the app:

   ```bash
   mysql -u root -p < database/schema.sql
   ```

   The app also creates the database and `assignments` table automatically on startup if the MySQL user has permission.

5. Start the app:

   ```bash
   npm start
   ```

The app runs at `http://localhost:3000`.

## Environment Variables

- `PORT`: Express server port
- `SESSION_SECRET`: secret used for flash-message sessions
- `DB_HOST`: MySQL host
- `DB_PORT`: MySQL port
- `DB_USER`: MySQL username
- `DB_PASSWORD`: MySQL password
- `DB_NAME`: MySQL database name
- `MAIL_*`: optional SMTP settings for due-date reminder emails

## Team Database Setup

Each teammate should create their own `.env` file from `.env.example` and enter their own MySQL credentials. The `.env` file is ignored by Git, so passwords and local database settings are not pushed to GitHub.

If everyone is running MySQL on their own laptop, they can all use the same `DB_NAME` value because each database is local to that laptop. If multiple teammates share one MySQL server, use different database names such as `assignment_tracker_shawn` and `assignment_tracker_teamname`.

## Main Routes

- `/`: home page
- `/dashboard`: redirects to the home page dashboard section
- `/assignments`: assignment list
- `/calendar`: monthly calendar and upcoming assignment timetable (`?month=YYYY-MM` supported)
- `/assignments/add`: add assignment form
- `/assignments/edit/:id`: edit assignment form

## Docker

Build and run the application container:

```bash
docker build -t assignment-tracker-node .
docker run -p 3000:3000 --env-file .env assignment-tracker-node
```
