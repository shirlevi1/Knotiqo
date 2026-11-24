import json
from io import BytesIO

from django.http import HttpResponse
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from rest_framework.response import Response

from .guests import GuestFilters, WeddingGuestView


XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_EXPORT_ROWS = 5000
MAX_EXPORT_TEXT = 4_000_000
GUEST_COLUMNS = (
    ("full_name", "שם מלא", 27),
    ("phone", "טלפון", 20),
    ("email", "אימייל", 31),
    ("side", "צד בחתונה", 17),
    ("category", "קטגוריה", 15),
    ("party_size", "כמות מוזמנים", 17),
    ("adult_count", "מבוגרים", 14),
    ("child_count", "ילדים", 14),
    ("infant_count", "תינוקות", 14),
    ("family_group", "קבוצה משפחתית", 24),
    ("notes", "הערות", 42),
)
EXPORT_COLUMNS = GUEST_COLUMNS + (("tags", "תגיות", 27), ("is_archived", "בארכיון", 13))


def data_sheet(workbook, columns, rows):
    sheet = workbook.active
    sheet.title = "מוזמנים"
    sheet.sheet_view.rightToLeft = True
    sheet.freeze_panes = "A2"
    sheet.row_dimensions[1].height = 24
    for index, (key, heading, width) in enumerate(columns, 1):
        dimension = sheet.column_dimensions[get_column_letter(index)]
        dimension.width = width
        if key == "phone":
            dimension.number_format = "@"
        header = sheet.cell(1, index, heading)
        header.fill = PatternFill("solid", fgColor="385F76")
        header.font = Font(color="FFFFFF", bold=True)
        header.alignment = Alignment(horizontal="right", vertical="center")
    for row_number, row in enumerate(rows, 2):
        for column, (key, _, _) in enumerate(columns, 1):
            value = row[key]
            if isinstance(value, str):
                value = ILLEGAL_CHARACTERS_RE.sub("\uFFFD", value).replace("\uFFFE", "\uFFFD").replace("\uFFFF", "\uFFFD")
            cell = sheet.cell(row_number, column, value)
            # Explicit OOXML text type keeps formula-like values literal,
            # including leading spaces and characters such as +, -, and @.
            if isinstance(value, str):
                cell.data_type = "s"
            if key == "phone":
                cell.number_format = "@"
    sheet.auto_filter.ref = sheet.dimensions


def file_response(workbook, filename):
    buffer = BytesIO()
    try:
        workbook.save(buffer)
        response = HttpResponse(buffer.getvalue(), content_type=XLSX_TYPE)
    finally:
        workbook.close()
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["X-Content-Type-Options"] = "nosniff"
    return response


class GuestTemplate(WeddingGuestView):
    http_method_names = ["get", "head", "options"]

    def get(self, request, wedding_id):
        workbook = Workbook()
        data_sheet(workbook, GUEST_COLUMNS, ())
        instructions = workbook.create_sheet("הוראות")
        instructions.sheet_view.rightToLeft = True
        instructions.column_dimensions["A"].width = 86
        instructions.row_dimensions[1].height = 150
        # Keep all instructions on the heading row, so this tab has no data
        # rows even if someone selects it during import.
        note = instructions["A1"]
        note.value = (
            "מלאו את גיליון ״מוזמנים״ החל משורה 2 והשאירו את הכותרות בשורה 1.\n"
            "שם מלא הוא שדה חובה. יתר השדות אופציונליים. מספרי טלפון נשמרים כטקסט.\n"
            "צד בחתונה: כלה, חתן, משותף, לא משויך. קטגוריה: מבוגר, ילד, תינוק.\n"
            "הזינו מספר מבוגרים, ילדים ותינוקות. אם הזנתם פירוט, תאים ריקים בפירוט נספרים כאפס.\n"
            "כמות מוזמנים, אם הוזנה, כוללת את כולם וחייבת להתאים לסכום הפירוט.\n"
            "אם ידועה רק הכמות הכוללת, השאירו את תאי הפירוט ריקים. ברירת המחדל היא 1.\n"
            "לאחר שמירת הקובץ כ־XLSX בחרו בגיליון ״מוזמנים״ בייבוא של Knotiqo."
        )
        note.fill = PatternFill("solid", fgColor="EAF5FA")
        note.font = Font(color="253C50")
        note.alignment = Alignment(wrap_text=True, horizontal="right", vertical="center")
        return file_response(workbook, "knotiqo-guest-template.xlsx")


class GuestExport(WeddingGuestView):
    http_method_names = ["get", "head", "options"]

    def get(self, request, wedding_id):
        filters = GuestFilters(data={"archive": request.query_params.get("archive", "active")})
        filters.is_valid(raise_exception=True)
        archive = filters.validated_data["archive"]
        guests = self.get_queryset()
        if archive != "all":
            guests = guests.filter(is_archived=archive == "archived")
        fields = [key for key, _, _ in EXPORT_COLUMNS]
        rows, text_size = [], 0
        for row in guests.values(*fields)[:MAX_EXPORT_ROWS + 1].iterator(chunk_size=100):
            row["tags"] = json.dumps(row["tags"], ensure_ascii=False)
            row["is_archived"] = "כן" if row["is_archived"] else "לא"
            text_size += sum(len(value) for value in row.values() if isinstance(value, str))
            if len(rows) == MAX_EXPORT_ROWS or text_size > MAX_EXPORT_TEXT:
                return Response({"error": {"code": "export_limit"}}, status=422)
            rows.append(row)
        workbook = Workbook()
        data_sheet(workbook, EXPORT_COLUMNS, rows)
        return file_response(workbook, "knotiqo-guests.xlsx")
