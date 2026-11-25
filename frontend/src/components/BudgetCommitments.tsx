import { useEffect, useRef, useState } from "react";
import { commitmentFields, commitmentsApi, paymentPhases, type BudgetCategory, type Commitments,
    type Expense, type Payment, type Phase } from "../api/budget";
import { formatVenueMoney } from "../api/venues";
import { ExpenseForm, PaymentForm } from "./BudgetCommitmentForms";

const totalsLabels = ["עלות התחייבויות", "תשלומים מתוכננים", "שולם בפועל", "נותר לתשלום", "תשלומים קרובים", "תשלומים באיחור"];
const statusLabels = { paid: "שולם", unpaid: "טרם שולם", partial: "שולם חלקית" } as const;
const timeline: { label: string; phases: Phase[] }[] = [
    { label: "לפני החתונה", phases: ["deposit", "before"] },
    { label: "ביום החתונה", phases: ["on_day"] },
    { label: "אחרי החתונה", phases: ["after"] },
    { label: "תשלומים נוספים", phases: ["other"] },
];
type Editor = { kind: "expense"; expense?: Expense }
    | { kind: "payment"; expense: Expense; payment?: Payment };
type Removal = { expense: Expense; payment?: Payment };

function Money({ value }: { value: string }) {
    return <bdi>{formatVenueMoney(value)}</bdi>;
}

export default function BudgetCommitments({ weddingId, categories, newExpense, expenseId, showPayments }: {
    weddingId: number; categories: BudgetCategory[]; newExpense?: boolean; expenseId?: number; showPayments?: boolean;
}) {
    const [data, setData] = useState<Commitments | null>(null);
    const [editor, setEditor] = useState<Editor | null>(newExpense && categories.length ? { kind: "expense" } : null);
    const [removal, setRemoval] = useState<Removal | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [status, setStatus] = useState("");
    const [from, setFrom] = useState("");
    const [until, setUntil] = useState("");
    const [supplier, setSupplier] = useState("");
    const pending = useRef<AbortController | null>(null);
    const section = useRef<HTMLElement>(null);
    const api = commitmentsApi(weddingId);
    const locked = busy || editor !== null || removal !== null;
    const invalidDates = Boolean(from && until && from > until);

    useEffect(() => {
        const controller = new AbortController();
        void commitmentsApi(weddingId).load(controller.signal).then((snapshot) => {
            if (!controller.signal.aborted) setData(snapshot);
        }).catch(() => {
            if (!controller.signal.aborted) setError("לא הצלחנו לטעון התחייבויות ותשלומים.");
        });
        return () => controller.abort();
    }, [weddingId, attempt]);

    useEffect(() => () => pending.current?.abort(), []);
    const loaded = data !== null;
    useEffect(() => {
        if (loaded && (showPayments || newExpense || expenseId !== undefined)) section.current?.scrollIntoView?.({ block: "start" });
    }, [loaded, newExpense, expenseId, showPayments]);

    async function save(action: (signal: AbortSignal) => Promise<Commitments>) {
        if (pending.current) return;
        const controller = new AbortController();
        pending.current = controller;
        setBusy(true);
        setError("");
        setNotice("");
        try {
            const snapshot = await action(controller.signal);
            if (!controller.signal.aborted) {
                setData(snapshot);
                setEditor(null);
                setRemoval(null);
                setNotice("השינויים נשמרו.");
            }
        } catch (cause) {
            if (!controller.signal.aborted) setError(cause instanceof Error && !(cause instanceof TypeError)
                ? cause.message : "לא הצלחנו להתחבר לשרת. נסו שוב.");
        } finally {
            if (!controller.signal.aborted) {
                pending.current = null;
                setBusy(false);
            }
        }
    }

    function begin(next: Editor) {
        setError("");
        setNotice("");
        setEditor(next);
    }

    const expenses = (data?.expenses ?? []).filter((expense) => expenseId === undefined || expense.id === expenseId);
    const entries = expenses.flatMap((expense) =>
        expense.payments.map((payment) => ({ expense, payment }))).filter(({ expense, payment }) => {
        const needle = supplier.trim().toLocaleLowerCase();
        return (!status || (status === "outstanding" ? payment.status !== "paid" : payment.status === status))
            && (!from || (payment.due_date !== null && payment.due_date >= from))
            && (!until || (payment.due_date !== null && payment.due_date <= until))
            && [expense.name, expense.supplier_name, expense.venue_name ?? ""].some((value) => value.toLocaleLowerCase().includes(needle));
    }).sort((a, b) => (a.payment.due_date ?? "9999-12-31").localeCompare(b.payment.due_date ?? "9999-12-31")
        || a.payment.id - b.payment.id);

    return <section ref={section} className="ui-panel budget-section budget-commitments" aria-labelledby="budget-commitments">
        <header className="budget-section-heading">
            <h2 id="budget-commitments">התחייבויות ותשלומים</h2>
            {data && <button className="ui-button ui-button--secondary" disabled={locked || !categories.length}
                onClick={() => begin({ kind: "expense" })}>הוספת התחייבות</button>}
        </header>
        <p>כאן מתעדים עלויות מול ספקים, תשלומים מתוכננים וסכומים ששולמו בפועל. הקצאות והערכות בקטגוריות מוצגות בנפרד.</p>
        {error && <p className="ui-error" role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {!data && (error ? <button className="ui-button" onClick={() => {
            setError(""); setAttempt((value) => value + 1);
        }}>טעינת תשלומים מחדש</button> : <p role="status">טוענים התחייבויות ותשלומים…</p>)}
        {data && <>
            <dl className="budget-metrics">{commitmentFields.map((field, index) =>
                <div key={field}><dt>{totalsLabels[index]}</dt><dd><Money value={data.totals[field]} /></dd></div>)}</dl>
            {!categories.length && <p>הוסיפו קטגוריה כדי לשייך אליה התחייבות.</p>}
            {expenseId !== undefined && <a href={`#/weddings/${weddingId}/budget`}>כל ההתחייבויות</a>}
            {expenses.length === 0 && categories.length > 0 && <p>{expenseId === undefined ? "עדיין אין התחייבויות שמורות." : "ההתחייבות אינה זמינה."}</p>}
            {expenses.length > 0 && <ul className="budget-categories">
                {expenses.map((expense) => <li key={expense.id}>
                    <header><h3>{expense.name}</h3>
                        <p>{[categories.find(({ id }) => id === expense.category_id)?.name, expense.supplier_name,
                            expense.venue_name].filter(Boolean).join(" · ")}</p>
                    </header>
                    <dl><div><dt>עלות התחייבות</dt><dd><Money value={expense.committed_cost} /></dd></div>
                        <div><dt>שולם בפועל</dt><dd><Money value={expense.paid_amount} /></dd></div>
                        <div><dt>נותר לתשלום</dt><dd><Money value={expense.remaining_amount} /></dd></div></dl>
                    <div className="budget-actions">
                        <button className="ui-button ui-button--secondary" disabled={locked}
                            onClick={() => begin({ kind: "payment", expense })}>הוספת תשלום</button>
                        <button className="ui-button ui-button--text" disabled={locked}
                            onClick={() => begin({ kind: "expense", expense })}>עריכת התחייבות</button>
                        {!expense.payments.length && <button className="ui-button ui-button--text" disabled={locked}
                            onClick={() => setRemoval({ expense })}>מחיקה</button>}
                    </div>
                    {expense.schedule_status !== "complete" && <p className="budget-confirm">
                        {expense.schedule_status === "incomplete" ? "חסר בלוח התשלומים: " : "לוח התשלומים חורג מההתחייבות ב־"}
                        <Money value={expense.schedule_difference.replace(/^-/, "")} />
                    </p>}
                </li>)}
            </ul>}
            {editor?.kind === "expense" && <ExpenseForm weddingId={weddingId} categories={categories} busy={busy}
                expense={editor.expense} cancel={() => setEditor(null)}
                save={(input) => void save((signal) => api.saveExpense(input, signal, editor.expense))} />}
            {editor?.kind === "payment" && <PaymentForm payment={editor.payment} today={data.as_of} busy={busy}
                cancel={() => setEditor(null)} save={(input) =>
                    void save((signal) => api.savePayment(editor.expense.id, input, signal, editor.payment))} />}
            {removal && <div className="budget-actions">
                <p>{removal.payment ? "להסיר את התשלום המתוכנן?" : `להסיר את ההתחייבות ״${removal.expense.name}״?`}</p>
                <button className="ui-button" disabled={busy} onClick={() => void save((signal) => removal.payment
                    ? api.deletePayment(removal.expense.id, removal.payment.id, signal) : api.deleteExpense(removal.expense.id, signal))}>אישור מחיקה</button>
                <button className="ui-button ui-button--text" disabled={busy} onClick={() => setRemoval(null)}>ביטול</button>
            </div>}
            <h3>לוח תשלומים</h3>
            {data.wedding_date && <p>תאריך החתונה <time dir="ltr" dateTime={data.wedding_date}>{data.wedding_date}</time></p>}
            <div className="budget-plan-fields">
                <label className="ui-field">מצב תשלום<select className="ui-input" value={status} onChange={(event) => setStatus(event.target.value)}>
                    <option value="">כל התשלומים</option><option value="outstanding">עם יתרה לתשלום</option>
                    {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select></label>
                <label className="ui-field">מתאריך יעד<input className="ui-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
                <label className="ui-field">עד תאריך יעד<input className="ui-input" type="date" value={until} onChange={(event) => setUntil(event.target.value)} /></label>
                <label className="ui-field">ספק או התחייבות<input className="ui-input" type="search" value={supplier} onChange={(event) => setSupplier(event.target.value)} /></label>
            </div>
            {invalidDates ? <p className="ui-error" role="alert">תאריך הסיום צריך להיות אחרי תאריך ההתחלה או זהה לו.</p>
                : entries.length === 0 ? <p>אין תשלומים להצגה.</p>
                    : timeline.map(({ label, phases }) => {
                        const group = entries.filter(({ payment }) => phases.includes(payment.phase));
                        return group.length > 0 && <div className="budget-timeline-group" key={label}>
                            <h3>{label}</h3>
                            <ul className="budget-categories">{group.map(({ expense, payment }) => <li key={payment.id}>
                                <div><strong>{expense.name} · {paymentPhases[payment.phase]}</strong>
                                    <p>{payment.due_date ? <>לתשלום עד <time dir="ltr" dateTime={payment.due_date}>{payment.due_date}</time></> : "ללא תאריך יעד"}
                                        {payment.timing === "overdue" && <span className="ui-error"> · באיחור</span>}</p>
                                    {payment.notes && <p className="budget-payment-notes">{payment.notes}</p>}
                                </div>
                                <dl><div><dt>מתוכנן</dt><dd><Money value={payment.amount} /></dd></div>
                                    <div><dt>{statusLabels[payment.status]} {payment.paid_date && <time dir="ltr" dateTime={payment.paid_date}>{payment.paid_date}</time>}</dt>
                                        <dd><Money value={payment.paid_amount} /></dd></div>
                                    <div><dt>נותר לתשלום</dt><dd><Money value={payment.outstanding_amount} /></dd></div></dl>
                                <div className="budget-actions">
                                    <button className="ui-button ui-button--text" disabled={locked}
                                        onClick={() => begin({ kind: "payment", expense, payment })}>עריכת תשלום</button>
                                    {payment.status === "unpaid" && <button className="ui-button ui-button--text" disabled={locked}
                                        onClick={() => setRemoval({ expense, payment })}>מחיקה</button>}
                                </div>
                            </li>)}</ul>
                        </div>;
                    })}
        </>}
    </section>;
}
