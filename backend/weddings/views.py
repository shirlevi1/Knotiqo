from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import authentication_classes
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .serializers import WeddingSerializer
from .services import create_wedding, weddings_for_user
from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError as DRFValidationError

from .models import Wedding
from .serializers import CreateInvitationSerializer
from .services import create_partner_invitation

@api_view(["GET", "POST"])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAuthenticated])
def my_weddings(request):
    if request.method == "POST":
        serializer = WeddingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        wedding = create_wedding(user=request.user, **serializer.validated_data)
        return Response(WeddingSerializer(wedding).data, status=201)

    weddings = weddings_for_user(user=request.user)


    return Response(WeddingSerializer(weddings, many=True).data)

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
            "invitation_url": f"/invite/{token}",
        },
        status=201,
    )
