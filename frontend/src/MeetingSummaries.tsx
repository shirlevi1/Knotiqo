import { meetingDateLabel, meetingStatuses, meetingTypes, type Meeting } from "./api/meetings";
import { useUpcomingMeetings } from "./useUpcomingMeetings";
import "./MeetingsPage.css";
import "./DashboardMeetings.css";
import { VenuePhoto } from "./components/VenueGallery";

export function MeetingTime({ meeting }: { meeting: Meeting }) {
    return <><time dateTime={meeting.starts_at}>{meetingDateLabel(meeting.date)}</time>
        {" · "}<bdi dir="ltr">{meeting.start_time}{meeting.end_time && `–${meeting.end_time}`}</bdi></>;
}

export function AppointmentLink({ weddingId, kind, id, upcoming, state }: {
    weddingId: number; kind: "venue" | "vendor"; id: number; upcoming?: Meeting; state?: { error: string };
}) {
    const base = `#/weddings/${weddingId}/meetings`;
    return <div className="meeting-resource ui-panel">
        <h3>פגישות</h3>
        {upcoming ? <p><bdi>{upcoming.title}</bdi> · <MeetingTime meeting={upcoming} /></p> : <p>{state?.error ? "לא ניתן לטעון פגישות כרגע." : state ? "אין פגישה קרובה מתוכננת." : "טוענים פגישות…"}</p>}
        <div className="meeting-actions">
            <a className="ui-button ui-button--secondary" href={`${base}/new/${kind}/${id}`}>קביעת פגישה</a>
            {upcoming && <a className="ui-button ui-button--text" href={`${base}/edit/${upcoming.id}`}>עריכת הפגישה הקרובה</a>}
        </div>
    </div>;
}

const shortMonth = new Intl.DateTimeFormat("he-IL", { month: "short", timeZone: "UTC" });

export function DashboardMeetings({ weddingId }: { weddingId: number }) {
    const data = useUpcomingMeetings(weddingId, "dashboard");
    const base = `#/weddings/${weddingId}/meetings`;
    const meetings = (data?.records ?? []).filter((meeting) => meeting.status === "scheduled")
        .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at) || left.id - right.id)
        .slice(0, 3);

    return <section className="home-meetings" aria-labelledby="upcoming-meetings-title">
        <header className="workspace-section-heading home-meetings-heading">
            <div>
                <h2 id="upcoming-meetings-title">הפגישות הבאות שלנו</h2>
                <p>סיורים באולמות ופגישות עם ספקים</p>
            </div>
            <a className="workspace-inline-link" href={base}>לוח הפגישות <span aria-hidden="true">←</span></a>
        </header>
        {data?.error ? <p className="home-meetings-state" role="status">לא ניתן לטעון פגישות כרגע.</p>
            : !data ? <p className="home-meetings-state" role="status">טוענים פגישות…</p>
                : !meetings.length ? <div className="home-meetings-state">
                    <p>אין פגישות קרובות מתוכננות.</p>
                    <a className="ui-button ui-button--secondary" href={`${base}/new`}>קביעת פגישה</a>
                </div> : <ol className="home-meetings-list">
                    {meetings.map((meeting, index) => {
                        const business = meeting.venue_name || meeting.vendor_name;
                        const location = meeting.location || meeting.venue_details?.location;
                        const month = shortMonth.format(new Date(meeting.date + "T12:00:00Z"));
                        return <li key={meeting.id} className={index === 0 ? "home-meetings-featured" : undefined}>
                            <a className="home-meeting" href={`${base}/edit/${meeting.id}`}>
                                {index === 0 && <div className="home-meeting-art">
                                    {meeting.venue_details?.image_url ?
                                        <VenuePhoto url={meeting.venue_details.image_url} alt={meeting.venue_details.image_alt} />
                                        : <svg aria-hidden="true" viewBox="0 0 40 40" width="32" height="32" fill="none"
                                            stroke="currentColor" strokeWidth="1.2"><path d="M8 11h24v21H8z M13 7v8m14-8v8M8 18h24m-17 7h10" /></svg>}
                                </div>}
                                <div className="home-meeting-info">
                                    <time className="home-meeting-date" dateTime={meeting.starts_at} aria-label={meetingDateLabel(meeting.date)}>
                                        <strong>{Number(meeting.date.slice(-2))}</strong><span>{month}</span>
                                    </time>
                                    <div className="home-meeting-copy">
                                        <h3><bdi>{meeting.title}</bdi></h3>
                                        {business && business !== meeting.title && <p><bdi>{business}</bdi></p>}
                                        <div className="home-meeting-meta">
                                            <bdi dir="ltr">{meeting.start_time}{meeting.end_time && `–${meeting.end_time}`}</bdi>
                                            <span>{meetingTypes[meeting.meeting_type]}</span>
                                            <span className="home-meeting-status">{meetingStatuses[meeting.status]}</span>
                                        </div>
                                        {location && <p><bdi>{location}</bdi></p>}
                                    </div>
                                    <span className="home-meeting-arrow" aria-hidden="true">←</span>
                                </div>
                            </a>
                        </li>;
                    })}
                </ol>}
    </section>;
}
