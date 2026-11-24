import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
    analyzeBudget, BudgetApiError, budgetFieldMessages,
    type BudgetAnalysis, type BudgetFieldErrors, type BudgetInput,
} from "../api/budgetAnalysis";
import "./BudgetAssistant.css";

const fields = [
    { name: "total_budget", label: "תקציב כולל (₪)" },
    { name: "guests", label: "מספר אורחים" },
    { name: "price_per_guest", label: "מחיר לאורח (₪)" },
    { name: "other_expenses", label: "הוצאות נוספות (₪)" },
] as const;

const ils = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" });

function formatIls(amount: string): string {
    const [whole, cents] = amount.split(".");
    return ils.formatToParts(whole === "-0" ? -0 : BigInt(whole))
        .map((part) => part.type === "fraction" ? cents : part.value)
        .join("");
}

type State =
    | { status: "idle" | "loading" }
    | { status: "error"; message: string; fields: BudgetFieldErrors }
    | { status: "ready"; result: BudgetAnalysis };

function readBudgetInput(form: HTMLFormElement) {
    const formData = new FormData(form);
    const errors: BudgetFieldErrors = {};

    function money(field: Exclude<keyof BudgetInput, "guests">) {
        const value = String(formData.get(field) ?? "").trim().replace(",", ".");
        if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) {
            errors[field] = budgetFieldMessages[field];
        }
        return value;
    }

    const guestsValue = String(formData.get("guests") ?? "").trim();
    const guests = Number(guestsValue);
    if (!/^\d+$/.test(guestsValue) || !Number.isSafeInteger(guests) || guests < 1) {
        errors.guests = budgetFieldMessages.guests;
    }

    const input = {
        total_budget: money("total_budget"),
        guests,
        price_per_guest: money("price_per_guest"),
        other_expenses: money("other_expenses"),
    };
    return { input, errors };
}

export default function BudgetAssistant({ weddingId, initiallyOpen }: { weddingId: number; initiallyOpen?: boolean }) {
    const id = useId();
    const [state, setState] = useState<State>({ status: "idle" });
    const request = useRef<AbortController | null>(null);

    useEffect(() => () => request.current?.abort(), []);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (request.current) return;

        const { input, errors } = readBudgetInput(event.currentTarget);
        if (Object.keys(errors).length) {
            setState({ status: "error", message: "בדקו את השדות המסומנים ונסו שוב.", fields: errors });
            return;
        }

        const controller = new AbortController();
        request.current = controller;
        setState({ status: "loading" });
        try {
            const result = await analyzeBudget(weddingId, input, controller.signal);
            if (!controller.signal.aborted) setState({ status: "ready", result });
        } catch (error) {
            if (!controller.signal.aborted) {
                setState({
                    status: "error",
                    message: error instanceof BudgetApiError
                        ? error.message : "לא הצלחנו לנתח את התקציב. בדקו את החיבור ונסו שוב.",
                    fields: error instanceof BudgetApiError ? error.fields : {},
                });
            }
        } finally {
            request.current = null;
        }
    }

    const loading = state.status === "loading";
    const result = state.status === "ready" ? state.result : null;
    const budget = result?.budget_analysis;

    return (
        <details className="budget-assistant ui-panel" dir="rtl" open={initiallyOpen}>
            <summary>עוזר התקציב החכם</summary>
            <form noValidate onSubmit={submit} aria-busy={loading}
                onInput={() => {
                    if (state.status === "ready") setState({ status: "idle" });
                }}>
                <fieldset className="ui-fieldset" disabled={loading}>
                    <div className="budget-fields">
                        {fields.map(({ name, label }) => {
                            const fieldId = `${id}-${name}`;
                            const error = state.status === "error" ? state.fields[name] : undefined;
                            return (
                                <div className="ui-field" key={name}>
                                    <label htmlFor={fieldId}>{label}</label>
                                    <input className="ui-input" id={fieldId} name={name} dir="ltr" required
                                        inputMode={name === "guests" ? "numeric" : "decimal"}
                                        aria-invalid={error ? true : undefined}
                                        aria-describedby={error ? `${fieldId}-error` : undefined} />
                                    {error && <p id={`${fieldId}-error`} className="ui-error">{error}</p>}
                                </div>
                            );
                        })}
                    </div>
                    <button className="ui-button" type="submit" disabled={loading}>
                        ניתוח תקציב
                    </button>
                </fieldset>
            </form>

            {loading && <p className="ui-status ui-status--loading" role="status">מנתחים את התקציב ומכינים המלצה…</p>}
            {state.status === "error" && <p className="ui-error" role="alert">{state.message}</p>}
            <div aria-live="polite">
                {result && budget && (
                    <div className="budget-results">
                        <section className="ui-card" aria-labelledby={`${id}-breakdown`}>
                            <h4 id={`${id}-breakdown`}>חישוב תקציב מאומת</h4>
                            <dl>
                                <dt>עלות האולם</dt><dd><bdi>{formatIls(budget.venue_cost)}</bdi></dd>
                                <dt>סך ההוצאות</dt><dd><bdi>{formatIls(budget.total_expenses)}</bdi></dd>
                                <dt>יתרת התקציב</dt><dd><bdi>{formatIls(budget.remaining_budget)}</bdi></dd>
                            </dl>
                            <p className={budget.over_budget ? "ui-error" : "ui-status"}>
                                {budget.over_budget ? "חריגה מהתקציב" : "ההוצאות במסגרת התקציב"}
                            </p>
                        </section>
                        <section className="ui-card" aria-labelledby={`${id}-recommendation`}>
                            <h4 id={`${id}-recommendation`}>המלצת Gemini</h4>
                            <p className="budget-recommendation">{result.ai_recommendation}</p>
                        </section>
                    </div>
                )}
            </div>
        </details>
    );
}
