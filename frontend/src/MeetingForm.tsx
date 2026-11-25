import { useRef, useEffect, useState, type FormEvent } from "react";
import { meetingStatuses, meetingTypes, resourceValue, type Meeting, type MeetingInput, type Resource } from "./api/meetings";

export function ResourceOptions({ resources }: { resources: Resource[] }) {
    return <>{(["venue", "vendor"] as const).map((kind) => {
        const options = resources.filter((resource) => resource.kind === kind);
        return options.length > 0 && <optgroup label={kind === "venue" ? "אולמות" : "ספקים"} key={kind}>
            {options.map((resource) => <option key={resource.id} value={resourceValue(resource)}>{resource.name}</option>)}
        </optgroup>;
    })}</>;
}

export default function MeetingForm({ initial, day, association, resources, busy, error, onSave, onClose, onCancelMeeting, onRemove }: {
    initial?: Meeting; day: string; association?: string; resources: Resource[]; busy: boolean; error: string;
    onSave: (input: MeetingInput) => void; onClose: () => void; onCancelMeeting: () => void; onRemove: () => void;
}) {
    const [validation, setValidation] = useState("");
    const [confirm, setConfirm] = useState<"cancel" | "delete" | null>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        heading.current?.focus();
        heading.current?.scrollIntoView?.({ block: "nearest" });
    }, []);
    const linked = initial?.venue_id ? `venue:${initial.venue_id}` : initial?.vendor_id ? `vendor:${initial.vendor_id}` : association;

    const suggestedLocation = resources.find((resource) => resourceValue(resource) === association)?.location;

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const read = (name: string) => String(data.get(name) ?? "").trim();
        const [kind, id] = read("resource").split(":");
        const start = read("start_time");
        const end = read("end_time") || null;
        if (!read("title") || (end && end <= start)) {
            setValidation(!read("title") ? "יש להזין שם לפגישה." : "שעת הסיום צריכה להיות מאוחרת משעת ההתחלה באותו יום.");
            return;
        }
        setValidation("");
        onSave({ title: read("title"), meeting_type: read("meeting_type") as MeetingInput["meeting_type"],
            date: read("date"), start_time: start, end_time: end,
            status: read("status") as MeetingInput["status"], venue_id: kind === "venue" ? Number(id) : null,
            vendor_id: kind === "vendor" ? Number(id) : null, contact_person: read("contact_person"),
            phone: read("phone"), location: read("location"), video_url: read("video_url"), notes: read("notes") });
    }

    return <form className="ui-card meeting-panel meeting-form" onSubmit={submit} aria-label={initial ? "עריכת פגישה" : "קביעת פגישה"}>
        <h2 ref={heading} tabIndex={-1}>{initial ? "עריכת פגישה" : "קביעת פגישה"}</h2>
        <fieldset className="meeting-fields" disabled={busy || !!confirm}>
            <label className="ui-field">שם הפגישה<input className="ui-input" required name="title" maxLength={150} defaultValue={initial?.title} /></label>
            <label className="ui-field">סוג פגישה<select className="ui-input" name="meeting_type" defaultValue={initial?.meeting_type ?? (association?.startsWith("venue:") ? "venue_tour" : "in_person")}>
                {Object.entries(meetingTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <label className="ui-field">משויך אל<select className="ui-input" name="resource" defaultValue={linked ?? ""}>
                <option value="">פגישה כללית</option><ResourceOptions resources={resources} />
            </select></label>
            <label className="ui-field">תאריך<input lang="he-IL" className="ui-input" name="date" type="date" required defaultValue={initial?.date ?? day} /></label>
            <label className="ui-field">שעת התחלה<input lang="he-IL" className="ui-input" type="time" required name="start_time" defaultValue={initial?.start_time} /></label>
            <label className="ui-field">שעת סיום (אופציונלי)<input lang="he-IL" className="ui-input" type="time" name="end_time" defaultValue={initial?.end_time ?? ""} /></label>
            <label className="ui-field">איש או אשת קשר<input className="ui-input" name="contact_person" maxLength={150} defaultValue={initial?.contact_person} /></label>
            <label className="ui-field">טלפון<input className="ui-input" name="phone" type="tel" dir="ltr" maxLength={32} defaultValue={initial?.phone} /></label>
            <label className="ui-field">מיקום או כתובת<input className="ui-input" name="location" maxLength={300} defaultValue={initial ? initial.location : suggestedLocation} /></label>
            <label className="ui-field">קישור לשיחת וידאו<input className="ui-input" name="video_url" type="url" dir="ltr" maxLength={500} defaultValue={initial?.video_url} /></label>
            <label className="ui-field">מצב<select className="ui-input" name="status" defaultValue={initial?.status ?? "scheduled"}>
                {Object.entries(meetingStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <label className="ui-field meeting-notes">הערות<textarea className="ui-input" name="notes" maxLength={4000} defaultValue={initial?.notes} /></label>
        </fieldset>
        <p>התאריך והשעות לפי שעון ישראל.</p>
        {(validation || error) && <p className="ui-error" role="alert">{validation || error}</p>}
        {confirm ? <div className="meeting-actions">
            <p>{confirm === "delete" ? "למחוק את הפגישה?" : "לבטל את הפגישה ולהשאיר אותה בלוח?"}</p>
            <button type="button" className="ui-button" disabled={busy} onClick={confirm === "delete" ? onRemove : onCancelMeeting}>אישור</button>
            <button type="button" className="ui-button ui-button--text" disabled={busy} onClick={() => setConfirm(null)}>חזרה</button>
        </div> : <div className="meeting-actions">
            <button className="ui-button" disabled={busy}>{busy ? "שומרים…" : "שמירת פגישה"}</button>
            <button type="button" className="ui-button ui-button--secondary" disabled={busy} onClick={onClose}>סגירה</button>
            {initial && initial.status === "scheduled" && <button type="button" className="ui-button ui-button--text" disabled={busy}
                onClick={() => { setValidation(""); setConfirm("cancel"); }}>ביטול פגישה</button>}
            {initial && <button type="button" className="ui-button ui-button--text" disabled={busy}
                onClick={() => { setValidation(""); setConfirm("delete"); }}>מחיקת פגישה</button>}
        </div>}
    </form>;
}
