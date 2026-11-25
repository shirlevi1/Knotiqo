import { useEffect, useRef, useState, type FormEvent } from "react";
import { attendeeFields, budgetApi, moneyFields, type Budget, type BudgetCategory, type CategoryInput } from "./api/budget";
import { formatVenueMoney } from "./api/venues";
import BudgetAssistant from "./components/BudgetAssistant";
import BudgetCommitments from "./components/BudgetCommitments";
import VenueBudgetSimulation from "./components/VenueBudgetSimulation";
import "./BudgetPage.css";

const suggestedNames = ["אולם וקייטרינג", "צילום", "די־ג׳יי ומוזיקה", "לבוש לחתונה", "שיער ואיפור",
    "עיצוב ופרחים", "הזמנות", "הסעות", "אחר"];
const moneyLabels = ["תקציב כולל", "תקציב שהוקצה", "הוצאה משוערת", "תקציב שטרם הוקצה", "יתרה משוערת"];
const attendeeLabels = ["סך משתתפים", "מבוגרים", "ילדים", "תינוקות", "ללא סיווג גיל"];
const moneyPattern = "[0-9]{1,10}([.,][0-9]{1,2})?";

function displayMoney(amount: string) {
    return amount.startsWith("-") ? `−${formatVenueMoney(amount.slice(1)).replace(/[\u200e\u200f]/g, "")}` : formatVenueMoney(amount);
}

function amount(form: FormData, field: string) {
    return String(form.get(field)).replace(",", ".");
}

function errorMessage(cause: unknown) {
    return cause instanceof Error && !(cause instanceof TypeError) ? cause.message : "לא הצלחנו להתחבר לשרת. נסו שוב.";
}

function CategoryForm({ category, busy, onCancel, onSubmit }: {
    category?: BudgetCategory; busy: boolean; onCancel: () => void; onSubmit: (input: CategoryInput) => void;
}) {
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const name = String(data.get("name")).trim();
        if (!name) {
            const input = event.currentTarget.elements.namedItem("name") as HTMLInputElement;
            input.setCustomValidity("יש להזין שם לקטגוריה.");
            input.reportValidity();
            return;
        }
        onSubmit({ name, planned_amount: amount(data, "planned_amount"), estimated_cost: amount(data, "estimated_cost") || null });
    }
    return <form className="budget-plan-fields" onSubmit={submit} aria-label={category ? "עריכת קטגוריה" : "הוספת קטגוריה"}>
        <label className="ui-field">שם הקטגוריה<input className="ui-input" name="name" list="budget-category-suggestions"
            defaultValue={category?.name} onInput={(event) => event.currentTarget.setCustomValidity("")} maxLength={100} required /></label>
        <datalist id="budget-category-suggestions">{suggestedNames.map((name) => <option key={name} value={name} />)}</datalist>
        <label className="ui-field">סכום מתוכנן בש״ח<input className="ui-input" name="planned_amount" inputMode="decimal"
            defaultValue={category?.planned_amount} pattern={moneyPattern} maxLength={13} required /></label>
        <label className="ui-field">עלות משוערת בש״ח (אופציונלי)<input className="ui-input" name="estimated_cost"
            inputMode="decimal" defaultValue={category?.estimated_cost ?? ""} pattern={moneyPattern} maxLength={13} /></label>
        <div className="budget-actions"><button className="ui-button" disabled={busy}>שמירת קטגוריה</button>
            <button className="ui-button ui-button--text" type="button" disabled={busy} onClick={onCancel}>ביטול</button></div>
    </form>;
}

export default function BudgetPage({ weddingId, newExpense, expenseId, showPayments }: { weddingId: number; newExpense?: boolean; expenseId?: number; showPayments?: boolean }) {
    const [budget, setBudget] = useState<Budget | null>(null);
    const [total, setTotal] = useState("");
    const [editing, setEditing] = useState<number | "new" | null>(null);
    const [removing, setRemoving] = useState<number | null>(null);
    const [error, setError] = useState("");
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const pending = useRef<AbortController | null>(null);
    const api = budgetApi(weddingId);

    useEffect(() => {
        const controller = new AbortController();
        void budgetApi(weddingId).load(controller.signal).then((data) => {
            if (!controller.signal.aborted) {
                setBudget(data);
                setTotal(data.total_budget);
            }
        }).catch((cause) => {
            if (!controller.signal.aborted) setError(errorMessage(cause));
        });
        return () => controller.abort();
    }, [weddingId, attempt]);

    useEffect(() => () => pending.current?.abort(), []);

    async function save(change: (signal: AbortSignal) => Promise<Budget>, done?: (data: Budget) => void) {
        if (pending.current) return;
        const controller = new AbortController();
        pending.current = controller;
        setBusy(true);
        setError("");
        setStatus("");
        try {
            const data = await change(controller.signal);
            if (!controller.signal.aborted) {
                setBudget(data);
                done?.(data);
                setStatus("השינויים נשמרו.");
            }
        } catch (cause) {
            if (!controller.signal.aborted) setError(errorMessage(cause));
        } finally {
            if (!controller.signal.aborted) {
                pending.current = null;
                setBusy(false);
            }
        }
    }

    function move(index: number, offset: number) {
        if (!budget) return;
        const ids = budget.categories.map(({ id }) => id);
        [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
        void save((signal) => api.reorder(ids, signal));
    }

    const category = budget?.categories.find(({ id }) => id === editing);
    return <div className="budget-page">
        <header><h1>תקציב החתונה</h1><p>תכנון הקצאות והערכות עלות בש״ח</p></header>
        {error && <p className="ui-error" role="alert">{error} {!busy && <button className="ui-button ui-button--text" onClick={() => {
            setError(""); setBudget(null); setEditing(null); setRemoving(null); setAttempt((value) => value + 1);
        }}>רענון מהשרת</button>}</p>}
        {status && <p className="budget-status" role="status">{status}</p>}
        {!budget && !error && <p role="status">טוענים את התקציב…</p>}
        {budget && <>
            <section className="ui-panel budget-section" aria-labelledby="budget-overview">
                <h2 id="budget-overview">תמונת התקציב</h2>
                <dl className="budget-metrics">{moneyFields.map((field, index) => <div key={field}>
                    <dt>{moneyLabels[index]}</dt><dd><bdi dir={budget[field].startsWith("-") ? "ltr" : undefined}>{displayMoney(budget[field])}</bdi></dd>
                </div>)}</dl>
                {budget.missing_estimate_count > 0 && <p>היתרה מבוססת על ההערכות שהוזנו. ל־{budget.missing_estimate_count} קטגוריות טרם הוזנה הערכה.</p>}
                <form className="budget-plan-fields" onSubmit={(event) => {
                    event.preventDefault();
                    const value = amount(new FormData(event.currentTarget), "total_budget");
                    void save((signal) => api.total(value, signal), (data) => setTotal(data.total_budget));
                }}>
                    <label className="ui-field">תקציב כולל בש״ח<input className="ui-input" inputMode="decimal" name="total_budget"
                        pattern={moneyPattern} maxLength={13} required value={total} disabled={busy}
                        onChange={(event) => setTotal(event.target.value)} /></label>
                    <button className="ui-button" disabled={busy}>{busy ? "שומרים…" : "שמירת תקציב"}</button>
                </form>
            </section>
            <section className="ui-panel budget-section" aria-labelledby="budget-categories">
                <header className="budget-section-heading"><h2 id="budget-categories">קטגוריות תקציב</h2>
                    <button className="ui-button ui-button--secondary" disabled={busy || editing !== null || removing !== null}
                        onClick={() => setEditing("new")}>הוספת קטגוריה</button></header>
                {budget.categories.length === 0 && !editing && <p>עדיין אין קטגוריות. הוסיפו קטגוריה כדי להתחיל להקצות את התקציב.</p>}
                {budget.categories.length > 0 && <ul className="budget-categories">{budget.categories.map((item, index) => <li key={item.id}>
                    <h3>{item.name}</h3>
                    <dl><div><dt>מתוכנן</dt><dd><bdi>{displayMoney(item.planned_amount)}</bdi></dd></div>
                        <div><dt>משוער</dt><dd><bdi>{item.estimated_cost === null ? "טרם הוזן" : displayMoney(item.estimated_cost)}</bdi></dd></div></dl>
                    <div className="budget-actions">
                        <button className="ui-button ui-button--text" disabled={busy || editing !== null || removing !== null || index === 0}
                            onClick={() => move(index, -1)} aria-label={`העברת ${item.name} למעלה`}>↑</button>
                        <button className="ui-button ui-button--text"
                            disabled={busy || editing !== null || removing !== null || index === budget.categories.length - 1}
                            onClick={() => move(index, 1)} aria-label={`העברת ${item.name} למטה`}>↓</button>
                        <button className="ui-button ui-button--text" disabled={busy || editing !== null || removing !== null}
                            onClick={() => setEditing(item.id)} aria-label={`עריכת ${item.name}`}>עריכה</button>
                        <button className="ui-button ui-button--text" disabled={busy || editing !== null || removing !== null}
                            onClick={() => setRemoving(item.id)} aria-label={`מחיקת ${item.name}`}>מחיקה</button>
                    </div>
                    {removing === item.id && <div className="budget-actions budget-confirm">
                        <p>למחוק את הקטגוריה ואת הסכומים שלה?</p>
                        <button className="ui-button" disabled={busy} onClick={() =>
                            void save((signal) => api.remove(item.id, signal), () => setRemoving(null))}>אישור מחיקה</button>
                        <button className="ui-button ui-button--text" disabled={busy} onClick={() => setRemoving(null)}>ביטול</button>
                    </div>}
                </li>)}</ul>}
                {(editing === "new" || category) && <CategoryForm key={editing} category={category} busy={busy}
                    onCancel={() => setEditing(null)} onSubmit={(input) =>
                        void save((signal) => api.category(input, signal, category?.id), () => setEditing(null))} />}
            </section>
            <section className="ui-panel budget-section" aria-labelledby="budget-guests">
                <h2 id="budget-guests">משתתפים ברשימת המוזמנים</h2>
                {budget.attendee_summary.attendees === 0 && <p>עדיין אין מוזמנים פעילים.</p>}
                <dl className="budget-metrics">{attendeeFields.map((field, index) => <div key={field}>
                    <dt>{attendeeLabels[index]}</dt><dd>{budget.attendee_summary[field]}</dd>
                </div>)}</dl>
            </section>
            <BudgetCommitments key={weddingId} weddingId={weddingId} categories={budget.categories}
                newExpense={newExpense} expenseId={expenseId} showPayments={showPayments} />
            <VenueBudgetSimulation weddingId={weddingId} attendees={budget.attendee_summary.attendees} />
        </>}
        <BudgetAssistant weddingId={weddingId} initiallyOpen />
    </div>;
}
