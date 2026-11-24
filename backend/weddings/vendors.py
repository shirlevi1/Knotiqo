import re
from urllib.parse import urlsplit

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.response import Response

from venues.serializers import EditableFieldsMixin, JSONIntegerField

from .budget import AmountField, WeddingBudgetView
from .budget_payments import MAX_EXPENSES, commitment_snapshot
from .models import BudgetCategory, BudgetExpense, VendorQuote, WeddingVendor


MAX_VENDORS = 100
MAX_QUOTES = 20


class VendorInput(EditableFieldsMixin, serializers.ModelSerializer):
    budget_category_id = JSONIntegerField(min_value=1, max_value=2**63 - 1, allow_null=True, required=False)

    class Meta:
        model = WeddingVendor
        fields = ("id", "name", "service_category", "contact_person", "phone", "email", "website",
                  "notes", "status", "budget_category_id")
        read_only_fields = ("id",)

    def validate_phone(self, value):
        if value and (not re.fullmatch(r"\+?[0-9 ().-]+", value)
                      or not 5 <= sum(char.isdigit() for char in value) <= 15):
            raise serializers.ValidationError("Enter a valid telephone number.")
        return value

    def validate_website(self, value):
        if value:
            try:
                parsed = urlsplit(value)
                parsed.port
            except ValueError as error:
                raise serializers.ValidationError("Enter a valid website.") from error
            if parsed.scheme not in ("http", "https") or parsed.username is not None or parsed.password is not None:
                raise serializers.ValidationError("Enter an HTTP or HTTPS link without credentials.")
        return value


class QuoteInput(EditableFieldsMixin, serializers.ModelSerializer):
    amount = AmountField()

    class Meta:
        model = VendorQuote
        fields = ("id", "title", "amount", "received_date", "included_services", "excluded_services", "notes", "status")
        read_only_fields = ("id",)


class LinkInput(EditableFieldsMixin, serializers.Serializer):
    expense_id = JSONIntegerField(min_value=1, max_value=2**63 - 1, required=False)
    quote_id = JSONIntegerField(min_value=1, max_value=2**63 - 1, required=False)
    category_id = JSONIntegerField(min_value=1, max_value=2**63 - 1, required=False)
    confirmed = serializers.BooleanField(required=False)

    def validate(self, attrs):
        if set(attrs) != {"expense_id"} and (
            set(attrs) != {"quote_id", "category_id", "confirmed"}
            or not isinstance(self.initial_data.get("confirmed"), bool) or not attrs["confirmed"]
        ):
            raise serializers.ValidationError("Choose an existing expense or confirm a quote with its category.")
        return attrs


def vendor_rows(wedding):
    return [
        {**VendorInput(vendor).data, "quotes": QuoteInput(vendor.quotes.all(), many=True).data}
        for vendor in wedding.vendors.prefetch_related("quotes")
    ]


class VendorView(WeddingBudgetView):
    def vendor(self, wedding, vendor_id):
        return get_object_or_404(wedding.vendors, pk=vendor_id)

    def category(self, wedding, category_id):
        return get_object_or_404(BudgetCategory, pk=category_id, budget__wedding=wedding)

    def edit_vendor(self, request, wedding, instance=None):
        edit = VendorInput(instance, data=request.data, partial=instance is not None)
        edit.is_valid(raise_exception=True)
        if (category_id := edit.validated_data.get("budget_category_id")) is not None:
            self.category(wedding, category_id)
        return edit


class VendorList(VendorView):
    def get(self, request, wedding_id):
        return Response(vendor_rows(self.scoped_wedding(request, wedding_id)))

    @transaction.atomic
    def post(self, request, wedding_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        edit = self.edit_vendor(request, wedding)
        if wedding.vendors.count() >= MAX_VENDORS:
            raise serializers.ValidationError({"vendors": "A wedding can contain up to 100 vendors."})
        edit.save(wedding=wedding)
        return Response(vendor_rows(wedding), status=201)


class VendorDetail(VendorView):
    def get(self, request, wedding_id, vendor_id):
        vendor = self.vendor(self.scoped_wedding(request, wedding_id), vendor_id)
        return Response({**VendorInput(vendor).data, "quotes": QuoteInput(vendor.quotes.all(), many=True).data})

    @transaction.atomic
    def patch(self, request, wedding_id, vendor_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        self.edit_vendor(request, wedding, self.vendor(wedding, vendor_id)).save()
        return Response(vendor_rows(wedding))

    @transaction.atomic
    def delete(self, request, wedding_id, vendor_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        vendor = self.vendor(wedding, vendor_id)
        if vendor.expenses.exists():
            raise serializers.ValidationError({"expenses": "Unlink the commitments before deleting the vendor."})
        vendor.delete()
        return Response(vendor_rows(wedding))


class VendorQuoteList(VendorView):
    def get(self, request, wedding_id, vendor_id):
        vendor = self.vendor(self.scoped_wedding(request, wedding_id), vendor_id)
        return Response(QuoteInput(vendor.quotes.all(), many=True).data)

    @transaction.atomic
    def post(self, request, wedding_id, vendor_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        vendor = self.vendor(wedding, vendor_id)
        edit = QuoteInput(data=request.data)
        edit.is_valid(raise_exception=True)
        if vendor.quotes.count() >= MAX_QUOTES:
            raise serializers.ValidationError({"quotes": "A vendor can contain up to 20 quotes."})
        edit.save(vendor=vendor)
        return Response(vendor_rows(wedding), status=201)


class VendorQuoteDetail(VendorView):
    def get(self, request, wedding_id, vendor_id, quote_id):
        vendor = self.vendor(self.scoped_wedding(request, wedding_id), vendor_id)
        return Response(QuoteInput(get_object_or_404(vendor.quotes, pk=quote_id)).data)

    @transaction.atomic
    def patch(self, request, wedding_id, vendor_id, quote_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        quote = get_object_or_404(self.vendor(wedding, vendor_id).quotes, pk=quote_id)
        edit = QuoteInput(quote, data=request.data, partial=True)
        edit.is_valid(raise_exception=True)
        edit.save()
        return Response(vendor_rows(wedding))

    @transaction.atomic
    def delete(self, request, wedding_id, vendor_id, quote_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        quote = get_object_or_404(self.vendor(wedding, vendor_id).quotes, pk=quote_id)
        quote.delete()
        return Response(vendor_rows(wedding))


class VendorCommitments(VendorView):
    @transaction.atomic
    def post(self, request, wedding_id, vendor_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        vendor = self.vendor(wedding, vendor_id)
        edit = LinkInput(data=request.data)
        edit.is_valid(raise_exception=True)
        values = edit.validated_data
        if "expense_id" in values:
            expense = get_object_or_404(BudgetExpense, pk=values["expense_id"], category__budget__wedding=wedding)
            if expense.vendor_id not in (None, vendor.pk) or (
                expense.source_quote_id and expense.source_quote.vendor_id != vendor.pk
            ):
                return Response({"code": "expense_already_linked"}, status=409)
            expense.vendor = vendor
            expense.save(update_fields=["vendor"])
            return Response(commitment_snapshot(wedding))
        quote = get_object_or_404(vendor.quotes, pk=values["quote_id"])
        category = self.category(wedding, values["category_id"])
        if quote.status != VendorQuote.Status.SELECTED:
            raise serializers.ValidationError({"quote_id": "Select the quote before creating a commitment."})
        if BudgetExpense.objects.filter(source_quote=quote).exists():
            return Response({"code": "quote_already_committed"}, status=409)
        if BudgetExpense.objects.filter(category__budget__wedding=wedding).count() >= MAX_EXPENSES:
            raise serializers.ValidationError({"expenses": "A wedding can contain up to 100 commitments."})
        BudgetExpense.objects.create(category=category, vendor=vendor, source_quote=quote,
                                     name=quote.title[:100], committed_cost=quote.amount)
        return Response(commitment_snapshot(wedding), status=201)


class VendorCommitmentDetail(VendorView):
    @transaction.atomic
    def delete(self, request, wedding_id, vendor_id, expense_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        vendor = self.vendor(wedding, vendor_id)
        expense = get_object_or_404(vendor.expenses, pk=expense_id, category__budget__wedding=wedding)
        expense.vendor = None
        expense.save(update_fields=["vendor"])
        return Response(commitment_snapshot(wedding))
