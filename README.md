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

2. Create the MySQL database:

   ```bash
   mysql -u root -p < database/schema.sql
   ```

3. Create your local environment file:

   ```bash
   cp .env.example .env
   ```

4. Update `.env` with your MySQL username and password.

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

## Main Routes

- `/`: home page
- `/dashboard`: assignment summary dashboard
- `/assignments`: assignment list
- `/assignments/add`: add assignment form
- `/assignments/edit/:id`: edit assignment form

## Docker

Build and run the application container:

```bash
docker build -t assignment-tracker-node .
docker run -p 3000:3000 --env-file .env assignment-tracker-node
```
