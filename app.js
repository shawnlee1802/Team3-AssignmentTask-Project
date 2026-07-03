require("dotenv").config({ quiet: true });

const express = require("express");
const path = require("path");
const session = require("express-session");
const flash = require("connect-flash");
const nodemailer = require("nodemailer");
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
app.use(flash());

app.use((req, res, next) => {
  res.locals.messages = req.flash();
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

async function getDueSoonAssignments(days = 3) {
  const [assignments] = await pool.query(
    `
      SELECT *
      FROM assignments
      WHERE due_date IS NOT NULL
        AND due_date >= ?
        AND due_date <= ?
      ORDER BY due_date ASC
    `,
    [todayIso(), addDaysIso(days)]
  );
  return assignments;
}

async function sendDueDateReminders() {
  const recipient = process.env.MAIL_RECIPIENT;
  if (!recipient) {
    return;
  }

  const assignments = await getDueSoonAssignments(3);
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

app.get("/", async (req, res, next) => {
  try {
    const [assignments] = await pool.query("SELECT * FROM assignments");
    res.render("index", buildAssignmentSummary(assignments));
  } catch (error) {
    next(error);
  }
});

app.get("/dashboard", (req, res) => {
  res.redirect("/#progress-overview");
});

app.get("/assignments", async (req, res, next) => {
  try {
    await sendDueDateReminders();
    const [assignments] = await pool.query(
      "SELECT * FROM assignments ORDER BY due_date ASC"
    );
    res.render("assignments", { assignments });
  } catch (error) {
    next(error);
  }
});

app.get("/calendar", async (req, res, next) => {
  try {
    const [assignments] = await pool.query(
      "SELECT * FROM assignments WHERE due_date IS NOT NULL ORDER BY due_date ASC, priority ASC"
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
          (module_name, assignment_title, description, due_date, priority, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        assignment.module_name,
        assignment.assignment_title,
        assignment.description,
        assignment.due_date,
        assignment.priority,
        assignment.status,
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
    const [assignments] = await pool.query("SELECT * FROM assignments WHERE id = ?", [
      req.params.id,
    ]);
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
    const [assignments] = await pool.query("SELECT * FROM assignments WHERE id = ?", [
      req.params.id,
    ]);
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
        WHERE id = ?
      `,
      [
        assignment.module_name,
        assignment.assignment_title,
        assignment.description,
        assignment.due_date,
        assignment.priority,
        assignment.status,
        req.params.id,
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
    const [result] = await pool.query("DELETE FROM assignments WHERE id = ?", [
      req.params.id,
    ]);
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
