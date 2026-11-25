import { useEffect, useRef, useState, type FormEvent } from "react";
import { ageFields, guestFields } from "./api/guests";
import { readInvitation, rsvpStatuses, sendResponse, unavailable, type RSVPInvitation, type RSVPStatus } from "./api/rsvp";
import "./RSVP.css";

const dateFormat = new Intl.DateTimeFormat("he-IL", { dateStyle: "long", timeZone: "UTC" });
const failure = (error: unknown) => error instanceof Error && !(error instanceof TypeError)
    ? error.message : "לא ניתן להתחבר כרגע. נסו שוב.";

export default function RSVPPage({ token }: { token: string }) {
    const [invitation, setInvitation] = useState<RSVPInvitation | null>(null);
    const [status, setStatus] = useState<RSVPStatus | "">("");
    const [error, setError] = useState("");
    const [pending, setPending] = useState(false);
    const [saved, setSaved] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const current = useRef<AbortController | null>(null);

    useEffect(() => {
        if (window.location.protocol !== "https:" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
        const controller = new AbortController();
        void readInvitation(token, controller.signal).then((value) => {
            if (!controller.signal.aborted) setInvitation(value);
        }).catch((cause) => {
            if (!controller.signal.aborted) setError(failure(cause));
        });
        return () => controller.abort();
    }, [token, attempt]);
    useEffect(() => () => current.current?.abort(), []);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!invitation || !status || current.current) return;
        const values = new FormData(event.currentTarget);
        const fields = invitation.age_limits ? ageFields : (["attendee_count"] as const);
        const summary = status === "attending" ? Object.fromEntries(fields.map((field) => [field, Number(values.get(field))])) : {};
        if (status === "attending" && !Object.values(summary).some((value) => value > 0)) {
            setError("יש להזין לפחות משתתף אחד.");
            return;
        }
        const controller = new AbortController();
        current.current = controller;
        setPending(true);
        setError("");
        try {
            const response = await sendResponse(token, status, summary, controller.signal);
            if (!response.saved) throw new Error("לא ניתן לשמור את התשובה כרגע. נסו שוב.");
            if (!controller.signal.aborted) setSaved(true);
        } catch (cause) {
            if (!controller.signal.aborted) setError(failure(cause));
        } finally {
            if (!controller.signal.aborted) {
                current.current = null;
                setPending(false);
            }
        }
    }

    const invalid = window.location.protocol !== "https:" || !/^[A-Za-z0-9_-]{43}$/.test(token);
    const names = invitation && [invitation.creator_display_name, invitation.partner_display_name].filter(Boolean);
    return <main className="rsvp-page" dir="rtl">
        <section className="rsvp-card ui-card">
            <p className="rsvp-brand" lang="en">Knotiqo</p>
            <header className="rsvp-heading">
                <h1>אישור הגעה לחתונה</h1>
                {!!names?.length && <p className="rsvp-couple">{names.map((name, index) =>
                    <span key={index}>{index ? " · " : ""}<bdi>{name}</bdi></span>)}</p>}
                {invitation?.wedding_date && <time dateTime={invitation.wedding_date}>
                    {dateFormat.format(new Date(invitation.wedding_date + "T00:00:00Z"))}</time>}
            </header>
            {(error || invalid) && <p className="ui-error" role="alert">{invalid ? unavailable : error}</p>}
            {!invalid && !invitation && (error
                ? error !== unavailable && <button className="ui-button ui-button--secondary" onClick={() => {
                    setError(""); setAttempt((value) => value + 1);
                }}>ניסיון נוסף</button>
                : <p role="status">טוענים את ההזמנה…</p>)}
            {invitation && (saved ? <div className="rsvp-confirm" role="status">
                <h2>תודה, התשובה נשמרה</h2><p>{status && rsvpStatuses[status]}. אפשר לחזור לקישור כדי לעדכן את התשובה.</p>
                <button className="ui-button ui-button--secondary" onClick={() => { setSaved(false); setStatus(""); }}>עדכון תשובה</button>
            </div> : <form onSubmit={submit} className="rsvp-form">
                <p>בהזמנה שמורים {invitation.invited_count} מקומות.</p>
                <fieldset disabled={pending} className="rsvp-options">
                    <legend>האם תגיעו?</legend>
                    {invitation.options.map((option) => <label key={option}>
                        <input type="radio" name="status" value={option} checked={status === option}
                            onChange={() => { setStatus(option); setError(""); }} required />
                        {rsvpStatuses[option]}
                    </label>)}
                </fieldset>
                {status === "attending" && (invitation.age_limits ? <fieldset className="rsvp-counts" disabled={pending}>
                    <legend>כמה יגיעו?</legend>
                    {ageFields.filter((field) => invitation.age_limits![field] > 0).map((field) =>
                        <label className="ui-field" key={field}>{guestFields[field]}
                            <input className="ui-input" type="number" inputMode="numeric" name={field} step={1} min={0}
                                max={invitation.age_limits![field]} defaultValue={invitation.age_limits![field]} required />
                        </label>)}
                </fieldset> : <label className="ui-field">כמה יגיעו?
                    <input className="ui-input" type="number" inputMode="numeric" name="attendee_count" min={1} step={1}
                        max={invitation.invited_count} defaultValue={invitation.invited_count} disabled={pending} required />
                </label>)}
                <button className="ui-button" disabled={pending || !status}>{pending ? "שומרים…" : "שמירת תשובה"}</button>
            </form>)}
        </section>
    </main>;
}
