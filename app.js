require("dotenv").config({ quiet: true });

const express = require("express");
const path = require("path");
const session = require("express-session");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const { pool, initDb } = require("./db");
const { buildCalendar } = require("./calendar");

const app = express();
const sentReminderAssignmentIds = new Set();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "static")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-key",
    resave: false,
    saveUninitialized: false,
  })
);

app.use((req, res, next) => {
  req.session.flashMessages = req.session.flashMessages || {};
  req.flash = (type, message) => {
    if (message === undefined) {
      const messages = req.session.flashMessages[type] || [];
      delete req.session.flashMessages[type];
      return messages;
    }

    req.session.flashMessages[type] = req.session.flashMessages[type] || [];
    req.session.flashMessages[type].push(message);
    return req.session.flashMessages[type];
  };

  const messages = req.session.flashMessages;
  req.session.flashMessages = {};
  res.locals.messages = messages;
  res.locals.currentUser = req.session.user || null;
  next();
});

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildAssignmentSummary(assignments) {
  const today = todayIso();
  const nextWeek = addDaysIso(7);

  const total = assignments.length;
  const completed = assignments.filter((a) => a.status === "Completed").length;
  const pending = total - completed;
  const highPriority = assignments.filter((a) => a.priority === "High").length;
  const overdue = assignments.filter(
    (a) => a.due_date && a.due_date < today && a.status !== "Completed"
  ).length;
  const dueThisWeek = assignments.filter(
    (a) =>
      a.due_date &&
      a.due_date >= today &&
      a.due_date <= nextWeek &&
      a.status !== "Completed"
  ).length;
  const upcomingDeadlines = assignments
    .filter((a) => a.due_date && a.due_date >= today && a.status !== "Completed")
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 5);
  const progress = total > 0 ? Math.floor((completed / total) * 100) : 0;

  return {
    summary: {
      total_assignments: total,
      pending_assignments: pending,
      completed_assignments: completed,
      due_this_week: dueThisWeek,
    },
    total_assignments: total,
    pending_assignments: pending,
    completed_assignments: completed,
    due_this_week: dueThisWeek,
    high_priority: highPriority,
    overdue,
    upcoming_deadlines: upcomingDeadlines,
    progress_percentage: progress,
  };
}

function validateAssignmentForm(body) {
  const errors = [];
  const assignment = {
    module_name: (body.module_name || "").trim(),
    assignment_title: (body.assignment_title || "").trim(),
    description: (body.description || "").trim(),
    due_date: (body.due_date || "").trim(),
    priority: body.priority || "Low",
    status: body.status || "Not Started",
  };

  if (!assignment.module_name) {
    errors.push("Module Name is required.");
  }
  if (!assignment.assignment_title) {
    errors.push("Assignment Title is required.");
  }
  if (!assignment.due_date) {
    errors.push("Due Date is required.");
  } else if (Number.isNaN(Date.parse(assignment.due_date))) {
    errors.push("Due Date must be a valid date.");
  }

  return { errors, assignment };
}

function getReminderStatus(dueDate) {
  if (!dueDate) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const threeDays = new Date(today);
  threeDays.setDate(threeDays.getDate() + 3);

  if (due < today) {
    return {
      label: "Overdue Warning",
      className: "badge bg-danger-subtle text-danger-emphasis",
    };
  }

  if (due <= tomorrow) {
    return {
      label: "Urgent Reminder",
      className: "badge bg-warning-subtle text-warning-emphasis",
    };
  }

  if (due <= threeDays) {
    return {
      label: "Upcoming Reminder",
      className: "badge bg-info-subtle text-info-emphasis",
    };
  }

  return null;
}

function requireAuth(req, res, next) {
  if (req.session.userId) {
    return next();
  }

  req.flash("warning", "Please log in to continue.");
  return res.redirect("/login");
}

async function sendEmail(subject, body, recipient) {
  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_SERVER || "localhost",
    port: Number(process.env.MAIL_PORT || 25),
    secure: (process.env.MAIL_USE_SSL || "false").toLowerCase() === "true",
    auth:
      process.env.MAIL_USERNAME && process.env.MAIL_PASSWORD
        ? {
            user: process.env.MAIL_USERNAME,
            pass: process.env.MAIL_PASSWORD,
          }
        : undefined,
    requireTLS: (process.env.MAIL_USE_TLS || "false").toLowerCase() === "true",
  });

  await transporter.sendMail({
    from: process.env.MAIL_DEFAULT_SENDER || "noreply@example.com",
    to: recipient,
    subject,
    text: body,
  });
}

async function getDueSoonAssignments(days = 3, userId = null) {
  const [assignments] = await pool.query(
    `
      SELECT *
      FROM assignments
      WHERE due_date IS NOT NULL
        AND due_date >= ?
        AND due_date <= ?
        ${userId ? "AND user_id = ?" : ""}
      ORDER BY due_date ASC
    `,
    userId ? [todayIso(), addDaysIso(days), userId] : [todayIso(), addDaysIso(days)]
  );
  return assignments;
}

async function sendDueDateReminders(userId = null) {
  const recipient = process.env.MAIL_RECIPIENT;
  if (!recipient) {
    return;
  }

  const assignments = await getDueSoonAssignments(3, userId);
  for (const assignment of assignments) {
    if (sentReminderAssignmentIds.has(assignment.id)) {
      continue;
    }

    const subject = `Reminder: '${assignment.assignment_title}' due on ${assignment.due_date}`;
    const body = [
      "Assignment Reminder:",
      "",
      `Module: ${assignment.module_name}`,
      `Title: ${assignment.assignment_title}`,
      `Due Date: ${assignment.due_date}`,
      `Priority: ${assignment.priority || "N/A"}`,
      `Status: ${assignment.status || "N/A"}`,
      "",
      "This assignment is due within 3 days.",
    ].join("\n");

    try {
      await sendEmail(subject, body, recipient);
      sentReminderAssignmentIds.add(assignment.id);
    } catch (error) {
      // Keep reminder failures from blocking the assignment list.
    }
  }
}

app.use((req, res, next) => {
  const publicPaths = ["/login", "/signup", "/logout"];
  if (
    publicPaths.includes(req.path) ||
    req.path.startsWith("/css/") ||
    req.path.startsWith("/js/") ||
    req.path === "/favicon.ico"
  ) {
    return next();
  }

  return requireAuth(req, res, next);
});

app.get("/", async (req, res, next) => {
  try {
    const [assignments] = await pool.query(
      "SELECT * FROM assignments WHERE user_id = ?",
      [req.session.userId]
    );
    res.render("index", buildAssignmentSummary(assignments));
  } catch (error) {
    next(error);
  }
});

app.get("/dashboard", (req, res) => {
  res.redirect("/#progress-overview");
});

app.get("/login", (req, res) => {
  if (req.session.userId) {
    return res.redirect("/assignments");
  }

  return res.render("login", { form_data: {} });
});

app.post("/login", async (req, res, next) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const password = (req.body.password || "").trim();

    if (!email || !password) {
      req.flash("danger", "Email and password are required.");
      return res.render("login", { form_data: { email } });
    }

    const [users] = await pool.query("SELECT * FROM users WHERE email = ? LIMIT 1", [
      email,
    ]);
    const user = users[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      req.flash("danger", "Invalid email or password.");
      return res.render("login", { form_data: { email } });
    }

    req.session.userId = user.id;
    req.session.user = { id: user.id, name: user.name, email: user.email };
    req.flash("success", "Welcome back!");
    return res.redirect("/assignments");
  } catch (error) {
    return next(error);
  }
});

app.get("/signup", (req, res) => {
  if (req.session.userId) {
    return res.redirect("/assignments");
  }

  return res.render("signup", { form_data: {} });
});

app.post("/signup", async (req, res, next) => {
  try {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const password = (req.body.password || "").trim();

    const errors = [];
    if (!name) {
      errors.push("Name is required.");
    }
    if (!email) {
      errors.push("Email is required.");
    }
    if (!password || password.length < 6) {
      errors.push("Password must be at least 6 characters long.");
    }

    if (errors.length) {
      req.flash("danger", errors[0]);
      return res.render("signup", { form_data: { name, email } });
    }

    const [existingUsers] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [
      email,
    ]);
    if (existingUsers.length) {
      req.flash("warning", "An account with that email already exists.");
      return res.render("signup", { form_data: { name, email } });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
      [name, email, passwordHash]
    );

    const userId = result.insertId;
    req.session.userId = userId;
    req.session.user = { id: userId, name, email };

    await pool.query("UPDATE assignments SET user_id = ? WHERE user_id IS NULL", [userId]);

    try {
      const welcomeBody = [
        "Welcome to Assignment Tracker!",
        "",
        `Hi ${name},`,
        "",
        "Your account was created successfully.",
        "You can now log in to manage your assignments, track deadlines, and keep your workload organised.",
      ].join("\n");

      await sendEmail(
        "Welcome to Assignment Tracker",
        welcomeBody,
        email
      );
      req.flash("success", "Account created successfully. A welcome email has been sent.");
    } catch (emailError) {
      console.error("Signup email failed:", emailError);
      req.flash("warning", "Account created successfully, but the welcome email could not be sent.");
    }

    return res.redirect("/assignments");
  } catch (error) {
    return next(error);
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/assignments", async (req, res, next) => {
  try {
    await sendDueDateReminders(req.session.userId);
    const [assignments] = await pool.query(
      "SELECT * FROM assignments WHERE user_id = ? ORDER BY due_date ASC",
      [req.session.userId]
    );
    const assignmentRows = assignments.map((assignment) => ({
      ...assignment,
      reminderStatus: getReminderStatus(assignment.due_date),
    }));
    res.render("assignments", { assignments: assignmentRows });
  } catch (error) {
    next(error);
  }
});

app.get("/calendar", async (req, res, next) => {
  try {
    const [assignments] = await pool.query(
      "SELECT * FROM assignments WHERE due_date IS NOT NULL AND user_id = ? ORDER BY due_date ASC, priority ASC",
      [req.session.userId]
    );
    const calendar = buildCalendar(assignments, req.query.month);
    const upcomingAssignments = assignments
      .filter(
        (assignment) =>
          assignment.due_date >= calendar.today && assignment.status !== "Completed"
      )
      .slice(0, 6);

    res.render("calendar", { ...calendar, upcomingAssignments });
  } catch (error) {
    next(error);
  }
});

app.get("/assignments/add", (req, res) => {
  res.render("add_assignment", { form_data: {} });
});

app.post("/assignments/add", async (req, res, next) => {
  const { errors, assignment } = validateAssignmentForm(req.body);
  if (errors.length) {
    res.locals.messages = { ...(res.locals.messages || {}), danger: errors };
    return res.render("add_assignment", { form_data: assignment });
  }

  try {
    await pool.query(
      `
        INSERT INTO assignments
          (module_name, assignment_title, description, due_date, priority, status, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        assignment.module_name,
        assignment.assignment_title,
        assignment.description,
        assignment.due_date,
        assignment.priority,
        assignment.status,
        req.session.userId,
      ]
    );
    req.flash("success", "Assignment added successfully.");
    res.redirect("/assignments");
  } catch (error) {
    next(error);
  }
});

app.get("/assignments/edit/:id", async (req, res, next) => {
  try {
    const [assignments] = await pool.query(
      "SELECT * FROM assignments WHERE id = ? AND user_id = ?",
      [req.params.id, req.session.userId]
    );
    const assignment = assignments[0];
    if (!assignment) {
      req.flash("warning", "Assignment not found.");
      return res.redirect("/assignments");
    }

    res.render("edit_assignment", { assignment, form_data: null });
  } catch (error) {
    next(error);
  }
});

app.post("/assignments/edit/:id", async (req, res, next) => {
  const { errors, assignment } = validateAssignmentForm(req.body);

  try {
    const [assignments] = await pool.query(
      "SELECT * FROM assignments WHERE id = ? AND user_id = ?",
      [req.params.id, req.session.userId]
    );
    const existingAssignment = assignments[0];
    if (!existingAssignment) {
      req.flash("warning", "Assignment not found.");
      return res.redirect("/assignments");
    }

    if (errors.length) {
      res.locals.messages = { ...(res.locals.messages || {}), danger: errors };
      return res.render("edit_assignment", {
        assignment: existingAssignment,
        form_data: assignment,
      });
    }

    await pool.query(
      `
        UPDATE assignments
        SET module_name = ?,
            assignment_title = ?,
            description = ?,
            due_date = ?,
            priority = ?,
            status = ?
        WHERE id = ? AND user_id = ?
      `,
      [
        assignment.module_name,
        assignment.assignment_title,
        assignment.description,
        assignment.due_date,
        assignment.priority,
        assignment.status,
        req.params.id,
        req.session.userId,
      ]
    );

    req.flash("success", "Assignment updated successfully.");
    res.redirect("/assignments");
  } catch (error) {
    next(error);
  }
});

app.post("/assignments/delete/:id", async (req, res, next) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM assignments WHERE id = ? AND user_id = ?",
      [req.params.id, req.session.userId]
    );
    req.flash(
      result.affectedRows ? "success" : "warning",
      result.affectedRows
        ? "Assignment deleted successfully."
        : "Assignment not found."
    );
    res.redirect("/assignments");
  } catch (error) {
    next(error);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("error", {
    message: "Something went wrong. Check the server logs for details.",
  });
});

async function start() {
  await initDb();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`Assignment Tracker running on http://localhost:${port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Failed to start application:", error);
    process.exit(1);
  });
}

module.exports = app;
