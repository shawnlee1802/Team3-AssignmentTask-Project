const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const request = require("supertest");
const proxyquire = require("proxyquire").noCallThru();

const users = new Map();
let insertedUser = null;

/*
 * This is a pretend database used only during testing.
 *
 * Authentication queries receive controlled test data instead of connecting
 * to the team's real MySQL database.
 */
const fakePool = {
  async query(sql, parameters = []) {
    const normalizedSql = sql.replace(/\s+/g, " ").trim();

    if (normalizedSql.startsWith("SELECT * FROM users WHERE email = ?")) {
      const user = users.get(parameters[0]);
      return [user ? [user] : []];
    }

    if (
      normalizedSql.startsWith(
        "INSERT INTO users (name, email, password_hash)"
      )
    ) {
      insertedUser = {
        name: parameters[0],
        email: parameters[1],
        password_hash: parameters[2],
      };

      return [{ insertId: 2 }];
    }

    if (normalizedSql.includes("FROM assignments")) {
      return [[]];
    }

    if (normalizedSql.startsWith("UPDATE assignments")) {
      return [{ affectedRows: 0 }];
    }

    throw new Error(`Unexpected test database query: ${normalizedSql}`);
  },
};

/*
 * app.js normally imports the real pool and database initializer from db.js.
 *
 * proxyquire replaces db.js with the fake objects below. This lets the tests
 * exercise the real Express routes without touching MySQL.
 */
const app = proxyquire("../app", {
  "./db": {
    pool: fakePool,
    initDb: async () => {},
  },
});

test("visitor can open the login page", async () => {
  const response = await request(app).get("/login");

  assert.equal(response.status, 200);
  assert.match(response.text, /Welcome to Assignment Tracker/);
});

test("unauthenticated visitor is redirected away from protected pages", async () => {
  const response = await request(app).get("/assignments");

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/login");
});

test("unknown email receives a generic login error", async () => {
  const response = await request(app)
    .post("/login")
    .type("form")
    .send({
      email: "missing@example.com",
      password: "WrongPassword123",
    });

  assert.equal(response.status, 200);
  assert.match(response.text, /Invalid email or password/);
});

test("wrong password receives the same generic login error", async () => {
  const passwordHash = await bcrypt.hash("CorrectPassword123", 10);

  users.set("kiran@example.com", {
    id: 1,
    name: "Kiran",
    email: "kiran@example.com",
    password_hash: passwordHash,
  });

  const response = await request(app)
    .post("/login")
    .type("form")
    .send({
      email: "kiran@example.com",
      password: "WrongPassword123",
    });

  assert.equal(response.status, 200);
  assert.match(response.text, /Invalid email or password/);
});

test("valid login creates a session that can access protected pages", async () => {
  const passwordHash = await bcrypt.hash("CorrectPassword123", 10);

  users.set("kiran@example.com", {
    id: 1,
    name: "Kiran",
    email: "kiran@example.com",
    password_hash: passwordHash,
  });

  /*
   * An agent keeps cookies between requests.
   *
   * It behaves like one browser logging in and then opening another page.
   */
  const agent = request.agent(app);

  const loginResponse = await agent
    .post("/login")
    .type("form")
    .send({
      email: "kiran@example.com",
      password: "CorrectPassword123",
    });

  assert.equal(loginResponse.status, 302);
  assert.equal(loginResponse.headers.location, "/dashboard");

  const protectedResponse = await agent.get("/assignments");

  assert.equal(protectedResponse.status, 200);
  assert.match(protectedResponse.text, /Assignments/i);
});

test("registration hashes the password before storing it", async () => {
  insertedUser = null;

  const response = await request(app)
    .post("/register")
    .type("form")
    .send({
      name: "New Student",
      email: "new-student@example.com",
      password: "MySecurePassword123",
    });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/login");

  assert.ok(insertedUser);
  assert.equal(insertedUser.name, "New Student");
  assert.equal(insertedUser.email, "new-student@example.com");

  /*
   * The database must not receive the original plain-text password.
   */
  assert.notEqual(
    insertedUser.password_hash,
    "MySecurePassword123"
  );

  /*
   * bcrypt should confirm that the stored hash represents the submitted
   * password.
   */
  const passwordMatches = await bcrypt.compare(
    "MySecurePassword123",
    insertedUser.password_hash
  );

  assert.equal(passwordMatches, true);
});

test("logout destroys access to protected pages", async () => {
  const passwordHash = await bcrypt.hash("CorrectPassword123", 10);

  users.set("kiran@example.com", {
    id: 1,
    name: "Kiran",
    email: "kiran@example.com",
    password_hash: passwordHash,
  });

  const agent = request.agent(app);

  await agent
    .post("/login")
    .type("form")
    .send({
      email: "kiran@example.com",
      password: "CorrectPassword123",
    })
    .expect(302);

  const beforeLogout = await agent.get("/assignments");
  assert.equal(beforeLogout.status, 200);

  const logoutResponse = await agent.get("/logout");
  assert.equal(logoutResponse.status, 302);
  assert.equal(logoutResponse.headers.location, "/login");

  const afterLogout = await agent.get("/assignments");
  assert.equal(afterLogout.status, 302);
  assert.equal(afterLogout.headers.location, "/login");
});