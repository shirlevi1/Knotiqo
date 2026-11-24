import { getCsrfToken } from "./csrf";
import type { ComparedQuote } from "./venues";

export type CategoryInput = { name: string; planned_amount: string; estimated_cost: string | null };
export type BudgetCategory = CategoryInput & { id: number; position: number };
export const moneyFields = ["total_budget", "allocated_budget", "estimated_spending",
    "unallocated_budget", "estimated_remaining_budget"] as const;
export const attendeeFields = ["attendees", "adult_count", "child_count", "infant_count", "unclassified_count"] as const;
export type Budget = Record<typeof moneyFields[number], string> & {
    currency: "ILS";
    missing_estimate_count: number;
    categories: BudgetCategory[];
    attendee_summary: Record<typeof attendeeFields[number], number>;
};
export type Simulation = Omit<ComparedQuote, "notes" | "difference_from_cheapest"> & { expected_guests: number };

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function money(value: unknown): value is string {
    return typeof value === "string" && /^-?\d+\.\d{2}$/.test(value);
}

function count(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBudget(value: unknown): value is Budget {
    if (!record(value) || !record(value.attendee_summary)) return false;
    const attendees = value.attendee_summary;
    return value.currency === "ILS" && moneyFields.every((field) => money(value[field]))
        && attendeeFields.every((field) => count(attendees[field])) && count(value.missing_estimate_count)
        && Array.isArray(value.categories) && value.categories.every((category: unknown) =>
            record(category) && count(category.id) && count(category.position) && typeof category.name === "string"
            && money(category.planned_amount) && (category.estimated_cost === null || money(category.estimated_cost)));
}

function isSimulation(value: unknown): value is Simulation {
    return record(value) && ["billable_guests", "minimum_guests", "expected_guests", "venue_id", "quote_id"]
        .every((field) => count(value[field]))
        && ["price_per_guest", "additional_costs", "meals_cost", "total_cost"].every((field) => money(value[field]))
        && typeof value.venue_name === "string" && (value.event_date === null || typeof value.event_date === "string");
}

async function request<T>(url: string, check: (value: unknown) => value is T,
    signal: AbortSignal, method = "GET", body?: unknown): Promise<T> {
    const options = { credentials: "same-origin", cache: "no-store", signal } as const;
    const headers: Record<string, string> = {};
    if (method !== "GET") {
        const csrf = await fetch("/api/auth/csrf/", options);
        const token = getCsrfToken();
        if (!csrf.ok || !token) throw new Error("לא ניתן לאמת את הבקשה. רעננו את הדף ונסו שוב.");
        headers["X-CSRFToken"] = token;
        headers["Content-Type"] = "application/json";
    }
    const response = await fetch(url, { ...options, method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.status === 401 || response.status === 403) throw new Error("לא ניתן לאמת את הבקשה. התחברו מחדש ונסו שוב.");
    if (response.status === 404) throw new Error("הפריט אינו זמין בחתונה הזו. רעננו את הדף.");
    const data: unknown = await response.json().catch(() => null);
    if (response.status === 400) {
        if (record(data) && "category_ids" in data) throw new Error("סדר הקטגוריות השתנה. רעננו את הרשימה ונסו שוב.");
        if (record(data) && "categories" in data) throw new Error("אפשר לשמור עד 100 קטגוריות בתקציב.");
        if (record(data) && "paid_amount" in data) throw new Error("בדקו שסכום ששולם אינו עולה על התשלום המתוכנן או על ההתחייבות.");
        if (record(data) && "paid_date" in data) throw new Error("לסכום ששולם נדרש תאריך תשלום שאינו עתידי. בסכום אפס השאירו את התאריך ריק.");
        if (record(data) && "committed_cost" in data) throw new Error("בדקו שסכום ההתחייבות תקין ואינו נמוך מהסכום שכבר שולם.");
        if (record(data) && "payments" in data) throw new Error(method === "DELETE"
            ? "יש להסיר את התשלומים המתוכננים לפני מחיקת ההתחייבות." : "ניתן להוסיף עד 30 תשלומים לכל התחייבות.");
        if (record(data) && "expenses" in data) throw new Error(method === "DELETE"
            ? "יש להעביר או להסיר את ההתחייבויות לפני מחיקת הקטגוריה." : "ניתן להוסיף עד 100 התחייבויות.");
        throw new Error("בדקו את הערכים שהזנתם ונסו שוב.");
    }
    if (!response.ok || !check(data)) throw new Error("לא ניתן להשלים את הפעולה כרגע. נסו שוב.");
    return data;
}

export function budgetApi(weddingId: number) {
    const base = `/api/weddings/${weddingId}/budget/`;
    return {
        load: (signal: AbortSignal) => request(base, isBudget, signal),
        total: (total_budget: string, signal: AbortSignal) => request(base, isBudget, signal, "PATCH", { total_budget }),
        reorder: (category_ids: number[], signal: AbortSignal) => request(base, isBudget, signal, "PATCH", { category_ids }),
        category: (input: CategoryInput, signal: AbortSignal, id?: number) => request(
            id ? `${base}categories/${id}/` : `${base}categories/`, isBudget, signal, id ? "PATCH" : "POST", input),
        remove: (id: number, signal: AbortSignal) => request(`${base}categories/${id}/`, isBudget, signal, "DELETE"),
        simulate: (quote_id: number, expected_guests: number, signal: AbortSignal) => request(
            `${base}venue-simulation/`, isSimulation, signal, "POST", { quote_id, expected_guests }),
    };
}

export const paymentPhases = {
    deposit: "מקדמה", before: "לפני החתונה", on_day: "ביום החתונה", after: "אחרי החתונה", other: "אחר",
} as const;
export type Phase = keyof typeof paymentPhases;
export type ExpenseInput = {
    category_id: number; venue_id: number | null; name: string; supplier_name: string; committed_cost: string;
};
export type PaymentInput = {
    phase: Phase; due_date: string | null; amount: string; notes: string; paid_amount: string; paid_date: string | null;
};
export type Payment = PaymentInput & {
    id: number; status: "unpaid" | "partial" | "paid"; outstanding_amount: string; timing: "upcoming" | "overdue" | null;
};
export type Expense = ExpenseInput & {
    id: number; venue_name: string | null; scheduled_amount: string; paid_amount: string; remaining_amount: string;
    schedule_difference: string; schedule_status: "incomplete" | "overallocated" | "complete"; payments: Payment[];
};
export const commitmentFields = ["committed_cost", "scheduled_amount", "paid_amount", "remaining_amount",
    "upcoming_amount", "overdue_amount"] as const;
export type Commitments = {
    currency: "ILS"; as_of: string; wedding_date: string | null; expenses: Expense[];
    totals: Record<typeof commitmentFields[number], string>;
};

function optionalDate(value: unknown) {
    return value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isPayment(value: unknown): value is Payment {
    return record(value) && count(value.id) && typeof value.phase === "string" && Object.hasOwn(paymentPhases, value.phase)
        && typeof value.notes === "string" && optionalDate(value.due_date) && optionalDate(value.paid_date)
        && ["amount", "paid_amount", "outstanding_amount"].every((field) => money(value[field]))
        && ["unpaid", "partial", "paid"].some((status) => status === value.status)
        && [null, "overdue", "upcoming"].some((timing) => timing === value.timing);
}

function isCommitments(value: unknown): value is Commitments {
    if (!record(value) || value.currency !== "ILS" || typeof value.as_of !== "string"
        || !optionalDate(value.as_of) || !optionalDate(value.wedding_date) || !record(value.totals)) return false;
    const totals = value.totals;
    return commitmentFields.every((field) => money(totals[field])) && Array.isArray(value.expenses)
        && value.expenses.every((item: unknown) => record(item) && count(item.id) && count(item.category_id)
            && (item.venue_id === null || count(item.venue_id)) && (item.venue_name === null || typeof item.venue_name === "string")
            && typeof item.name === "string" && typeof item.supplier_name === "string"
            && ["committed_cost", "scheduled_amount", "paid_amount", "remaining_amount", "schedule_difference"].every((field) => money(item[field]))
            && ["incomplete", "overallocated", "complete"].some((status) => status === item.schedule_status)
            && Array.isArray(item.payments) && item.payments.every(isPayment));
}

function changedFields<T extends Record<string, unknown>>(input: T, previous: T) {
    return Object.fromEntries(Object.entries(input).filter(([field, value]) => previous[field] !== value));
}

export function commitmentsApi(weddingId: number) {
    const base = `/api/weddings/${weddingId}/budget/expenses/`;
    const payments = (expenseId: number) => `${base}${expenseId}/payments/`;
    return {
        load: (signal: AbortSignal) => request(base, isCommitments, signal),
        saveExpense: (input: ExpenseInput, signal: AbortSignal, previous?: Expense) =>
            request(previous ? `${base}${previous.id}/` : base, isCommitments, signal, previous ? "PATCH" : "POST",
                previous ? changedFields(input, previous) : input),
        deleteExpense: (id: number, signal: AbortSignal) => request(`${base}${id}/`, isCommitments, signal, "DELETE"),
        savePayment: (expenseId: number, input: PaymentInput, signal: AbortSignal, previous?: Payment) =>
            request(previous ? `${payments(expenseId)}${previous.id}/` : payments(expenseId), isCommitments, signal,
                previous ? "PATCH" : "POST", previous ? changedFields(input, previous) : input),
        deletePayment: (expenseId: number, id: number, signal: AbortSignal) =>
            request(`${payments(expenseId)}${id}/`, isCommitments, signal, "DELETE"),
    };
}
