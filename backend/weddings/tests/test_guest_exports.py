from io import BytesIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from openpyxl import load_workbook
from rest_framework.test import APIClient

from weddings.guest_exports import XLSX_TYPE
from weddings.models import Guest, WeddingMembership
from weddings.services import create_wedding


HEADINGS = ["שם מלא", "טלפון", "אימייל", "צד בחתונה", "קטגוריה", "כמות מוזמנים", "מבוגרים", "ילדים",
            "תינוקות", "קבוצה משפחתית", "הערות"]


class GuestWorkbookDownloadTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        users = get_user_model().objects
        cls.owner = users.create_user(username="export-owner")
        cls.partner = users.create_user(username="export-partner")
        cls.outsider = users.create_user(username="export-outsider")
        cls.wedding = create_wedding(user=cls.owner, name="Shared")
        cls.foreign = create_wedding(user=cls.outsider, name="Other")
        WeddingMembership.objects.create(wedding=cls.wedding, user=cls.partner)

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.force_login(self.owner)
        self.base = f"/api/weddings/{self.wedding.pk}/guests/"

    def workbook(self, response, filename):
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], XLSX_TYPE)
        self.assertEqual(response["Content-Disposition"], f'attachment; filename="{filename}"')
        self.assertIn("no-store", response["Cache-Control"])
        book = load_workbook(BytesIO(response.content), data_only=False)
        self.addCleanup(book.close)
        return book

    def test_template_has_hebrew_headers_and_passes_existing_upload_and_preview(self):
        response = self.client.get(self.base + "template/")
        book = self.workbook(response, "knotiqo-guest-template.xlsx")
        self.assertEqual(book.sheetnames, ["מוזמנים", "הוראות"])
        self.assertEqual(list(book.active.values), [tuple(HEADINGS)])
        self.assertEqual(book["הוראות"].max_row, 1)
        self.assertTrue(book.active.sheet_view.rightToLeft)
        self.assertEqual(book.active.freeze_panes, "A2")
        self.assertEqual(book.active.column_dimensions["B"].number_format, "@")
        self.client.get("/api/auth/csrf/")
        csrf = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}
        upload = self.client.post(self.base + "import/", {
            "workbook": SimpleUploadedFile("template.xlsx", response.content),
        }, **csrf)
        self.assertEqual(upload.status_code, 201, upload.data)
        data = upload.json()
        columns = data["worksheets"][0]["columns"]
        mapping = {item["suggested_field"]: item["column"] for item in columns}
        self.assertEqual(mapping, {
            "full_name": 1, "phone": 2, "email": 3, "side": 4, "category": 5,
            "party_size": 6, "adult_count": 7, "child_count": 8, "infant_count": 9, "family_group": 10, "notes": 11,
        })
        self.assertIsNone(data["worksheets"][1]["columns"][0]["suggested_field"])
        preview = self.client.post(f"{self.base}import/{data['session_id']}/preview/", {
            "worksheet": "מוזמנים", "mapping": mapping,
        }, format="json", **csrf)
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.json()["rows"], [])

    def test_export_filters_membership_and_wedding_scope_and_preserves_fields(self):
        Guest.objects.create(wedding=self.wedding, full_name="נועה לוי", phone="0500123456",
                             email="noa@example.com", side="bride", category="child", party_size=3,
                             family_group="לוי", notes="הערה", tags=["קרובים"])
        Guest.objects.create(wedding=self.wedding, full_name="ארכיון", is_archived=True)
        Guest.objects.create(wedding=self.foreign, full_name="Private", is_archived=True)
        self.client.force_login(self.partner)
        for archive, names in (("", ["נועה לוי"]), ("archived", ["ארכיון"]), ("all", ["נועה לוי", "ארכיון"])):
            query = {"archive": archive} if archive else {}
            response = self.client.get(self.base + "export/", query)
            rows = list(self.workbook(response, "knotiqo-guests.xlsx").active.values)
            self.assertEqual(list(rows[0]), [*HEADINGS, "תגיות", "בארכיון"])
            self.assertEqual([row[0] for row in rows[1:]], names)
            if not archive:
                self.assertEqual(rows[1], ("נועה לוי", "0500123456", "noa@example.com", "bride", "child",
                                           3, 3, 0, 0, "לוי", "הערה", '["קרובים"]', "לא"))
            if archive:
                self.assertEqual(rows[-1][-1], "כן")

    def test_formula_like_text_remains_literal_and_party_size_is_numeric(self):
        Guest.objects.create(wedding=self.wedding, full_name="=1+1", phone="+972501234567",
                             email="test@example.com", family_group="-2+4", notes="@SUM(A1)\x01", party_size=2)
        Guest.objects.create(wedding=self.wedding, full_name="#REF!", notes=" \t=2+2")
        sheet = self.workbook(self.client.get(self.base + "export/"), "knotiqo-guests.xlsx").active
        for address, value in {
            "A2": "=1+1", "B2": "+972501234567", "J2": "-2+4", "K2": "@SUM(A1)\uFFFD",
            "A3": "#REF!", "K3": " \t=2+2",
        }.items():
            self.assertEqual((sheet[address].value, sheet[address].data_type), (value, "s"))
        self.assertEqual((sheet["F2"].value, sheet["F2"].data_type), (2, "n"))

    def test_empty_export_and_explicit_limits(self):
        sheet = self.workbook(self.client.get(self.base + "export/"), "knotiqo-guests.xlsx").active
        self.assertEqual(list(sheet.values), [(*HEADINGS, "תגיות", "בארכיון")])
        self.assertEqual(self.client.get(self.base + "export/", {"archive": "anything"}).status_code, 400)
        Guest.objects.create(wedding=self.wedding, full_name="Guest", notes="note")
        for setting, limit in (("MAX_EXPORT_ROWS", 0), ("MAX_EXPORT_TEXT", 1)):
            with patch(f"weddings.guest_exports.{setting}", limit):
                response = self.client.get(self.base + "export/")
            self.assertEqual((response.status_code, response.json()), (422, {"error": {"code": "export_limit"}}))

    def test_mixed_and_unclassified_records_round_trip_through_export_and_import(self):
        Guest.objects.create(wedding=self.wedding, full_name="Mixed fixture", party_size=4,
                             adult_count=2, child_count=1, infant_count=1)
        Guest.objects.create(wedding=self.wedding, full_name="Legacy fixture", party_size=3)
        response = self.client.get(self.base + "export/")
        self.client.get("/api/auth/csrf/")
        csrf = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}
        upload = self.client.post(self.base + "import/", {
            "workbook": SimpleUploadedFile("round-trip.xlsx", response.content),
        }, **csrf).json()
        mapping = {col["suggested_field"]: col["column"] for col in upload["worksheets"][0]["columns"]
                   if col["suggested_field"]}
        root = f"{self.base}import/{upload['session_id']}/"
        preview = self.client.post(root + "preview/", {
            "worksheet": "מוזמנים", "mapping": mapping,
        }, format="json", **csrf).json()
        mixed, legacy = preview["rows"]
        self.assertEqual([mixed["values"][key] for key in ("adult_count", "child_count", "infant_count", "party_size")],
                         ["2", "1", "1", "4"])
        self.assertEqual(legacy["values"]["adult_count"], "3")
        result = self.client.post(root + "confirm/", {
            "preview_id": preview["preview_id"],
            "decisions": [{"row": 2, "action": "create"}, {"row": 3, "action": "create"}],
        }, format="json", **csrf)
        self.assertEqual(result.json()["created"], 2)
        guests = list(Guest.objects.filter(wedding=self.wedding).values_list("party_size", "adult_count", "child_count", "infant_count"))
        self.assertEqual(guests, [(4, 2, 1, 1), (3, 3, 0, 0)] * 2)

    def test_downloads_require_login_and_membership(self):
        for suffix in ("template/", "export/"):
            self.client.force_login(self.owner)
            for wedding_id in (self.foreign.pk, 0):
                response = self.client.get(f"/api/weddings/{wedding_id}/guests/{suffix}")
                self.assertEqual((response.status_code, response.json()), (404, {"detail": "Not found."}))
            self.client.logout()
            self.assertEqual(self.client.get(self.base + suffix).status_code, 403)
