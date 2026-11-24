import { useEffect, useState, type FormEvent } from "react";
import { paymentPhases, type BudgetCategory, type Expense, type ExpenseInput, type Payment, type PaymentInput, type Phase } from "../api/budget";
import { venuesApi, type Venue } from "../api/venues";

const moneyPattern = "[0-9]{1,10}([.,][0-9]{1,2})?";
const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const money = (data: FormData, key: string) => text(data, key).replace(",", ".");

function FormButtons({ busy, cancel }: { busy: boolean; cancel: () => void }) {
    return <div className="budget-actions">
        <button className="ui-button" disabled={busy}>{busy ? "שומרים…" : "שמירה"}</button>
        <button className="ui-button ui-button--text" type="button" onClick={cancel} disabled={busy}>ביטול</button>
    </div>;
}

function MoneyField({ name, label, value, required = false }: {
    name: string; label: string; value?: string; required?: boolean;
}) {
    return <label className="ui-field">{label}<input className="ui-input" name={name} inputMode="decimal"
        maxLength={13} pattern={moneyPattern} defaultValue={value} required={required} /></label>;
}

export function ExpenseForm({ weddingId, expense, categories, busy, cancel, save }: {
    weddingId: number; expense?: Expense; categories: BudgetCategory[]; busy: boolean;
    cancel: () => void; save: (input: ExpenseInput) => void;
}) {
    const [venues, setVenues] = useState<Venue[] | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        void venuesApi(weddingId).list(controller.signal).then((items) => {
            if (!controller.signal.aborted) setVenues(items);
        }).catch(() => {
            if (!controller.signal.aborted) setFailed(true);
        });
        return () => controller.abort();
    }, [weddingId]);

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const selectedVenue = data.has("venue_id") ? Number(text(data, "venue_id")) || null : expense?.venue_id ?? null;
        save({ name: text(data, "name"), category_id: Number(text(data, "category_id")), venue_id: selectedVenue,
            supplier_name: text(data, "supplier_name"), committed_cost: money(data, "committed_cost") });
    }

    return <form onSubmit={submit} aria-label={expense ? "עריכת התחייבות" : "הוספת התחייבות"}>
        <fieldset className="budget-plan-fields budget-form-fields" disabled={busy}>
            <label className="ui-field">שם ההתחייבות<input name="name" className="ui-input" maxLength={100} required defaultValue={expense?.name} /></label>
            <label className="ui-field">קטגוריה<select name="category_id" className="ui-input" required defaultValue={expense?.category_id ?? ""}>
                <option value="">בחירת קטגוריה</option>
                {categories.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select></label>
            <label className="ui-field">שם ספק (אופציונלי)<input name="supplier_name" className="ui-input" maxLength={100} defaultValue={expense?.supplier_name} /></label>
            <label className="ui-field">אולם מקושר (אופציונלי)<select name="venue_id" className="ui-input"
                defaultValue={expense?.venue_id ?? ""} disabled={!venues}>
                <option value="">{!venues && !failed ? "טוענים אולמות…" : "ללא אולם מקושר"}</option>
                {expense?.venue_id && !venues?.some(({ id }) => id === expense.venue_id)
                    && <option value={expense.venue_id}>{expense.venue_name}</option>}
                {venues?.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select></label>
            {failed && <p role="status">לא ניתן לטעון את רשימת האולמות. אפשר לשמור את יתר הפרטים.</p>}
            <MoneyField name="committed_cost" label="עלות התחייבות בש״ח" value={expense?.committed_cost} required />
        </fieldset>
        <FormButtons busy={busy} cancel={cancel} />
    </form>;
}

export function PaymentForm({ payment, today, busy, cancel, save }: {
    payment?: Payment; today: string; busy: boolean; cancel: () => void; save: (input: PaymentInput) => void;
}) {
    const [error, setError] = useState("");
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const paid_amount = money(data, "paid_amount") || "0";
        const paid_date = text(data, "paid_date") || null;
        if (Boolean(paid_date) !== /[1-9]/.test(paid_amount)) {
            setError("יש להזין תאריך עבור סכום ששולם. אם טרם שולם, השאירו את התאריך ריק.");
            return;
        }
        setError("");
        save({ phase: text(data, "phase") as Phase, due_date: text(data, "due_date") || null,
            amount: money(data, "amount"), paid_amount, paid_date, notes: text(data, "notes") });
    }

    return <form onSubmit={submit} aria-label={payment ? "עריכת תשלום" : "הוספת תשלום"}>
        <fieldset className="budget-plan-fields budget-form-fields" disabled={busy}>
            <legend>תשלום מתוכנן</legend>
            <label className="ui-field">שלב<select className="ui-input" name="phase" required defaultValue={payment?.phase ?? "deposit"}>
                {Object.entries(paymentPhases).map(([phase, label]) => <option key={phase} value={phase}>{label}</option>)}
            </select></label>
            <label className="ui-field">תאריך יעד (אופציונלי)<input className="ui-input" type="date" name="due_date" defaultValue={payment?.due_date ?? ""} /></label>
            <MoneyField name="amount" label="סכום מתוכנן בש״ח" value={payment?.amount} required />
            <label className="ui-field">הערות<input className="ui-input" name="notes" maxLength={500} defaultValue={payment?.notes} /></label>
        </fieldset>
        <fieldset className="budget-plan-fields budget-form-fields" disabled={busy}>
            <legend>תשלום בפועל</legend>
            <MoneyField name="paid_amount" label="סכום ששולם בפועל בש״ח" value={payment?.paid_amount} />
            <label className="ui-field">תאריך התשלום האחרון בפועל<input className="ui-input" name="paid_date" type="date" max={today}
                defaultValue={payment?.paid_date ?? ""} /></label>
        </fieldset>
        {error && <p className="ui-error" role="alert">{error}</p>}
        <FormButtons busy={busy} cancel={cancel} />
    </form>;
}
