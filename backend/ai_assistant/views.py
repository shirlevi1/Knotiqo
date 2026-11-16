from django.http import Http404
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from weddings.services import weddings_for_user

from .serializers import BudgetAnalysisSerializer
from .services import BudgetProviderUnavailable, analyze_wedding_budget


@method_decorator(never_cache, name="dispatch")
class BudgetAnalysisView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request, wedding_id):
        if not weddings_for_user(user=request.user).filter(pk=wedding_id).exists():
            raise Http404

        serializer = BudgetAnalysisSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = analyze_wedding_budget(serializer.validated_data)
        except BudgetProviderUnavailable:
            return Response(
                {"detail": "Budget recommendation temporarily unavailable."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response(result)
