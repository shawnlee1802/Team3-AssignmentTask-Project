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

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayIso() {
  // Get today's date in YYYY-MM-DD format so dashboard comparisons stay simple.
  return formatLocalDate(new Date());
}

function addDaysIso(days) {
  // Start from today's date so we can calculate a future deadline boundary.
  const date = new Date();
  // Move the date forward by the number of days passed into the function.
  date.setDate(date.getDate() + days);
  // Return the future date in YYYY-MM-DD format for view and summary checks.
  return formatLocalDate(date);
}

function isCompletedStatus(status) {
  return String(status || "").trim().toLowerCase() === "completed";
}

// ======================================================
// Deadline Reminder Feature (Shawn)
// Automatic Priority Calculation
//
// Lecturer Requirement:
// Automatically update assignment priority based on assignment due date.
//
// High Priority    : Due within 5 days
// Medium Priority  : Due within 1 week
// Low Priority     : More than 1 week
// ======================================================
// This helper converts a due date into a day count so the reminder
// and priority rules can use the same date calculation everywhere.
// Input: a due date string from the assignment record.
// Output: number of days remaining, or null when no valid date exists.
function getDaysUntilDue(dueDate) {
  // If there is no due date at all, the feature cannot calculate a reminder.
  if (!dueDate) {
    return null;
  }

  // Create a date object for today so the time part can be removed.
  const today = new Date();
  // Clear the time so the calculation uses full days only.
  today.setHours(0, 0, 0, 0);

  // Convert the saved due date string into a Date object.
  const due = new Date(`${dueDate}T00:00:00`);
  // If the date cannot be parsed, stop and report that the date is invalid.
  if (Number.isNaN(due.getTime())) {
    return null;
  }
  // Clear the time again so both dates are compared at midnight.
  due.setHours(0, 0, 0, 0);

  // Return the number of days between today and the due date.
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

// Determines the stored priority label from the assignment due date.
// It is used whenever an assignment is created, edited, displayed,
// or synced from the database so priority always follows the lecturer rule.
// Input: assignment due date and current status.
// Output: "Completed", "Overdue", "High", "Medium", or "Low".
function getAssignmentPriority(dueDate, status) {
  // Completed assignments always keep the Completed priority regardless of the due date.
  if (isCompletedStatus(status)) {
    return "Completed";
  }

  // Reuse the shared day calculation so priority and reminders stay aligned.
  const daysUntilDue = getDaysUntilDue(dueDate);

  // Missing or invalid dates default to Low because no deadline urgency can be measured.
  if (daysUntilDue === null) {
    return "Low";
  }

  // If the deadline has already passed, the task is overdue even when it is not completed.
  if (daysUntilDue < 0) {
    return "Overdue";
  }

  // Five days or fewer means the assignment should be treated as High priority.
  if (daysUntilDue <= 5) {
    return "High";
  }

  // Six or seven days away means the assignment is important but not the most urgent.
  if (daysUntilDue <= 7) {
    return "Medium";
  }

  // Anything further away is considered Low priority.
  return "Low";
}

// Synchronizes the priority field in memory and in the database.
// This keeps older records consistent when assignments are loaded.
// Input: array of assignment rows fetched from MySQL.
// Output: the same assignment array after priority values are updated.
async function syncAssignmentPriorities(assignments) {
  // Store database update promises so they can all finish together.
  const updates = [];

  // Check every assignment loaded from the database.
  assignments.forEach((assignment) => {
    // Calculate the correct priority from the due date and status.
    const calculatedPriority = getAssignmentPriority(
      assignment.due_date,
      assignment.status
    );
    // Read the current stored priority, falling back to an empty string if it is missing.
    const currentPriority = assignment.priority ?? "";
    // Update the in-memory object so the UI sees the fresh priority immediately.
    assignment.priority = calculatedPriority;

    // Only update the database when the row belongs to a valid assignment record
    // and the stored value is different from the calculated one.
    if (
      assignment.id &&
      assignment.user_id &&
      currentPriority !== calculatedPriority
    ) {
      // Save the corrected priority back into MySQL for this user-owned record.
      updates.push(
        pool.query(
          "UPDATE assignments SET priority = ? WHERE id = ? AND user_id = ?",
          [calculatedPriority, assignment.id, assignment.user_id]
        )
      );
    }
  });

  // Wait for all priority updates to finish before continuing.
  await Promise.all(updates);
  // Return the same array so the caller can keep using the updated assignments.
  return assignments;
}

// Builds the dashboard assignment summary and counts priority totals
// using the same due-date rule as the rest of the feature.
// Input: array of assignment rows.
// Output: dashboard summary object passed to the home page view.
function buildAssignmentSummary(assignments) {
  // Store today's date for overdue and due-this-week checks.
  const today = todayIso();
  // Store the date seven days from now for the weekly deadline boundary.
  const nextWeek = addDaysIso(7);
  // Build the reminder counts that will be shown on the home page.
  const reminderOverview = getReminderOverview(assignments);

  // Count every assignment in the current list.
  const total = assignments.length;
  // Count assignments that are already marked as completed.
  const completed = assignments.filter((a) => isCompletedStatus(a.status)).length;
  // Count assignments that still need work.
  const pending = total - completed;
  // Count assignments whose due date makes them High priority.
  const highPriority = assignments.filter(
    (assignment) =>
      getAssignmentPriority(assignment.due_date, assignment.status) === "High"
  ).length;
  // Count assignments that are overdue and not completed yet.
  const overdue = assignments.filter(
    (a) => a.due_date && a.due_date < today && !isCompletedStatus(a.status)
  ).length;
  // Count assignments due between today and one week from now.
  const dueThisWeek = assignments.filter(
    (a) =>
      a.due_date &&
      a.due_date >= today &&
      a.due_date <= nextWeek &&
      !isCompletedStatus(a.status)
  ).length;
  // Keep only upcoming incomplete assignments, sort them by due date,
  // take the first five, and add reminder information for the UI.
  const upcomingDeadlines = assignments
    .filter((a) => a.due_date && !isCompletedStatus(a.status))
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 5)
    .map(decorateAssignmentReminder);
  // Calculate the completion percentage for the progress bar.
  const progress = total > 0 ? Math.floor((completed / total) * 100) : 0;

  // Return the dashboard data object that the home page reads.
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

// Validates the assignment form and automatically assigns the correct
// priority from the due date before the record is saved.
// Input: raw request body from the add/edit form.
// Output: validation errors plus a normalized assignment object.
function validateAssignmentForm(body) {
  // Collect validation messages so the form can show all problems at once.
  const errors = [];
  // Build a clean assignment object from the submitted form values.
  const assignment = {
    // Store the module name after trimming extra spaces.
    module_name: (body.module_name || "").trim(),
    // Store the assignment title after trimming extra spaces.
    assignment_title: (body.assignment_title || "").trim(),
    // Store the description, or an empty string when nothing was typed.
    description: (body.description || "").trim(),
    // Store the due date exactly as entered in the form.
    due_date: (body.due_date || "").trim(),
    // Store the status, defaulting to Not Started when no value is selected.
    status: (body.status || "Not Started").trim(),
  };

  // Require a module name because every assignment must belong to a module.
  if (!assignment.module_name) {
    errors.push("Module Name is required.");
  }
  // Require a title so the assignment can be identified in the UI.
  if (!assignment.assignment_title) {
    errors.push("Assignment Title is required.");
  }
  // Require a due date because priority depends on the deadline.
  if (!assignment.due_date) {
    errors.push("Due Date is required.");
  // Reject dates that JavaScript cannot parse into a valid date value.
  } else if (Number.isNaN(Date.parse(assignment.due_date))) {
    errors.push("Due Date must be a valid date.");
  }

  // Calculate the priority after validation so the saved record matches the due date and status.
  assignment.priority = getAssignmentPriority(
    assignment.due_date,
    assignment.status
  );

  // Return both the errors and the cleaned assignment object to the route handler.
  return { errors, assignment };
}

// Converts a due date into a reminder label for list and dashboard views.
// This exists so the reminder badges stay aligned with the same date
// logic used by automatic priority calculation.
// Input: assignment due date.
// Output: reminder descriptor object or null when no reminder is needed.
function getReminderStatus(dueDate, status) {
  // Completed assignments should not display reminders because the task is already done.
  if (isCompletedStatus(status)) {
    return null;
  }

  // Reuse the shared day count so reminder timing matches the priority rule.
  const daysUntilDue = getDaysUntilDue(dueDate);
  // If the date is missing or invalid, there is no reminder to show.
  if (daysUntilDue === null) {
    return null;
  }

  // A negative value means the deadline has already passed.
  if (daysUntilDue < 0) {
    return {
      label: "Overdue Warning",
      className: "badge bg-danger-subtle text-danger-emphasis",
    };
  }

  // One day or less means the assignment needs urgent attention.
  if (daysUntilDue <= 1) {
    return {
      label: "Urgent Reminder",
      className: "badge bg-warning-subtle text-warning-emphasis",
    };
  }

  // Three days or less still needs a reminder, but it is less urgent.
  if (daysUntilDue <= 3) {
    return {
      label: "Upcoming Reminder",
      className: "badge bg-info-subtle text-info-emphasis",
    };
  }

  // If the assignment is farther away, no reminder badge is needed.
  return null;
}

// Builds the human-readable countdown text shown beside each assignment.
// It reuses the shared day calculation so reminder text matches priority rules.
// Input: assignment due date.
// Output: countdown descriptor object or null when no countdown is needed.
function getReminderCountdown(dueDate, status) {
  // Completed assignments should not show a countdown because the task is already done.
  if (isCompletedStatus(status)) {
    return null;
  }

  // Reuse the same day count used by reminders and priority logic.
  const daysUntilDue = getDaysUntilDue(dueDate);
  // No valid due date means there is no countdown to display.
  if (daysUntilDue === null) {
    return null;
  }

  // Negative days means the assignment is already overdue.
  if (daysUntilDue < 0) {
    return {
      text: `Overdue by ${Math.abs(daysUntilDue)} days`,
      className: "text-danger-emphasis",
    };
  }

  // Zero days means the assignment is due today.
  if (daysUntilDue === 0) {
    return {
      text: "Due Today",
      className: "text-warning-emphasis",
    };
  }

  // One day means the assignment is due tomorrow.
  if (daysUntilDue === 1) {
    return {
      text: "Due Tomorrow",
      className: "text-warning-emphasis",
    };
  }

  // Three days or fewer gets a more visible countdown message.
  if (daysUntilDue <= 3) {
    return {
      text: `${daysUntilDue} days remaining`,
      className: "text-info-emphasis",
    };
  }

  // Longer countdowns still show the number of remaining days.
  return {
    text: `${daysUntilDue} days remaining`,
    className: "text-muted",
  };
}

// Adds reminder metadata to an assignment row before rendering the UI.
// This keeps the assignment list and dashboard cards presentation-ready
// without changing the original record fields.
// Input: one assignment row.
// Output: the same assignment row with reminderStatus and reminderCountdown.
function decorateAssignmentReminder(assignment) {
  // Return a copy of the assignment with extra UI-only reminder fields attached.
  return {
    ...assignment,
    reminderStatus: getReminderStatus(assignment.due_date, assignment.status),
    reminderCountdown: getReminderCountdown(assignment.due_date, assignment.status),
  };
}

// Counts overdue, urgent, and upcoming assignments for the dashboard.
// This summary uses the reminder helpers so the cards reflect the same
// due-date rules shown elsewhere in the application.
// Input: array of assignment rows.
// Output: object containing overdue, urgent, and upcoming totals.
function getReminderOverview(assignments) {
  // Start the totals at zero so reduce can count them up one by one.
  return assignments.reduce(
    (overview, assignment) => {
      // Skip records with no due date or records already completed.
      if (!assignment.due_date || isCompletedStatus(assignment.status)) {
        return overview;
      }

      // Check what reminder category this assignment belongs to.
      const reminderStatus = getReminderStatus(assignment.due_date, assignment.status);
      // If no reminder is needed, leave the totals unchanged.
      if (!reminderStatus) {
        return overview;
      }

      // Increase the matching counter based on the reminder label.
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
      // Initial overdue count.
      overdue: 0,
      // Initial urgent count.
      urgent: 0,
      // Initial upcoming count.
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
  // Loads the dashboard data, syncs stored priority values, and then
  // passes the assignments into the summary builder for the home page.
  try {
    // Load every assignment for the logged-in user from MySQL.
    const [assignments] = await pool.query("SELECT * FROM assignments WHERE user_id = ?", 
      [req.session.user.id]);
    // Recalculate priority so the home page always uses the latest due-date rules.
    await syncAssignmentPriorities(assignments);
    // Render the home page with dashboard statistics and upcoming deadlines.
    res.render("index", buildAssignmentSummary(assignments));
  } catch (error) {
    next(error);
  }
});

app.get("/dashboard", (req, res) => {
  res.redirect("/#progress-overview");
});

app.get("/assignments", requireLogin,async (req, res, next) => {  //protect assignment pages(requirelogin)
  // Loads the assignment list for the current user, updates priority values
  // from due dates, and decorates each row with reminder information.
  try {
    // Load assignments in due-date order so the most urgent items appear first.
    const [assignments] = await pool.query(
      "SELECT * FROM assignments WHERE user_id = ? ORDER BY due_date ASC",
      [req.session.user.id]
    );
    // Keep the stored priority aligned with the due-date rule before rendering.
    await syncAssignmentPriorities(assignments);
    // Add reminder badges and countdown text for the assignments table.
    const assignmentRows = assignments.map(decorateAssignmentReminder);
    // Send the prepared rows to the assignment list view.
    res.render("assignments", { assignments: assignmentRows });
  } catch (error) {
    next(error);
  }
});

app.get("/calendar", requireLogin, async (req, res, next) => {
  // Loads all dated assignments for the current user, syncs priority from
  // the due date, and passes the result into the calendar builder.
  try {
    // Load only assignments that have a due date because the calendar needs a date.
    const [assignments] = await pool.query(
      "SELECT * FROM assignments WHERE user_id = ? AND due_date IS NOT NULL ORDER BY due_date ASC, priority ASC",
      [req.session.user.id]
    );
    // Update any stored priorities so the calendar uses the correct category colors.
    await syncAssignmentPriorities(assignments);
    // Build the calendar data structure for the requested month.
    const calendar = buildCalendar(assignments, req.query.month);
    // Keep only upcoming incomplete assignments for the sidebar list.
    const upcomingAssignments = assignments
      .filter(
        (assignment) =>
          assignment.due_date >= calendar.today && !isCompletedStatus(assignment.status)
      )
      .slice(0, 6);

    // Render the calendar page with the month grid and upcoming deadlines.
    res.render("calendar", { ...calendar, upcomingAssignments });
  } catch (error) {
    next(error);
  }
});

app.get("/assignments/add", requireLogin, (req, res) => {
  res.render("add_assignment", { form_data: {} });
});

app.post("/assignments/add", requireLogin, async (req, res, next) => {
  // Validates the new assignment, calculates its priority from the due date,
  // and stores the record so the database always keeps the lecturer rule.
  // Read and clean the submitted form data.
  const { errors, assignment } = validateAssignmentForm(req.body);
  // If validation fails, show the form again with the cleaned values.
  if (errors.length) {
    res.locals.messages = { ...(res.locals.messages || {}), danger: errors };
    return res.render("add_assignment", { form_data: assignment });
  }

  try {
    // Insert the new assignment into MySQL with the calculated priority.
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
    // Tell the user the save worked, then send them back to the list.
    req.flash("success", "Assignment added successfully.");
    res.redirect("/assignments");
  } catch (error) {
    next(error);
  }
});

app.get("/assignments/edit/:id", requireLogin, async (req, res, next) => {
  // Loads one assignment for editing, syncs its priority from the due date,
  // and sends the record to the edit form.
  try {
    // Find the selected assignment and make sure it belongs to the logged-in user.
    const [assignments] = await pool.query("SELECT * FROM assignments WHERE id = ? AND user_id = ?", 
      [req.params.id, req.session.user.id]
    );
    // Sync the stored priority before the form is shown.
    await syncAssignmentPriorities(assignments);
    // Use the first row because the query should return only one matching assignment.
    const assignment = assignments[0];
    // If nothing is found, show a warning and return to the assignment list.
    if (!assignment) {
      req.flash("warning", "Assignment not found.");
      return res.redirect("/assignments");
    }

    // Render the edit form with the assignment data.
    res.render("edit_assignment", { assignment, form_data: null });
  } catch (error) {
    next(error);
  }
});

app.post("/assignments/edit/:id", requireLogin, async (req, res, next) => {
  // Validates the edited assignment, recalculates priority from the new due
  // date, and updates the saved record in MySQL.
  // Clean and validate the form values before updating the database.
  const { errors, assignment } = validateAssignmentForm(req.body);

  try {
    // Load the current record so we know whether the assignment exists.
    const [assignments] = await pool.query("SELECT * FROM assignments WHERE id = ? AND user_id = ?", 
      [req.params.id, req.session.user.id]
    );
    // Keep the first matching record for the current user.
    const existingAssignment = assignments[0];
    // If no record exists, show a warning and stop.
    if (!existingAssignment) {
      req.flash("warning", "Assignment not found.");
      return res.redirect("/assignments");
    }

    // If validation failed, show the edit form again with the user's input.
    if (errors.length) {
      res.locals.messages = { ...(res.locals.messages || {}), danger: errors };
      return res.render("edit_assignment", {
        assignment: existingAssignment,
        form_data: assignment,
      });
    }

    // Save the updated assignment back into MySQL using the recalculated priority.
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

    // Let the user know the update succeeded.
    req.flash("success", "Assignment updated successfully.");
    // Return to the assignments page after saving.
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
module.exports.getAssignmentPriority = getAssignmentPriority;
module.exports.getReminderStatus = getReminderStatus;
module.exports.getReminderCountdown = getReminderCountdown;
module.exports.isCompletedStatus = isCompletedStatus;
