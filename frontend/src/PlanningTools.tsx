import { useEffect, useRef, useState } from "react";
import { journeyApi, journeyError, type FeatureVisibility, type JourneySummary, type PlanningFeature } from "./api/journey";
import "./PlanningTools.css";

const tools = {
    vendors: { title: "ספקים והוצאות", route: "vendors", description: "רכזו ספקים, הצעות מחיר והתחייבויות." },
    payments: { title: "מקדמות ותשלומים", route: "budget/payments", description: "פתחו את לוח התשלומים בתוך תקציב החתונה." },
    rsvp: { title: "אישורי הגעה", route: "guests/rsvp", description: "נהלו תשובות וקישורי אישור ברשימת המוזמנים." },
};
const everyday = [
    { title: "אולמות", route: "venues", description: "אולמות, תמונות והצעות מחיר." },
    { title: "השוואת אולמות", route: "venues/compare", description: "השוו בין הצעות מחיר שמורות." },
    { title: "רשימת מוזמנים", route: "guests", description: "רשימת המוזמנים, כמויות ו־Excel." },
    { title: "תקציב החתונה", route: "budget", description: "תקציב, קטגוריות ועוזר התקציב." },
    { title: "פגישות וסיורים", route: "meetings", description: "לוח פגישות וסיורים משותף." },
];

export function FeatureAction({ feature, weddingId, features, onChange }: {
    feature: PlanningFeature; weddingId: number; features?: FeatureVisibility; onChange: (summary: JourneySummary) => void;
}) {
    const [error, setError] = useState("");
    const [pending, setPending] = useState(false);
    const controller = useRef<AbortController | null>(null);
    useEffect(() => () => controller.current?.abort(), []);
    const tool = tools[feature];
    const href = `#/weddings/${weddingId}/${tool.route}`;
    if (features?.[feature]?.visible) return <a className="ui-button ui-button--text" href={href}>{tool.title} ←</a>;

    async function activate() {
        if (controller.current) return;
        const request = new AbortController();
        controller.current = request;
        setError("");
        setPending(true);
        try {
            const summary = await journeyApi(weddingId).activate(feature, request.signal);
            if (!request.signal.aborted) {
                onChange(summary);
                window.location.assign(href);
            }
        } catch (cause) {
            if (!request.signal.aborted) setError(journeyError(cause));
        } finally {
            if (!request.signal.aborted) {
                controller.current = null;
                setPending(false);
            }
        }
    }

    return <div className="tool-activation">
        <button type="button" className="ui-button ui-button--secondary" onClick={() => void activate()} disabled={pending}>
            {pending ? "פותחים…" : "פתיחת הכלי"}<span className="tool-visually-hidden"> · {tool.title}</span>
        </button>
        {error && <p role="alert" className="ui-error">{error}</p>}
    </div>;
}

export default function PlanningTools({ weddingId, features, onChange }: {
    weddingId: number; features?: FeatureVisibility; onChange: (summary: JourneySummary) => void;
}) {
    return <section className="planning-directory" dir="rtl">
        <header><h1>כל הכלים</h1><p>כל כלי התכנון של החתונה זמינים גם לפני השלב המומלץ.</p></header>
        <ul className="planning-directory-list">
            {everyday.map((tool) => <li className="ui-card" key={tool.route}>
                <h2>{tool.title}</h2><p>{tool.description}</p>
                <a className="ui-button ui-button--text" href={`#/weddings/${weddingId}/${tool.route}`}>{tool.title} ←</a>
            </li>)}
            {(Object.keys(tools) as PlanningFeature[]).map((feature) => <li className="ui-card" key={feature}>
                <h2>{tools[feature].title}</h2><p>{tools[feature].description}</p>
                <FeatureAction feature={feature} weddingId={weddingId} features={features} onChange={onChange} />
            </li>)}
        </ul>
    </section>;
}
