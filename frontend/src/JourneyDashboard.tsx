import { type JourneySummary, type Progress } from "./api/journey";
import "./JourneyPage.css";

export function JourneyStageTitle({ title }: { title: string }) {
    const range = /^([0-9]+–[0-9]+)(.*)$/.exec(title);
    return range ? <><bdi dir="ltr">{range[1]}</bdi>{range[2]}</> : <>{title}</>;
}

export function JourneyProgress({ value }: { value: Progress }) {
    return <div className="journey-progress">
        <div><strong>{value.percentage === null ? "—" : `${value.percentage}%`}</strong>
            <span>{value.completed} מתוך {value.total} משימות הושלמו{value.skipped > 0 && ` · ${value.skipped} דולגו`}</span></div>
        {value.percentage !== null && <progress max={100} value={value.percentage} aria-label="התקדמות בתכנון" />}
    </div>;
}

export function JourneyNext({ tasks }: { tasks: JourneySummary["next_actions"] }) {
    return tasks.length ? <ol className="journey-next">{tasks.map((task) => <li key={task.key}>{task.title}</li>)}</ol>
        : <p>אין משימות פתוחות כרגע.</p>;
}

export default function JourneyDashboard({ weddingId, data, error }: { weddingId: number; data?: JourneySummary; error?: string }) {
    return <section className="journey-dashboard" aria-labelledby="journey-dashboard-title">
        <header className="workspace-section-heading"><h2 id="journey-dashboard-title">איפה אנחנו בתכנון?</h2>
            <a className="workspace-inline-link" href={`#/weddings/${weddingId}/journey`}>מסלול החתונה המלא ←</a></header>
        {data ? <div className="journey-dashboard-card ui-panel">
            <div><p>{data.recommended_stage_title ? <JourneyStageTitle title={data.recommended_stage_title} />
                : "אפשר לתכנן בכל שלב. המלצה תופיע לאחר קביעת תאריך החתונה."}</p>
                <JourneyProgress value={data.progress} /></div>
            <div><h3>הצעדים הבאים</h3><JourneyNext tasks={data.next_actions} /></div>
        </div> : <p role="status">{error || "טוענים את מסלול החתונה…"}</p>}
    </section>;
}
