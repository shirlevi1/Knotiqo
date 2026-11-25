from django.conf import settings
from django.contrib.staticfiles.views import serve as serve_static
from django.db import DatabaseError, connection
from django.http import Http404, JsonResponse
from django.urls import path, re_path
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe
from django.views.static import serve

from .urls import urlpatterns as app_urls


@never_cache
@require_safe
def readiness(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except DatabaseError:
        status = 503
    else:
        status = 200
    return JsonResponse({"instance": settings.LOCAL_INSTANCE, "ready": status == 200}, status=status)


@require_safe
def frontend(request, asset="index.html"):
    root = settings.LOCAL_BUILD.resolve()
    target = (root / asset).resolve()
    try:
        relative = target.relative_to(root).as_posix()
    except ValueError as error:
        raise Http404 from error
    if relative != asset or not target.is_file():
        raise Http404
    response = serve(request, relative, document_root=root)
    response["Cache-Control"] = "no-cache"
    response["X-Content-Type-Options"] = "nosniff"
    return response


@require_safe
def django_static(request, asset):
    return serve_static(request, asset, insecure=True)


urlpatterns = [
    *app_urls,
    path("_knotiqo/ready/", readiness),
    path("", frontend),
    re_path(r"^(?P<asset>(?:assets|images)/.+|favicon\.svg|icons\.svg)$", frontend),
    path("static/<path:asset>", django_static),
]
