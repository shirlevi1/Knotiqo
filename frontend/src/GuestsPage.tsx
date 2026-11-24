import { useEffect, useRef, useState, type FormEvent } from "react";
import {
    ageFields, archives, categories, guestError, guestFields, guestsApi, GuestApiError, sides,
    type Guest, type GuestFilters, type GuestInput, type GuestList,
} from "./api/guests";
import GuestImportWizard from "./components/GuestImportWizard";
import "./GuestsPage.css";

const initialFilters: GuestFilters = { search: "", side: "", category: "", archive: "active", page: 1 };
const number = new Intl.NumberFormat("he-IL");
const formErrors: Record<string, string> = {
    full_name: "הזינו שם מלא באורך של עד 150 תווים.",
    phone: "הזינו מספר טלפון תקין, או השאירו את השדה ריק.",
    email: "הזינו כתובת אימייל תקינה, או השאירו את השדה ריק.",
    party_size: "הזינו מספר שלם וחיובי של מוזמנים.",
    family_group: "הקבוצה המשפחתית יכולה להכיל עד 150 תווים.",
    notes: "ההערות יכולות להכיל עד 4,000 תווים.",
    tags: "אפשר להזין עד 20 תגיות, עד 40 תווים לכל תגית.",
    side: "בחרו צד מהרשימה.",
    category: "בחרו קטגוריה מהרשימה.",
    adult_count: "הזינו מספר שלם שאינו שלילי.",
    child_count: "הזינו מספר שלם שאינו שלילי.",
    infant_count: "הזינו מספר שלם שאינו שלילי.",
};

function GuestForm({ guest, onSave, onClose, busy }: {
    guest?: Guest; onSave: (data: GuestInput) => Promise<void>; onClose: () => void; busy: boolean;
}) {
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [error, setError] = useState("");
    const [counts, setCounts] = useState({
        adult_count: guest?.adult_count?.toString() ?? "",
        child_count: guest?.child_count?.toString() ?? "",
        infant_count: guest?.infant_count?.toString() ?? "",
    });
    const [legacyTotal, setLegacyTotal] = useState(String(guest?.party_size ?? 1));
    const hasBreakdown = guest?.adult_count != null || ageFields.some((field) => counts[field] !== "");
    const total = hasBreakdown ? ageFields.reduce((sum, field) => sum + Number(counts[field]), 0) : Number(legacyTotal);
    const title = useRef<HTMLHeadingElement>(null);
    useEffect(() => { title.current?.focus(); }, []);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const text = (field: string) => String(data.get(field) ?? "").trim();
        const payload: GuestInput = {
            full_name: text("full_name"), phone: text("phone"), email: text("email"),
            side: text("side") as GuestInput["side"], category: text("category") as GuestInput["category"],
            party_size: total, family_group: text("family_group"), notes: text("notes"),
            tags: guest && text("tags") === guest.tags.join(", ") ? guest.tags
                : text("tags").split(",").map((tag) => tag.trim()).filter(Boolean),
        };
        const invalid: Record<string, string> = {};
        const mark = (field: string) => { invalid[field] = formErrors[field]; };
        if (!payload.full_name || payload.full_name.length > 150) mark("full_name");
        if (payload.phone && (payload.phone.length > 32 || !/^\+?[0-9 ().-]+$/.test(payload.phone)
            || !/^\d{5,15}$/.test(payload.phone.replace(/\D/g, "")))) mark("phone");
        if (payload.email && (payload.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email))) mark("email");
        if (hasBreakdown) {
            for (const field of ageFields) {
                if (!/^\d*$/.test(counts[field])) mark(field);
                payload[field] = Number(counts[field]);
            }
        } else if (!/^\d+$/.test(legacyTotal)) mark("party_size");
        if (!Number.isInteger(total) || total < 1 || total > 2147483647) mark("party_size");
        if (payload.family_group.length > 150) mark("family_group");
        if (payload.notes.length > 4000) mark("notes");
        if (payload.tags.length > 20 || payload.tags.some((tag) => tag.length > 40)) mark("tags");
        if (!Object.hasOwn(sides, payload.side)) mark("side");
        if (!Object.hasOwn(categories, payload.category)) mark("category");
        setErrors(invalid);
        setError("");
        if (Object.keys(invalid).length) { setError("יש לתקן את השדות המסומנים."); return; }
        try {
            await onSave(payload);
        } catch (failure) {
            if (failure instanceof GuestApiError) {
                setErrors(Object.fromEntries(failure.fields.filter((field) => Object.hasOwn(formErrors, field))
                    .map((field) => [field, formErrors[field]])));
            }
            setError(guestError(failure));
        }
    }

    const textFields = [
        ["full_name", "text", 150], ["phone", "tel", 32], ["email", "email", 254],
        ["family_group", "text", 150],
    ] as const;
    return <form className="guest-panel ui-card" onSubmit={(event) => void submit(event)} noValidate aria-busy={busy}>
        <h2 ref={title} tabIndex={-1}>{guest ? "עריכת מוזמן" : "הוספת מוזמן"}</h2>
        <fieldset className="ui-fieldset" disabled={busy}>
            <div className="guest-fields">
                {textFields.map(([key, type, maxLength]) => <label className="ui-field" key={key}>
                    {guestFields[key]}
                    <input className="ui-input" name={key} type={type} maxLength={maxLength}
                        defaultValue={guest?.[key] ?? ""} required={key === "full_name"}
                        dir={key === "phone" || key === "email" ? "ltr" : undefined}
                        aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `guest-error-${key}` : undefined} />
                    {errors[key] && <span id={`guest-error-${key}`} className="ui-error">{errors[key]}</span>}
                </label>)}
                <label className="ui-field">צד בחתונה
                    <select className="ui-input" name="side" defaultValue={guest?.side ?? "unassigned"} aria-invalid={!!errors.side}>
                        {Object.entries(sides).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>{errors.side && <span className="ui-error">{errors.side}</span>}
                </label>
                <label className="ui-field">קטגוריה ותיקה (לסינון רשומות ללא פירוט)
                    <select className="ui-input" name="category" defaultValue={guest?.category ?? "adult"} aria-invalid={!!errors.category}>
                        {Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>{errors.category && <span className="ui-error">{errors.category}</span>}
                </label>
                <label className="ui-field">תגיות (מופרדות בפסיק)
                    <input className="ui-input" name="tags" defaultValue={guest?.tags.join(", ")} aria-invalid={!!errors.tags} />
                    {errors.tags && <span className="ui-error">{errors.tags}</span>}
                </label>
            </div>
            <fieldset className="guest-age-fields">
                <legend>פירוט גילאים</legend>
                <div className="guest-fields">
                    {ageFields.map((field) => <label className="ui-field" key={field}>{guestFields[field]}
                        <input name={field} className="ui-input" type="number" min={0} step={1} value={counts[field]}
                            aria-invalid={!!errors[field]} onChange={(event) => setCounts((before) => ({
                                ...before, [field]: event.target.value,
                            }))} />
                        {errors[field] && <span className="ui-error">{errors[field]}</span>}
                    </label>)}
                    {!hasBreakdown && <label className="ui-field">כמות מוזמנים ללא פירוט
                        <input name="party_size" className="ui-input" type="number" min={1} step={1} value={legacyTotal}
                            aria-invalid={!!errors.party_size} onChange={(event) => setLegacyTotal(event.target.value)} />
                    </label>}
                </div>
                <p className="guest-muted">הפירוט כולל את כל בני הקבוצה, כולל המוזמן או המוזמנת ששמם רשום. תאים ריקים בפירוט נספרים כאפס לאחר הזנת כמות באחד השדות.</p>
                {hasBreakdown && <p>סה״כ מקומות: {Number.isFinite(total) ? number.format(total) : "—"}</p>}
                {guest && !hasBreakdown && <p>ברשומה זו נשמרה כמות כוללת בלבד. אפשר להשלים כאן את הפירוט.</p>}
                {errors.party_size && <p className="ui-error">{errors.party_size}</p>}
            </fieldset>
            <label className="ui-field">הערות
                <textarea className="ui-input" name="notes" defaultValue={guest?.notes} maxLength={4000} aria-invalid={!!errors.notes} />
                {errors.notes && <span className="ui-error">{errors.notes}</span>}
            </label>
            {error && <p role="alert" className="ui-error">{error}</p>}
            <div className="guest-toolbar">
                <button type="submit" className="ui-button">{busy ? "שומרים…" : "שמירת מוזמן"}</button>
                <button type="button" className="ui-button ui-button--text" onClick={onClose}>ביטול</button>
            </div>
        </fieldset>
    </form>;
}

export default function GuestsPage(props: { weddingId: number; weddingName: string }) {
    return <WeddingGuests key={props.weddingId} {...props} />;
}

function WeddingGuests({ weddingId, weddingName }: { weddingId: number; weddingName: string }) {
    const [filters, setFilters] = useState(initialFilters);
    const [data, setData] = useState<GuestList>();
    const [editor, setEditor] = useState<Guest | "new">();
    const [importing, setImporting] = useState(false);
    const [revision, setRevision] = useState(0);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [actionError, setActionError] = useState("");
    const [status, setStatus] = useState("");
    const action = useRef<AbortController | null>(null);
    const api = guestsApi(weddingId);

    useEffect(() => () => action.current?.abort(), []);
    useEffect(() => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            void guestsApi(weddingId).list(filters, controller.signal).then(
                (result) => { if (!controller.signal.aborted) { setData(result); setLoadError(""); } },
                (error) => { if (!controller.signal.aborted) { setData(undefined); setLoadError(guestError(error)); } },
            ).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        }, filters.search ? 180 : 0);
        return () => { controller.abort(); window.clearTimeout(timer); };
    }, [weddingId, filters, revision]);

    function changeFilter<T extends keyof GuestFilters>(field: T, value: GuestFilters[T]) {
        setLoading(true);
        setFilters((before) => ({ ...before, page: 1, [field]: value }));
    }

    function movePage(delta: number) {
        setLoading(true);
        setFilters((before) => ({ ...before, page: before.page + delta }));
    }

    async function run(operation: (signal: AbortSignal) => Promise<unknown>, success: () => void, form = false) {
        if (action.current) return;
        const controller = new AbortController();
        action.current = controller;
        setBusy(true); setActionError(""); setStatus("");
        try {
            await operation(controller.signal);
            if (!controller.signal.aborted) success();
        } catch (error) {
            if (!controller.signal.aborted) {
                if (form) throw error;
                setActionError(guestError(error));
            }
        } finally {
            if (!controller.signal.aborted) { action.current = null; setBusy(false); }
        }
    }

    function refresh(returnToFirst = false) {
        setLoading(true);
        if (returnToFirst) setFilters((before) => ({ ...before, page: 1 }));
        setRevision((previous) => previous + 1);
    }

    const summary = data?.summary;
    return <section className="guests-page" dir="rtl" aria-labelledby="guests-title">
        <a href="#workspace" className="ui-button ui-button--text">חזרה למרחב החתונה</a>
        <header className="guest-header">
            <p className="eyebrow"><bdi>{weddingName}</bdi></p>
            <h1 id="guests-title">רשימת המוזמנים שלנו</h1>
        </header>
        {importing ? <GuestImportWizard weddingId={weddingId} onClose={() => setImporting(false)}
            onImported={() => refresh(true)} /> : <>
            <div className="guest-toolbar">
                <button className="ui-button" type="button" disabled={busy} onClick={() => setEditor("new")}>הוספת מוזמן</button>
                <button className="ui-button ui-button--secondary" type="button" disabled={busy} onClick={() => {
                    setEditor(undefined); setImporting(true);
                }}>ייבוא רשימה</button>
                <button className="ui-button ui-button--text" type="button" disabled={busy}
                    onClick={() => void run((signal) => api.download("template", "active", signal), () => {})}>הורדת תבנית Excel</button>
                <button className="ui-button ui-button--text" type="button" disabled={busy}
                    onClick={() => void run((signal) => api.download("export", filters.archive, signal), () => {})}>ייצוא ל-Excel</button>
            </div>
            {actionError && <p role="alert" className="ui-error">{actionError}</p>}
            {status && <p role="status" className="ui-status">{status}</p>}
            {editor && <GuestForm key={editor === "new" ? "new" : editor.id} guest={editor === "new" ? undefined : editor}
                busy={busy} onClose={() => setEditor(undefined)} onSave={(values) => run(
                    (signal) => api.save(values, signal, editor === "new" ? undefined : editor.id), () => {
                        setEditor(undefined); setStatus("פרטי המוזמן נשמרו."); refresh(editor === "new");
                    }, true,
                )} />}
            <div className="guest-fields guest-filters ui-panel" aria-label="סינון מוזמנים">
                <label className="ui-field">חיפוש לפי שם או טלפון
                    <input type="search" className="ui-input" maxLength={150} value={filters.search}
                        onChange={(event) => changeFilter("search", event.target.value)} />
                </label>
                <label className="ui-field">צד בחתונה
                    <select className="ui-input" value={filters.side} onChange={(event) => changeFilter("side", event.target.value as GuestFilters["side"])}>
                        <option value="">כל הצדדים</option>
                        {Object.entries(sides).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                </label>
                <label className="ui-field">קטגוריה
                    <select className="ui-input" value={filters.category} onChange={(event) => changeFilter("category", event.target.value as GuestFilters["category"])}>
                        <option value="">כל הקטגוריות</option>
                        {Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                </label>
                <label className="ui-field">מצב ארכיון
                    <select className="ui-input" value={filters.archive} onChange={(event) => changeFilter("archive", event.target.value as GuestFilters["archive"])}>
                        {Object.entries(archives).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                </label>
            </div>
            {loading ? <p role="status" className="ui-status">טוענים את רשימת המוזמנים…</p> : loadError ? <>
                <p className="ui-error" role="alert">{loadError}</p>
                <button type="button" className="ui-button ui-button--secondary" onClick={() => refresh(true)}>טעינה מחדש</button>
            </> : data && summary && <>
                <dl className="guest-summary ui-panel" aria-label="סיכום תוצאות הסינון">
                    {(["attendees", "records", "unnamed_companions", ...ageFields, "unclassified_count",
                        "bride", "groom", "joint", "unassigned"] as const).map((key) => {
                        const label = key === "attendees" ? "מקומות למוזמנים" : key === "records" ? "רשומות מוזמנים"
                            : key === "unnamed_companions" ? "מלווים ללא שם"
                            : key === "unclassified_count" ? "ללא פירוט גילאים"
                            : key in guestFields ? guestFields[key as keyof typeof guestFields] : sides[key as keyof typeof sides];
                        return <div key={key}><dt>{label}</dt><dd>{number.format(summary[key])}</dd></div>;
                    })}
                </dl>
                {!data.results.length ? <p role="status" className="guest-muted">לא נמצאו מוזמנים בתצוגה הנוכחית.</p> : (
                    <table className="guest-table" aria-label="מוזמנים" role="table">
                        <thead><tr>{["שם", "פרטי קשר", "צד בחתונה", "מקומות ופירוט גילאים", "משפחה", "פעולות"].map((label) =>
                            <th scope="col" key={label}>{label}</th>)}</tr></thead>
                        <tbody role="rowgroup">{data.results.map((guest) => <tr key={guest.id} role="row">
                            <td role="cell" data-label="שם"><strong><bdi>{guest.full_name}</bdi></strong>{guest.is_archived && <small> · בארכיון</small>}</td>
                            <td role="cell" data-label="פרטי קשר">{guest.phone && <bdi>{guest.phone}</bdi>}{guest.email && <bdi>{guest.email}</bdi>}
                                {!guest.phone && !guest.email && "—"}</td>
                            <td role="cell" data-label="צד בחתונה">{sides[guest.side]}</td>
                            <td role="cell" data-label="מקומות ופירוט גילאים">
                                <strong>{number.format(guest.party_size)} מקומות</strong>
                                <div className="guest-age-breakdown">{guest.adult_count == null ? "ללא פירוט גילאים" : ageFields.map((field) =>
                                    <span key={field}>{guestFields[field]} {number.format(guest[field] ?? 0)}</span>)}</div>
                            </td>
                            <td role="cell" data-label="משפחה"><bdi>{guest.family_group || "—"}</bdi></td>
                            <td role="cell" data-label="פעולות"><div className="guest-toolbar">
                                <button type="button" className="ui-button ui-button--text" disabled={busy} onClick={() => setEditor(guest)}>עריכה</button>
                                <button type="button" className="ui-button ui-button--text" disabled={busy}
                                    onClick={() => void run((signal) => api.archive(guest.id, !guest.is_archived, signal), () => {
                                        setEditor(undefined);
                                        setStatus(guest.is_archived ? "המוזמן שוחזר." : "המוזמן הועבר לארכיון.");
                                        if (data.results.length === 1 && filters.page > 1 && filters.archive !== "all") {
                                            setFilters((before) => ({ ...before, page: before.page - 1 }));
                                        }
                                        refresh();
                                    })}>{guest.is_archived ? "שחזור" : "העברה לארכיון"}</button>
                            </div></td>
                        </tr>)}</tbody>
                    </table>
                )}
                {(data.previous || data.next) && <nav className="guest-toolbar" aria-label="דפי רשימת המוזמנים">
                    <button type="button" className="ui-button ui-button--secondary" disabled={!data.previous}
                        onClick={() => movePage(-1)}>הקודם</button>
                    <span>עמוד {number.format(filters.page)}</span>
                    <button type="button" className="ui-button ui-button--secondary" disabled={!data.next}
                        onClick={() => movePage(1)}>הבא</button>
                </nav>}
            </>}
        </>}
    </section>;
}
