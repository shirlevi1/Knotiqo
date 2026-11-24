from django.urls import path
from .budget import BudgetCategoryDetail, BudgetCategoryList, BudgetDetail, BudgetSimulation
from .budget_payments import ExpenseDetail, ExpenseList, PaymentDetail, PaymentList
from .guests import GuestDetail, GuestList
from .guest_exports import GuestExport, GuestTemplate
from .guest_import_views import guest_import_confirm, guest_import_preview, guest_import_upload
from .vendors import VendorCommitmentDetail, VendorCommitments, VendorDetail, VendorList, VendorQuoteDetail, VendorQuoteList
from .views import accept_invitation, create_invitation, my_weddings, validate_invitation, wedding_couple_names, wedding_cover, wedding_details

invitation_urlpatterns = [
    path("validate/", validate_invitation, name="validate-invitation"),
    path("accept/", accept_invitation, name="accept-invitation"),
]

urlpatterns = [
    path("", my_weddings, name="my-weddings"),
    path("<int:wedding_id>/", wedding_details, name="wedding-details"),
    path("<int:wedding_id>/couple-names/", wedding_couple_names, name="wedding-couple-names"),
    path("<int:wedding_id>/cover/", wedding_cover, name="wedding-cover"),
    path("<int:wedding_id>/budget/", BudgetDetail.as_view(), name="budget-detail"),
    path("<int:wedding_id>/budget/categories/", BudgetCategoryList.as_view(), name="budget-category-list"),
    path("<int:wedding_id>/budget/categories/<int:category_id>/", BudgetCategoryDetail.as_view(), name="budget-category-detail"),
    path("<int:wedding_id>/budget/venue-simulation/", BudgetSimulation.as_view(), name="budget-venue-simulation"),
    path("<int:wedding_id>/budget/expenses/", ExpenseList.as_view(), name="budget-expense-list"),
    path("<int:wedding_id>/budget/expenses/<int:expense_id>/", ExpenseDetail.as_view(), name="budget-expense-detail"),
    path("<int:wedding_id>/budget/expenses/<int:expense_id>/payments/", PaymentList.as_view(), name="budget-payment-list"),
    path("<int:wedding_id>/budget/expenses/<int:expense_id>/payments/<int:payment_id>/",
         PaymentDetail.as_view(), name="budget-payment-detail"),
    path("<int:wedding_id>/vendors/", VendorList.as_view(), name="wedding-vendors"),
    path("<int:wedding_id>/vendors/<int:vendor_id>/", VendorDetail.as_view(), name="wedding-vendor"),
    path("<int:wedding_id>/vendors/<int:vendor_id>/quotes/", VendorQuoteList.as_view(), name="wedding-vendor-quotes"),
    path("<int:wedding_id>/vendors/<int:vendor_id>/quotes/<int:quote_id>/", VendorQuoteDetail.as_view(), name="wedding-vendor-quote"),
    path("<int:wedding_id>/vendors/<int:vendor_id>/commitments/", VendorCommitments.as_view(), name="wedding-vendor-commitments"),
    path("<int:wedding_id>/vendors/<int:vendor_id>/commitments/<int:expense_id>/", VendorCommitmentDetail.as_view(),
         name="wedding-vendor-commitment"),
    path("<int:wedding_id>/guests/", GuestList.as_view(), name="guest-list"),
    path("<int:wedding_id>/guests/template/", GuestTemplate.as_view(), name="guest-template"),
    path("<int:wedding_id>/guests/export/", GuestExport.as_view(), name="guest-export"),
    path("<int:wedding_id>/guests/import/", guest_import_upload, name="guest-import-upload"),
    path("<int:wedding_id>/guests/import/<uuid:session_id>/preview/", guest_import_preview, name="guest-import-preview"),
    path("<int:wedding_id>/guests/import/<uuid:session_id>/confirm/", guest_import_confirm, name="guest-import-confirm"),
    path("<int:wedding_id>/guests/<int:guest_id>/", GuestDetail.as_view(), name="guest-detail"),
    path(
        "<int:wedding_id>/invitations/",
        create_invitation,
        name="create-invitation",
    ),
]
