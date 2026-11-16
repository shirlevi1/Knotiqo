
from rest_framework import serializers


class BudgetAnalysisSerializer(serializers.Serializer):
    total_budget = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=0,
    )

    guests = serializers.IntegerField(
        min_value=1,
    )

    price_per_guest = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=0,
    )

    other_expenses = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=0,
    )
