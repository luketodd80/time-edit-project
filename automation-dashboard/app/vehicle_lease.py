"""Internal vehicle lease allocation.

The payment formula, All Locations split, journal CSV, and fleet report follow
Luke's standalone allocator. This app stores the registry and the month's files
under DATA_DIR. It does not write to Google Sheets or QuickBooks.
"""
import calendar
import csv
import datetime
import fcntl
import json
import math
import os
import re
import uuid
from io import StringIO
from pathlib import Path

from app.clock import now

BRANCHES = ["Covington", "Greenville", "Dayton", "Springfield", "Columbus", "Mobile"]
BRANCH_CHOICES = ["All Locations", *BRANCHES]
MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
GL_ACCOUNT = "611-3 Vehicle Lease Expense (Internal)"
CREDIT_LOCATION = "Truck Sales"


class UnitExists(ValueError):
    """The registry already has this unit number."""
TSC_CUSTOMER = "The Service Company(use for non-pro projects)(FMS)"
_MONTH = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
JE_HEADERS = ["JournalNo", "JournalDate", "Account", "Debits", "Credits", "Description", "Name", "Location"]
DETAIL_HEADERS = [
    "Branch", "Unit #", "Description", "Shop %", "Counter %",
    "Shop $", "Counter $", "Branch Total", "Note", "All Locations?",
]


def cents(amount):
    """Round half away from zero, matching the allocator's Math.round on positive amounts."""
    return math.floor(float(amount) * 100 + 0.5) / 100


def money(amount):
    """6,910.61 — thousands separators, two decimals, no dollar sign."""
    rounded = cents(amount)
    negative = rounded < 0
    whole, frac = divmod(int(round(abs(rounded) * 100)), 100)
    return f"{'-' if negative else ''}{whole:,}.{frac:02d}"


def pmt(annual_rate_pct, term_mo, pv):
    if not pv or not term_mo:
        return 0.0
    rate = float(annual_rate_pct) / 100 / 12
    if rate == 0:
        return float(pv) / float(term_mo)
    growth = (1 + rate) ** int(term_mo)
    return (rate * float(pv) * growth) / (growth - 1)


def parse_month(value):
    match = _MONTH.fullmatch(str(value or "").strip())
    if not match:
        raise ValueError("month must be YYYY-MM")
    year, month = int(match.group(1)), int(match.group(2))
    if year < 2000 or year > 2100:
        raise ValueError("month must be YYYY-MM")
    return year, month, f"{year:04d}-{month:02d}"


def month_label(iso):
    year, month, _ = parse_month(iso)
    return f"{MONTHS[month - 1]} {year}"


def _elapsed(vehicle, year, month):
    parts = str(vehicle.get("start_date") or "").split("-")
    if len(parts) < 2:
        return -1
    return (year - int(parts[0])) * 12 + (month - int(parts[1]))


def is_active(vehicle, year, month):
    elapsed = _elapsed(vehicle, year, month)
    return elapsed >= 0 and elapsed < int(vehicle.get("term") or 0)


def default_settings():
    return {
        "gl_account": GL_ACCOUNT,
        "credit_location": CREDIT_LOCATION,
        "default_rate": 7.0,
        "default_term": 60,
        "alloc": {
            "Covington": 22,
            "Greenville": 18,
            "Dayton": 16,
            "Springfield": 15,
            "Columbus": 17,
            "Mobile": 12,
        },
    }


def _alloc(settings):
    stored = (settings or {}).get("alloc") or {}
    return {branch: float(stored.get(branch) or 0) for branch in BRANCHES}


def allocate(vehicles, settings, year, month):
    """Raw branch totals, then cent-rounded journal amounts. Credit equals the rounded debits."""
    alloc = _alloc(settings)
    raw = {branch: 0.0 for branch in BRANCHES}
    active = []
    for vehicle in vehicles:
        if not is_active(vehicle, year, month):
            continue
        payment = pmt(vehicle.get("rate"), vehicle.get("term"), vehicle.get("value"))
        service = float(vehicle.get("service_pct") or 0) / 100
        counter = (100 - float(vehicle.get("service_pct") or 0)) / 100
        branch = vehicle.get("branch")
        if branch == "All Locations":
            for name in BRANCHES:
                raw[name] += payment * (alloc[name] / 100)
            active.append({**vehicle, "payment": payment, "service": payment * service, "counter": payment * counter, "all_locations": True})
        elif branch in raw:
            raw[branch] += payment
            active.append({**vehicle, "payment": payment, "service": payment * service, "counter": payment * counter, "all_locations": False})
    rounded = {branch: cents(raw[branch]) for branch in BRANCHES}
    total = cents(sum(rounded.values()))
    return {"raw": raw, "branches": rounded, "total": total, "active": active, "alloc": alloc}


def _detail_rows(vehicles, settings, year, month):
    alloc = _alloc(settings)
    rows = []
    for branch in BRANCHES:
        for vehicle in vehicles:
            if not is_active(vehicle, year, month):
                continue
            payment = pmt(vehicle.get("rate"), vehicle.get("term"), vehicle.get("value"))
            service_pct = float(vehicle.get("service_pct") or 0)
            service = service_pct / 100
            counter = (100 - service_pct) / 100
            if vehicle.get("branch") == "All Locations":
                share = alloc[branch] / 100
                branch_amt = payment * share
                rows.append([
                    branch, vehicle.get("unit") or "", vehicle.get("nickname") or "",
                    f"{service_pct:g}%", f"{100 - service_pct:g}%",
                    f"{branch_amt * service:.2f}", f"{branch_amt * counter:.2f}", f"{branch_amt:.2f}",
                    f"All Locations ({alloc[branch]:g}%)", "Yes",
                ])
            elif vehicle.get("branch") == branch:
                rows.append([
                    branch, vehicle.get("unit") or "", vehicle.get("nickname") or "",
                    f"{service_pct:g}%", f"{100 - service_pct:g}%",
                    f"{payment * service:.2f}", f"{payment * counter:.2f}", f"{payment:.2f}",
                    "", "No",
                ])
    return rows


def build_je_csv(vehicles, settings, year, month):
    summary = allocate(vehicles, settings, year, month)
    last = calendar.monthrange(year, month)[1]
    date_str = f"{month:02d}/{last:02d}/{year}"
    mon = MON3[month - 1].upper()
    journal = f"VEH-LEASE-{mon}{year}"
    memo = f"Internal Vehicle Lease - {MON3[month - 1]} {year}"
    account = (settings.get("gl_account") or GL_ACCOUNT).strip() or GL_ACCOUNT
    credit_at = (settings.get("credit_location") or CREDIT_LOCATION).strip() or CREDIT_LOCATION
    rows = []
    for branch in BRANCHES:
        amount = summary["branches"][branch]
        if amount <= 0.005:
            continue
        rows.append([journal, date_str, account, money(amount), "", memo, "", branch])
    if summary["total"] > 0:
        rows.append([journal, date_str, account, "", money(summary["total"]), memo, "", credit_at])
    buf = StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(JE_HEADERS)
    writer.writerows(rows)
    return buf.getvalue(), summary, journal


def build_detail_csv(vehicles, settings, year, month):
    buf = StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(DETAIL_HEADERS)
    writer.writerows(_detail_rows(vehicles, settings, year, month))
    return buf.getvalue()


def build_pdf(vehicles, settings, year, month, summary):
    from fpdf import FPDF

    label = f"{MONTHS[month - 1]} {year}"
    pdf = FPDF(orientation="P", unit="mm", format="Letter")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()
    pdf.set_text_color(30, 64, 175)
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(130, 7, "The Service Company", new_x="RIGHT", new_y="TOP")
    pdf.set_text_color(17, 24, 39)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 7, label, align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(80, 80, 80)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(130, 5, "Internal Vehicle Lease Allocation Report", new_x="RIGHT", new_y="TOP")
    pdf.cell(0, 5, f"Total Monthly Charge: ${money(summary['total'])}", align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(30, 64, 175)
    pdf.line(10, pdf.get_y() + 1, 206, pdf.get_y() + 1)
    pdf.ln(4)
    pdf.set_text_color(30, 64, 175)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 6, "BRANCH SUMMARY", new_x="LMARGIN", new_y="NEXT")
    widths = [40, 22, 32, 32, 32]
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_fill_color(30, 64, 175)
    pdf.set_text_color(255, 255, 255)
    for text, width in zip(["Branch", "Vehicles", "Shop (Service)", "Counter", "Total"], widths):
        pdf.cell(width, 6, text, align="R" if text != "Branch" else "L", fill=True)
    pdf.ln()
    pdf.set_text_color(17, 24, 39)
    shop_total = counter_total = 0.0
    vehicle_count = len(summary["active"])
    by_branch = {branch: [] for branch in BRANCHES}
    for vehicle in summary["active"]:
        payment = vehicle["payment"]
        service_pct = float(vehicle.get("service_pct") or 0)
        if vehicle.get("all_locations"):
            for branch in BRANCHES:
                share = summary["alloc"][branch] / 100
                by_branch[branch].append({
                    "unit": vehicle.get("unit"),
                    "nickname": vehicle.get("nickname") or "",
                    "service_pct": service_pct,
                    "shop": cents(payment * share * service_pct / 100),
                    "counter": cents(payment * share * (100 - service_pct) / 100),
                    "total": payment * share,
                    "note": f"All Locations ({summary['alloc'][branch]:g}%)",
                })
        elif vehicle.get("branch") in by_branch:
            by_branch[vehicle["branch"]].append({
                "unit": vehicle.get("unit"),
                "nickname": vehicle.get("nickname") or "",
                "service_pct": service_pct,
                "shop": cents(payment * service_pct / 100),
                "counter": cents(payment * (100 - service_pct) / 100),
                "total": payment,
                "note": "",
            })
    for branch in BRANCHES:
        lines = by_branch[branch]
        shop = sum(line["shop"] for line in lines)
        counter = sum(line["counter"] for line in lines)
        shop_total += shop
        counter_total += counter
        pdf.set_font("Helvetica", "", 8)
        pdf.cell(widths[0], 6, branch)
        pdf.cell(widths[1], 6, str(len(lines)), align="R")
        pdf.cell(widths[2], 6, "$" + money(shop), align="R")
        pdf.cell(widths[3], 6, "$" + money(counter), align="R")
        pdf.set_font("Helvetica", "B", 8)
        pdf.cell(widths[4], 6, "$" + money(summary["branches"][branch]), align="R")
        pdf.ln()
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_fill_color(232, 237, 248)
    pdf.cell(widths[0], 6, "Total", fill=True)
    pdf.cell(widths[1], 6, str(vehicle_count), align="R", fill=True)
    pdf.cell(widths[2], 6, "$" + money(shop_total), align="R", fill=True)
    pdf.cell(widths[3], 6, "$" + money(counter_total), align="R", fill=True)
    pdf.cell(widths[4], 6, "$" + money(summary["total"]), align="R", fill=True)
    pdf.ln(10)
    detail_widths = [22, 48, 16, 18, 22, 22, 24, 24]
    for branch in BRANCHES:
        lines = by_branch[branch]
        if not lines:
            continue
        if pdf.get_y() > 250:
            pdf.add_page()
        pdf.set_fill_color(30, 64, 175)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(sum(detail_widths), 6, branch, fill=True, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "B", 7)
        for text, width in zip(
            ["Unit #", "Description", "Shop %", "Counter %", "Shop $", "Counter $", "Total", "Note"],
            detail_widths,
        ):
            pdf.cell(width, 5, text, fill=True, align="R" if text not in ("Unit #", "Description", "Note") else "L")
        pdf.ln()
        pdf.set_text_color(17, 24, 39)
        pdf.set_font("Helvetica", "", 7)
        for line in lines:
            pdf.cell(detail_widths[0], 5, str(line["unit"]))
            pdf.cell(detail_widths[1], 5, str(line["nickname"])[:32])
            pdf.cell(detail_widths[2], 5, f"{line['service_pct']:g}%", align="R")
            pdf.cell(detail_widths[3], 5, f"{100 - line['service_pct']:g}%", align="R")
            pdf.cell(detail_widths[4], 5, "$" + money(line["shop"]), align="R")
            pdf.cell(detail_widths[5], 5, "$" + money(line["counter"]), align="R")
            pdf.set_font("Helvetica", "B", 7)
            pdf.cell(detail_widths[6], 5, "$" + money(line["total"]), align="R")
            pdf.set_font("Helvetica", "I", 7)
            pdf.cell(detail_widths[7], 5, line["note"][:22])
            pdf.ln()
            pdf.set_font("Helvetica", "", 7)
    pdf.ln(4)
    pdf.set_text_color(120, 120, 120)
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(120, 5, f"The Service Company · Fleet Manager Report · {label}")
    pdf.cell(0, 5, "Confidential - Internal Use Only", align="R")
    return bytes(pdf.output())


def fleet_check_csv(csv_text, vehicles, ignored):
    """Compare an active CustomerUnits export to the registry and the ignored list."""
    rows = list(csv.DictReader(StringIO(csv_text or "")))
    if not rows:
        raise ValueError("fleet CSV is empty")
    fleet = []
    for row in rows:
        number = (row.get("Number") or "").strip()
        customer = (row.get("Customer") or "").strip()
        if customer != TSC_CUSTOMER or (row.get("Unit Active") or "").strip() != "Yes":
            continue
        if not number or number in {"?", "#1"}:
            continue
        fleet.append(number)
    registered = {v.get("unit") for v in vehicles}
    ignored_set = set(ignored)
    unresolved = [unit for unit in fleet if unit not in registered and unit not in ignored_set]
    if unresolved:
        noun = "vehicle" if len(unresolved) == 1 else "vehicles"
        text = f"{len(unresolved)} {noun} need to be added to the registry or marked as ignored: {', '.join(unresolved[:12])}"
        status = "flagged"
    else:
        text = f"All {len(fleet)} active vehicles accounted for."
        status = "ok"
    return {"status": status, "text": text, "unresolved": len(unresolved), "fleet": len(fleet)}


def _clean_settings(body):
    base = default_settings()
    if not isinstance(body, dict):
        raise ValueError("settings required")
    account = str(body.get("gl_account") if body.get("gl_account") is not None else base["gl_account"]).strip()
    location = str(body.get("credit_location") if body.get("credit_location") is not None else base["credit_location"]).strip()
    if not account:
        raise ValueError("GL account required")
    if not location:
        raise ValueError("credit location required")
    try:
        rate = float(body.get("default_rate") if body.get("default_rate") is not None else base["default_rate"])
        term = int(body.get("default_term") if body.get("default_term") is not None else base["default_term"])
    except (TypeError, ValueError):
        raise ValueError("rate and term must be numbers")
    if rate < 0 or rate > 30:
        raise ValueError("default rate must be between 0 and 30")
    if term < 1 or term > 120:
        raise ValueError("default term must be between 1 and 120 months")
    incoming = body.get("alloc") if isinstance(body.get("alloc"), dict) else {}
    alloc = {}
    for branch in BRANCHES:
        raw = incoming.get(branch, base["alloc"][branch])
        try:
            alloc[branch] = float(raw)
        except (TypeError, ValueError):
            raise ValueError(f"{branch} percent must be a number")
        if alloc[branch] < 0 or alloc[branch] > 100:
            raise ValueError(f"{branch} percent must be between 0 and 100")
    total = sum(alloc.values())
    if abs(total - 100) > 0.01:
        raise ValueError(f"All Locations split must total 100%. Currently {total:.1f}%.")
    return {
        "gl_account": account[:200],
        "credit_location": location[:120],
        "default_rate": rate,
        "default_term": term,
        "alloc": alloc,
    }


def _clean_vehicle(body, settings, existing=None):
    if not isinstance(body, dict):
        raise ValueError("vehicle required")
    unit = " ".join(str(body.get("unit") or "").split())
    nickname = " ".join(str(body.get("nickname") or "").split())
    branch = str(body.get("branch") or "").strip()
    start = str(body.get("start_date") or "").strip()
    if not unit or not nickname or branch not in BRANCH_CHOICES:
        raise ValueError("unit, nickname, and branch are required")
    try:
        value = float(body.get("value"))
        term = int(body.get("term") if body.get("term") is not None else settings["default_term"])
        rate = float(body.get("rate") if body.get("rate") is not None else settings["default_rate"])
        service = float(body.get("service_pct") if body.get("service_pct") is not None else 50)
    except (TypeError, ValueError):
        raise ValueError("value, term, rate, and service % must be numbers")
    if value <= 0:
        raise ValueError("value must be greater than 0")
    if term < 1 or term > 120:
        raise ValueError("term must be between 1 and 120 months")
    if rate < 0 or rate > 30:
        raise ValueError("rate must be between 0 and 30")
    if service < 0 or service > 100:
        raise ValueError("service % must be between 0 and 100")
    try:
        datetime.date.fromisoformat(start)
    except ValueError:
        raise ValueError("start date must be YYYY-MM-DD")
    if "note" in body:
        note_raw = body.get("note")
    elif "notes" in body:
        note_raw = body.get("notes")
    else:
        note_raw = ""
    note = str(note_raw or "").strip()[:500]
    return {
        "id": (existing or {}).get("id") or uuid.uuid4().hex[:12],
        "unit": unit[:40],
        "nickname": nickname[:120],
        "branch": branch,
        "value": value,
        "start_date": start,
        "term": term,
        "rate": rate,
        "service_pct": service,
        "note": note,
    }


def _match_unit(vehicles, unit):
    want = " ".join(str(unit or "").split()).lower()
    if not want:
        raise KeyError(unit)
    for vehicle in vehicles:
        if " ".join(str(vehicle.get("unit") or "").split()).lower() == want:
            return vehicle
    raise KeyError(unit)


def _merge_vehicle(existing, body):
    """PATCH keeps omitted fields. A present note replaces the stored one."""
    if not isinstance(body, dict):
        raise ValueError("vehicle required")
    merged = {
        "unit": existing.get("unit"),
        "nickname": existing.get("nickname"),
        "branch": existing.get("branch"),
        "value": existing.get("value"),
        "start_date": existing.get("start_date"),
        "term": existing.get("term"),
        "rate": existing.get("rate"),
        "service_pct": existing.get("service_pct"),
        "note": existing.get("note") if existing.get("note") is not None else existing.get("notes") or "",
    }
    for key in ("unit", "nickname", "branch", "value", "start_date", "term", "rate", "service_pct"):
        if key in body:
            merged[key] = body[key]
    if "note" in body:
        merged["note"] = body.get("note")
    elif "notes" in body:
        merged["note"] = body.get("notes")
    return merged


def _clean_ignored(units):
    if not isinstance(units, list):
        raise ValueError("ignored units must be a list")
    out = []
    seen = set()
    for raw in units:
        unit = " ".join(str(raw or "").split())
        if not unit or unit in seen:
            continue
        seen.add(unit)
        out.append(unit[:40])
    return out


class VehicleLease:
    def __init__(self, data_dir, seed_dir):
        self.data_dir = Path(data_dir)
        self.seed_dir = Path(seed_dir)
        self.path = self.data_dir / "vehicle_lease.json"
        self.files = self.data_dir / "vehicle_lease"
        self.lock_path = self.data_dir / "vehicle_lease.lock"

    def _locked(self, fn):
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.lock_path, "a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                return fn()
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def _blank(self):
        vehicles = []
        with (self.seed_dir / "fleet_registry.csv").open(newline="", encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                vehicles.append({
                    "id": uuid.uuid4().hex[:12],
                    "unit": (row.get("Unit #") or "").strip(),
                    "nickname": (row.get("Nickname") or "").strip(),
                    "branch": (row.get("Branch") or "").strip(),
                    "value": float(row.get("Starting Value") or 0),
                    "start_date": (row.get("Start Date") or "").strip(),
                    "term": int(float(row.get("Term (months)") or 60)),
                    "rate": float(row.get("Interest Rate (%)") or 7),
                    "service_pct": float(row.get("Service %") or 0),
                    "note": (row.get("Notes") or "").strip(),
                })
        ignored = [
            line.strip()
            for line in (self.seed_dir / "ignored_units.txt").read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        return {"vehicles": vehicles, "ignored": ignored, "settings": default_settings(), "runs": {}}

    def _read(self):
        if not self.path.exists():
            state = self._blank()
            self._write(state)
            return state
        state = json.loads(self.path.read_text(encoding="utf-8"))
        for vehicle in state.get("vehicles") or []:
            if "note" not in vehicle:
                vehicle["note"] = str(vehicle.pop("notes", "") or "").strip()
            else:
                vehicle.pop("notes", None)
                vehicle["note"] = str(vehicle.get("note") or "").strip()
        return state

    def _write(self, state):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state, indent=1), encoding="utf-8")
        os.replace(tmp, self.path)

    def state(self):
        def run():
            return self._read()
        return self._locked(run)

    def public(self):
        state = self.state()
        moment = now()
        year, month = moment.year, moment.month
        if month == 1:
            default = f"{year - 1}-12"
        else:
            default = f"{year:04d}-{month - 1:02d}"
        runs = [self._public_run(item) for item in state.get("runs", {}).values()]
        runs.sort(key=lambda item: item["month"], reverse=True)
        return {
            "settings": state["settings"],
            "vehicles": state["vehicles"],
            "ignored": state["ignored"],
            "runs": runs,
            "branches": BRANCHES,
            "branch_choices": BRANCH_CHOICES,
            "default_month": default,
        }

    def _public_run(self, item):
        month = item["month"]
        return {
            "month": month,
            "label": month_label(month),
            "created_at": item.get("created_at"),
            "total": item.get("total"),
            "active_units": item.get("active_units"),
            "branches": item.get("branches") or {},
            "fleet_check": item.get("fleet_check") or {"status": "", "text": ""},
            "qbo_je": item.get("qbo_je") or "",
            "source": item.get("source") or "",
            "je_url": f"/api/vehicle-lease/runs/{month}/je.csv",
            "pdf_url": f"/api/vehicle-lease/runs/{month}/report.pdf",
            "detail_url": f"/api/vehicle-lease/runs/{month}/detail.csv",
        }

    def save_vehicle(self, body, vehicle_id=None):
        def run():
            state = self._read()
            existing = None
            if vehicle_id:
                existing = next((v for v in state["vehicles"] if v["id"] == vehicle_id), None)
                if not existing:
                    raise KeyError(vehicle_id)
            clean = _clean_vehicle(body, state["settings"], existing)
            for other in state["vehicles"]:
                if other["id"] != clean["id"] and other["unit"].lower() == clean["unit"].lower():
                    raise UnitExists(f"unit {clean['unit']} is already in the registry")
            if existing:
                existing.pop("notes", None)
                existing.update(clean)
                saved = existing
            else:
                state["vehicles"].append(clean)
                saved = clean
            self._write(state)
            return saved
        return self._locked(run)

    def update_by_unit(self, unit, body):
        def run():
            state = self._read()
            existing = _match_unit(state["vehicles"], unit)
            clean = _clean_vehicle(_merge_vehicle(existing, body), state["settings"], existing)
            for other in state["vehicles"]:
                if other["id"] != clean["id"] and other["unit"].lower() == clean["unit"].lower():
                    raise UnitExists(f"unit {clean['unit']} is already in the registry")
            existing.pop("notes", None)
            existing.update(clean)
            self._write(state)
            return existing
        return self._locked(run)

    def delete_by_unit(self, unit):
        def run():
            state = self._read()
            existing = _match_unit(state["vehicles"], unit)
            state["vehicles"] = [v for v in state["vehicles"] if v["id"] != existing["id"]]
            self._write(state)
            return existing["unit"]
        return self._locked(run)

    def add_ignored(self, raw_units):
        def run():
            state = self._read()
            existing = list(state.get("ignored") or [])
            known = {" ".join(str(item).split()).lower() for item in existing}
            added = []
            saw_text = False
            for raw in raw_units:
                unit = " ".join(str(raw or "").split())[:40]
                if not unit:
                    continue
                saw_text = True
                key = unit.lower()
                if key in known:
                    continue
                known.add(key)
                existing.append(unit)
                added.append(unit)
            if not saw_text:
                raise ValueError("unit is required")
            state["ignored"] = existing
            self._write(state)
            return added, existing
        return self._locked(run)

    def remove_ignored(self, unit):
        def run():
            state = self._read()
            want = " ".join(str(unit or "").split()).lower()
            if not want:
                raise KeyError(unit)
            kept = []
            removed = None
            for item in state.get("ignored") or []:
                if removed is None and " ".join(str(item).split()).lower() == want:
                    removed = item
                    continue
                kept.append(item)
            if removed is None:
                raise KeyError(unit)
            state["ignored"] = kept
            self._write(state)
            return removed, kept
        return self._locked(run)

    def delete_vehicle(self, vehicle_id):
        def run():
            state = self._read()
            kept = [v for v in state["vehicles"] if v["id"] != vehicle_id]
            if len(kept) == len(state["vehicles"]):
                raise KeyError(vehicle_id)
            state["vehicles"] = kept
            self._write(state)
        return self._locked(run)

    def save_ignored(self, units):
        def run():
            state = self._read()
            state["ignored"] = _clean_ignored(units)
            self._write(state)
            return state["ignored"]
        return self._locked(run)

    def save_settings(self, body):
        def run():
            state = self._read()
            state["settings"] = _clean_settings(body)
            self._write(state)
            return state["settings"]
        return self._locked(run)

    def _month_dir(self, iso):
        dest = self.files / iso
        dest.mkdir(parents=True, exist_ok=True)
        return dest

    def generate(self, month, fleet_csv=""):
        year, mon, iso = parse_month(month)

        def run():
            state = self._read()
            check = None
            if str(fleet_csv or "").strip():
                check = fleet_check_csv(fleet_csv, state["vehicles"], state["ignored"])
                check = {"status": check["status"], "text": check["text"]}
            je, summary, _journal = build_je_csv(state["vehicles"], state["settings"], year, mon)
            detail = build_detail_csv(state["vehicles"], state["settings"], year, mon)
            pdf = build_pdf(state["vehicles"], state["settings"], year, mon, summary)
            if check is None:
                count = len(summary["active"])
                noun = "unit" if count == 1 else "units"
                check = {"status": "ok" if count else "flagged", "text": f"{count} active {noun} in the registry for {month_label(iso)}."}
            dest = self._month_dir(iso)
            (dest / "je.csv").write_text(je, encoding="utf-8")
            (dest / "detail.csv").write_text(detail, encoding="utf-8")
            (dest / "report.pdf").write_bytes(pdf)
            previous = state["runs"].get(iso) or {}
            item = {
                "month": iso,
                "created_at": previous.get("created_at") or now().isoformat(timespec="seconds"),
                "updated_at": now().isoformat(timespec="seconds"),
                "total": summary["total"],
                "active_units": len(summary["active"]),
                "branches": summary["branches"],
                "fleet_check": check,
                "qbo_je": previous.get("qbo_je") or "",
                "source": "dashboard",
            }
            state["runs"][iso] = item
            self._write(state)
            return self._public_run(item)
        return self._locked(run)

    def store_upload(self, month, fields, je_bytes, pdf_bytes, detail_bytes):
        _year, _mon, iso = parse_month(month)
        if not je_bytes or b"JournalNo" not in je_bytes.splitlines()[0]:
            raise ValueError("JE CSV must include a JournalNo header")
        if not pdf_bytes or not pdf_bytes.startswith(b"%PDF"):
            raise ValueError("report must be a PDF")
        if not detail_bytes or b"Branch" not in detail_bytes.splitlines()[0]:
            raise ValueError("detail CSV must include a Branch header")
        try:
            total = float(fields.get("total"))
        except (TypeError, ValueError):
            raise ValueError("total is required")
        branches = fields.get("branches") or {}
        if isinstance(branches, str):
            try:
                branches = json.loads(branches)
            except json.JSONDecodeError:
                raise ValueError("branches must be JSON")
        if not isinstance(branches, dict):
            raise ValueError("branches must be an object")
        clean_branches = {}
        for branch in BRANCHES:
            if branch not in branches:
                continue
            try:
                clean_branches[branch] = float(branches[branch])
            except (TypeError, ValueError):
                raise ValueError(f"{branch} total must be a number")
        try:
            active = int(fields.get("active_units") or 0)
        except (TypeError, ValueError):
            raise ValueError("active_units must be a number")
        status = str(fields.get("fleet_status") or "ok").strip().lower()
        if status not in {"ok", "flagged", "skipped"}:
            raise ValueError("fleet_status must be ok, flagged, or skipped")
        text = str(fields.get("fleet_check") or "").strip()[:1000]
        qbo = str(fields.get("qbo_je") or "").strip()[:40]

        def run():
            state = self._read()
            dest = self._month_dir(iso)
            (dest / "je.csv").write_bytes(je_bytes)
            (dest / "report.pdf").write_bytes(pdf_bytes)
            (dest / "detail.csv").write_bytes(detail_bytes)
            previous = state["runs"].get(iso) or {}
            item = {
                "month": iso,
                "created_at": previous.get("created_at") or now().isoformat(timespec="seconds"),
                "updated_at": now().isoformat(timespec="seconds"),
                "total": cents(total),
                "active_units": active,
                "branches": clean_branches,
                "fleet_check": {"status": status, "text": text},
                "qbo_je": qbo or previous.get("qbo_je") or "",
                "source": "ingest",
            }
            state["runs"][iso] = item
            self._write(state)
            return self._public_run(item)
        return self._locked(run)

    def set_qbo(self, month, qbo_je):
        _year, _mon, iso = parse_month(month)
        qbo = str(qbo_je or "").strip()[:40]

        def run():
            state = self._read()
            item = state.get("runs", {}).get(iso)
            if not item:
                raise KeyError(iso)
            item["qbo_je"] = qbo
            item["updated_at"] = now().isoformat(timespec="seconds")
            self._write(state)
            return self._public_run(item)
        return self._locked(run)

    def open_file(self, month, kind):
        _year, _mon, iso = parse_month(month)
        name = {"je": "je.csv", "pdf": "report.pdf", "detail": "detail.csv"}.get(kind)
        if not name:
            raise KeyError(kind)
        path = (self.files / iso / name).resolve()
        root = self.files.resolve()
        if root not in path.parents or not path.is_file():
            raise KeyError(iso)
        return path
