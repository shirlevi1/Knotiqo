from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Wedding


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_weddings(request):
    weddings = Wedding.objects.filter(
        members=request.user
    )

    data = [
        {
            "id": wedding.id,
            "name": wedding.name,
            "wedding_date": wedding.wedding_date,
        }
        for wedding in weddings
    ]

    return Response(data)