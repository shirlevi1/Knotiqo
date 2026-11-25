import { useEffect, useRef, useState } from "react";
import {
    guestError, guestFields, guestsApi, GuestApiError, type Decision, type ImportField,
    type ImportResult, type ImportSession, type Mapping, type MatchReason, type Preview, type PreviewRow,
} from "../api/guests";

const steps = ["העלאת קובץ", "בחירת גיליון", "מיפוי עמודות", "תצוגה מקדימה", "סקירת כפילויות", "אישור ייבוא"];
const actionLabels = { create: "הוספה כרשומה חדשה", skip: "דילוג", update: "עדכון רשומה", restore: "שחזור מהארכיון" };
const warningLabels: Record<string, string> = {
    review_section_boundary: "השורה מופיעה אחרי כותרת חוזרת או סיכום. בדקו ידנית שהיא שייכת לרשימת המוזמנים.",
    check_numeric_phone_leading_zeros: "הטלפון נשמר כמספר באקסל. בדקו אם חסרים אפסים בתחילת המספר.",
    duplicate_suggestions_truncated: "קיימות התאמות נוספות שלא מוצגות.",
};
const issueLabels: Record<string, string> = {
    non_guest_row: "השורה נראית כמו כותרת או סיכום ואינה זמינה לייבוא.",
    required: "שדה חובה", blank: "שדה חובה", invalid: "ערך לא תקין", invalid_choice: "בחירה לא תקינה",
    max_length: "ערך ארוך מדי", min_value: "נדרש מספר חיובי", max_value: "הערך גדול מדי",
    formula: "העמודה מכילה נוסחה. החליפו אותה בערך בקובץ.", unsupported: "סוג התא אינו נתמך.",
};
const fieldLabel = (field: string) => Object.hasOwn(guestFields, field) ? guestFields[field as ImportField] : field;
const matchLabel = (matched: MatchReason[]) => {
    const strong = matched.filter((reason) => reason !== "name").map((reason) => reason === "phone" ? "טלפון" : "אימייל");
    return strong.length ? `התאמה לפי ${strong.join(" ו")}` : "שם דומה בלבד";
};
const valid = (row: PreviewRow) => !Object.keys(row.errors).length;
const hasMatches = (row: PreviewRow) => !!(row.duplicates?.rows.length || row.duplicates?.guests.length);

function RowReview({ row, selection, onSelect }: {
    row: PreviewRow; selection?: Decision; onSelect: (decision?: Decision) => void;
}) {
    const selected = selection ? ("guest_id" in selection ? String(selection.guest_id) : selection.action) : "";
    const candidates = row.duplicates?.guests ?? [];
    return <li className="guest-review-row">
        <h4>שורה {row.row} · <bdi>{row.values.full_name || "ללא שם"}</bdi></h4>
        {row.duplicates?.rows.map((match) => <p key={match.row}>בקובץ, שורה {match.row} · {matchLabel(match.matched_on)}</p>)}
        {!!candidates.length && <ul>
            {candidates.map((guest) => <li key={guest.id}>
                <bdi>{guest.full_name}</bdi>{guest.phone && <> · <bdi>{guest.phone}</bdi></>}
                {guest.email && <> · <bdi>{guest.email}</bdi></>} · {matchLabel(guest.matched_on)}
                {guest.is_archived && " · בארכיון"}
            </li>)}
        </ul>}
        {!valid(row) && <p>השורה מכילה שגיאות וניתן רק לדלג עליה.</p>}
        {row.warnings.includes("review_section_boundary") && <p>{warningLabels.review_section_boundary}</p>}
        <label>החלטה לשורה {row.row}
            <select className="ui-input" value={selected} onChange={(event) => {
                const value = event.target.value;
                const guest = candidates.find(({ id }) => String(id) === value);
                if (guest) onSelect({ row: row.row, action: guest.is_archived ? "restore" : "update", guest_id: guest.id });
                else if (value === "create" || value === "skip") onSelect({ row: row.row, action: value });
                else onSelect();
            }}>
                <option value="">ללא החלטה</option>
                <option value="skip">{actionLabels.skip}</option>
                {valid(row) && <option value="create">{actionLabels.create}</option>}
                {candidates.map((guest) => <option key={guest.id} value={guest.id}>
                    {guest.is_archived ? actionLabels.restore : actionLabels.update} · {guest.full_name} (#{guest.id})
                </option>)}
            </select>
        </label>
    </li>;
}

export default function GuestImportWizard({ weddingId, onClose, onImported }: {
    weddingId: number; onClose: () => void; onImported: () => void;
}) {
    const api = guestsApi(weddingId);
    const current = useRef<AbortController | null>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    const [step, setStep] = useState(0);
    const [file, setFile] = useState<File>();
    const [session, setSession] = useState<ImportSession>();
    const [worksheet, setWorksheet] = useState("");
    const [mapping, setMapping] = useState<Mapping>({});
    const [preview, setPreview] = useState<Preview>();
    const [decisions, setDecisions] = useState<Record<number, Decision>>({});
    const [result, setResult] = useState<ImportResult>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [expired, setExpired] = useState(false);
    const sheet = session?.worksheets.find(({ name }) => name === worksheet);
    const selected = Object.values(decisions);
    const targets = selected.flatMap((decision) => "guest_id" in decision ? [decision.guest_id] : []);
    const repeatedTarget = new Set(targets).size !== targets.length;
    const clearPreview = () => { setPreview(undefined); setDecisions({}); };

    useEffect(() => () => current.current?.abort(), []);
    useEffect(() => { heading.current?.focus(); }, [step]);

    async function run<T>(operation: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void) {
        if (current.current) return;
        const controller = new AbortController();
        current.current = controller;
        setBusy(true);
        setError("");
        try {
            const data = await operation(controller.signal);
            if (!controller.signal.aborted) apply(data);
        } catch (failure) {
            if (!controller.signal.aborted) {
                setError(guestError(failure));
                if (failure instanceof GuestApiError && failure.code === "session_expired") setExpired(true);
            }
        } finally {
            if (!controller.signal.aborted) { current.current = null; setBusy(false); }
        }
    }

    function upload() {
        if (!file || !/\.xlsx$/i.test(file.name) || !file.size || file.size > 2 * 1024 * 1024) {
            setError("בחרו קובץ XLSX תקין עד 2 MiB.");
            return;
        }
        void run((signal) => api.upload(file, signal), (data) => {
            setFile(undefined);
            setSession(data);
            setWorksheet(data.worksheets[0]?.name ?? "");
            clearPreview();
            setStep(1);
        });
    }

    function suggestMapping() {
        const next: Mapping = {};
        for (const { column, suggested_field } of sheet?.columns ?? []) {
            if (suggested_field && next[suggested_field] === undefined) next[suggested_field] = column;
        }
        setMapping(next);
        clearPreview();
        setStep(2);
    }

    function buildPreview() {
        if (!session || !mapping.full_name) {
            setError("בחרו עמודה עבור שם מלא.");
            return;
        }
        void run((signal) => api.preview(session.session_id, worksheet, mapping, signal), (data) => {
            setPreview(data);
            setDecisions({});
            setStep(3);
        });
    }

    function confirm() {
        if (!session || !preview || !selected.length || repeatedTarget) return;
        void run((signal) => api.confirm(session.session_id, preview.preview_id, selected, signal), (data) => {
            setResult(data);
            setSession(undefined);
            clearPreview();
            setStep(6);
            onImported();
        });
    }

    return <section className="guest-panel ui-card" aria-labelledby="guest-import-title">
        <div className="guest-toolbar">
            <h2 id="guest-import-title" tabIndex={-1} ref={heading}>{steps[step] ?? "הייבוא הושלם"}</h2>
            <button type="button" className="ui-button ui-button--text" onClick={onClose} disabled={busy}>
                {step === 6 ? "חזרה לרשימת המוזמנים" : "ביטול ייבוא"}
            </button>
        </div>
        {step < 6 && <ol className="guest-import-steps" aria-label="שלבי הייבוא">
            {steps.map((name, index) => <li key={name} aria-current={step === index ? "step" : undefined}>{name}</li>)}
        </ol>}
        {error && <p role="alert" className="ui-error">{error}</p>}
        {busy && <p role="status" className="ui-status">{step === 0 ? "מעלים את הקובץ…" : "מעבדים את הבקשה…"}</p>}
        {expired ? <button className="ui-button" type="button" onClick={() => {
            setSession(undefined); clearPreview(); setError(""); setExpired(false); setStep(0);
        }}>העלאת קובץ מחדש</button> : <>
            {step === 0 && <>
                <label className="ui-field">קובץ Excel
                    <input className="ui-input" type="file" accept=".xlsx" disabled={busy}
                        onChange={(event) => { setFile(event.target.files?.[0]); setError(""); }} />
                </label>
                <p>קובץ XLSX עד 2 MiB ועד 500 שורות נתונים בגיליון.</p>
                <button className="ui-button" type="button" disabled={busy || !file} onClick={upload}>העלאת קובץ</button>
            </>}
            {step === 1 && <>
                <label className="ui-field">גיליון לייבוא
                    <select className="ui-input" value={worksheet} onChange={(event) => {
                        setWorksheet(event.target.value); setMapping({}); clearPreview();
                    }}>
                        {session?.worksheets.map(({ name }) => <option key={name}>{name}</option>)}
                    </select>
                </label>
                <button className="ui-button" type="button" disabled={!sheet} onClick={suggestMapping}>המשך למיפוי</button>
            </>}
            {step === 2 && <>
                <p>בחרו שדה לכל עמודה שתרצו לייבא. שם מלא הוא חובה.</p>
                <div className="guest-fields">
                    {sheet?.columns.map(({ column, heading: label }) => {
                        const field = (Object.keys(mapping) as ImportField[]).find((key) => mapping[key] === column);
                        return <label className="ui-field" key={column}><bdi>{label || `עמודה ${column}`}</bdi>
                            <select className="ui-input" value={field ?? ""} disabled={busy} onChange={(event) => {
                                const next = { ...mapping };
                                const chosen = event.target.value as ImportField | "";
                                if (field) delete next[field];
                                if (chosen) next[chosen] = column;
                                setMapping(next); clearPreview(); setError("");
                            }}>
                                <option value="">ללא מיפוי</option>
                                {(Object.keys(guestFields) as ImportField[]).map((key) =>
                                    <option key={key} value={key} disabled={!!mapping[key] && mapping[key] !== column}>{guestFields[key]}</option>)}
                            </select>
                        </label>;
                    })}
                </div>
                <button className="ui-button" type="button" disabled={busy} onClick={buildPreview}>הצגת תצוגה מקדימה</button>
            </>}
            {step === 3 && preview && <>
                <p>{preview.rows.filter(valid).length} שורות תקינות מתוך {preview.rows.length}. טרם נשמרו מוזמנים.</p>
                <p>שורות ללא פירוט גילאים ייספרו כמבוגרים ביצירת מוזמן חדש. בעדכון או שחזור, הפירוט הקיים יישמר.</p>
                {!!preview.unmapped_columns.length && <p>עמודות ללא מיפוי: {preview.unmapped_columns.map(({ column, heading }) =>
                    heading || `עמודה ${column}`).join(", ")}</p>}
                <ul className="guest-row-list">
                    {preview.rows.map((row) => <li className="guest-review-row" key={row.row}>
                        <h4>שורה {row.row} · {valid(row) ? "תקינה" : "נדרשת בדיקה"}</h4>
                        <dl className="guest-preview-fields">{Object.entries(row.values).map(([key, value]) =>
                            <div key={key}><dt>{fieldLabel(key)}</dt><dd><bdi>{value}</bdi></dd></div>)}</dl>
                        {Object.entries(row.errors).map(([field, codes]) => <p className="ui-error" key={field}>
                            {fieldLabel(field)} · {codes.map((code) => issueLabels[code] ?? "ערך לא תקין").join(" · ")}
                        </p>)}
                        {row.warnings.map((warning) => <p key={warning}>{warningLabels[warning] ?? "יש לבדוק את הערך בקובץ."}</p>)}
                    </li>)}
                </ul>
                {!preview.rows.length && <p>לא נמצאו שורות נתונים בגיליון הזה.</p>}
                <button className="ui-button" type="button" disabled={!preview.rows.length}
                    onClick={() => setStep(4)}>סקירת כפילויות</button>
            </>}
            {step === 4 && preview && <>
                <p>רק שורות עם החלטה ייכללו בייבוא. התאמה בשם בלבד היא הצעה לבדיקה.</p>
                <button className="ui-button ui-button--secondary" type="button" onClick={() => {
                    setDecisions((before) => {
                        const next = { ...before };
                        for (const row of preview.rows) {
                            if (valid(row) && !hasMatches(row) && !row.warnings.includes("review_section_boundary")) {
                                next[row.row] ??= { row: row.row, action: "create" };
                            }
                        }
                        return next;
                    });
                }}>בחירת הוספה לשורות תקינות ללא התאמות</button>
                <ul className="guest-row-list">{preview.rows.map((row) => <RowReview key={row.row} row={row}
                    selection={decisions[row.row]} onSelect={(decision) => setDecisions((before) => {
                        const next = { ...before };
                        if (decision) next[row.row] = decision;
                        else delete next[row.row];
                        return next;
                    })} />)}</ul>
                {repeatedTarget && <p role="alert" className="ui-error">אפשר לעדכן כל מוזמן קיים פעם אחת בלבד בייבוא.</p>}
                <button className="ui-button" type="button" disabled={!selected.length || repeatedTarget}
                    onClick={() => setStep(5)}>המשך לאישור</button>
            </>}
            {step === 5 && <>
                <p>{selected.length} שורות נבחרו. שורות ללא החלטה יישארו מחוץ לייבוא.</p>
                <ul>{Object.entries(actionLabels).map(([action, title]) =>
                    <li key={action}>{title} · {selected.filter((decision) => decision.action === action).length}</li>)}</ul>
                <button className="ui-button" type="button" disabled={busy} onClick={confirm}>אישור ושמירת הייבוא</button>
            </>}
            {step === 6 && result && <p role="status">נוספו {result.created} · דולגו {result.skipped} · עודכנו {result.updated} · שוחזרו {result.restored}</p>}
            {step > 1 && step < 6 && <button className="ui-button ui-button--text" type="button" disabled={busy}
                onClick={() => { if (step === 3) clearPreview(); setError(""); setStep(step - 1); }}>חזרה לשלב הקודם</button>}
        </>}
    </section>;
}
