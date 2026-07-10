require("dotenv").config({ quiet: true });

const express = require("express");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcrypt");
const { pool, initDb } = require("./db");
const { buildCalendar } = require("./calendar");

const app = express();

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
  res.locals.user = req.session.user || null;
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
  const reminderOverview = getReminderOverview(assignments);

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
    .filter((a) => a.due_date && a.status !== "Completed")
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 5)
    .map(decorateAssignmentReminder);
  const progress = total > 0 ? Math.floor((completed / total) * 100) : 0;

  return {
    dashboard: {
      total,
      pending,
      completed,
      dueThisWeek,
      highPriority,
      overdue,
      progress,
      reminderOverview,
    },
    upcomingDeadlines,
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

function getReminderCountdown(dueDate) {
  if (!dueDate) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) {
    return null;
  }
  due.setHours(0, 0, 0, 0);

  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);

  if (diffDays < 0) {
    return {
      text: `Overdue by ${Math.abs(diffDays)} days`,
      className: "text-danger-emphasis",
    };
  }

  if (diffDays === 0) {
    return {
      text: "Due Today",
      className: "text-warning-emphasis",
    };
  }

  if (diffDays === 1) {
    return {
      text: "Due Tomorrow",
      className: "text-warning-emphasis",
    };
  }

  if (diffDays <= 3) {
    return {
      text: `${diffDays} days remaining`,
      className: "text-info-emphasis",
    };
  }

  return {
    text: `${diffDays} days remaining`,
    className: "text-muted",
  };
}

function decorateAssignmentReminder(assignment) {
  return {
    ...assignment,
    reminderStatus: getReminderStatus(assignment.due_date),
    reminderCountdown: getReminderCountdown(assignment.due_date),
  };
}

function getReminderOverview(assignments) {
  return assignments.reduce(
    (overview, assignment) => {
      if (!assignment.due_date || assignment.status === "Completed") {
        return overview;
      }

      const reminderStatus = getReminderStatus(assignment.due_date);
      if (!reminderStatus) {
        return overview;
      }

      if (reminderStatus.label === "Overdue Warning") {
        overview.overdue += 1;
      } else if (reminderStatus.label === "Urgent Reminder") {
        overview.urgent += 1;
      } else if (reminderStatus.label === "Upcoming Reminder") {
        overview.upcoming += 1;
      }

      return overview;
    },
    {
      overdue: 0,
      urgent: 0,
      upcoming: 0,
    }
  );
}

function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.redirect("/login");
    }
    next();
}

app.get("/", requireLogin, async (req, res, next) => {
  try {
    const [assignments] = await pool.query("SELECT * FROM assignments WHERE user_id = ?", 
      [req.session.user.id]);
    res.render("index", buildAssignmentSummary(assignments));
  } catch (error) {
    next(error);
  }
});

app.get("/dashboard", (req, res) => {
  res.redirect("/#progress-overview");
});

app.get("/assignments", requireLogin,async (req, res, next) => {  //protect assignment pages(requirelogin)
  try {
    const [assignments] = await pool.query(
      "SELECT * FROM assignments WHERE user_id = ? ORDER BY due_date ASC",
      [req.session.user.id]
    );
    const assignmentRows = assignments.map(decorateAssignmentReminder);
    res.render("assignments", { assignments: assignmentRows });
  } catch (error) {
    next(error);
  }
});

app.get("/calendar", requireLogin, async (req, res, next) => {
  try {
    const [assignments] = await pool.query(
      "SELECT * FROM assignments WHERE user_id = ? AND due_date IS NOT NULL ORDER BY due_date ASC, priority ASC",
      [req.session.user.id]
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

app.get("/assignments/add", requireLogin, (req, res) => {
  res.render("add_assignment", { form_data: {} });
});

app.post("/assignments/add", requireLogin, async (req, res, next) => {
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
        req.session.user.id,
      ]
    );
    req.flash("success", "Assignment added successfully.");
    res.redirect("/assignments");
  } catch (error) {
    next(error);
  }
});

app.get("/assignments/edit/:id", requireLogin, async (req, res, next) => {
  try {
    const [assignments] = await pool.query("SELECT * FROM assignments WHERE id = ? AND user_id = ?", 
      [req.params.id, req.session.user.id]
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

app.post("/assignments/edit/:id", requireLogin, async (req, res, next) => {
  const { errors, assignment } = validateAssignmentForm(req.body);

  try {
    const [assignments] = await pool.query("SELECT * FROM assignments WHERE id = ? AND user_id = ?", 
      [req.params.id, req.session.user.id]
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
        req.session.user.id,
      ]
    );

    req.flash("success", "Assignment updated successfully.");
    res.redirect("/assignments");
  } catch (error) {
    next(error);
  }
});

app.post("/assignments/delete/:id", requireLogin, async (req, res, next) => {
  try {
    const [result] = await pool.query("DELETE FROM assignments WHERE id = ? AND user_id = ?", 
      [req.params.id, req.session.user.id]
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

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.get('/register', (req, res) => {
    res.render('register', { error: null });
});

app.post('/register', async (req, res, next) => {
    const { name, email, password } = req.body;

    try {
        const passwordHash = await bcrypt.hash(password, 10);

        await pool.query(
            "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
            [name, email, passwordHash]
        );

        res.redirect('/login');
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.render("register", { error: "Email already registered." });
        }

        next(error);
    }
});

app.post("/login", async (req, res, next) => {
    const { email, password } = req.body;

    try {
        const [rows] = await pool.query(
            "SELECT * FROM users WHERE email = ?",
            [email]
        );

        if (rows.length === 0) {
            return res.render("login", {
              error: "Invalid email or password."
});
        }

        const user = rows[0];

        const passwordMatch = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatch) {
            return res.render("login", {
              error: "Invalid email or password."
});
        }

        req.session.user = {
            id: user.id,
            name: user.name,
            email: user.email
        };

        res.redirect("/dashboard");

    } catch (err) {
        next(err);
    }
});

//logout
app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.redirect("/");
        }

        res.redirect("/login");
    });
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
