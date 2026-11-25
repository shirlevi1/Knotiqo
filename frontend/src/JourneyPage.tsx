import { useEffect, useRef, useState, type FormEvent } from "react";
import { journeyApi, journeyError, type Journey, type JourneySummary, type JourneyTask, type TaskInput } from "./api/journey";
import { FeatureAction } from "./PlanningTools";
import { JourneyNext, JourneyProgress, JourneyStageTitle } from "./JourneyDashboard";

const dateFormat = new Intl.DateTimeFormat("he-IL", { dateStyle: "long", timeZone: "UTC" });
const formatDate = (date: string) => dateFormat.format(new Date(date + "T12:00:00Z"));
const moduleLabels: Record<string, string> = {
    budget: "פתיחת תקציב", guests: "ניהול מוזמנים", venues: "מעבר לאולמות",
    "venues/compare": "השוואת הצעות", meetings: "לוח פגישות", vendors: "מעבר לספקים",
};

function TaskForm({ task, stage, stages, busy, close, save }: {
    task?: JourneyTask; stage: number; stages: Journey["stages"]; busy: boolean; close: () => void; save: (input: TaskInput) => void;
}) {
    const heading = useRef<HTMLHeadingElement>(null);
    const [invalid, setInvalid] = useState(false);
    useEffect(() => { heading.current?.focus(); }, []);
    const custom = !task || task.custom;
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const read = (name: string) => String(fields.get(name) ?? "").trim();
        if (custom && !read("title")) { setInvalid(true); return; }
        save({ ...(custom ? { title: read("title"), description: read("description"), stage: Number(read("stage")) } : {}),
            priority: read("priority") === "high" ? "high" : "normal", due_date: read("due_date") || null });
    }
    return <form className="journey-task-form ui-panel" onSubmit={submit} aria-label={task ? "עריכת משימה" : "הוספת משימה"}>
        <h3 ref={heading} tabIndex={-1}>{task ? "עריכת משימה" : "הוספת משימה"}</h3>
        <fieldset className="journey-fields" disabled={busy}>
            {custom && <>
                <label className="ui-field">שם המשימה<input className="ui-input" name="title" required maxLength={150} defaultValue={task?.title} /></label>
                <label className="ui-field">שלב<select className="ui-input" name="stage" defaultValue={task?.stage ?? stage}>
                    {stages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                </select></label>
                <label className="ui-field">תיאור<textarea className="ui-input" name="description" maxLength={1000} defaultValue={task?.description} /></label>
            </>}
            <label className="ui-field">עדיפות<select className="ui-input" name="priority" defaultValue={task?.priority ?? "normal"}>
                <option value="normal">רגילה</option><option value="high">גבוהה</option>
            </select></label>
            <label className="ui-field">תאריך יעד<input className="ui-input" name="due_date" lang="he-IL" type="date" defaultValue={task?.due_date ?? ""} /></label>
        </fieldset>
        {invalid && <p role="alert" className="ui-error">יש להזין שם למשימה.</p>}
        <div className="journey-actions"><button className="ui-button" disabled={busy}>שמירת משימה</button>
            <button type="button" className="ui-button ui-button--text" onClick={close} disabled={busy}>ביטול</button></div>
    </form>;
}

export default function JourneyPage({ weddingId, onChange }: { weddingId: number; onChange: (summary: JourneySummary) => void }) {
    const [journey, setJourney] = useState<Journey>();
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [revision, setRevision] = useState(0);
    const [busy, setBusy] = useState(false);
    const [editor, setEditor] = useState<{ stage: number; task?: JourneyTask }>();
    const [removal, setRemoval] = useState<JourneyTask>();
    const pending = useRef<AbortController | null>(null);
    const api = journeyApi(weddingId);

    useEffect(() => {
        const controller = new AbortController();
        void journeyApi(weddingId).load(controller.signal).then((data) => {
            if (!controller.signal.aborted) setJourney(data);
        }).catch((cause) => {
            if (!controller.signal.aborted) setError(journeyError(cause));
        });
        return () => controller.abort();
    }, [weddingId, revision]);
    useEffect(() => () => pending.current?.abort(), []);

    async function change(run: (signal: AbortSignal) => Promise<Journey>, close = false) {
        if (pending.current) return;
        const controller = new AbortController();
        pending.current = controller;
        setBusy(true);
        setError("");
        setNotice("");
        try {
            const data = await run(controller.signal);
            if (!controller.signal.aborted) {
                setJourney(data);
                onChange(data);
                setNotice("מסלול החתונה עודכן.");
                if (close) { setEditor(undefined); setRemoval(undefined); }
            }
        } catch (cause) {
            if (!controller.signal.aborted) setError(journeyError(cause));
        } finally {
            if (!controller.signal.aborted) { pending.current = null; setBusy(false); }
        }
    }

    return <section className="journey-page" dir="rtl" aria-labelledby="journey-title">
        <header className="journey-intro ui-card">
            <div><h1 id="journey-title">מסלול החתונה</h1><p>תכננו את הדרך לחתונה בקצב שמתאים לכם.</p>
                {journey?.wedding_date && <p>תאריך החתונה <time dateTime={journey.wedding_date}>{formatDate(journey.wedding_date)}</time></p>}
                {journey && <p>{journey.recommended_stage_title ? <>השלב המומלץ כרגע · <JourneyStageTitle title={journey.recommended_stage_title} /></>
                    : "תאריך החתונה טרם נקבע. כל שלבי המסלול זמינים."}</p>}
                {journey && <JourneyProgress value={journey.progress} />}</div>
            {journey && <div><h2>הצעדים הבאים</h2><JourneyNext tasks={journey.next_actions} /></div>}
        </header>
        {notice && <p role="status">{notice}</p>}
        {error && <p className="ui-error" role="alert">{error} {!journey && <button className="ui-button ui-button--text"
            onClick={() => { setError(""); setRevision((value) => value + 1); }}>טעינה מחדש</button>}</p>}
        {!journey && !error && <p role="status">טוענים את מסלול החתונה…</p>}
        {journey && <ol className="journey-stages">{journey.stages.map((stage) => {
            const custom = stage.tasks.filter((task) => task.custom);
            return <li key={stage.id}>
                <span className="journey-stage-number" aria-hidden="true">{stage.id}</span>
                <details className="journey-stage ui-card" open={stage.id === (journey.recommended_stage ?? 1) || undefined}>
                    <summary><span><JourneyStageTitle title={stage.title} />{stage.id === journey.recommended_stage && <small>שלב מומלץ</small>}</span>
                        <small>{stage.progress.completed}/{stage.progress.total} הושלמו</small></summary>
                    <div className="journey-stage-body">
                        <ul className="journey-tasks">{stage.tasks.map((task) => {
                            const position = custom.indexOf(task);
                            const feature = task.module === "vendors" ? "vendors"
                                : ["deposit", "final-payments"].includes(task.key) ? "payments"
                                    : ["rsvp", "follow-rsvp"].includes(task.key) ? "rsvp" : null;
                            return <li key={task.key} className="journey-task">
                                <div className="journey-task-copy">
                                    <label><input type="checkbox" checked={task.status === "done"} disabled={busy || task.status === "skipped"}
                                        onChange={() => void change((signal) => api.edit(task.key, { status: task.status === "done" ? "open" : "done" }, signal))} />
                                        <strong>{task.title}</strong></label>
                                    {task.description && <p>{task.description}</p>}
                                    <div className="journey-task-meta">
                                        {task.status === "skipped" && <span>דולגה</span>}
                                        {task.priority === "high" && <span>עדיפות גבוהה</span>}
                                        {task.due_date && <time dateTime={task.due_date}>{task.overdue ? "באיחור · " : "יעד · "}{formatDate(task.due_date)}</time>}
                                        {task.has_evidence && <span>יש נתונים במערכת</span>}
                                        {["seating", "tables", "prepare-invitations", "send-invitations"].includes(task.key) &&
                                            <span>כלי ייעודי בפיתוח</span>}
                                    </div>
                                </div>
                                <div className="journey-actions">
                                    {feature && <FeatureAction feature={feature} weddingId={weddingId} features={journey.features} onChange={onChange} />}
                                    {!feature && Object.hasOwn(moduleLabels, task.module) && <a className="ui-button ui-button--text"
                                        href={`#/weddings/${weddingId}/${task.module}`}>{moduleLabels[task.module]}</a>}
                                    <button type="button" className="ui-button ui-button--text" disabled={busy || !!editor || !!removal}
                                        onClick={() => setEditor({ stage: stage.id, task })}>עריכה</button>
                                    <button type="button" className="ui-button ui-button--text" disabled={busy}
                                        onClick={() => void change((signal) => api.edit(task.key, { status: task.status === "skipped" ? "open" : "skipped" }, signal))}>
                                        {task.status === "skipped" ? "החזרה למסלול" : "דילוג"}</button>
                                    {task.custom && <>
                                        <button type="button" className="ui-button ui-button--text" disabled={busy || position <= 0}
                                            aria-label={`העברת ${task.title} למעלה`} onClick={() => void change((signal) => api.edit(task.key, { move: "up" }, signal))}>↑</button>
                                        <button type="button" className="ui-button ui-button--text" disabled={busy || position === custom.length - 1}
                                            aria-label={`העברת ${task.title} למטה`} onClick={() => void change((signal) => api.edit(task.key, { move: "down" }, signal))}>↓</button>
                                        <button type="button" className="ui-button ui-button--text" disabled={busy || !!editor || !!removal}
                                            onClick={() => setRemoval(task)}>מחיקה</button>
                                    </>}
                                </div>
                            </li>;
                        })}</ul>
                        {editor?.stage === stage.id && <TaskForm key={editor.task?.key ?? "new"} task={editor.task} stage={stage.id}
                            stages={journey.stages} busy={busy} close={() => setEditor(undefined)}
                            save={(input) => void change((signal) => editor.task ? api.edit(editor.task.key, input, signal)
                                : api.create(input, signal), true)} />}
                        {removal?.stage === stage.id && <div className="journey-actions">
                            <p>למחוק את המשימה ״{removal.title}״?</p>
                            <button className="ui-button" type="button" disabled={busy}
                                onClick={() => void change((signal) => api.remove(removal.key, signal), true)}>אישור מחיקה</button>
                            <button className="ui-button ui-button--text" type="button" disabled={busy} onClick={() => setRemoval(undefined)}>ביטול</button>
                        </div>}
                        <button className="ui-button ui-button--secondary" type="button" disabled={busy || !!editor || !!removal}
                            onClick={() => setEditor({ stage: stage.id })}>הוספת משימה</button>
                    </div>
                </details>
            </li>;
        })}</ol>}
    </section>;
}
