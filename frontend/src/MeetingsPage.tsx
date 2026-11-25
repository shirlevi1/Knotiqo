import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import MeetingCard, { MeetingStatus } from "./MeetingCard";
import MeetingForm, { ResourceOptions } from "./MeetingForm";
import { MeetingTime } from "./MeetingSummaries";
import { meetingDateLabel, meetingError, meetingsApi, meetingStatuses, meetingToday, meetingTypes, resourceValue,
    type Meeting, type MeetingPage, type Resource } from "./api/meetings";

const months = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "UTC" });
const weekdays = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const day = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (iso: string) => new Date(iso + "T12:00:00Z");
const shiftDay = (iso: string, days: number) => {
    const date = asDate(iso);
    date.setUTCDate(date.getUTCDate() + days);
    return day(date);
};
const shiftMonth = (iso: string, offset: number) => {
    const date = asDate(iso);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return day(date);
};

export default function MeetingsPage({ weddingId, route }: { weddingId: number; route: string }) {
    const [today] = useState(meetingToday);
    const [month, setMonth] = useState(today.slice(0, 7) + "-01");
    const [selectedDay, setSelectedDay] = useState("");
    const [focusedDay, setFocusedDay] = useState(today);
    const [view, setView] = useState<"month" | "agenda">("month");
    const [allUpcoming, setAllUpcoming] = useState(true);
    const [associationFilter, setAssociationFilter] = useState("");
    const [search, setSearch] = useState("");
    const [summary, setSummary] = useState<{ key: string; active: number; first: Meeting | null; monthCount: number }>();
    const [summaryError, setSummaryError] = useState("");
    const [kind, setKind] = useState("");
    const [status, setStatus] = useState("");
    const [resource, setResource] = useState("");
    const [page, setPage] = useState(1);
    const [list, setList] = useState<{ key: string; result: MeetingPage }>();
    const [markers, setMarkers] = useState<{ key: string; dates: string[]; error?: boolean }>();
    const [resources, setResources] = useState<Resource[]>();
    const [editor, setEditor] = useState<Meeting | "new">();
    const [notice, setNotice] = useState("");
    const [loadError, setLoadError] = useState("");
    const [optionsError, setOptionsError] = useState("");
    const [editorError, setEditorError] = useState("");
    const [busy, setBusy] = useState(false);
    const [revision, setRevision] = useState(0);
    const grid = useRef<HTMLDivElement>(null);
    const shiftFocus = useRef(false);
    const pending = useRef<AbortController | null>(null);
    const api = meetingsApi(weddingId);
    const association = /^meetings\/new\/(venue|vendor)\/(\d+)$/.exec(route)?.slice(1).join(":");
    const detailId = /^meetings\/edit\/(\d+)$/.exec(route)?.[1];
    const base = `#/weddings/${weddingId}/meetings`;
    const last = shiftDay(shiftMonth(month, 1), -1);
    const firstGrid = shiftDay(month, -asDate(month).getUTCDay());
    const filters = new URLSearchParams();
    if (associationFilter) filters.set("association", associationFilter);
    if (search.trim()) filters.set("search", search.trim());
    const dateRange = new URLSearchParams(filters);
    if (selectedDay || !allUpcoming) {
        dateRange.set("date_from", selectedDay || month);
        dateRange.set("date_to", selectedDay || last);
    } else {
        if (!status) dateRange.set("upcoming", "true");
    }
    dateRange.set("page", String(page));
    if (kind) dateRange.set("meeting_type", kind);
    if (status) dateRange.set("status", status);
    if (resource) {
        const [key, id] = resource.split(":");
        dateRange.set(key + "_id", id);
    }
    const query = dateRange.toString();
    const calendarRange = new URLSearchParams(dateRange);
    calendarRange.set("date_from", month);
    calendarRange.set("date_to", last);
    calendarRange.delete("page");
    calendarRange.delete("upcoming");
    const calendarQuery = calendarRange.toString();
    const activeRange = new URLSearchParams(dateRange);
    activeRange.delete("page");
    activeRange.set("upcoming", "true");
    const activeQuery = activeRange.toString();
    const summaryKey = `${calendarQuery}:${activeQuery}:${revision}`;
    const currentSummary = summary?.key === summaryKey ? summary : undefined;
    const listKey = `${query}:${revision}`;
    const markerKey = `${calendarQuery}:${revision}`;
    const rows = list?.key === listKey ? list.result : undefined;

    useEffect(() => {
        const controller = new AbortController();
        void meetingsApi(weddingId).options(controller.signal).then((options) => {
            if (!controller.signal.aborted) setResources(options);
        }).catch((error) => {
            if (!controller.signal.aborted) setOptionsError(meetingError(error));
        });
        return () => controller.abort();
    }, [weddingId, revision]);

    useEffect(() => {
        const controller = new AbortController();
        void meetingsApi(weddingId).list(new URLSearchParams(query), controller.signal).then((result) => {
            if (!controller.signal.aborted) {
                setLoadError("");
                setList({ key: listKey, result });
            }
        }).catch((error) => {
            if (!controller.signal.aborted) setLoadError(meetingError(error));
        });
        return () => controller.abort();
    }, [weddingId, query, listKey]);

    useEffect(() => {
        if (view !== "month") return;
        const controller = new AbortController();
        void meetingsApi(weddingId).dates(new URLSearchParams(calendarQuery), controller.signal).then((dates) => {
            if (!controller.signal.aborted) setMarkers({ key: markerKey, dates });
        }).catch(() => {
            if (!controller.signal.aborted) setMarkers({ key: markerKey, dates: [], error: true });
        });
        return () => controller.abort();
    }, [weddingId, calendarQuery, markerKey, view]);

    useEffect(() => {
        const controller = new AbortController();
        const client = meetingsApi(weddingId);
        void Promise.all([client.summary(new URLSearchParams(activeQuery), controller.signal),
            client.summary(new URLSearchParams(calendarQuery), controller.signal)]).then(([active, monthly]) => {
            if (!controller.signal.aborted) setSummary({ key: summaryKey, active: active.count, first: active.first, monthCount: monthly.count });
        }).catch(() => {
            if (!controller.signal.aborted) setSummaryError(summaryKey);
        });
        return () => controller.abort();
    }, [weddingId, activeQuery, calendarQuery, summaryKey]);

    useEffect(() => {
        if (!detailId) return;
        const controller = new AbortController();
        void meetingsApi(weddingId).detail(Number(detailId), controller.signal).then((record) => {
            if (!controller.signal.aborted) {
                setEditor(record);
                setMonth(record.date.slice(0, 7) + "-01");
                setSelectedDay(record.date);
                setFocusedDay(record.date);

            }
        }).catch((error) => {
            if (!controller.signal.aborted) setEditorError(meetingError(error));
        });
        return () => controller.abort();
    }, [weddingId, detailId]);

    useEffect(() => () => pending.current?.abort(), []);
    useEffect(() => {
        if (shiftFocus.current) {
            grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusedDay}"]`)?.focus();
            shiftFocus.current = false;
        }
    }, [focusedDay, month]);

    function resetList() { setLoadError(""); setPage(1); }
    function changeMonth(next: string) {
        resetList();
        setAllUpcoming(false);
        setMonth(next);
        setSelectedDay("");
        setFocusedDay(next);
    }
    function selectDay(next: string) {
        resetList();
        if (next.slice(0, 7) !== month.slice(0, 7)) setMonth(next.slice(0, 7) + "-01");
        setAllUpcoming(false);
        setSelectedDay(next);
        setFocusedDay(next);
    }
    function navigateDays(event: KeyboardEvent<HTMLButtonElement>, current: string) {
        const offset = { ArrowLeft: 1, ArrowRight: -1, ArrowUp: -7, ArrowDown: 7 }[event.key];
        if (offset === undefined) return;
        event.preventDefault();
        const next = shiftDay(current, offset);
        shiftFocus.current = true;
        if (next.slice(0, 7) !== month.slice(0, 7)) changeMonth(next.slice(0, 7) + "-01");
        setFocusedDay(next);
    }

    async function mutate(operation: (signal: AbortSignal) => Promise<Meeting | void>, message: string) {
        if (pending.current) return;
        const controller = new AbortController();
        pending.current = controller;
        setBusy(true);
        setEditorError("");
        try {
            const result = await operation(controller.signal);
            if (!controller.signal.aborted) {
                if (result) selectDay(result.date);
                else resetList();
                setEditor(undefined);
                setNotice(message);
                setRevision((value) => value + 1);
            }
        } catch (error) {
            if (!controller.signal.aborted) setEditorError(meetingError(error));
        } finally {
            if (!controller.signal.aborted) {
                pending.current = null;
                setBusy(false);
            }
        }
    }

    const current = editor && editor !== "new" ? editor : undefined;
    const linkedResource = association && resources?.find((item) => resourceValue(item) === association);
    const [deepLinkClosed, setDeepLinkClosed] = useState(false);
    const deepNew = (route === "meetings/new" || Boolean(association && linkedResource)) && !deepLinkClosed && editor === undefined;
    const dayForForm = selectedDay || (today.startsWith(month.slice(0, 7)) ? today : month);
    const closeEditor = () => { setEditor(undefined); setEditorError(""); setDeepLinkClosed(true); };
    const showEditor = editor !== undefined || deepNew;
    const occupied = new Set(markers?.key === markerKey ? markers.dates : []);

    return <section className="meetings-page" dir="rtl" aria-labelledby="meetings-title">
        <header className="meeting-header">
            <div><h1 id="meetings-title">פגישות קרובות</h1><p>כל הסיורים, הפגישות והשיחות לקראת החתונה במקום אחד</p></div>
            <button type="button" className="ui-button" disabled={!resources || busy || !!showEditor}
                onClick={() => { setEditor("new"); setNotice(""); setEditorError(""); }}>הוספת פגישה חדשה</button>
        </header>
        {notice && <p role="status">{notice}</p>}
        {optionsError && <p role="alert" className="ui-error">{optionsError} <button className="ui-button ui-button--text"
            onClick={() => { setOptionsError(""); setRevision((value) => value + 1); }}>טעינה מחדש</button></p>}
        {association && resources && !linkedResource && <p className="ui-error" role="alert">האולם או הספק אינם זמינים בחתונה הזו.</p>}
        {editorError && !showEditor && <p role="alert" className="ui-error">{editorError}</p>}
        {showEditor && resources && <MeetingForm key={current?.id ?? "new"} initial={current} day={dayForForm}
            association={linkedResource ? association : undefined} resources={resources} busy={busy} error={editorError}
            onClose={closeEditor} onSave={(input) => void mutate(async (signal) => {
                const meeting = await api.save(input, signal, current?.id);
                if (!signal.aborted) setDeepLinkClosed(true);
                return meeting;
            }, "הפגישה נשמרה.")}
            onCancelMeeting={() => current && void mutate((signal) => api.save({ status: "cancelled" }, signal, current.id), "הפגישה בוטלה.")}
            onRemove={() => current && void mutate((signal) => api.remove(current.id, signal), "הפגישה נמחקה.")} />}
        <div className="meeting-panel ui-panel">
            <div className="meeting-actions" aria-label="תצוגת לוח">
                <button type="button" className="ui-button ui-button--secondary" aria-pressed={view === "month"} onClick={() => setView("month")}>חודש</button>
                <button type="button" className="ui-button ui-button--secondary" aria-pressed={view === "agenda"} onClick={() => {
                    setView("agenda");
                    if (selectedDay) { resetList(); setSelectedDay(""); }
                }}>סדר יום</button>
            </div>
            <div className="meeting-filters">
                <label className="ui-field">חיפוש<input type="search" className="ui-input" value={search} maxLength={150}
                    onChange={(event) => { resetList(); setSearch(event.target.value); }} /></label>
                <label className="ui-field">שיוך<select value={associationFilter} className="ui-input"
                    onChange={(event) => { resetList(); setAssociationFilter(event.target.value); }}>
                    <option value="">כל הפגישות</option><option value="venue">אולמות</option>
                    <option value="vendor">פגישות ספקים</option><option value="general">פגישות כלליות</option>
                </select></label>
                <label className="ui-field">סוג פגישה<select value={kind} className="ui-input" onChange={(event) => { resetList(); setKind(event.target.value); }}>
                    <option value="">כל הסוגים</option>
                    {Object.entries(meetingTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select></label>
                <label className="ui-field">מצב<select value={status} className="ui-input" onChange={(event) => { resetList(); setStatus(event.target.value); }}>
                    <option value="">כל המצבים</option>
                    {Object.entries(meetingStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select></label>
                <label className="ui-field">אולם או ספק<select value={resource} className="ui-input" onChange={(event) => { resetList(); setResource(event.target.value); }}>
                    <option value="">כל הפגישות</option><ResourceOptions resources={resources ?? []} />
                </select></label>
            </div>
            <button type="button" className="ui-button ui-button--text meeting-today" onClick={() => {
                resetList(); setSearch(""); setAssociationFilter(""); setKind(""); setStatus(""); setResource(""); setSelectedDay(""); setAllUpcoming(true);
            }}>ניקוי מסננים</button>
        </div>
        <div className="meeting-content" data-view={view}>
            <aside className="meeting-side"><div className="meeting-panel ui-card">
                <header className="meeting-header meeting-month-nav">
                    <button type="button" className="ui-button ui-button--text" aria-label="החודש הקודם" onClick={() => changeMonth(shiftMonth(month, -1))}>→</button>
                    <h2 aria-live="polite">{months.format(asDate(month))}</h2>
                    <button type="button" className="ui-button ui-button--text" aria-label="החודש הבא" onClick={() => changeMonth(shiftMonth(month, 1))}>←</button>
                </header>
                <button type="button" className="ui-button ui-button--secondary meeting-today" onClick={() => selectDay(today)}>היום</button>
                {view === "month" && markers?.key === markerKey && markers.error && <p className="ui-error">לא ניתן להציג סימונים על הלוח כרגע.</p>}
                {view === "month" && <div className="meeting-calendar" ref={grid}>
                    {weekdays.map((label) => <span className="meeting-weekday" key={label}>{label}</span>)}
                    {Array.from({ length: 42 }, (_, offset) => {
                        const cell = shiftDay(firstGrid, offset);
                        const otherMonth = !cell.startsWith(month.slice(0, 7));
                        const hasMeetings = occupied.has(cell);
                        return <button type="button" key={cell} className="meeting-day" data-day={cell} data-other={otherMonth}
                            data-occupied={hasMeetings} tabIndex={cell === focusedDay ? 0 : -1}
                            aria-current={cell === today ? "date" : undefined} aria-pressed={cell === selectedDay}
                            aria-label={meetingDateLabel(cell) + (hasMeetings ? ", יש פגישות בתצוגה" : "")}
                            onClick={() => selectDay(cell)} onKeyDown={(event) => navigateDays(event, cell)}>
                            {Number(cell.slice(-2))}
                        </button>;
                    })}
                </div>}
            </div>
            <section className="meeting-panel ui-panel meeting-overview" aria-labelledby="meeting-summary-title">
                <h2 id="meeting-summary-title">במבט אחד</h2>
                {currentSummary && Number.isInteger(currentSummary.active) && Number.isInteger(currentSummary.monthCount) ? <>
                    <dl><div><dt>פגישות קרובות בתצוגה</dt><dd>{currentSummary.active}</dd></div>
                        <div><dt>פגישות בחודש הנבחר</dt><dd>{currentSummary.monthCount}</dd></div></dl>
                    {currentSummary.first && <div className="meeting-next"><strong><bdi>{currentSummary.first.title}</bdi></strong>
                        <p><MeetingTime meeting={currentSummary.first} /></p>
                        {(currentSummary.first.venue_name || currentSummary.first.vendor_name) && <p><bdi>
                            {currentSummary.first.venue_name || currentSummary.first.vendor_name}</bdi></p>}
                        <MeetingStatus status={currentSummary.first.status} /></div>}
                </> : <p>{summaryError === summaryKey ? "לא ניתן לטעון את הסיכום." : "טוענים את סיכום הפגישות…"}</p>}
            </section></aside>
            <section className="meeting-list-panel" aria-labelledby="agenda-title">
                <header className="meeting-header"><h2 id="agenda-title">{selectedDay ? meetingDateLabel(selectedDay)
                    : allUpcoming && !status ? "הפגישות הבאות" : allUpcoming ? "פגישות לפי מצב" : "פגישות החודש"}</h2>
                    {(!allUpcoming || selectedDay || status) && <button type="button" className="ui-button ui-button--text"
                        onClick={() => { resetList(); setSelectedDay(""); setStatus(""); setAllUpcoming(true); }}>כל הפגישות הקרובות</button>}
                    {allUpcoming && !selectedDay && <button type="button" className="ui-button ui-button--text"
                        onClick={() => { resetList(); setAllUpcoming(false); }}>הצגת כל החודש</button>}
                </header>
                {loadError ? <p className="ui-error" role="alert">{loadError} <button className="ui-button ui-button--text"
                    onClick={() => { setLoadError(""); setRevision((value) => value + 1); }}>ניסיון נוסף</button></p>
                    : !rows ? <p role="status">טוענים פגישות…</p> : !rows.results.length ? <div className="meeting-panel ui-card">
                        <p>אין פגישות בתצוגה הנוכחית.</p>
                        <button type="button" className="ui-button ui-button--secondary meeting-today" disabled={!resources || !!showEditor}
                            onClick={() => { setEditor("new"); setEditorError(""); }}>הוספת פגישה</button>
                    </div> : <ul className="meeting-agenda">{rows.results.map((meeting) =>
                        <MeetingCard key={meeting.id} weddingId={weddingId} meeting={meeting} canEdit={!!resources && !busy && !showEditor}
                            onEdit={() => { setEditor(meeting); setNotice(""); setEditorError(""); }} />)}</ul>}
                {(rows?.previous || rows?.next) && <div className="meeting-actions">
                    <button type="button" className="ui-button ui-button--secondary" disabled={!rows.previous}
                        onClick={() => { setPage((value) => value - 1); }}>הקודם</button>
                    <button type="button" className="ui-button ui-button--secondary" disabled={!rows.next}
                        onClick={() => { setPage((value) => value + 1); }}>הבא</button>
                </div>}
                {route !== "meetings" && <a href={base}>פתיחת לוח הפגישות</a>}
            </section>
        </div>
    </section>;
}
