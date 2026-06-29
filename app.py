from datetime import datetime

from flask import Flask, render_template, request, redirect, url_for, flash
from config import Config
from models import db, Assignment

app = Flask(__name__)
app.config.from_object(Config)
db.init_app(app)

with app.app_context():
    db.create_all()

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")

@app.route("/assignments")
def assignments():
    all_assignments = Assignment.query.order_by(Assignment.due_date).all()
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
