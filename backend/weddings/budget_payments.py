from django.db import transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response

from venues.models import Venue
from venues.serializers import EditableFieldsMixin, JSONIntegerField

from .budget import AmountField, WeddingBudgetView, ZERO
from .models import BudgetCategory, BudgetExpense, ScheduledBudgetPayment


MAX_EXPENSES = 100
MAX_PAYMENTS = 30


class ExpenseInput(EditableFieldsMixin, serializers.Serializer):
    category_id = JSONIntegerField(min_value=1, max_value=2**63 - 1)
    venue_id = JSONIntegerField(min_value=1, max_value=2**63 - 1, allow_null=True, required=False)
    name = serializers.CharField(max_length=100)
    supplier_name = serializers.CharField(max_length=100, allow_blank=True, required=False)
    committed_cost = AmountField()


class PaymentInput(EditableFieldsMixin, serializers.Serializer):
    phase = serializers.ChoiceField(choices=ScheduledBudgetPayment.Phase)
    due_date = serializers.DateField(allow_null=True, required=False)
    amount = AmountField()
    notes = serializers.CharField(max_length=500, allow_blank=True, required=False)
    paid_amount = AmountField(required=False)
    paid_date = serializers.DateField(allow_null=True, required=False)

    def validate(self, attrs):
        def value(field, default):
            return attrs.get(field, getattr(self.instance, field, default))

        amount = value("amount", ZERO)
        paid = value("paid_amount", ZERO)
        paid_date = value("paid_date", None)
        if amount <= ZERO:
            raise serializers.ValidationError({"amount": "A scheduled amount must be positive."})
        if paid > amount:
            raise serializers.ValidationError({"paid_amount": "Paid amount exceeds the scheduled amount."})
        if bool(paid) != bool(paid_date) or (paid_date and paid_date > timezone.localdate()):
            raise serializers.ValidationError({"paid_date": "A positive paid amount requires a date on or before today."})
        return attrs


def money(value):
    return format(value, ".2f")


def commitment_snapshot(wedding):
    today = timezone.localdate()
    expenses = BudgetExpense.objects.filter(category__budget__wedding=wedding).select_related("venue")
    rows = []
    committed = paid = scheduled = upcoming = overdue = ZERO
    for expense in expenses.prefetch_related("payments"):
        payments = []
        expense_paid = expense_scheduled = ZERO
        for payment in expense.payments.all():
            outstanding = payment.amount - payment.paid_amount
            status = "paid" if not outstanding else "partial" if payment.paid_amount else "unpaid"
            timing = None
            if outstanding and payment.due_date:
                timing = "overdue" if payment.due_date < today else "upcoming"
                if timing == "overdue":
                    overdue += outstanding
                else:
                    upcoming += outstanding
            expense_paid += payment.paid_amount
            expense_scheduled += payment.amount
            payments.append({
                "id": payment.pk, "phase": payment.phase, "due_date": payment.due_date,
                "amount": money(payment.amount), "notes": payment.notes, "status": status,
                "paid_amount": money(payment.paid_amount), "paid_date": payment.paid_date,
                "outstanding_amount": money(outstanding), "timing": timing,
            })
        cost = expense.committed_cost
        rows.append({
            "id": expense.pk, "category_id": expense.category_id, "venue_id": expense.venue_id,
            "venue_name": expense.venue.name if expense.venue else None,
            "name": expense.name, "supplier_name": expense.supplier_name, "committed_cost": money(cost),
            "scheduled_amount": money(expense_scheduled), "paid_amount": money(expense_paid),
            "remaining_amount": money(cost - expense_paid), "schedule_difference": money(cost - expense_scheduled),
            "schedule_status": "incomplete" if expense_scheduled < cost else "overallocated"
            if expense_scheduled > cost else "complete",
            "payments": payments,
        })
        committed += cost
        paid += expense_paid
        scheduled += expense_scheduled
    return {
        "currency": "ILS", "as_of": today, "wedding_date": wedding.wedding_date, "expenses": rows,
        "totals": {
            "committed_cost": money(committed), "scheduled_amount": money(scheduled),
            "paid_amount": money(paid), "remaining_amount": money(committed - paid),
            "upcoming_amount": money(upcoming), "overdue_amount": money(overdue),
        },
    }


class CommitmentView(WeddingBudgetView):
    def expense(self, wedding, expense_id):
        return get_object_or_404(BudgetExpense, pk=expense_id, category__budget__wedding=wedding)

    def expense_input(self, request, wedding, expense=None):
        edit = ExpenseInput(data=request.data, partial=expense is not None)
        edit.is_valid(raise_exception=True)
        values = edit.validated_data
        if "category_id" in values:
            get_object_or_404(BudgetCategory, pk=values["category_id"], budget__wedding=wedding)
        if values.get("venue_id") is not None:
            get_object_or_404(Venue, pk=values["venue_id"], wedding=wedding)
        if expense and "committed_cost" in values:
            paid = expense.payments.aggregate(value=Sum("paid_amount", default=ZERO))["value"]
            if values["committed_cost"] < paid:
                raise serializers.ValidationError({"committed_cost": "Committed cost cannot be below actual payments."})
        return values

    def payment_input(self, request, expense, payment=None):
        edit = PaymentInput(payment, data=request.data, partial=payment is not None)
        edit.is_valid(raise_exception=True)
        values = edit.validated_data
        others = expense.payments.exclude(pk=payment.pk) if payment else expense.payments.all()
        paid = others.aggregate(value=Sum("paid_amount", default=ZERO))["value"]
        if paid + values.get("paid_amount", payment.paid_amount if payment else ZERO) > expense.committed_cost:
            raise serializers.ValidationError({"paid_amount": "Actual payments cannot exceed the committed cost."})
        return values


class ExpenseList(CommitmentView):
    @transaction.atomic
    def get(self, request, wedding_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        return Response(commitment_snapshot(wedding))

    @transaction.atomic
    def post(self, request, wedding_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        values = self.expense_input(request, wedding)
        if BudgetExpense.objects.filter(category__budget__wedding=wedding).count() >= MAX_EXPENSES:
            raise serializers.ValidationError({"expenses": "A wedding can contain up to 100 commitments."})
        BudgetExpense.objects.create(**values)
        return Response(commitment_snapshot(wedding), status=201)


class ExpenseDetail(CommitmentView):
    @transaction.atomic
    def patch(self, request, wedding_id, expense_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        expense = self.expense(wedding, expense_id)
        values = self.expense_input(request, wedding, expense)
        for field, value in values.items():
            setattr(expense, field, value)
        expense.save(update_fields=list(values))
        return Response(commitment_snapshot(wedding))

    @transaction.atomic
    def delete(self, request, wedding_id, expense_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        expense = self.expense(wedding, expense_id)
        if expense.payments.exists():
            raise serializers.ValidationError({"payments": "Remove scheduled payments before deleting a commitment."})
        expense.delete()
        return Response(commitment_snapshot(wedding))


class PaymentList(CommitmentView):
    @transaction.atomic
    def post(self, request, wedding_id, expense_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        expense = self.expense(wedding, expense_id)
        values = self.payment_input(request, expense)
        if expense.payments.count() >= MAX_PAYMENTS:
            raise serializers.ValidationError({"payments": "A commitment can contain up to 30 scheduled payments."})
        expense.payments.create(**values)
        return Response(commitment_snapshot(wedding), status=201)


class PaymentDetail(CommitmentView):
    @transaction.atomic
    def patch(self, request, wedding_id, expense_id, payment_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        payment = get_object_or_404(self.expense(wedding, expense_id).payments, pk=payment_id)
        values = self.payment_input(request, payment.expense, payment)
        for field, value in values.items():
            setattr(payment, field, value)
        payment.save(update_fields=list(values))
        return Response(commitment_snapshot(wedding))

    @transaction.atomic
    def delete(self, request, wedding_id, expense_id, payment_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        payment = get_object_or_404(self.expense(wedding, expense_id).payments, pk=payment_id)
        if payment.paid_amount:
            raise serializers.ValidationError({"paid_amount": "Correct the recorded payment before deleting the installment."})
        payment.delete()
        return Response(commitment_snapshot(wedding))
