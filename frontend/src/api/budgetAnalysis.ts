import { getCsrfToken } from "./csrf";

export type BudgetInput = {
    total_budget: string;
    guests: number;
    price_per_guest: string;
    other_expenses: string;
};

export type BudgetFieldErrors = Partial<Record<keyof BudgetInput, string>>;

export const budgetFieldMessages = {
    total_budget: "הזינו תקציב לא שלילי, עם עד 10 ספרות לפני הנקודה ועד 2 אחריה.",
    guests: "הזינו מספר אורחים שלם וחיובי.",
    price_per_guest: "הזינו מחיר לא שלילי, עם עד 10 ספרות לפני הנקודה ועד 2 אחריה.",
    other_expenses: "הזינו הוצאות לא שליליות, עם עד 10 ספרות לפני הנקודה ועד 2 אחריה.",
} satisfies Record<keyof BudgetInput, string>;

type BudgetBreakdown = {
    venue_cost: string;
    total_expenses: string;
    remaining_budget: string;
    over_budget: boolean;
};

export type BudgetAnalysis = {
    budget_analysis: BudgetBreakdown;
    ai_recommendation: string;
};

export class BudgetApiError extends Error {
    readonly fields: BudgetFieldErrors;

    constructor(message: string, fields: BudgetFieldErrors = {}) {
        super(message);
        this.fields = fields;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAmount(value: unknown): value is string {
    return typeof value === "string" && /^-?\d+\.\d{2}$/.test(value);
}

function isBudgetAnalysis(value: unknown): value is BudgetAnalysis {
    if (!isRecord(value) || !isRecord(value.budget_analysis)) return false;
    const budget = value.budget_analysis;
    return isAmount(budget.venue_cost) && isAmount(budget.total_expenses)
        && isAmount(budget.remaining_budget) && typeof budget.over_budget === "boolean"
        && typeof value.ai_recommendation === "string" && value.ai_recommendation.trim() !== "";
}

const authenticationError = "לא הצלחנו לאמת את הבקשה. רעננו את הדף והתחברו שוב במידת הצורך.";

export async function analyzeBudget(
    weddingId: number, input: BudgetInput, signal: AbortSignal,
): Promise<BudgetAnalysis> {
    const csrf = await fetch("/api/auth/csrf/", { credentials: "same-origin", signal });
    if (!csrf.ok) throw new BudgetApiError(authenticationError);
    const token = getCsrfToken();
    if (!token) throw new BudgetApiError(authenticationError);

    const response = await fetch(`/api/ai/weddings/${weddingId}/budget-analysis/`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify(input),
        signal,
    });

    if (response.status === 400) {
        const data: unknown = await response.json().catch(() => null);
        const fields: BudgetFieldErrors = {};
        for (const field of Object.keys(budgetFieldMessages) as (keyof BudgetInput)[]) {
            if (isRecord(data) && Object.hasOwn(data, field)) {
                fields[field] = budgetFieldMessages[field];
            }
        }
        throw new BudgetApiError("בדקו את נתוני התקציב ונסו שוב.", fields);
    }
    if (response.status === 401 || response.status === 403) {
        throw new BudgetApiError(authenticationError);
    }
    if (response.status === 404) {
        throw new BudgetApiError("החתונה אינה זמינה לחשבון הזה. חזרו לרשימת החתונות ובדקו את הגישה.");
    }
    if (response.status === 503) {
        throw new BudgetApiError("שירות ההמלצות אינו זמין כרגע. נסו שוב בעוד כמה דקות.");
    }
    if (!response.ok) throw new BudgetApiError("לא הצלחנו לנתח את התקציב כרגע. נסו שוב.");

    const data: unknown = await response.json().catch(() => null);
    if (!isBudgetAnalysis(data)) {
        throw new BudgetApiError("התקבלה תשובה לא תקינה לניתוח התקציב. נסו שוב.");
    }
    return data;
}
