from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import authentication_classes
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .serializers import CoupleNamesSerializer, WeddingDetailsSerializer, WeddingSerializer
from .services import create_wedding, update_couple_names, wedding_details_for_user, weddings_for_user
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.cache import never_cache
from rest_framework.exceptions import ValidationError as DRFValidationError

from .models import Wedding
from .covers import CoverError, cover_url, normalize_cover, replace_cover
from .serializers import CreateInvitationSerializer, InvitationTokenSerializer
from .services import accept_partner_invitation, create_partner_invitation, preview_partner_invitation

@never_cache
@api_view(["GET", "POST"])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAuthenticated])
def my_weddings(request):
    if request.method == "POST":
        serializer = WeddingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        wedding = create_wedding(user=request.user, **serializer.validated_data)
        return Response(WeddingSerializer(wedding).data, status=201)

    include_memberships = request.query_params.get("include") == "memberships"
    weddings = weddings_for_user(user=request.user, include_memberships=include_memberships)
    serializer_class = WeddingDetailsSerializer if include_memberships else WeddingSerializer
    return Response(serializer_class(weddings, many=True).data)


@never_cache
@api_view(["GET"])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAuthenticated])
def wedding_details(request, wedding_id):
    wedding = wedding_details_for_user(user=request.user, wedding_id=wedding_id)
    return Response(WeddingDetailsSerializer(wedding).data)


@never_cache
@api_view(["GET", "POST", "DELETE"])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser])
def wedding_cover(request, wedding_id):
    wedding = weddings_for_user(user=request.user).filter(pk=wedding_id).first()
    if wedding is None:
        raise Http404()
    if request.method == "GET":
        if not wedding.cover_image:
            raise Http404()
        try:
            with wedding.cover_image.open("rb") as stream:
                image_bytes = stream.read()
        except FileNotFoundError as error:
            raise Http404() from error
        except Exception:
            return Response({"code": "storage_unavailable"}, status=503)
        response = HttpResponse(image_bytes, content_type="image/webp")
        response["X-Content-Type-Options"] = "nosniff"
        return response

    try:
        content = None
        if request.method == "POST":
            files = request.FILES.getlist("cover")
            if set(request.data) != {"cover"} or len(files) != 1 or len(request.data.getlist("cover")) != 1:
                raise CoverError("invalid_upload")
            content = normalize_cover(files[0])
        updated = replace_cover(user=request.user, wedding_id=wedding_id, content=content)
    except Http404 as error:
        raise Http404() from error
    except CoverError as error:
        status = {"too_large": 413, "storage_unavailable": 503}.get(error.code, 400)
        return Response({"code": error.code}, status=status)
    return Response({"cover_image_url": cover_url(updated)})


@never_cache
@api_view(["PUT"])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAuthenticated])
def wedding_couple_names(request, wedding_id):
    serializer = CoupleNamesSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    update_couple_names(user=request.user, wedding_id=wedding_id, **serializer.validated_data)
    return Response(serializer.data)

@never_cache
@api_view(["POST"])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAuthenticated])
def create_invitation(request, wedding_id):
    # 1. Validate request data
    serializer = CreateInvitationSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    # 2. Find the wedding
    wedding = get_object_or_404(Wedding, pk=wedding_id)

    # 3. Create invitation through the service
    try:
        invitation, token = create_partner_invitation(
            wedding=wedding,
            invited_by=request.user,
            email=serializer.validated_data["email"],
        )
    except DjangoValidationError as error:
        raise DRFValidationError({
            "error": error.messages
        })

    # 4. Return invitation details
    return Response(
        {
            "id": invitation.id,
            "email": invitation.invited_email,
            "status": invitation.status,
            "expires_at": invitation.expires_at.isoformat(),
            "invitation_url": f"/invite/#{token}",
        },
        status=201,
    )


@never_cache
@api_view(["POST"])
@authentication_classes([])
def validate_invitation(request):
    # POST keeps the secret in the request body. The lookup is read-only.
    serializer = InvitationTokenSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    return Response(preview_partner_invitation(**serializer.validated_data))


@never_cache
@api_view(["POST"])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAuthenticated])
def accept_invitation(request):
    serializer = InvitationTokenSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        wedding = accept_partner_invitation(user=request.user, **serializer.validated_data)
    except DjangoValidationError:
        return Response({"detail": "Wedding membership unavailable."}, status=409)
    return Response(WeddingSerializer(wedding).data)
