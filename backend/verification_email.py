"""Text / HTML blocks added to the existing alert email for unauthorized workers.

Pure functions (no SMTP) so they can be tested. Everything user-supplied is escaped.
"""
from __future__ import annotations

from html import escape
from typing import Dict

from backend.ppe_workflow import REQUIRED_ITEMS


def _rows(v: Dict):
    ppe = v.get("ppe") or {}
    rows = [
        ("Name", v.get("name", "-")),
        ("Person ID", v.get("code", "-")),
        ("Mobile", v.get("mobile", "-")),
        ("Face verification", "Verified" if v.get("face_verified") else "Not verified"),
        ("PPE compliance", f"{v.get('ppe_percentage', 0)}%"),
        ("Absent", f"{v.get('absent_percentage', 100)}%"),
    ]
    for item in REQUIRED_ITEMS:
        rows.append((item.title(), "Present" if ppe.get(item) is True else "ABSENT"))
    missing = v.get("missing") or []
    rows.append(("Missing PPE", ", ".join(m.title() for m in missing) if missing else "None"))
    rows.append(("Date / time", v.get("timestamp", "-")))
    rows.append(("Work authorization", "NOT ALLOWED TO WORK"))
    return rows


def build_text(v: Dict) -> str:
    lines = ["\nWork Authorization Result"] + [f"{k}: {val}" for k, val in _rows(v)]
    return "\n".join(lines) + "\n"


def build_html(v: Dict) -> str:
    cells = "".join(
        f'<tr><td style="padding:4px 12px 4px 0;color:#555;"><b>{escape(str(k))}</b></td>'
        f'<td style="padding:4px 0;">{escape(str(val))}</td></tr>'
        for k, val in _rows(v)
    )
    return (
        '<div style="background-color:#fff5f5;padding:12px;border-radius:6px;margin:15px 0;'
        'border-left:4px solid #d9534f;"><p style="margin:0 0 8px 0;color:#d9534f;">'
        '<b>WORK NOT AUTHORIZED</b></p>'
        f'<table style="border-collapse:collapse;">{cells}</table>'
        '<p style="margin:8px 0 0 0;color:#666;font-size:0.9em;">Attachments: live evidence frame '
        'and the registered face photo.</p></div>'
    )


# ---------------------------------------------------------------------------
# Stand-alone "PPE Violation Alert" e-mail (one per stored ppe_alerts row)
# ---------------------------------------------------------------------------
def _alert_rows(alert: Dict):
    stamp = str(alert.get("timestamp") or "")
    date, _, clock = stamp.partition(" ")
    missing = alert.get("missing_ppe") or []
    pct = alert.get("compliance_percentage", 0)
    return [
        ("Worker Name", alert.get("worker_name") or "-"),
        ("Mobile", alert.get("mobile") or "-"),
        ("Face Verification", "Verified"),
        ("PPE Compliance", f"{int(pct) if float(pct).is_integer() else pct}%"),
        ("Missing PPE", ", ".join(str(m).title() for m in missing) if missing else "None"),
        ("Date", date or "-"),
        ("Time", clock or "-"),
    ], missing


def build_alert_subject(alert: Dict) -> str:
    return f"PPE Violation Alert - {alert.get('worker_name') or 'Unknown'}"


def build_alert_text(alert: Dict) -> str:
    rows, missing = _alert_rows(alert)
    lines = []
    for key, val in rows:
        if key == "Missing PPE":
            lines.append("Missing PPE:")
            lines += [f"- {m.title()}" for m in missing] or ["- None"]
        else:
            lines.append(f"{key}:\n{val}")
        lines.append("")
    lines.append("The attached image is the captured snapshot of the worker.")
    return "\n".join(lines) + "\n"


def build_alert_html(alert: Dict) -> str:
    rows, missing = _alert_rows(alert)
    cells = []
    for key, val in rows:
        if key == "Missing PPE":
            val = "".join(f"<div>&bull; {escape(m.title())}</div>" for m in missing) or "None"
            shown = f'<span style="color:#d9534f;font-weight:bold;">{val}</span>'
        else:
            shown = escape(str(val))
        cells.append(f'<tr><td style="padding:4px 14px 4px 0;color:#555;vertical-align:top;"><b>{escape(key)}</b></td>'
                     f'<td style="padding:4px 0;">{shown}</td></tr>')
    return (
        '<html><body style="font-family:Arial,sans-serif;color:#333;">'
        '<h2 style="color:#d9534f;margin-bottom:5px;">PPE Violation Alert</h2>'
        '<hr style="border:0;border-top:2px solid #d9534f;margin-top:0;" />'
        f'<table style="border-collapse:collapse;">{"".join(cells)}</table>'
        '<p style="color:#666;font-size:0.9em;margin-top:20px;"><em>The attached image is the captured '
        'snapshot of the worker.</em></p></body></html>'
    )
