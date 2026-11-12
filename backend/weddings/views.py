from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import authentication_classes
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .serializers import WeddingSerializer
from .services import create_wedding, weddings_for_user


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
