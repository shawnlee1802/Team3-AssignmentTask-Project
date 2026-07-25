# Assignment Tracker

Assignment Tracker is a Node.js web app that uses Express, EJS templates, and a MySQL database.

## Requirements

- Node.js 18 or newer
- MySQL 8 or newer
- Docker Desktop, when running the container version

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

   The app also creates the database, `users` table, and `assignments` table automatically on startup if the MySQL user has permission.

5. Start the app:

   ```bash
   npm start
   ```

The app runs at `http://localhost:3000`.

## Environment Variables

- `PORT`: Express server port
- `SESSION_SECRET`: secret used to protect login sessions
- `DB_HOST`: MySQL host
- `DB_PORT`: MySQL port
- `DB_USER`: MySQL username
- `DB_PASSWORD`: MySQL password
- `DB_NAME`: MySQL database name
- `DB_CREATE_DATABASE`: set to `false` when the database is created externally; defaults to creating it
- `MYSQL_ROOT_PASSWORD`: root password for the Docker MySQL container
- `MYSQL_APP_PASSWORD`: application-user password for the Docker MySQL container

## Team Database Setup

Each teammate should create their own `.env` file from `.env.example` and enter their own MySQL credentials. The `.env` file is ignored by Git, so passwords and local database settings are not pushed to GitHub.

If everyone is running MySQL on their own laptop, they can all use the same `DB_NAME` value because each database is local to that laptop. If multiple teammates share one MySQL server, use different database names such as `assignment_tracker_shawn` and `assignment_tracker_teamname`.

## Main Routes

- `/`: dashboard home page after login
- `/dashboard`: redirects to the home page dashboard section
- `/login`: login page
- `/register`: signup page
- `/logout`: ends the login session
- `/assignments`: assignment list
- `/calendar`: monthly calendar and upcoming assignment timetable (`?month=YYYY-MM` supported)
- `/assignments/add`: add assignment form
- `/assignments/edit/:id`: edit assignment form

## Docker

Docker Compose starts both the Node.js application and a MySQL 8.4 database:

Before starting the containers, create `.env` from `.env.example` and replace
all secret placeholders. Docker Compose requires `SESSION_SECRET`,
`MYSQL_ROOT_PASSWORD`, and `MYSQL_APP_PASSWORD`; it does not provide default
passwords.

```bash
docker compose up --build -d
docker compose ps
```

Open `http://localhost:3000`. To prove the app is connected to MySQL, open
`http://localhost:3000/health`. The expected response is:

```json
{"status":"ok","database":"connected"}
```

Useful checks:

```bash
docker compose logs app
docker compose logs database
docker compose down
```

The named `mysql_data` volume keeps the database when the containers stop.

## Jenkins CI/CD

The `Jenkinsfile` runs these stages:

1. Check out the repository.
2. Install exact package versions with `npm ci`.
3. Run syntax checks and the priority/reminder tests with `npm test`.
4. Validate `docker-compose.yml`.
5. Build versioned and `latest` Docker images.
6. Deploy the app and MySQL with `docker compose up -d --no-build`.
7. Wait for the app container to become healthy and verify `/health`.

Configure a Jenkins NodeJS tool named `NodeJS`, and install Docker on the
Jenkins agent. The Jenkins service account must have permission to use Docker.
The pipeline supports Windows and Linux agents.

Add these three Jenkins credentials as **Secret text** values:

| Credential ID | Purpose |
| --- | --- |
| `assignment-tracker-session-secret` | Protects login sessions |
| `assignment-tracker-mysql-root-password` | Protects the container's MySQL root account |
| `assignment-tracker-mysql-app-password` | Password used by the app's MySQL account |

The pipeline exposes these credentials only as masked environment variables.
Do not place the real values in `.env.example`, the `Jenkinsfile`, or GitHub.
For local Docker commands outside Jenkins, put your own values in the ignored
`.env` file instead.

If local deployment or the health check fails, Jenkins displays
`docker compose ps` and the app/database logs before removing the broken
containers. After a successful pipeline, the containers remain running so the
application can be demonstrated at `http://localhost:3000`.
