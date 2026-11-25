import { useId, useState } from "react";
import { meetingStatuses, meetingTypes, type Meeting } from "./api/meetings";
import { MeetingTime } from "./MeetingSummaries";
import { VenuePhoto } from "./components/VenueGallery";

const weekday = new Intl.DateTimeFormat("he-IL", { weekday: "long", timeZone: "UTC" });

export function MeetingStatus({ status }: { status: Meeting["status"] }) {
    return <span className="meeting-status" data-status={status}>{meetingStatuses[status]}</span>;
}

export default function MeetingCard({ meeting, weddingId, canEdit, onEdit }: {
    meeting: Meeting; weddingId: number; canEdit: boolean; onEdit: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const details = useId();
    const associated = meeting.venue_details ?? meeting.vendor_details;
    const name = meeting.venue_name || meeting.vendor_name;
    const location = meeting.location || meeting.venue_details?.location;
    const ownContact = Boolean(meeting.contact_person || meeting.phone);
    const phone = ownContact ? meeting.phone : associated?.phone;
    const contact = ownContact ? meeting.contact_person : associated?.contact_person;
    return <li className="meeting-rich-card ui-card">
        <div className="meeting-art">
            {meeting.venue_id ? <VenuePhoto url={meeting.venue_details?.image_url ?? undefined} alt={meeting.venue_details?.image_alt} />
                : <svg viewBox="0 0 40 40" width="36" height="36" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <path d="M8 11h24v21H8z M13 7v8m14-8v8M8 18h24m-17 7h10" />
                </svg>}
        </div>
        <div className="meeting-card-body">
            <div className="meeting-card-top"><p>{meetingTypes[meeting.meeting_type]}</p><MeetingStatus status={meeting.status} /></div>
            <h3><bdi>{meeting.title}</bdi></h3>
            {name && <p className="meeting-associated"><bdi>{name}</bdi>{meeting.vendor_details?.category && <> · {meeting.vendor_details.category}</>}</p>}
            <p className="meeting-card-time">{weekday.format(new Date(meeting.date + "T12:00:00Z"))} · <MeetingTime meeting={meeting} /></p>
            {(location || contact || phone) && <dl className="meeting-facts">
                {location && <div><dt>{meeting.location ? "מיקום הפגישה" : "מיקום האולם"}</dt><dd><bdi>{location}</bdi></dd></div>}
                {(contact || phone) && <div><dt>{ownContact ? "איש קשר לפגישה" : meeting.venue_id ? "איש קשר באולם" : "איש קשר אצל הספק"}</dt>
                    <dd>{contact && <bdi>{contact}</bdi>}{contact && phone && " · "}{phone && <a dir="ltr" href={`tel:${phone.replace(/[^+0-9]/g, "")}`}>{phone}</a>}</dd></div>}
            </dl>}
            {meeting.notes && <p className="meeting-copy">{meeting.notes}</p>}
            <div className="meeting-actions">
                <button type="button" className="ui-button ui-button--secondary" aria-expanded={expanded} aria-controls={details}
                    onClick={() => setExpanded(!expanded)}>{expanded ? "סגירת פרטים" : "צפייה בפרטים"}</button>
                <button type="button" className="ui-button ui-button--text" disabled={!canEdit} onClick={onEdit}>עריכת פגישה</button>
            </div>
            <div id={details} hidden={!expanded} className="meeting-extra">
                {meeting.location && meeting.venue_details?.location && meeting.location !== meeting.venue_details.location &&
                    <p>כתובת האולם · <bdi>{meeting.venue_details.location}</bdi></p>}
                {meeting.video_url && /^https?:\/\//i.test(meeting.video_url) && <a href={meeting.video_url}
                    target="_blank" rel="noopener noreferrer">קישור לשיחת וידאו</a>}
                {meeting.venue_id && <a href={`#/weddings/${weddingId}/venues/${meeting.venue_id}`}>לפרטי האולם</a>}
                {!meeting.venue_id && !meeting.video_url && <p>כל פרטי הפגישה מופיעים בכרטיס.</p>}
            </div>
        </div>
    </li>;
}
