import logging
import re
from time import monotonic
from zipfile import BadZipFile, ZIP_DEFLATED, ZIP_STORED, ZipFile

from defusedxml.ElementTree import fromstring
from defusedxml.common import DefusedXmlException
from openpyxl import load_workbook
from openpyxl.utils.cell import column_index_from_string
from openpyxl.utils.exceptions import InvalidFileException
from xml.etree.ElementTree import ParseError


MAX_UPLOAD = 2 * 1024 * 1024
MAX_EXPANDED = 8 * 1024 * 1024
MAX_DATA_ROWS = 500
MAX_COLUMNS = 32
MAX_SHEETS = 8
MAX_CELL = 4000
MAX_TEXT = 400_000
MAX_XML_ROWS = 4096
MAX_SOURCE_ROW = MAX_XML_ROWS
MAX_XML_CELLS = 32_768
MAIN_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
SHARED_STRINGS_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"
SHEET_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
CELL_REF = re.compile(r"([A-Z]{1,3})([1-9][0-9]{0,6})")
logger = logging.getLogger(__name__)


class ImportIssue(Exception):
    def __init__(self, code, status=400):
        self.code = code
        self.status = status
        super().__init__(code)


def check_deadline(deadline):
    if monotonic() >= deadline:
        reject("parse_deadline", "workbook_timeout", limit=5, status=422)


def reject(rule, code, measured=None, limit=None, *, status=400):
    logger.warning("Guest workbook rejected: rule=%s measured=%s limit=%s", rule, measured, limit)
    raise ImportIssue(code, status)


def has_cell_content(cell, shared_strings):
    if cell.find(f"{SHEET_NS}f") is not None:
        return True
    if cell.get("t") == "inlineStr":
        inline = cell.find(f"{SHEET_NS}is")
        return inline is not None and any((node.text or "").strip() for node in inline.iter(f"{SHEET_NS}t"))
    value = cell.findtext(f"{SHEET_NS}v", default="").strip()
    if value and cell.get("t") == "s":
        if not re.fullmatch(r"[0-9]{1,8}", value) or int(value) >= len(shared_strings):
            reject("shared_string_index", "invalid_workbook")
        return shared_strings[int(value)]
    return bool(value)


def inspect_worksheet(root, shared_strings, deadline):
    prior_row = 0
    cell_count = 0
    data_rows = 0
    last_populated = 1
    for count, row in enumerate(root.iter(f"{SHEET_NS}row"), 1):
        check_deadline(deadline)
        if count > MAX_XML_ROWS:
            reject("worksheet_xml_rows", "workbook_metadata_limit", count, MAX_XML_ROWS)
        cell_count += len(row)
        if cell_count > MAX_XML_CELLS:
            reject("worksheet_xml_cells", "workbook_metadata_limit", cell_count, MAX_XML_CELLS)
        ref = row.get("r", str(prior_row + 1))
        if not re.fullmatch(r"[1-9][0-9]{0,6}", ref):
            reject("worksheet_row_reference", "invalid_workbook")
        row_number = int(ref)
        if not prior_row < row_number <= 1_048_576:
            reject("worksheet_row_reference", "invalid_workbook", row_number, 1_048_576)
        prior_row = row_number
        column = 0
        populated = False
        for cell in row:
            if cell.tag != f"{SHEET_NS}c":
                reject("worksheet_cell_element", "invalid_workbook")
            ref = cell.get("r")
            if ref is None:
                column += 1
            else:
                match = CELL_REF.fullmatch(ref)
                if not match or int(match[2]) != row_number:
                    reject("worksheet_cell_reference", "invalid_workbook")
                column = column_index_from_string(match[1])
            if column > 16_384:
                reject("worksheet_cell_reference", "invalid_workbook", column, 16_384)
            if not has_cell_content(cell, shared_strings):
                continue
            populated = True
            if row_number > MAX_SOURCE_ROW:
                reject("populated_row_position", "workbook_row_position", row_number, MAX_SOURCE_ROW)
            if column > MAX_COLUMNS:
                reject("populated_column_position", "workbook_column_limit", column, MAX_COLUMNS)
        if populated:
            last_populated = row_number
            if row_number > 1:
                data_rows += 1
                if data_rows > MAX_DATA_ROWS:
                    reject("populated_row_count", "workbook_row_limit", data_rows, MAX_DATA_ROWS)
    return last_populated


def inspect_package(upload, deadline):
    with ZipFile(upload) as archive:
        entries = archive.infolist()
        names = {entry.filename for entry in entries}
        if len(entries) > 96:
            reject("zip_entry_count", "workbook_package_limit", len(entries), 96)
        expanded_size = sum(entry.file_size for entry in entries)
        if expanded_size > MAX_EXPANDED:
            reject("zip_expanded_bytes", "workbook_package_limit", expanded_size, MAX_EXPANDED)
        largest_entry = max((entry.file_size for entry in entries), default=0)
        if largest_entry > MAX_EXPANDED // 2:
            reject("zip_entry_bytes", "workbook_package_limit", largest_entry, MAX_EXPANDED // 2)
        if len(names) != len(entries) or any(
            entry.flag_bits & 1 or entry.compress_type not in {ZIP_STORED, ZIP_DEFLATED}
            or "\\" in entry.filename or entry.filename.startswith("/")
            or ".." in entry.filename.split("/") for entry in entries
        ):
            reject("zip_entry_structure", "invalid_workbook", len(entries))
        if any("vbaproject" in name.lower() or name.startswith(("xl/externalLinks/", "xl/embeddings/"))
               for name in names):
            reject("unsupported_package_parts", "unsupported_workbook")
        manifest = fromstring(archive.read("[Content_Types].xml"), forbid_dtd=True)
        if not any(part.get("PartName") == "/xl/workbook.xml" and part.get("ContentType") == MAIN_TYPE
                   for part in manifest):
            reject("workbook_content_type", "unsupported_workbook")
        workbook_root = fromstring(archive.read("xl/workbook.xml"), forbid_dtd=True)
        sheet_count = sum(1 for _ in workbook_root.iter(f"{SHEET_NS}sheet"))
        if not 0 < sheet_count <= MAX_SHEETS:
            reject("worksheet_count", "workbook_sheet_limit", sheet_count, MAX_SHEETS)
        shared_part = next((part.get("PartName", "").lstrip("/") for part in manifest
                            if part.get("ContentType") == SHARED_STRINGS_TYPE), None)
        shared_strings = []
        if shared_part is not None:
            shared_root = fromstring(archive.read(shared_part), forbid_dtd=True)
            shared_strings = [
                any((text.text or "").strip() for text in item.iter(f"{SHEET_NS}t"))
                for item in shared_root.findall(f"{SHEET_NS}si")
            ]
        relations = fromstring(archive.read("xl/_rels/workbook.xml.rels"), forbid_dtd=True)
        worksheets = set()
        for relation in relations:
            if relation.get("Type", "").endswith("/worksheet"):
                target = relation.get("Target", "")
                name = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
                if not name.endswith(".xml") or name not in names or relation.get("TargetMode") == "External":
                    reject("worksheet_relationship", "invalid_workbook")
                worksheets.add(name)
        # Check actual XML coordinates rather than Excel's optional dimension hint.
        last_populated = 1
        for name in names:
            check_deadline(deadline)
            if not name.endswith((".xml", ".rels")):
                continue
            root = fromstring(archive.read(name), forbid_dtd=True)
            if name in worksheets and root.tag != f"{SHEET_NS}worksheet":
                reject("worksheet_xml_root", "invalid_workbook")
            if root.tag == f"{SHEET_NS}worksheet":
                last_populated = max(last_populated, inspect_worksheet(root, shared_strings, deadline))
        return last_populated


def cell_value(cell):
    if cell.data_type == "f":
        return ["", "formula"]
    value = cell.value
    if isinstance(value, str) and cell.data_type != "e":
        return [value, ""]
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        # Preserve explicit zero padding when Excel stores a phone as a number.
        number_format = cell.number_format
        if value >= 0 and int(value) == value and re.fullmatch(r"0{2,32}", number_format):
            return [str(int(value)).zfill(len(number_format)), ""]
        return [str(value), "numeric"]
    return ["", "unsupported"]


def read_workbook(upload):
    if not upload.name.lower().endswith(".xlsx"):
        reject("file_extension", "unsupported_file")
    if not 0 < upload.size <= MAX_UPLOAD:
        reject("upload_bytes", "file_size", upload.size, MAX_UPLOAD, status=413)
    workbook = None
    deadline = monotonic() + 5
    try:
        last_populated = inspect_package(upload, deadline)
        check_deadline(deadline)
        upload.seek(0)
        workbook = load_workbook(upload, read_only=True, data_only=False, keep_links=False)
        check_deadline(deadline)
        if not 0 < len(workbook.worksheets) <= MAX_SHEETS:
            reject("worksheet_count", "workbook_sheet_limit", len(workbook.worksheets), MAX_SHEETS)
        sheets = []
        total_text = 0
        for sheet in workbook.worksheets:
            rows = []
            data_rows = 0
            for row_number, cells in enumerate(sheet.iter_rows(max_row=last_populated, max_col=MAX_COLUMNS), 1):
                check_deadline(deadline)
                row = {}
                for column, cell in enumerate(cells, 1):
                    if cell.value is None:
                        continue
                    value, kind = cell_value(cell)
                    if "\x00" in value:
                        reject("cell_null_character", "invalid_workbook")
                    total_text += len(value)
                    if len(value) > MAX_CELL:
                        reject("cell_text_length", "workbook_text_limit", len(value), MAX_CELL)
                    if total_text > MAX_TEXT:
                        reject("workbook_text_length", "workbook_text_limit", total_text, MAX_TEXT)
                    if not value.strip() and not kind:
                        continue
                    row[str(column)] = [value, kind]
                if row:
                    if row_number > 1:
                        data_rows += 1
                        if data_rows > MAX_DATA_ROWS:
                            reject("populated_row_count", "workbook_row_limit", data_rows, MAX_DATA_ROWS)
                    rows.append([row_number, row])
            sheets.append({"name": sheet.title, "rows": rows})
        return sheets
    except ImportIssue:
        raise
    except (BadZipFile, InvalidFileException, ParseError, DefusedXmlException, KeyError, ValueError,
            OSError, RuntimeError, TypeError, IndexError, OverflowError, NotImplementedError, AttributeError) as error:
        logger.warning("Guest workbook rejected: rule=decode_structure error_type=%s", type(error).__name__)
        raise ImportIssue("invalid_workbook") from error
    finally:
        if workbook is not None:
            workbook.close()
