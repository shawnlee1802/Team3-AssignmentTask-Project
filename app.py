from datetime import datetime, date, timedelta
import smtplib
from email.message import EmailMessage

from flask import Flask, render_template, request, redirect, url_for, flash
from config import Config
from models import db, Assignment

app = Flask(__name__)
app.config.from_object(Config)
db.init_app(app)

with app.app_context():
    db.create_all()

sent_reminder_assignment_ids = set()

def send_email(subject, body, recipient):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = app.config.get("MAIL_DEFAULT_SENDER")
    msg["To"] = recipient
    msg.set_content(body)

    server = app.config.get("MAIL_SERVER")
    port = app.config.get("MAIL_PORT")
    use_tls = app.config.get("MAIL_USE_TLS")
    use_ssl = app.config.get("MAIL_USE_SSL")
    username = app.config.get("MAIL_USERNAME")
    password = app.config.get("MAIL_PASSWORD")

    if use_ssl:
        smtp = smtplib.SMTP_SSL(server, port, timeout=10)
    else:
        smtp = smtplib.SMTP(server, port, timeout=10)
        if use_tls:
            smtp.starttls()

    if username and password:
        smtp.login(username, password)

    smtp.send_message(msg)
    smtp.quit()


def get_due_soon_assignments(days=3):
    today = date.today()
    max_date = today + timedelta(days=days)
    return Assignment.query.filter(
        Assignment.due_date != None,
        Assignment.due_date >= today,
        Assignment.due_date <= max_date,
    ).all()


def send_due_date_reminders():
    recipient = app.config.get("MAIL_RECIPIENT")
    if not recipient:
        return

    for assignment in get_due_soon_assignments(3):
        if assignment.id in sent_reminder_assignment_ids:
            continue

        subject = f"Reminder: '{assignment.assignment_title}' due on {assignment.due_date}"
        body = (
            f"Assignment Reminder:\n\n"
            f"Module: {assignment.module_name}\n"
            f"Title: {assignment.assignment_title}\n"
            f"Due Date: {assignment.due_date}\n"
            f"Priority: {assignment.priority or 'N/A'}\n"
            f"Status: {assignment.status or 'N/A'}\n\n"
            f"This assignment is due within 3 days."
        )

        try:
            send_email(subject, body, recipient)
            sent_reminder_assignment_ids.add(assignment.id)
        except Exception:
            # Fail silently so existing app behavior is preserved.
            pass

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/dashboard")
def dashboard():
    today = date.today()
    next_week = today + timedelta(days=7)

    assignments = Assignment.query.all()

    total = len(assignments)
    completed = sum(1 for a in assignments if a.status == "Completed")
    pending = total - completed

    due_this_week = sum(
        1 for a in assignments
        if a.due_date and today <= a.due_date <= next_week and a.status != "Completed"
    )

    upcoming = sorted(
        [a for a in assignments if a.due_date and a.due_date >= today and a.status != "Completed"],
        key=lambda a: a.due_date
    )[:5]

    progress = int((completed / total) * 100) if total > 0 else 0

    return render_template(
        "dashboard.html",
        total_assignments=total,
        pending_assignments=pending,
        completed_assignments=completed,
        due_this_week=due_this_week,
        upcoming_deadlines=upcoming,
        progress_percentage=progress
    )

@app.route("/assignments")
def assignments():
    all_assignments = Assignment.query.order_by(Assignment.due_date).all()
    send_due_date_reminders()
    return render_template("assignments.html", assignments=all_assignments)


def validate_assignment_form(form):
    errors = []
    module_name = form.get("module_name", "").strip()
    assignment_title = form.get("assignment_title", "").strip()
    description = form.get("description", "").strip()
    due_date = form.get("due_date", "").strip()
    priority = form.get("priority", "Low")
    status = form.get("status", "Not Started")

    if not module_name:
        errors.append("Module Name is required.")
    if not assignment_title:
        errors.append("Assignment Title is required.")
    if not due_date:
        errors.append("Due Date is required.")

    due_date_obj = None
    if due_date:
        try:
            due_date_obj = datetime.strptime(due_date, "%Y-%m-%d").date()
        except ValueError:
            errors.append("Due Date must be a valid date.")

    return errors, module_name, assignment_title, description, due_date_obj, priority, status


@app.route("/assignments/add", methods=["GET", "POST"])
def add_assignment():
    if request.method == "POST":
        errors, module_name, assignment_title, description, due_date_obj, priority, status = validate_assignment_form(request.form)

        if errors:
            for error in errors:
                flash(error, "danger")
            return render_template("add_assignment.html", form_data=request.form.to_dict())

        assignment = Assignment(
            module_name=module_name,
            assignment_title=assignment_title,
            description=description,
            due_date=due_date_obj,
            priority=priority,
            status=status,
        )
        db.session.add(assignment)
        db.session.commit()

        flash("Assignment added successfully.", "success")
        return redirect(url_for("assignments"))

    return render_template("add_assignment.html")


@app.route("/assignments/edit/<int:assignment_id>", methods=["GET", "POST"])
def edit_assignment(assignment_id):
    assignment = Assignment.query.get(assignment_id)
    if not assignment:
        flash("Assignment not found.", "warning")
        return redirect(url_for("assignments"))

    if request.method == "POST":
        errors, module_name, assignment_title, description, due_date_obj, priority, status = validate_assignment_form(request.form)

        if errors:
            for error in errors:
                flash(error, "danger")
            return render_template(
                "edit_assignment.html",
                assignment=assignment,
                form_data=request.form.to_dict(),
            )

        assignment.module_name = module_name
        assignment.assignment_title = assignment_title
        assignment.description = description
        assignment.due_date = due_date_obj
        assignment.priority = priority
        assignment.status = status
        db.session.commit()

        flash("Assignment updated successfully.", "success")
        return redirect(url_for("assignments"))

    return render_template("edit_assignment.html", assignment=assignment)


@app.route("/assignments/delete/<int:assignment_id>", methods=["POST"])
def delete_assignment(assignment_id):
    assignment = Assignment.query.get(assignment_id)
    if not assignment:
        flash("Assignment not found.", "warning")
        return redirect(url_for("assignments"))

    db.session.delete(assignment)
    db.session.commit()

    flash("Assignment deleted successfully.", "success")
    return redirect(url_for("assignments"))


if __name__ == "__main__":
    app.run(debug=True)
