from datetime import timedelta
from io import BytesIO, StringIO
from unittest.mock import patch
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.styles import Font
from rest_framework.test import APIClient

from weddings.guest_workbook import (
    MAX_CELL, MAX_COLUMNS, MAX_DATA_ROWS, MAX_EXPANDED, MAX_SHEETS, MAX_SOURCE_ROW, MAX_UPLOAD, SHEET_NS,
)
from weddings.models import Guest, GuestImportSession, WeddingMembership
from weddings.services import create_wedding


def xlsx(*sheets, edit=None):
    book = Workbook()
    book.remove(book.active)
    for title, rows in sheets:
        sheet = book.create_sheet(title)
        for row in rows:
            sheet.append(row)
    if edit:
        edit(book)
    stream = BytesIO()
    book.save(stream)
    book.close()
    return SimpleUploadedFile("guests.xlsx", stream.getvalue())


class GuestImportTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        users = get_user_model().objects
        cls.owner = users.create_user(username="import-owner")
        cls.partner = users.create_user(username="import-partner")
        cls.other = create_wedding(user=cls.owner, name="Second wedding")
        cls.wedding = create_wedding(user=cls.owner, name="Shared")
        WeddingMembership.objects.create(wedding=cls.wedding, user=cls.partner)

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.login(self.owner)
        self.root = f"/api/weddings/{self.wedding.pk}/guests/import/"

    def login(self, user):
        self.client.force_login(user)
        self.client.get("/api/auth/csrf/")
        self.headers = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}

    def upload(self, file):
        return self.client.post(self.root, {"workbook": file}, **self.headers)

    def preview(self, session, worksheet="List", mapping=None):
        return self.client.post(f"{self.root}{session}/preview/", {
            "worksheet": worksheet, "mapping": mapping or {"full_name": 1},
        }, format="json", **self.headers)

    def confirm(self, session, preview, decisions):
        return self.client.post(f"{self.root}{session}/confirm/", {
            "preview_id": preview, "decisions": decisions,
        }, format="json", **self.headers)

    def test_inspect_multisheet_mapping_validation_and_source_rows(self):
        response = self.upload(xlsx(
            ("עברית", [
                ["טלפון", "כמות", "שם מלא", "צד", "הערה פרטית", "קטגוריה"],
                ["050-1234567", 2, "  דנה   לוי ", "כלה", "ignore", "ילד"],
                [None] * 6, [501234567, 0, None, "unknown", None, "unknown"],
                [501234567, 1, "טל", None, None, None],
                ["0123456789", "=1+2", "רוני"],
            ]),
            ("English", [["E-mail", "Family Group", "Guest Name"]]),
            edit=lambda book: setattr(book["עברית"]["A5"], "number_format", "0000000000"),
        ))
        self.assertEqual(response.status_code, 201, response.data)
        data = response.json()
        self.assertEqual([sheet["name"] for sheet in data["worksheets"]], ["עברית", "English"])
        self.assertEqual(data["worksheets"][0]["columns"][2]["suggested_field"], "full_name")
        self.assertEqual(data["worksheets"][1]["columns"][0]["suggested_field"], "email")
        result = self.preview(data["session_id"], "עברית", {
            "full_name": 3, "phone": 1, "party_size": 2, "side": 4, "category": 6,
        })
        self.assertEqual(result.status_code, 200, result.data)
        data = result.json()
        self.assertEqual([row["row"] for row in data["rows"]], [2, 4, 5, 6])
        first, invalid, padded, formula = data["rows"]
        self.assertEqual(first["values"]["full_name"], "דנה לוי")
        self.assertEqual(first["values"]["phone"], "0501234567")
        self.assertEqual(first["values"]["category"], "child")
        self.assertEqual(first["values"]["side"], "bride")
        self.assertEqual(set(invalid["errors"]), {"full_name", "party_size", "side", "category"})
        self.assertIn("check_numeric_phone_leading_zeros", invalid["warnings"])
        self.assertEqual(padded["values"]["phone"], "0501234567")
        self.assertEqual(formula["errors"]["party_size"], ["formula"])
        self.assertEqual([col["column"] for col in data["unmapped_columns"]], [5])
        self.assertFalse(Guest.objects.exists())

    def test_duplicate_review_restore_update_create_and_idempotence(self):
        archived = Guest.objects.create(wedding=self.wedding, full_name="Old name", phone="050-1234567",
                                        notes="Keep", tags=["family"], is_archived=True)
        active = Guest.objects.create(wedding=self.wedding, full_name="Dana", email="DANA@example.com", party_size=4)
        Guest.objects.create(wedding=self.wedding, full_name="Dana")
        foreign = Guest.objects.create(wedding=self.other, full_name="Dana", email="dana@example.com")
        session = self.upload(xlsx(("List", [
            ["Name", "Phone", "Email"], ["New name", "0501234567"], ["Dana", None, "dana@example.com"],
            ["Dana"], ["New guest"],
        ]))).json()["session_id"]
        preview = self.preview(session, mapping={"full_name": 1, "phone": 2, "email": 3}).json()
        first, second, *_ = preview["rows"]
        self.assertEqual(first["duplicates"]["guests"][0]["matched_on"], ["phone"])
        self.assertTrue(first["duplicates"]["guests"][0]["is_archived"])
        self.assertEqual(second["duplicates"]["rows"], [{"row": 4, "matched_on": ["name"]}])
        self.assertEqual(second["duplicates"]["guests"][0]["id"], active.pk)
        self.assertNotIn(foreign.pk, [guest["id"] for guest in second["duplicates"]["guests"]])
        decisions = [
            {"row": 2, "action": "restore", "guest_id": archived.pk},
            {"row": 3, "action": "update", "guest_id": active.pk},
            {"row": 4, "action": "skip"}, {"row": 5, "action": "create"},
        ]
        result = self.confirm(session, preview["preview_id"], decisions)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.json(), {"created": 1, "skipped": 1, "updated": 1, "restored": 1})
        self.assertEqual(self.confirm(session, preview["preview_id"], decisions[::-1]).json(), result.json())
        self.assertEqual(self.confirm(session, preview["preview_id"], decisions[:1]).status_code, 409)
        archived.refresh_from_db()
        active.refresh_from_db()
        self.assertEqual((archived.full_name, archived.is_archived, archived.notes, archived.tags),
                         ("New name", False, "Keep", ["family"]))
        self.assertEqual(active.party_size, 4)
        self.assertEqual(Guest.objects.filter(wedding=self.wedding, full_name="New guest").count(), 1)
        self.assertEqual(GuestImportSession.objects.get(pk=session).sheets, [])

    def test_failed_batch_rolls_back_and_stale_revision_or_guest_is_rejected(self):
        guest = Guest.objects.create(wedding=self.wedding, full_name="Match")
        session = self.upload(xlsx(("List", [["Name"], ["Create"], ["Match"], [None, "blank"]]))).json()["session_id"]
        prior = self.preview(session).json()["preview_id"]
        preview = self.preview(session).json()["preview_id"]
        create = {"row": 2, "action": "create"}
        self.assertEqual(self.confirm(session, prior, [create]).status_code, 409)
        self.assertEqual(self.confirm(session, preview, [create, {"row": 4, "action": "create"}]).status_code, 400)
        self.assertEqual(self.confirm(session, preview, [
            create, {"row": 3, "action": "update", "guest_id": guest.pk + 999},
        ]).status_code, 400)
        guest.notes = "Changed since preview"
        guest.save()
        self.assertEqual(self.confirm(session, preview, [
            create, {"row": 3, "action": "update", "guest_id": guest.pk},
        ]).status_code, 409)
        self.assertEqual(Guest.objects.count(), 1)
        self.assertEqual(self.confirm(session, preview, [create]).status_code, 200)

    def test_sessions_are_owned_and_expire_and_upload_requires_csrf(self):
        response = self.client.post(self.root, {"workbook": xlsx(("List", [["Name"]]))})
        self.assertEqual(response.status_code, 403)
        session = self.upload(xlsx(("List", [["Name"], ["Dana"]]))).json()["session_id"]
        self.assertEqual(self.preview(uuid4()).status_code, 404)
        other_url = f"/api/weddings/{self.other.pk}/guests/import/{session}/preview/"
        self.assertEqual(self.client.post(other_url, {"worksheet": "List", "mapping": {"full_name": 1}},
                                          format="json", **self.headers).json(), {"detail": "Not found."})
        self.login(self.partner)
        self.assertEqual(self.preview(session).status_code, 404)
        self.assertEqual(self.client.post(f"/api/weddings/{self.other.pk}/guests/import/", b"invalid",
                                          content_type="application/json", **self.headers).status_code, 404)
        self.login(self.owner)
        GuestImportSession.objects.filter(pk=session).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.preview(session).status_code, 410)
        self.assertEqual(self.confirm(session, uuid4(), [{"row": 2, "action": "create"}]).status_code, 410)
        call_command("cleanup_guest_imports", stdout=StringIO())
        self.assertFalse(GuestImportSession.objects.exists())
        self.client.logout()
        self.assertEqual(self.upload(xlsx(("List", [["Name"]]))).status_code, 403)

    def test_small_hebrew_workbook_ignores_formatting_only_rows_and_columns(self):
        def format_empty_row(book):
            book.active.row_dimensions[900].height = 23
            book.active["A901"].font = Font(bold=True)

        def format_empty_column(book):
            book.active.column_dimensions["ZZ"].width = 24
            book.active["ZZ2"].font = Font(bold=True)

        for edit in (None, format_empty_row, format_empty_column):
            with self.subTest(edit=edit):
                file = xlsx(("עברית", [["שם מלא", "טלפון"], ["נועה לוי", "0501234567"]]), edit=edit)
                self.assertLess(file.size, 20_000)
                result = self.upload(file)
                self.assertEqual(result.status_code, 201, result.data)
                data = result.json()
                self.assertEqual(len(data["worksheets"][0]["columns"]), 2)
                preview = self.preview(data["session_id"], "עברית", {"full_name": 1, "phone": 2})
                self.assertEqual(preview.json()["rows"][0]["values"], {
                    "full_name": "נועה לוי", "phone": "0501234567", "adult_count": "1", "child_count": "0", "infant_count": "0",
                })

    def test_rejects_malformed_and_oversized_uploads(self):
        archive = BytesIO()
        with ZipFile(archive, "w", ZIP_DEFLATED) as workbook:
            workbook.writestr("large.xml", b"0" * (MAX_EXPANDED + 1))
        forbidden_xml = BytesIO()
        with ZipFile(forbidden_xml, "w", ZIP_DEFLATED) as workbook:
            workbook.writestr("[Content_Types].xml", '<!DOCTYPE Types SYSTEM "unused"><Types/>')
        protected = "PRIVATE_GUEST_TEXT"
        for file, status, code, rule in (
            (SimpleUploadedFile("list.xls", b"wrong"), 400, "unsupported_file", "file_extension"),
            (SimpleUploadedFile("list.xlsx", b"not zipped"), 400, "invalid_workbook", "decode_structure"),
            (SimpleUploadedFile("list.xlsx", forbidden_xml.getvalue()), 400, "invalid_workbook", "decode_structure"),
            (SimpleUploadedFile("list.xlsx", b"0" * (MAX_UPLOAD + 1)), 413, "file_size", "upload_bytes"),
            (SimpleUploadedFile("list.xlsx", archive.getvalue()), 400, "workbook_package_limit", "zip_expanded_bytes"),
            (xlsx(*[(str(i), [["Name"]]) for i in range(MAX_SHEETS + 1)]),
             400, "workbook_sheet_limit", "worksheet_count"),
            (xlsx(("List", [["Name"], ["x" * (MAX_CELL + 1)]])), 400, "workbook_text_limit", "cell_text_length"),
            (xlsx(("List", [["Name"]] + [[protected]] * (MAX_DATA_ROWS + 1))),
             400, "workbook_row_limit", "populated_row_count"),
            (xlsx(("List", [["Name"]]), edit=lambda book: book.active.cell(MAX_SOURCE_ROW + 1, 1, protected)),
             400, "workbook_row_position", "populated_row_position"),
            (xlsx(("List", [["Name"]]), edit=lambda book: book.active.cell(2, MAX_COLUMNS + 1, protected)),
             400, "workbook_column_limit", "populated_column_position"),
        ):
            with self.subTest(code=code), self.assertLogs("weddings.guest_workbook") as logs:
                response = self.upload(file)
                self.assertEqual((response.status_code, response.json()), (status, {"error": {"code": code}}))
                self.assertIn(f"rule={rule}", logs.output[0])
                self.assertNotIn(protected, logs.output[0])
                self.assertNotIn(file.name, logs.output[0])
        styled = xlsx(("List", [["Name"]]), edit=lambda book: setattr(book.active["ZZ2"], "font", Font(bold=True)))
        with patch("weddings.guest_workbook.MAX_XML_CELLS", 1), self.assertLogs("weddings.guest_workbook"):
            response = self.upload(styled)
        self.assertEqual(response.json(), {"error": {"code": "workbook_metadata_limit"}})
        with patch("weddings.guest_workbook.monotonic", side_effect=[0, 6]):
            response = self.upload(xlsx(("List", [["Name"]])))
        self.assertEqual((response.status_code, response.json()), (422, {"error": {"code": "workbook_timeout"}}))
        self.assertFalse(GuestImportSession.objects.exists())

    def test_sparse_formatted_hebrew_sheet_preserves_source_rows_and_blocks_mapped_formulas(self):
        from xml.etree.ElementTree import fromstring

        def format_sheet(book):
            sheet = book.active
            for index in range(1, 1001):
                sheet.row_dimensions[index].height = 16
            for index in range(90, 170):
                sheet.cell(index, 1, f"פריט בדיקה {index}")
                if index < 103:
                    sheet.cell(index, 2, "=1+1")
            for index in [*range(200, 594), 1000]:
                sheet.cell(index, 18).font = Font(bold=True)

        file = xlsx(("עברית", [["שם מלא", "הערות"]]), edit=format_sheet)
        with ZipFile(file) as archive:
            root = fromstring(archive.read("xl/worksheets/sheet1.xml"))
        file.seek(0)
        self.assertEqual(root.find(f"{SHEET_NS}dimension").get("ref"), "A1:R1000")
        self.assertEqual(len(list(root.iter(f"{SHEET_NS}row"))), 1000)
        response = self.upload(file)
        self.assertEqual(response.status_code, 201)
        session = response.json()["session_id"]
        preview = self.preview(session, "עברית", {"full_name": 1, "notes": 2}).json()
        self.assertEqual([row["row"] for row in preview["rows"]], list(range(90, 170)))
        self.assertEqual(sum(row["errors"].get("notes") == ["formula"] for row in preview["rows"]), 13)
        self.assertEqual(self.confirm(session, preview["preview_id"], [{"row": 90, "action": "create"}]).status_code, 400)
        self.assertFalse(Guest.objects.exists())

    def test_age_counts_in_preview_and_duplicate_update(self):
        known = Guest.objects.create(wedding=self.wedding, full_name="Synthetic family", party_size=4,
                                     adult_count=2, child_count=1, infant_count=1)
        upload = self.upload(xlsx(("List", [
            ["Name", "Guest Count", "Adults", "Children", "Infants"],
            ["Synthetic family", 5], ["Synthetic family", None, 2, 1], ["Invalid", 3, 1],
        ]))).json()
        session = upload["session_id"]
        preview = self.preview(session, mapping={
            "full_name": 1, "party_size": 2, "adult_count": 3, "child_count": 4, "infant_count": 5,
        }).json()
        self.assertEqual(preview["rows"][1]["values"]["infant_count"], "0")
        self.assertEqual(preview["rows"][1]["values"]["party_size"], "3")
        self.assertIn("party_size", preview["rows"][2]["errors"])
        response = self.confirm(session, preview["preview_id"], [{"row": 2, "action": "update", "guest_id": known.pk}])
        self.assertEqual((response.status_code, response.json()), (409, {"error": {"code": "guest_age_conflict"}}))
        self.assertEqual(self.confirm(session, preview["preview_id"], [
            {"row": 3, "action": "update", "guest_id": known.pk},
        ]).json()["updated"], 1)
        known.refresh_from_db()
        self.assertEqual((known.party_size, known.adult_count, known.child_count, known.infant_count), (4, 2, 1, 1))

    def test_counts_populated_rows_and_warns_after_non_guest_section_markers(self):
        def sparse_row(book):
            book.active.cell(1000, 1, "Synthetic row")

        upload = self.upload(xlsx(("List", [["Name", "Notes"], ["Synthetic first"], ["Name", "Notes"], ["סיכום"]]),
                                  edit=sparse_row))
        self.assertEqual(upload.status_code, 201)
        session = upload.json()["session_id"]
        preview = self.preview(session, mapping={"full_name": 1, "notes": 2}).json()
        self.assertEqual([row["row"] for row in preview["rows"]], [2, 3, 4, 1000])
        for row in preview["rows"][1:3]:
            self.assertEqual(row["errors"]["full_name"], ["non_guest_row"])
        self.assertIn("review_section_boundary", preview["rows"][3]["warnings"])
        self.assertEqual(self.confirm(session, preview["preview_id"], [{"row": 4, "action": "create"}]).status_code, 400)
        response = self.confirm(session, preview["preview_id"], [{"row": 1000, "action": "create"}])
        self.assertEqual(response.json()["created"], 1)

    def test_total_only_defaults_in_preview_without_overwriting_existing_family(self):
        existing = Guest.objects.create(wedding=self.wedding, full_name="Existing family", party_size=4,
                                        adult_count=2, child_count=1, infant_count=1)
        session = self.upload(xlsx(("List", [
            ["Name", "Guest Count", "Children", "Infants"],
            ["New adult group", 3], ["Existing family", "4.0"], ["New mixed family", 5, 1, 1],
        ]))).json()["session_id"]
        preview = self.preview(session, mapping={"full_name": 1, "party_size": 2, "child_count": 3, "infant_count": 4}).json()
        self.assertEqual([row["values"]["adult_count"] for row in preview["rows"]], ["3", "4", "3"])
        response = self.confirm(session, preview["preview_id"], [
            {"row": 2, "action": "create"}, {"row": 3, "action": "update", "guest_id": existing.pk},
            {"row": 4, "action": "create"},
        ])
        self.assertEqual(response.status_code, 200, response.json())
        existing.refresh_from_db()
        self.assertEqual((existing.adult_count, existing.child_count, existing.infant_count), (2, 1, 1))
        self.assertEqual(Guest.objects.get(full_name="New adult group").adult_count, 3)
        self.assertEqual(Guest.objects.get(full_name="New mixed family").adult_count, 3)
