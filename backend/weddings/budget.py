from decimal import Decimal
import re

from django.db import transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from rest_framework import serializers
from rest_framework.authentication import SessionAuthentication
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from venues.serializers import EditableFieldsMixin, JSONIntegerField
from venues.services import compare_quotes_for_user

from .guests import summarize_guests
from .models import BudgetCategory, Guest, WeddingBudget
from .services import weddings_for_user


MAX_CATEGORIES = 100
ZERO = Decimal("0.00")
ATTENDEE_FIELDS = ("attendees", "adult_count", "child_count", "infant_count", "unclassified_count")


class AmountField(serializers.DecimalField):
    def __init__(self, **kwargs):
        super().__init__(max_digits=12, decimal_places=2, min_value=ZERO, coerce_to_string=True, **kwargs)

    def to_internal_value(self, data):
        if not isinstance(data, str) or not re.fullmatch(r"[0-9]{1,10}(?:\.[0-9]{1,2})?", data):
            self.fail("invalid")
        return super().to_internal_value(data)


class BudgetEdit(EditableFieldsMixin, serializers.Serializer):
    total_budget = AmountField(required=False)
    category_ids = serializers.ListField(
        child=JSONIntegerField(min_value=1, max_value=2**63 - 1), max_length=MAX_CATEGORIES, required=False,
    )

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Provide total_budget or category_ids.")
        return attrs


class CategoryEdit(EditableFieldsMixin, serializers.ModelSerializer):
    planned_amount = AmountField()
    estimated_cost = AmountField(allow_null=True, required=False)

    class Meta:
        model = BudgetCategory
        fields = ("id", "name", "planned_amount", "estimated_cost", "position")
        read_only_fields = ("id", "position")

    def to_internal_value(self, data):
        if isinstance(data, dict) and "name" in data and not isinstance(data["name"], str):
            raise serializers.ValidationError({"name": "Provide a category name."})
        return super().to_internal_value(data)

    def validate_name(self, value):
        if not value.isprintable():
            raise serializers.ValidationError("Provide a printable category name.")
        return value


class SimulationInput(EditableFieldsMixin, serializers.Serializer):
    quote_id = JSONIntegerField(min_value=1, max_value=2**63 - 1)
    expected_guests = JSONIntegerField(min_value=1, max_value=2**53 - 1)


def budget_snapshot(wedding_id, budget):
    categories = list(budget.categories.all()) if budget else []
    total = budget.total_budget if budget else ZERO
    allocated = sum((category.planned_amount for category in categories), ZERO)
    estimated = sum((category.estimated_cost for category in categories if category.estimated_cost is not None), ZERO)
    summary = summarize_guests(Guest.objects.filter(wedding_id=wedding_id, is_archived=False))
    return {
        "currency": "ILS",
        "total_budget": format(total, ".2f"),
        "allocated_budget": format(allocated, ".2f"),
        "estimated_spending": format(estimated, ".2f"),
        "unallocated_budget": format(total - allocated, ".2f"),
        "estimated_remaining_budget": format(total - estimated, ".2f"),
        "missing_estimate_count": sum(category.estimated_cost is None for category in categories),
        "categories": CategoryEdit(categories, many=True).data,
        "attendee_summary": {field: summary[field] for field in ATTENDEE_FIELDS},
    }


@method_decorator(never_cache, name="dispatch")
class WeddingBudgetView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def scoped_wedding(self, request, wedding_id, *, lock=False):
        weddings = weddings_for_user(user=request.user)
        if lock:
            weddings = weddings.select_for_update(of=("self",))
        return get_object_or_404(weddings, pk=wedding_id)

    def handle_exception(self, exc):
        return super().handle_exception(Http404() if isinstance(exc, Http404) else exc)


class BudgetDetail(WeddingBudgetView):
    @transaction.atomic
    def get(self, request, wedding_id):
        # Use the same parent lock as writes to read the total and categories consistently.
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        budget = WeddingBudget.objects.filter(wedding=wedding).first()
        return Response(budget_snapshot(wedding_id, budget))

    @transaction.atomic
    def patch(self, request, wedding_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        edit = BudgetEdit(data=request.data)
        edit.is_valid(raise_exception=True)
        budget, _ = WeddingBudget.objects.get_or_create(wedding=wedding)
        if "category_ids" in edit.validated_data:
            order = edit.validated_data["category_ids"]
            categories = {category.pk: category for category in budget.categories.all()}
            if len(order) != len(categories) or set(order) != categories.keys():
                raise serializers.ValidationError({"category_ids": "Provide every current category ID exactly once."})
            for position, category_id in enumerate(order):
                categories[category_id].position = position
            BudgetCategory.objects.bulk_update(categories.values(), ["position"])
        if "total_budget" in edit.validated_data:
            budget.total_budget = edit.validated_data["total_budget"]
            budget.save(update_fields=["total_budget"])
        return Response(budget_snapshot(wedding_id, budget))


class BudgetCategoryList(WeddingBudgetView):
    @transaction.atomic
    def post(self, request, wedding_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        edit = CategoryEdit(data=request.data)
        edit.is_valid(raise_exception=True)
        budget, _ = WeddingBudget.objects.get_or_create(wedding=wedding)
        last = budget.categories.last()
        position = last.position + 1 if last else 0
        if position >= MAX_CATEGORIES:
            raise serializers.ValidationError({"categories": "A budget can contain up to 100 categories."})
        edit.save(budget=budget, position=position)
        return Response(budget_snapshot(wedding_id, budget), status=201)


class BudgetCategoryDetail(WeddingBudgetView):
    def scoped_category(self, wedding_id, category_id):
        return get_object_or_404(
            BudgetCategory.objects.select_related("budget"), pk=category_id, budget__wedding_id=wedding_id,
        )

    @transaction.atomic
    def patch(self, request, wedding_id, category_id):
        self.scoped_wedding(request, wedding_id, lock=True)
        category = self.scoped_category(wedding_id, category_id)
        edit = CategoryEdit(category, data=request.data, partial=True)
        edit.is_valid(raise_exception=True)
        edit.save()
        return Response(budget_snapshot(wedding_id, category.budget))

    @transaction.atomic
    def delete(self, request, wedding_id, category_id):
        self.scoped_wedding(request, wedding_id, lock=True)
        category = self.scoped_category(wedding_id, category_id)
        budget = category.budget
        if category.expenses.exists():
            raise serializers.ValidationError({"expenses": "Move or remove the commitments before deleting this category."})
        category.delete()
        remaining = list(budget.categories.all())
        for position, item in enumerate(remaining):
            item.position = position
        BudgetCategory.objects.bulk_update(remaining, ["position"])
        return Response(budget_snapshot(wedding_id, budget))


class BudgetSimulation(WeddingBudgetView):
    def post(self, request, wedding_id):
        self.scoped_wedding(request, wedding_id)
        selection = SimulationInput(data=request.data)
        selection.is_valid(raise_exception=True)
        guests = selection.validated_data["expected_guests"]
        result = compare_quotes_for_user(
            user=request.user, wedding_id=wedding_id, expected_guests=guests,
            quote_ids=[selection.validated_data["quote_id"]],
        )["comparisons"][0]
        del result["difference_from_cheapest"], result["notes"]
        return Response({"expected_guests": guests, **result})
