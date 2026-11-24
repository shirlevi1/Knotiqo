from functools import wraps

from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from rest_framework.exceptions import ParseError
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.response import Response

from .guest_import import ConfirmInput, PreviewInput, column_info, confirm_session, create_session, preview_session
from .guest_workbook import MAX_UPLOAD, ImportIssue, read_workbook
from .guests import WeddingGuestView
from .services import weddings_for_user


def guard_body(view, limit):
    @never_cache
    @wraps(view)
    def scoped(request, wedding_id, **kwargs):
        # DRF's session CSRF check can look at request.POST before initial().
        # Scope authenticated callers before any multipart or JSON parsing.
        if request.user.is_authenticated and request.user.is_active:
            if not weddings_for_user(user=request.user).filter(pk=wedding_id).exists():
                return JsonResponse({"detail": "Not found."}, status=404)
            size = request.META.get("CONTENT_LENGTH") or "0"
            if not size.isascii() or not size.isdecimal() or len(size) > 12 or int(size) > limit:
                return JsonResponse({"error": {"code": "request_size"}}, status=413)
        return view(request, wedding_id=wedding_id, **kwargs)
    return scoped


class ImportJSONParser(JSONParser):
    def parse(self, stream, media_type=None, parser_context=None):
        try:
            return super().parse(stream, media_type, parser_context)
        except RecursionError as error:
            raise ParseError("Invalid JSON.") from error


class GuestImportView(WeddingGuestView):
    http_method_names = ["post", "options"]
    parser_classes = [ImportJSONParser]

    def handle_exception(self, exc):
        if isinstance(exc, ImportIssue):
            return Response({"error": {"code": exc.code}}, status=exc.status, exception=True)
        return super().handle_exception(exc)


class GuestImportUpload(GuestImportView):
    parser_classes = [MultiPartParser]

    def post(self, request, wedding_id):
        uploads = request.FILES.getlist("workbook")
        if set(request.data) != {"workbook"} or len(uploads) != 1 or len(request.data.getlist("workbook")) != 1:
            raise ImportIssue("invalid_upload")
        sheets = read_workbook(uploads[0])
        session = create_session(request.user, wedding_id, sheets)
        return Response({
            "session_id": session.pk,
            "expires_at": session.expires_at.isoformat(),
            "worksheets": [{"name": sheet["name"], "columns": column_info(sheet)} for sheet in sheets],
        }, status=201)


class GuestImportPreview(GuestImportView):
    serializer_class = PreviewInput

    def post(self, request, wedding_id, session_id):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(preview_session(request.user, wedding_id, session_id, **serializer.validated_data))


class GuestImportConfirm(GuestImportView):
    serializer_class = ConfirmInput

    def post(self, request, wedding_id, session_id):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(confirm_session(request.user, wedding_id, session_id, **serializer.validated_data))


guest_import_upload = guard_body(GuestImportUpload.as_view(), MAX_UPLOAD + 64 * 1024)
guest_import_preview = guard_body(GuestImportPreview.as_view(), 128 * 1024)
guest_import_confirm = guard_body(GuestImportConfirm.as_view(), 128 * 1024)
