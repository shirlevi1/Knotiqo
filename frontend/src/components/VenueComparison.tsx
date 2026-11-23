import { useEffect, useRef, useState, type FormEvent } from "react";
import {
    formatVenueMoney, venuesApi, VenueApiError, type ComparedQuote, type Venue,
    type VenueComparison as Comparison, type VenueQuote,
} from "../api/venues";
import { VenuePhoto } from "./VenueGallery";
import "./VenueComparison.css";

const minQuotes = 2;
const maxQuotes = 4;
const dateFormatter = new Intl.DateTimeFormat("he-IL", { timeZone: "UTC" });
const countFormatter = new Intl.NumberFormat("he-IL");
const formatDate = (date: string | null) => date ? dateFormatter.format(new Date(`${date}T00:00:00Z`)) : "טרם נקבע";

const metrics: { label: string; value: (quote: ComparedQuote) => string; total?: boolean }[] = [
    { label: "מחיר לאורח", value: (quote) => formatVenueMoney(quote.price_per_guest) },
    { label: "מינימום אורחים", value: (quote) => countFormatter.format(quote.minimum_guests) },
    { label: "אורחים לחיוב", value: (quote) => countFormatter.format(quote.billable_guests) },
    { label: "עלות מנות", value: (quote) => formatVenueMoney(quote.meals_cost) },
    { label: "עלויות נוספות", value: (quote) => formatVenueMoney(quote.additional_costs) },
    { label: "עלות כוללת", value: (quote) => formatVenueMoney(quote.total_cost), total: true },
    { label: "פער מהעלות הנמוכה ביותר", value: (quote) => formatVenueMoney(quote.difference_from_cheapest) },
];

type Entry = { venue: Venue; quotes: VenueQuote[] };

function QuoteSummary({ quote, entries, cheapest }: { quote: ComparedQuote; entries: Entry[]; cheapest: boolean }) {
    const image = entries.find(({ venue }) => venue.id === quote.venue_id)?.venue.images.find((item) => item.is_primary);
    return (
        <div className="comparison-quote-summary">
            <VenuePhoto url={image?.image_url} alt={image?.alt_text} />
            <h4><bdi>{quote.venue_name}</bdi></h4>
            <p>הצעה מס׳ <bdi>{quote.quote_id}</bdi> · <bdi>{formatDate(quote.event_date)}</bdi></p>
            {cheapest && <span className="comparison-lowest">העלות המחושבת הנמוכה ביותר</span>}
        </div>
    );
}

function ComparisonResults({ result, entries }: { result: Comparison; entries: Entry[] }) {
    return (
        <section className="comparison-results" aria-labelledby="comparison-results-title">
            <h3 id="comparison-results-title">תוצאות ההשוואה</h3>
            <p role="status">החישוב מבוסס על {countFormatter.format(result.expected_guests)} אורחים. הסימון מציין עלות בלבד. התאמת האולם ואיכותו אינן חלק מההשוואה.</p>
            <table className="comparison-table" aria-labelledby="comparison-results-title">
                <thead><tr>
                    <th scope="col">נתוני ההצעה</th>
                    {result.comparisons.map((quote) => (
                        <th scope="col" key={quote.quote_id} className={quote.quote_id === result.cheapest_quote_id ? "comparison-lowest-column" : undefined}>
                            <QuoteSummary quote={quote} entries={entries} cheapest={quote.quote_id === result.cheapest_quote_id} />
                        </th>
                    ))}
                </tr></thead>
                <tbody>
                    {metrics.map(({ label, value, total }) => (
                        <tr className={total ? "comparison-total" : undefined} key={label}>
                            <th scope="row">{label}</th>
                            {result.comparisons.map((quote) => (
                                <td className={quote.quote_id === result.cheapest_quote_id ? "comparison-lowest-column" : undefined}
                                    key={quote.quote_id}><bdi>{value(quote)}</bdi></td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            <ul className="comparison-cards">
                {result.comparisons.map((quote) => (
                    <li className={quote.quote_id === result.cheapest_quote_id ? "comparison-lowest-column" : undefined} key={quote.quote_id}>
                        <QuoteSummary quote={quote} entries={entries} cheapest={quote.quote_id === result.cheapest_quote_id} />
                        <dl>
                            {metrics.map(({ label, value, total }) => (
                                <div className={total ? "comparison-total" : undefined} key={label}>
                                    <dt>{label}</dt><dd><bdi>{value(quote)}</bdi></dd>
                                </div>
                            ))}
                        </dl>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export default function VenueComparison({ weddingId, entries, onClose }: {
    weddingId: number; entries: Entry[]; onClose: () => void;
}) {
    const [guests, setGuests] = useState("");
    const [selected, setSelected] = useState<number[]>([]);
    const [invalid, setInvalid] = useState<"guests" | "quotes" | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<Comparison | null>(null);
    const request = useRef<AbortController | null>(null);
    const title = useRef<HTMLHeadingElement>(null);
    const guestsField = useRef<HTMLInputElement>(null);
    const options = useRef<HTMLFieldSetElement>(null);
    const quoteCount = entries.reduce((count, entry) => count + entry.quotes.length, 0);

    useEffect(() => {
        title.current?.focus();
        return () => request.current?.abort();
    }, []);

    function invalidate() {
        request.current?.abort();
        request.current = null;
        setLoading(false);
        setResult(null);
        setError("");
        setInvalid(null);
    }

    function toggleQuote(id: number, checked: boolean) {
        invalidate();
        setSelected((current) => {
            if (!checked) return current.filter((quoteId) => quoteId !== id);
            if (current.length >= maxQuotes || current.includes(id)) return current;
            return [...current, id];
        });
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (request.current) return;
        invalidate();
        const expected = Number(guests);
        if (!/^\d+$/.test(guests) || !Number.isSafeInteger(expected) || expected < 1) {
            setInvalid("guests");
            guestsField.current?.focus();
            return;
        }
        if (selected.length < minQuotes || selected.length > maxQuotes) {
            setInvalid("quotes");
            options.current?.querySelector("input")?.focus();
            return;
        }
        const controller = new AbortController();
        request.current = controller;
        setLoading(true);
        try {
            const comparison = await venuesApi(weddingId).compare(expected, selected, controller.signal);
            if (!controller.signal.aborted) setResult(comparison);
        } catch (failure) {
            if (!controller.signal.aborted) setError(failure instanceof VenueApiError
                ? failure.message : "החיבור לשרת נכשל. בדקו את החיבור ונסו שוב.");
        } finally {
            if (!controller.signal.aborted) {
                request.current = null;
                setLoading(false);
            }
        }
    }

    return (
        <section className="venue-comparison ui-card" dir="rtl" aria-labelledby="comparison-title">
            <button type="button" className="ui-button ui-button--text" onClick={onClose}>חזרה לניהול אולמות</button>
            <h2 id="comparison-title" ref={title} tabIndex={-1}>השוואת אולמות</h2>
            {quoteCount < minQuotes ? <p role="status">יש לשמור לפחות שתי הצעות מחיר כדי להתחיל השוואה.</p> : (
                <form className="comparison-form" noValidate onSubmit={(event) => void submit(event)}>
                    <label className="ui-field">מספר אורחים צפוי
                        <input ref={guestsField} className="ui-input" name="expected_guests"
                            type="number" min="1" step="1" inputMode="numeric" required dir="ltr" value={guests}
                            aria-invalid={invalid === "guests"} aria-describedby={invalid === "guests" ? "comparison-guests-error" : undefined}
                            onChange={(event) => { invalidate(); setGuests(event.target.value); }} />
                    </label>
                    {invalid === "guests" && <p className="ui-error" id="comparison-guests-error" role="alert">הזינו מספר אורחים שלם וחיובי.</p>}
                    <fieldset ref={options} className="comparison-options" aria-describedby="comparison-selection">
                        <legend>בחרו בין 2 ל-4 הצעות מחיר</legend>
                        <p id="comparison-selection" role="status">נבחרו {selected.length} מתוך {maxQuotes}</p>
                        <div className="comparison-options-grid">
                            {entries.flatMap(({ venue, quotes }) => quotes.map((quote) => {
                                const checked = selected.includes(quote.id);
                                return <label className="comparison-option" key={quote.id}>
                                    <input type="checkbox" name="quote_ids" value={quote.id} checked={checked}
                                        disabled={!checked && selected.length >= maxQuotes}
                                        onChange={(event) => toggleQuote(quote.id, event.target.checked)} />
                                    <span><strong><bdi>{venue.name}</bdi></strong>
                                        <span>הצעה מס׳ <bdi>{quote.id}</bdi> · <bdi>{formatDate(quote.event_date)}</bdi></span>
                                    </span>
                                </label>;
                            }))}
                        </div>
                    </fieldset>
                    {invalid === "quotes" && <p className="ui-error" role="alert">בחרו בין 2 ל־4 הצעות שונות.</p>}
                    <button type="submit" className="ui-button" disabled={loading}>השוו הצעות</button>
                    {loading && <p className="ui-status ui-status--loading" role="status">מחשבים את עלויות ההצעות…</p>}
                    {error && <p className="ui-error" role="alert">{error}</p>}
                </form>
            )}
            {result && <ComparisonResults result={result} entries={entries} />}
        </section>
    );
}
