from uuid import uuid4
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Q
from django.http import Http404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response

from venues.models import Venue, VenueQuote
from venues.serializers import EditableFieldsMixin, JSONIntegerField

from .budget import WeddingBudgetView
from .journey_defaults import DEFAULTS, STAGES
from .models import BudgetCategory, BudgetExpense, GuestRSVP, JourneyFeatureActivation, JourneyTask, ScheduledBudgetPayment, WeddingBudget, WeddingMeeting


JERUSALEM = ZoneInfo("Asia/Jerusalem")
MAX_CUSTOM_TASKS = 100


class TaskInput(EditableFieldsMixin, serializers.ModelSerializer):
    stage = JSONIntegerField(min_value=1, max_value=len(STAGES))
    move = serializers.ChoiceField(choices=("up", "down"), required=False, write_only=True)

    class Meta:
        model = JourneyTask
        fields = ("title", "description", "stage", "status", "priority", "due_date", "move")

    def validate(self, attrs):
        if "move" in attrs and (len(attrs) != 1 or not self.instance or not self.instance.custom):
            raise serializers.ValidationError({"move": ["Reorder a custom task separately."]})
        if self.instance and not self.instance.custom and {"title", "description", "stage"} & attrs.keys():
            raise serializers.ValidationError({"stage": ["Only a custom task can change its stage, title or description."]})
        return attrs


def progress(tasks):
    completed = sum(task["status"] == JourneyTask.Status.DONE for task in tasks)
    total = sum(task["status"] != JourneyTask.Status.SKIPPED for task in tasks)
    return {"completed": completed, "total": total, "skipped": len(tasks) - total,
            "percentage": (100 * completed + total // 2) // total if total else None}


def current_stage(wedding, today, booked):
    if not wedding.wedding_date:
        return None
    remaining = (wedding.wedding_date - today).days
    if remaining <= 0:
        return 6
    if remaining <= 7:
        return 5
    if remaining <= 30:
        return 4
    if remaining <= 183:
        return 3
    return 2 if booked else 1


def evidence_for(wedding):
    venues = Venue.objects.filter(wedding=wedding)
    booked = venues.filter(status=Venue.Status.BOOKED).exists()
    return booked, {
        "budget-initial": WeddingBudget.objects.filter(wedding=wedding, total_budget__gt=0).exists(),
        "budget-detail": BudgetCategory.objects.filter(budget__wedding=wedding).exists(),
        "guest-estimate": wedding.guests.filter(is_archived=False).exists(),
        "venue-search": venues.exists(),
        "venue-tours": wedding.meetings.filter(meeting_type=WeddingMeeting.Type.VENUE_TOUR)
        .exclude(status=WeddingMeeting.Status.CANCELLED).exists(),
        "venue-compare": VenueQuote.objects.filter(venue__wedding=wedding).exists(),
        "venue-booking": booked,
        "deposit": ScheduledBudgetPayment.objects.filter(
            expense__category__budget__wedding=wedding, phase=ScheduledBudgetPayment.Phase.DEPOSIT,
        ).exists(),
        "rsvp": GuestRSVP.objects.filter(guest__wedding=wedding, guest__is_archived=False,
                                        responded_at__isnull=False).exists(),
    }


def snapshot(wedding, *, summary=False):
    today = timezone.localdate(timezone=JERUSALEM)
    booked, evidence = evidence_for(wedding)
    saved = {row.key: row for row in wedding.journey_tasks.all()}
    contract_task = saved.get("venue-contract")
    booked = booked or bool(contract_task and contract_task.status == JourneyTask.Status.DONE)
    stage = current_stage(wedding, today, booked)
    groups = [{"id": number, "title": title, "tasks": []} for number, (title, _) in enumerate(STAGES, 1)]
    for key, defaults in DEFAULTS.items():
        row = saved.pop(key, None)
        groups[defaults["stage"] - 1]["tasks"].append(task_data(key, row, today, defaults, evidence.get(key, False)))
    for row in sorted(saved.values(), key=lambda item: (item.position, item.pk)):
        groups[row.stage - 1]["tasks"].append(task_data(row.key, row, today, {"stage": row.stage, "title": row.title}, False))
    tasks = [task for group in groups for task in group["tasks"]]
    actionable = sorted((task for task in tasks if task["status"] == "open"), key=lambda item: (
        not item["overdue"], item["stage"] != stage, item["priority"] != "high", item["due_date"] or "9999-12-31",
    ))
    result = {
        "wedding_date": wedding.wedding_date, "as_of": today, "recommended_stage": stage,
        "recommended_stage_title": STAGES[stage - 1][0] if stage else None,
        "progress": progress(tasks), "next_actions": actionable[:3],
        "features": feature_visibility(wedding, stage, booked),
    }
    if not summary:
        result["stages"] = [{**group, "progress": progress(group["tasks"])} for group in groups]
    return result


def feature_visibility(wedding, stage, booked):
    activated = set(wedding.journey_feature_activations.values_list("feature", flat=True))
    activity = {
        "vendors": wedding.vendors.exists(),
        "payments": BudgetExpense.objects.filter(category__budget__wedding=wedding).exists(),
        "rsvp": GuestRSVP.objects.filter(guest__wedding=wedding).filter(
            Q(token_hash__isnull=False) | Q(responded_at__isnull=False),
        ).exists(),
    }
    recommended = {"vendors": booked or bool(stage and stage >= 2),
                   "payments": booked or bool(stage and stage >= 2),
                   "rsvp": bool(stage and stage >= 4)}
    return {key: {"visible": key in activated or activity[key] or recommended[key],
                  "activated": key in activated, "has_data": activity[key], "recommended": recommended[key]}
            for key in JourneyFeatureActivation.Feature.values}


class JourneyActivateFeature(WeddingBudgetView):
    @transaction.atomic
    def post(self, request, wedding_id, feature):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        if feature not in JourneyFeatureActivation.Feature.values:
            raise Http404()
        JourneyFeatureActivation.objects.get_or_create(wedding=wedding, feature=feature)
        return Response(snapshot(wedding, summary=True))


def task_data(key, row, today, defaults, evidence):
    status = row.status if row else JourneyTask.Status.OPEN
    due = row.due_date if row else None
    return {
        "key": key, "stage": defaults["stage"], "title": defaults["title"], "custom": bool(row and row.custom),
        "description": row.description if row else "", "status": status,
        "priority": row.priority if row else JourneyTask.Priority.NORMAL,
        "due_date": due.isoformat() if due else None, "overdue": bool(due and due < today and status == JourneyTask.Status.OPEN),
        "module": defaults.get("module", ""), "has_evidence": evidence,
    }


def next_position(wedding, stage):
    last = wedding.journey_tasks.filter(custom=True, stage=stage).order_by("-position").first()
    return last.position + 1 if last else 0


class JourneyOverview(WeddingBudgetView):
    def get(self, request, wedding_id):
        wedding = self.scoped_wedding(request, wedding_id)
        return Response(snapshot(wedding, summary=request.query_params.get("summary") == "1"))

    @transaction.atomic
    def post(self, request, wedding_id):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        edit = TaskInput(data=request.data)
        edit.is_valid(raise_exception=True)
        if wedding.journey_tasks.filter(custom=True).count() >= MAX_CUSTOM_TASKS:
            raise serializers.ValidationError({"task": ["A wedding can contain up to 100 custom tasks."]})
        edit.save(wedding=wedding, custom=True, key=uuid4().hex,
                  position=next_position(wedding, edit.validated_data["stage"]))
        return Response(snapshot(wedding), status=201)


class JourneyTaskDetail(WeddingBudgetView):
    @transaction.atomic
    def patch(self, request, wedding_id, task_key):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        row = wedding.journey_tasks.filter(key=task_key).first()
        if row is None:
            default = DEFAULTS.get(task_key)
            if default is None:
                raise Http404()
            row = JourneyTask(wedding=wedding, key=task_key, stage=default["stage"], title=default["title"])
        edit = TaskInput(row, data=request.data, partial=True)
        edit.is_valid(raise_exception=True)
        values = edit.validated_data
        if direction := values.get("move"):
            tasks = list(wedding.journey_tasks.filter(custom=True, stage=row.stage).order_by("position", "pk"))
            index = next(index for index, item in enumerate(tasks) if item.pk == row.pk)
            target = index + (-1 if direction == "up" else 1)
            if 0 <= target < len(tasks):
                tasks[index], tasks[target] = tasks[target], tasks[index]
                for position, task in enumerate(tasks):
                    task.position = position
                JourneyTask.objects.bulk_update(tasks, ["position"])
        else:
            extra = {}
            if row.custom and "stage" in values and values["stage"] != row.stage:
                extra["position"] = next_position(wedding, values["stage"])
            edit.save(**extra)
        return Response(snapshot(wedding))

    @transaction.atomic
    def delete(self, request, wedding_id, task_key):
        wedding = self.scoped_wedding(request, wedding_id, lock=True)
        row = wedding.journey_tasks.filter(custom=True, key=task_key).first()
        if row is None:
            raise Http404()
        stage = row.stage
        row.delete()
        remaining = list(wedding.journey_tasks.filter(custom=True, stage=stage).order_by("position", "pk"))
        for position, task in enumerate(remaining):
            task.position = position
        JourneyTask.objects.bulk_update(remaining, ["position"])
        return Response(snapshot(wedding))
