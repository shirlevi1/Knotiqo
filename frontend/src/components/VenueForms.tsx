import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { VenueApiError, venueStatuses, type QuoteInput, type VenueInput, type VenueStatus } from "../api/venues";

type Field = {
    name: string; label: string; required?: boolean; maxLength?: number;
    kind?: "text" | "date" | "money" | "integer" | "notes" | "url";
};
const venueFields: Field[] = [
    { name: "name", label: "שם האולם", required: true, maxLength: 150 },
    { name: "location", label: "מיקום", maxLength: 150 },
    { name: "contact_name", label: "איש או אשת קשר", maxLength: 100 },
    { name: "phone", label: "טלפון", maxLength: 25 },
    { name: "website", label: "אתר אינטרנט", kind: "url", maxLength: 500 },
    { name: "capacity", label: "קיבולת", kind: "integer" },
    { name: "notes", label: "הערות", kind: "notes" },
];
const quoteFields: Field[] = [
    { name: "event_date", label: "תאריך האירוע", kind: "date" },
    { name: "price_per_guest", label: "מחיר לאורח (₪)", kind: "money", required: true },
    { name: "minimum_guests", label: "מינימום אורחים", kind: "integer", required: true },
    { name: "additional_costs", label: "עלויות נוספות (₪)", kind: "money" },
    { name: "notes", label: "הערות", kind: "notes" },
];

function Editor({ kind, initial, onSave, onCancel }: {
    kind: "venue" | "quote";
    initial?: VenueInput | QuoteInput;
    onSave: (form: FormData) => Promise<void>;
    onCancel: () => void;
}) {
    const id = useId();
    const form = useRef<HTMLFormElement>(null);
    const submitting = useRef(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});
    const fields = kind === "venue" ? venueFields : quoteFields;
    useEffect(() => { form.current?.querySelector("input")?.focus(); }, []);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting.current) return;
        const data = new FormData(event.currentTarget);
        const invalid: Record<string, string> = {};
        for (const field of fields) {
            const value = String(data.get(field.name) ?? "").trim();
            data.set(field.name, value);
            if (field.required && !value) invalid[field.name] = "יש למלא את השדה.";
            if (field.maxLength && Array.from(value).length > field.maxLength) invalid[field.name] = `עד ${field.maxLength} תווים.`;
            if (value && field.kind === "integer"
                && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 2147483647)) {
                invalid[field.name] = "יש להזין מספר שלם וחיובי עד 2,147,483,647.";
            }
            if (value && field.kind === "money") {
                const digits = field.name === "price_per_guest" ? 8 : 10;
                if (!new RegExp(`^\\d{1,${digits}}(?:\\.\\d{1,2})?$`).test(value)) {
                    invalid[field.name] = `יש להזין סכום לא שלילי עם עד ${digits} ספרות לפני הנקודה ועד שתיים אחריה.`;
                }
            }
            if (value && field.kind === "url") {
                const url = URL.parse(value);
                if (!url || !["http:", "https:", "ftp:", "ftps:"].includes(url.protocol)) invalid[field.name] = "יש להזין כתובת אתר מלאה ותקינה.";
            }
        }
        setErrors(invalid);
        setError("");
        if (Object.keys(invalid).length) {
            const firstInvalid = form.current?.elements.namedItem(Object.keys(invalid)[0]);
            if (firstInvalid instanceof HTMLElement) firstInvalid.focus();
            return;
        }
        submitting.current = true;
        setBusy(true);
        try { await onSave(data); }
        catch (failure) {
            setError(failure instanceof VenueApiError ? failure.message : "לא הצלחנו לשמור. בדקו את החיבור ונסו שוב.");
            if (failure instanceof VenueApiError) {
                setErrors(Object.fromEntries(failure.fields.map((field) => [field, "בדקו את הערך שהזנתם."])));
            }
        } finally { submitting.current = false; setBusy(false); }
    }

    return (
        <form ref={form} className="venue-management-form ui-panel" noValidate onSubmit={submit} aria-busy={busy}>
            <h2>{initial ? "עריכת" : "הוספת"} {kind === "venue" ? "אולם" : "הצעת מחיר"}</h2>
            <fieldset className="ui-fieldset" disabled={busy}>
                <div className="venue-management-fields">
                    {fields.map((field) => {
                        const fieldId = `${id}-${field.name}`;
                        const value = initial?.[field.name as keyof typeof initial] ?? "";
                        const attributes = {
                            id: fieldId, name: field.name, className: "ui-input", required: field.required,
                            defaultValue: String(value), maxLength: field.maxLength,
                            "aria-invalid": errors[field.name] ? true : undefined,
                            "aria-describedby": errors[field.name] ? `${fieldId}-error` : undefined,
                        };
                        return (
                            <div className="ui-field" key={field.name}>
                                <label htmlFor={fieldId}>{field.label}</label>
                                {field.kind === "notes" ? <textarea {...attributes} rows={3} /> : (
                                    <input {...attributes} type={field.kind === "date" ? "date" : "text"}
                                        dir={["money", "integer", "date", "url"].includes(field.kind ?? "") ? "ltr" : "auto"}
                                        inputMode={field.kind === "money" ? "decimal" : field.kind === "integer" ? "numeric" : undefined} />
                                )}
                                {errors[field.name] && <p id={`${fieldId}-error`} className="ui-error">{errors[field.name]}</p>}
                            </div>
                        );
                    })}
                    {kind === "venue" && (
                        <>
                            <div className="ui-field">
                                <label htmlFor={`${id}-status`}>סטטוס</label>
                                <select className="ui-input" id={`${id}-status`} name="status"
                                    defaultValue={initial && "status" in initial ? initial.status : "interested"}>
                                    {Object.entries(venueStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </select>
                            </div>
                            <label className="venue-checkbox"><input type="checkbox" name="is_favorite"
                                defaultChecked={initial && "is_favorite" in initial ? initial.is_favorite : false} />מועדף</label>
                        </>
                    )}
                </div>
                {error && <p className="ui-error" role="alert">{error}</p>}
                <div className="venue-management-actions">
                    <button className="ui-button" type="submit" disabled={busy}>{busy ? "שומרים…" : "שמירה"}</button>
                    <button className="ui-button ui-button--text" type="button" onClick={onCancel}>ביטול</button>
                </div>
            </fieldset>
        </form>
    );
}

export function VenueForm({ initial, onSave, onCancel }: {
    initial?: VenueInput; onSave: (input: VenueInput) => Promise<void>; onCancel: () => void;
}) {
    return <Editor kind="venue" initial={initial} onCancel={onCancel} onSave={async (data) => {
        const text = (key: string) => String(data.get(key) ?? "");
        await onSave({
            name: text("name"), location: text("location"), contact_name: text("contact_name"),
            phone: text("phone"), website: text("website"), notes: text("notes"),
            capacity: text("capacity") ? Number(text("capacity")) : null,
            status: text("status") as VenueStatus, is_favorite: data.get("is_favorite") === "on",
        });
    }} />;
}

export function QuoteForm({ initial, onSave, onCancel }: {
    initial?: QuoteInput; onSave: (input: QuoteInput) => Promise<void>; onCancel: () => void;
}) {
    return <Editor kind="quote" initial={initial} onCancel={onCancel} onSave={async (data) => {
        const text = (key: string) => String(data.get(key) ?? "");
        await onSave({
            event_date: text("event_date") || null, price_per_guest: text("price_per_guest"),
            minimum_guests: Number(text("minimum_guests")),
            additional_costs: text("additional_costs") || "0.00", notes: text("notes"),
        });
    }} />;
}
