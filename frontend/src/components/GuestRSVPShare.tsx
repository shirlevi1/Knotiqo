import { useEffect, useRef, useState } from "react";
import { ageFields, guestFields, type Guest } from "../api/guests";
import { getLinkState, invitationMessage, noPublicSite, rsvpStatuses, whatsappUrl, type LinkState } from "../api/rsvp";
import "../RSVP.css";

const defaultTemplate = "נשמח שתאשרו הגעה לחתונה שלנו בקישור האישי:\n{link}";

export default function GuestRSVPShare({ weddingId, guest, close }: { weddingId: number; guest: Guest; close: () => void }) {
    const [state, setState] = useState<LinkState | null>(null);
    const [template, setTemplate] = useState(defaultTemplate);
    const [targetPhone, setTargetPhone] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState<"POST" | "DELETE" | null>(null);
    const pending = useRef<AbortController | null>(null);
    const heading = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        const controller = new AbortController();
        heading.current?.focus();
        void getLinkState(weddingId, guest.id, controller.signal).then((value) => {
            if (!controller.signal.aborted) setState(value);
        }).catch(() => {
            if (!controller.signal.aborted) setError("לא הצלחנו לטעון את פרטי הקישור.");
        });
        return () => { controller.abort(); pending.current?.abort(); };
    }, [weddingId, guest.id]);

    async function change(method: "POST" | "DELETE") {
        if (pending.current) return;
        const controller = new AbortController();
        pending.current = controller;
        setError("");
        setNotice("");
        setBusy(true);
        try {
            const updated = await getLinkState(weddingId, guest.id, controller.signal, method);
            if (!controller.signal.aborted) {
                setState(updated);
                setConfirm(null);
                setNotice(method === "DELETE" ? "הקישור בוטל." : "קישור אישי חדש מוכן לשיתוף.");
            }
        } catch (cause) {
            if (!controller.signal.aborted) setError(cause instanceof Error && !(cause instanceof TypeError)
                ? cause.message : "לא ניתן להתחבר כרגע.");
        } finally {
            if (!controller.signal.aborted) {
                pending.current = null;
                setBusy(false);
            }
        }
    }

    const link = state?.sharing_enabled && state.link_active && state.url && /^https:\/\/[a-z0-9.-]+\/#\/rsvp\/[A-Za-z0-9_-]{43}$/.test(state.url)
        ? state.url : "";
    const message = link ? invitationMessage(template, link) : "";
    const hasInternationalPhone = whatsappUrl("", guest.phone) !== whatsappUrl("", "");
    return <section className="guest-panel ui-card rsvp-share" aria-labelledby="rsvp-share-title">
        <h2 id="rsvp-share-title" ref={heading} tabIndex={-1}>קישור אישור הגעה · <bdi>{guest.full_name}</bdi></h2>
        {error && <p role="alert" className="ui-error">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {!state && !error && <p role="status">טוענים את פרטי הקישור…</p>}
        {state && <>
            {state.response ? <p>תשובה אחרונה: {rsvpStatuses[state.response.status]}{state.response.status === "attending"
                && ` · ${state.response.attendee_count} משתתפים`}</p> : <p>טרם התקבלה תשובה.</p>}
            {state.response?.status === "attending" && state.response.adult_count !== null && <p>
                {ageFields.map((field) => `${guestFields[field]} ${state.response?.[field]}`).join(" · ")}
            </p>}
            {!state.sharing_enabled && <p>{noPublicSite}</p>}
            {state.link_active && state.expires_at && <p>הקישור בתוקף עד {new Date(state.expires_at).toLocaleDateString("he-IL")}.</p>}
            <div className="guest-toolbar">
                {state.sharing_enabled && <button type="button" className="ui-button" disabled={busy || !!confirm}
                    onClick={() => state.link_active ? setConfirm("POST") : void change("POST")}>
                    {state.link_active ? "יצירת קישור חדש" : "יצירת קישור אישי"}
                </button>}
                {state.link_active && <button type="button" className="ui-button ui-button--text" disabled={busy || !!confirm}
                    onClick={() => setConfirm("DELETE")}>ביטול הקישור</button>}
            </div>
            {state.link_active && !link && state.sharing_enabled && <p>מטעמי אבטחה הקישור מוצג רק בעת יצירתו. יצירת קישור חדש תבטל את הקודם.</p>}
            {confirm && <div className="guest-toolbar">
                <p>{confirm === "POST" ? "ליצור קישור חדש ולבטל את הקודם?" : "לבטל את הקישור האישי?"}</p>
                <button type="button" className="ui-button" disabled={busy} onClick={() => void change(confirm)}>אישור</button>
                <button type="button" className="ui-button ui-button--text" disabled={busy} onClick={() => setConfirm(null)}>חזרה</button>
            </div>}
            {link && !confirm && <>
                <label className="ui-field">קישור אישי<input className="ui-input" dir="ltr" value={link} readOnly
                    onFocus={(event) => event.currentTarget.select()} /></label>
                <label className="ui-field">נוסח הודעה<textarea className="ui-input" value={template} maxLength={800}
                    onChange={(event) => setTemplate(event.target.value)} /></label>
                <p>תצוגה מקדימה</p><p className="rsvp-preview">{message}</p>
                {hasInternationalPhone && <label><input type="checkbox" checked={targetPhone}
                    onChange={(event) => setTargetPhone(event.target.checked)} /> לפתוח שיחה עם המספר השמור</label>}
                <div className="guest-toolbar">
                    <button type="button" className="ui-button ui-button--secondary" onClick={async () => {
                        try { await navigator.clipboard.writeText(link); setNotice("הקישור הועתק."); }
                        catch { setNotice("אפשר לסמן ולהעתיק את הקישור מהשדה למעלה."); }
                    }}>העתקת קישור</button>
                    <a className="ui-button" href={whatsappUrl(message, targetPhone ? guest.phone : "")}
                        target="_blank" rel="noopener noreferrer">שליחה ב־WhatsApp</a>
                </div>
                <p>WhatsApp ייפתח עם ההודעה המוכנה. כדי לשתף אותה, יש לשלוח אותה בתוך WhatsApp.</p>
            </>}
        </>}
        <button type="button" className="ui-button ui-button--text" disabled={busy} onClick={close}>סגירה</button>
    </section>;
}
