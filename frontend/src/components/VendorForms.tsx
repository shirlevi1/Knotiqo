import type { FormEvent } from "react";
import type { BudgetCategory } from "../api/budget";
import { quoteStatuses, serviceCategories, vendorStatuses, type Quote, type QuoteInput, type Vendor, type VendorInput } from "../api/vendors";

export function VendorForm({ vendor, categories, busy, onSave, onCancel }: {
    vendor?: Vendor; categories: BudgetCategory[]; busy: boolean; onSave: (input: VendorInput) => void; onCancel: () => void;
}) {
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const value = (key: string) => String(data.get(key) ?? "").trim();
        onSave({ name: value("name"), service_category: value("service_category"), contact_person: value("contact_person"),
            phone: value("phone"), email: value("email"), website: value("website"), notes: value("notes"),
            status: value("status") as VendorInput["status"], budget_category_id: Number(value("budget_category_id")) || null });
    }
    return <form className="ui-panel vendors-panel" aria-label={vendor ? "עריכת ספק" : "הוספת ספק"} onSubmit={submit}>
        <h2>{vendor ? "עריכת ספק" : "הוספת ספק"}</h2>
        <fieldset disabled={busy} className="vendors-form">
            <label className="ui-field">שם העסק<input className="ui-input" name="name" required maxLength={150} defaultValue={vendor?.name} /></label>
            <label className="ui-field">קטגוריית שירות<input className="ui-input" name="service_category" list="vendor-category-options"
                required maxLength={100} defaultValue={vendor?.service_category} /></label>
            <datalist id="vendor-category-options">{serviceCategories.map((name) => <option value={name} key={name} />)}</datalist>
            <label className="ui-field">מצב ספק<select className="ui-input" name="status" defaultValue={vendor?.status ?? "researching"}>
                {Object.entries(vendorStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <label className="ui-field">איש קשר<input className="ui-input" name="contact_person" maxLength={150} defaultValue={vendor?.contact_person} /></label>
            <label className="ui-field">טלפון<input className="ui-input" name="phone" type="tel" dir="ltr" maxLength={32} defaultValue={vendor?.phone} /></label>
            <label className="ui-field">דוא״ל<input className="ui-input" name="email" type="email" dir="ltr" maxLength={254} defaultValue={vendor?.email} /></label>
            <label className="ui-field">אתר או קישור חברתי<input className="ui-input" name="website" type="url" dir="ltr"
                maxLength={500} defaultValue={vendor?.website} /></label>
            <label className="ui-field">קטגוריית תקציב<select className="ui-input" name="budget_category_id" defaultValue={vendor?.budget_category_id ?? ""}>
                <option value="">ללא קטגוריה מקושרת</option>
                {categories.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select></label>
            <label className="ui-field vendors-notes">הערות<textarea className="ui-input" name="notes" maxLength={4000} defaultValue={vendor?.notes} /></label>
        </fieldset>
        <div className="vendors-actions"><button className="ui-button" disabled={busy}>שמירת ספק</button>
            <button className="ui-button ui-button--text" type="button" disabled={busy} onClick={onCancel}>ביטול</button></div>
    </form>;
}

export function QuoteForm({ quote, busy, onSave, onCancel }: {
    quote?: Quote; busy: boolean; onSave: (input: QuoteInput) => void; onCancel: () => void;
}) {
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const value = (key: string) => String(data.get(key) ?? "").trim();
        onSave({ title: value("title"), amount: value("amount").replace(",", "."), received_date: value("received_date") || null,
            included_services: value("included_services"), excluded_services: value("excluded_services"),
            notes: value("notes"), status: value("status") as QuoteInput["status"] });
    }

    return <form className="vendors-panel" aria-label={quote ? "עריכת הצעה" : "הוספת הצעה"} onSubmit={submit}>
        <h3>{quote ? "עריכת הצעה" : "הוספת הצעה"}</h3>
        <fieldset className="vendors-form" disabled={busy}>
            <label className="ui-field">כותרת<input className="ui-input" name="title" required maxLength={150} defaultValue={quote?.title} /></label>
            <label className="ui-field">סכום הצעה בש״ח<input className="ui-input" name="amount" inputMode="decimal"
                pattern="[0-9]{1,10}([.,][0-9]{1,2})?" maxLength={13} required defaultValue={quote?.amount} /></label>
            <label className="ui-field">תאריך קבלה<input className="ui-input" name="received_date" type="date" defaultValue={quote?.received_date ?? ""} /></label>
            <label className="ui-field">מצב הצעה<select className="ui-input" name="status" defaultValue={quote?.status ?? "pending"}>
                {Object.entries(quoteStatuses).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
            </select></label>
            <label className="ui-field">שירותים כלולים<textarea className="ui-input" name="included_services" maxLength={2000} defaultValue={quote?.included_services} /></label>
            <label className="ui-field">שירותים לא כלולים<textarea className="ui-input" name="excluded_services" maxLength={2000} defaultValue={quote?.excluded_services} /></label>
            <label className="ui-field vendors-notes">הערות<textarea className="ui-input" name="notes" maxLength={4000} defaultValue={quote?.notes} /></label>
        </fieldset>
        <div className="vendors-actions"><button className="ui-button" disabled={busy}>שמירת הצעה</button>
            <button className="ui-button ui-button--text" type="button" disabled={busy} onClick={onCancel}>ביטול</button></div>
    </form>;
}
