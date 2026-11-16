from django.urls import path

from .views import BudgetAnalysisView


urlpatterns = [
    path(
        "weddings/<int:wedding_id>/budget-analysis/",
        BudgetAnalysisView.as_view(),
        name="budget-analysis",
    ),
]
