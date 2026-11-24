import { useEffect, useRef, useState, type FormEvent } from "react";
import { budgetApi, type Simulation } from "../api/budget";
import { formatVenueMoney, venuesApi, type Venue, type VenueQuote } from "../api/venues";

export default function VenueBudgetSimulation({ weddingId, attendees }: { weddingId: number; attendees: number }) {
    const [venues, setVenues] = useState<Venue[] | null>(null);
    const [venueId, setVenueId] = useState("");
    const [quotes, setQuotes] = useState<VenueQuote[] | null>(null);
    const [quoteId, setQuoteId] = useState("");
    const [result, setResult] = useState<Simulation | null>(null);
    const [error, setError] = useState("");
    const [pending, setPending] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const action = useRef<AbortController | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        void venuesApi(weddingId).list(controller.signal).then((items) => {
            if (!controller.signal.aborted) setVenues(items);
        }).catch(() => {
            if (!controller.signal.aborted) setError("לא הצלחנו לטעון את האולמות.");
        });
        return () => controller.abort();
    }, [weddingId, attempt]);

    useEffect(() => {
        if (!venueId) return;
        const controller = new AbortController();
        void venuesApi(weddingId).quotes(Number(venueId), controller.signal).then((items) => {
            if (!controller.signal.aborted) setQuotes(items);
        }).catch(() => {
            if (!controller.signal.aborted) setError("לא הצלחנו לטעון את הצעות המחיר.");
        });
        return () => controller.abort();
    }, [weddingId, venueId, attempt]);

    useEffect(() => () => action.current?.abort(), []);

    function invalidate() {
        action.current?.abort();
        action.current = null;
        setResult(null);
        setError("");
        setPending(false);
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (action.current) return;
        const guests = Number(new FormData(event.currentTarget).get("expected_guests"));
        if (!quoteId || !Number.isSafeInteger(guests) || guests < 1) {
            setError("בחרו הצעה והזינו מספר אורחים שלם וחיובי.");
            return;
        }
        const controller = new AbortController();
        action.current = controller;
        setPending(true);
        setError("");
        setResult(null);
        try {
            const data = await budgetApi(weddingId).simulate(Number(quoteId), guests, controller.signal);
            if (!controller.signal.aborted) setResult(data);
        } catch (cause) {
            if (!controller.signal.aborted) setError(cause instanceof Error && !(cause instanceof TypeError)
                ? cause.message : "לא הצלחנו להתחבר לשרת.");
        } finally {
            if (!controller.signal.aborted) {
                action.current = null;
                setPending(false);
            }
        }
    }

    return <section className="ui-panel budget-section" aria-labelledby="budget-simulation">
        <h2 id="budget-simulation">הדמיית עלות אולם</h2>
        <p>ההצעות משתמשות במחיר אחיד לאורח, ללא תעריף נפרד לפי גיל. החישוב להמחשה בלבד ואינו משנה את התקציב.</p>
        {error && <p className="ui-error" role="alert">{error}</p>}
        {error && (!venues || (venueId && !quotes)) && <button className="ui-button ui-button--secondary"
            onClick={() => { invalidate(); setAttempt((value) => value + 1); }}>טעינה מחדש</button>}
        {!venues && !error && <p role="status">טוענים אולמות…</p>}
        {venues?.length === 0 && <p>כדי לחשב עלות, שמרו אולם והצעת מחיר בניהול האולמות.</p>}
        {venues && venues.length > 0 && <form className="budget-plan-fields" onSubmit={submit}>
            <label className="ui-field">אולם<select className="ui-input" value={venueId} onChange={(event) => {
                invalidate(); setQuotes(null); setQuoteId(""); setVenueId(event.target.value);
            }}>
                <option value="">בחירת אולם</option>
                {venues.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select></label>
            <label className="ui-field">הצעת מחיר<select className="ui-input" value={quoteId}
                disabled={!quotes?.length} onChange={(event) => { invalidate(); setQuoteId(event.target.value); }} required>
                <option value="">{venueId && !quotes && !error ? "טוענים הצעות…" : "בחירת הצעה"}</option>
                {quotes?.map(({ id, event_date, price_per_guest }) =>
                    <option key={id} value={id}>#{id} · {event_date ?? "ללא תאריך"} · {formatVenueMoney(price_per_guest)} לאורח</option>)}
            </select></label>
            <label className="ui-field">מספר אורחים לחישוב<input className="ui-input" type="number" name="expected_guests"
                min={1} max={Number.MAX_SAFE_INTEGER} step={1} required defaultValue={attendees || ""} onChange={invalidate} /></label>
            <button className="ui-button" disabled={!quoteId || pending}>{pending ? "מחשבים…" : "חישוב עלות"}</button>
            {quotes?.length === 0 && <p>לאולם הזה אין הצעות מחיר שמורות.</p>}
        </form>}
        {result && <dl className="budget-metrics" aria-live="polite">
            <div><dt>אורחים לחיוב (מינימום {result.minimum_guests})</dt><dd>{result.billable_guests}</dd></div>
            <div><dt>עלות מנות</dt><dd>{formatVenueMoney(result.meals_cost)}</dd></div>
            <div><dt>עלויות נוספות</dt><dd>{formatVenueMoney(result.additional_costs)}</dd></div>
            <div><dt>עלות מדומה</dt><dd>{formatVenueMoney(result.total_cost)}</dd></div>
        </dl>}
    </section>;
}
