from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from weddings.models import BudgetExpense, WeddingMembership
from weddings.services import create_wedding


class VendorTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        users = get_user_model().objects
        cls.owner = users.create_user(username="vendor-owner")
        cls.partner = users.create_user(username="vendor-partner")
        cls.outsider = users.create_user(username="vendor-other")
        cls.wedding = create_wedding(user=cls.owner, name="Shared")
        cls.other = create_wedding(user=cls.outsider, name="Other")
        WeddingMembership.objects.create(wedding=cls.wedding, user=cls.partner)

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.login(self.owner)
        self.root = f"/api/weddings/{self.wedding.pk}/"
        self.vendors = self.root + "vendors/"
        self.expenses = self.root + "budget/expenses/"
        self.category = self.write("post", self.root + "budget/categories/",
                                   {"name": "Photography", "planned_amount": "5000"}).json()["categories"][0]["id"]

    def login(self, user):
        self.client.force_login(user)
        self.client.get("/api/auth/csrf/")
        self.csrf = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value}

    def write(self, method, path, data):
        return getattr(self.client, method)(path, data, format="json", **self.csrf)

    def vendor(self, **overrides):
        result = self.write("post", self.vendors, {"name": "Studio", "service_category": "Custom service", **overrides})
        self.assertEqual(result.status_code, 201, result.json())
        return next(item for item in result.json() if item["name"] == overrides.get("name", "Studio"))

    def test_vendor_crud_multiple_quotes_and_partner(self):
        self.assertEqual(self.client.get(self.vendors).json(), [])
        vendor = self.vendor(contact_person="Contact", phone="050-1234567", email="studio@example.com",
                             website="https://example.com", budget_category_id=self.category)
        second = self.vendor(name="Other Studio")
        self.assertEqual(second["service_category"], "Custom service")
        url = f"{self.vendors}{vendor['id']}/"
        self.assertEqual(vendor["status"], "researching")
        self.login(self.partner)
        self.assertEqual(self.client.get(url).json()["contact_person"], "Contact")
        response = self.write("patch", url, {"status": "contacted", "notes": "Follow up"})
        self.assertEqual(response.status_code, 200)
        for amount in ("1020.05", "1020.10"):
            self.assertEqual(self.write("post", url + "quotes/", {"title": "Offer", "amount": amount}).status_code, 201)
        offers = self.client.get(url + "quotes/").json()
        self.assertEqual([quote["amount"] for quote in offers], ["1020.05", "1020.10"])
        quote_url = url + f"quotes/{offers[0]['id']}/"
        self.assertEqual(self.write("patch", quote_url, {"status": "selected"}).status_code, 200)
        self.assertEqual(self.client.get(url).json()["status"], "contacted")
        self.assertFalse(BudgetExpense.objects.exists())
        self.assertEqual(self.client.delete(quote_url, **self.csrf).status_code, 200)
        self.assertEqual(self.client.delete(url, **self.csrf).status_code, 200)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_link_and_confirm_quote_without_duplicate_or_lost_payments(self):
        vendor = self.vendor()
        url = f"{self.vendors}{vendor['id']}/"
        standalone = self.write("post", self.expenses, {
            "category_id": self.category, "name": "Expense", "committed_cost": "30.10",
        }).json()["expenses"][0]
        self.assertIsNone(standalone["vendor_id"])
        schedule = self.write("post", self.expenses + f"{standalone['id']}/payments/", {
            "phase": "deposit", "amount": "10", "notes": "Deposit installment",
        }).json()["expenses"][0]["payments"]
        for _ in range(2):
            response = self.write("post", url + "commitments/", {"expense_id": standalone["id"]})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json()["expenses"]), 1)
            self.assertEqual(response.json()["expenses"][0]["payments"], schedule)
        offer = self.write("post", url + "quotes/", {"title": "Offer", "amount": "20.25"}).json()[0]["quotes"][0]
        payload = {"quote_id": offer["id"], "category_id": self.category, "confirmed": True}
        self.assertEqual(self.write("post", url + "commitments/", payload).status_code, 400)
        self.assertEqual(self.write("patch", url + f"quotes/{offer['id']}/", {"status": "selected"}).status_code, 200)
        self.assertEqual(self.write("post", url + "commitments/", {**payload, "confirmed": False}).status_code, 400)
        self.assertEqual(BudgetExpense.objects.count(), 1)
        result = self.write("post", url + "commitments/", payload)
        self.assertEqual(result.status_code, 201)
        self.assertEqual(result.json()["vendor_totals"][str(vendor["id"])], {
            "committed_cost": "50.35", "paid_amount": "0.00", "remaining_amount": "50.35",
        })
        self.assertEqual(self.write("post", url + "commitments/", payload).status_code, 409)
        self.assertEqual(self.client.delete(url, **self.csrf).status_code, 400)
        for expense in result.json()["expenses"]:
            self.assertEqual(self.client.delete(url + f"commitments/{expense['id']}/", **self.csrf).status_code, 200)
        self.assertEqual(self.client.delete(url, **self.csrf).status_code, 200)
        self.assertEqual(BudgetExpense.objects.count(), 2)

    def test_validation_membership_csrf_and_wedding_isolation(self):
        for invalid in ({"website": "javascript:alert(1)"}, {"website": "https://name@example.com"},
                        {"status": "fake"}, {"email": "invalid"}, {"phone": "abc"}):
            result = self.write("post", self.vendors, {"name": "Studio", "service_category": "Photo", **invalid})
            self.assertEqual(result.status_code, 400, result.json())
        vendor = self.vendor()
        url = f"{self.vendors}{vendor['id']}/"
        self.assertEqual(self.write("post", url + "quotes/", {"title": "Offer", "amount": "2.123"}).status_code, 400)
        self.assertEqual(self.client.patch(url, {"name": "Forged"}, format="json").status_code, 403)
        self.login(self.outsider)
        other_root = f"/api/weddings/{self.other.pk}/"
        other_category = self.write("post", other_root + "budget/categories/",
                                    {"name": "Other", "planned_amount": "1"}).json()["categories"][0]["id"]
        foreign_expense = self.write("post", other_root + "budget/expenses/", {
            "category_id": other_category, "name": "Private", "committed_cost": "1",
        }).json()["expenses"][0]["id"]
        self.assertEqual(self.client.get(url).status_code, 404)
        self.login(self.owner)
        self.assertEqual(self.write("patch", url, {"budget_category_id": other_category}).status_code, 404)
        self.assertEqual(self.write("post", url + "commitments/", {"expense_id": foreign_expense}).status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(self.vendors).status_code, 403)
