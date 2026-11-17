import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import "./VenueSection.css";

type VenueDraft = {
    name: string;
    location: string;
    price: number | null;
    capacity: number | null;
    imageUrl: string;
};

type Venue = VenueDraft & { id: number };

const currency = new Intl.NumberFormat("he-IL", {
    style: "currency", currency: "ILS", minimumFractionDigits: 0, maximumFractionDigits: 2,
});
const number = new Intl.NumberFormat("he-IL");
const facts = [
    { label: "מיקום", value: (venue: Venue) => venue.location },
    { label: "מחיר לאורח", value: (venue: Venue) => venue.price === null ? "" : currency.format(venue.price) },
    { label: "קיבולת", value: (venue: Venue) => venue.capacity === null ? "" : `${number.format(venue.capacity)} אורחים` },
];

function VenueFacts({ venue, showMissing = false }: { venue: Venue; showMissing?: boolean }) {
    return (
        <dl className="venue-facts">
            {facts.map(({ label, value }) => {
                const detail = value(venue);
                return (detail || showMissing) && (
                    <div key={label}>
                        <dt>{label}</dt>
                        <dd><bdi>{detail || "לא הוזן"}</bdi></dd>
                    </div>
                );
            })}
        </dl>
    );
}

function VenueEditor({ venue, onSave, onCancel }: {
    venue?: Venue; onSave: (draft: VenueDraft) => void; onCancel: () => void;
}) {
    const id = useId();
    const nameInput = useRef<HTMLInputElement>(null);
    const [error, setError] = useState("");

    useEffect(() => nameInput.current?.focus(), []);

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const read = (field: string) => String(data.get(field) ?? "").trim();
        const name = read("name");
        const price = read("price");
        const capacity = read("capacity");
        const imageUrl = read("image");

        if (!name) {
            setError("יש להזין את שם האולם.");
            nameInput.current?.focus();
            return;
        }
        if (price && !/^\d{1,10}(?:\.\d{1,2})?$/.test(price)) {
            setError("יש להזין מחיר לא שלילי עם עד שתי ספרות אחרי הנקודה.");
            return;
        }
        if (capacity && (!/^\d+$/.test(capacity) || !Number.isSafeInteger(Number(capacity)) || Number(capacity) < 1)) {
            setError("יש להזין קיבולת כמספר שלם וחיובי.");
            return;
        }
        if (imageUrl) {
            const url = URL.parse(imageUrl);
            if (!url || url.protocol !== "https:" || url.username || url.password) {
                setError("יש להזין כתובת HTTPS ישירה של תמונה.");
                return;
            }
        }
        onSave({
            name, location: read("location"), imageUrl,
            price: price ? Number(price) : null,
            capacity: capacity ? Number(capacity) : null,
        });
    }

    return (
        <form className="venue-editor ui-card" aria-labelledby={`${id}-title`} onSubmit={submit}>
            <h4 id={`${id}-title`}>{venue ? "עריכת אולם" : "הוספת אולם"}</h4>
            <p>רק שם האולם נדרש. אפשר להשלים פרטים כשתקבלו אותם.</p>
            <div className="venue-editor-fields">
                <label className="ui-field"><span className="ui-field-label">שם האולם</span><input className="ui-input" ref={nameInput} name="name" defaultValue={venue?.name} required maxLength={150} /></label>
                <label className="ui-field"><span className="ui-field-label">מיקום</span><input className="ui-input" name="location" defaultValue={venue?.location} maxLength={150} /></label>
                <label className="ui-field"><span className="ui-field-label">מחיר לאורח (₪)</span><input className="ui-input" name="price" dir="ltr" inputMode="decimal" defaultValue={venue?.price ?? ""} /></label>
                <label className="ui-field"><span className="ui-field-label">קיבולת</span><input className="ui-input" name="capacity" dir="ltr" inputMode="numeric" defaultValue={venue?.capacity ?? ""} /></label>
                <label className="venue-editor-image ui-field"><span className="ui-field-label">קישור לתמונה</span><input className="ui-input" name="image" dir="ltr" type="url" defaultValue={venue?.imageUrl} /></label>
            </div>
            {error && <p className="ui-error" role="alert">{error}</p>}
            <div className="venue-actions">
                <button className="ui-button" type="submit">שמירה ברשימה הזמנית</button>
                <button className="ui-button ui-button--text" type="button" onClick={onCancel}>ביטול</button>
            </div>
        </form>
    );
}

function VenuePhoto({ venue }: { venue: Venue }) {
    const [failed, setFailed] = useState(false);
    if (!venue.imageUrl || failed) return null;
    return (
        <img className="venue-photo" src={venue.imageUrl} alt={`תמונה של ${venue.name}`}
            loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    );
}

function VenueComparison({ venues, id }: { venues: Venue[]; id: string }) {
    return (
        <section className="venue-comparison" id={id} aria-labelledby={`${id}-title`}>
            <h4 id={`${id}-title`}>השוואת אולמות</h4>
            <table className="venue-comparison-table" aria-labelledby={`${id}-title`}>
                <thead>
                    <tr>
                        <th scope="col">פרט להשוואה</th>
                        {venues.map((venue) => <th key={venue.id} scope="col"><bdi>{venue.name}</bdi></th>)}
                    </tr>
                </thead>
                <tbody>
                    {facts.map(({ label, value }) => (
                        <tr key={label}>
                            <th scope="row">{label}</th>
                            {venues.map((venue) => <td key={venue.id}><bdi>{value(venue) || "לא הוזן"}</bdi></td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
            <ul className="venue-comparison-cards">
                {venues.map((venue) => (
                    <li className="ui-panel" key={venue.id}>
                        <h5><bdi>{venue.name}</bdi></h5>
                        <VenueFacts venue={venue} showMissing />
                    </li>
                ))}
            </ul>
        </section>
    );
}

export default function VenueSection() {
    const id = useId();
    const nextId = useRef(0);
    const opener = useRef<HTMLButtonElement>(null);
    // Drafts are scoped to this mounted wedding card until a shared venue API exists.
    const [venues, setVenues] = useState<Venue[]>([]);
    const [selection, setSelection] = useState<number[]>([]);
    const [editor, setEditor] = useState<Venue | "new" | null>(null);
    const compared = selection.flatMap((venueId) => venues.filter((venue) => venue.id === venueId));

    function closeEditor() {
        setEditor(null);
        opener.current?.focus();
    }

    function save(draft: VenueDraft) {
        if (editor === "new") {
            const venue = { ...draft, id: ++nextId.current };
            setVenues((previous) => [...previous, venue]);
        } else if (editor) {
            setVenues((previous) => previous.map((venue) => venue.id === editor.id ? { ...draft, id: venue.id } : venue));
        }
        closeEditor();
    }

    function toggleSelection(venueId: number) {
        setSelection((previous) => previous.includes(venueId)
            ? previous.filter((selected) => selected !== venueId)
            : previous.length < 3 ? [...previous, venueId] : previous);
    }

    function remove(venueId: number) {
        setVenues((previous) => previous.filter((venue) => venue.id !== venueId));
        setSelection((previous) => previous.filter((selected) => selected !== venueId));
        if (editor && editor !== "new" && editor.id === venueId) setEditor(null);
        opener.current?.focus();
    }

    return (
        <section className="venue-section ui-panel" dir="rtl" aria-labelledby={`${id}-title`}>
            <div className="venue-hero">
                <div className="venue-hero-copy">
                    <p className="eyebrow">אולמות וגני אירועים</p>
                    <h4 id={`${id}-title`}>המקום שבו<br /><span>הכול מתחיל</span></h4>
                    <p>אספו את המקומות שאהבתם והשוו ביניהם לפי מה שחשוב לכם.</p>
                    <button ref={opener} className="ui-button" type="button" onClick={() => setEditor("new")}>
                        הוספת אולם
                    </button>
                </div>
                <figure>
                    <img src="/images/venues-pearl-blue.jpg" width="1536" height="1024" loading="lazy"
                        alt="אולם מואר עם חלונות מקושתים, שולחנות לבנים ונגיעות של כחול מעושן" />
                    <figcaption>תמונת השראה</figcaption>
                </figure>
            </div>

            <div className="venue-board">
                <header className="venue-board-header">
                    <div>
                        <h4>האולמות שלכם</h4>
                        <p>רשימה זמנית, הזמינה רק לכם ועד לרענון העמוד.</p>
                    </div>
                    {compared.length >= 2 && <a className="ui-button ui-button--secondary" href={`#${id}-compare`}>להשוואה ↓</a>}
                </header>

                {editor && (
                    <VenueEditor key={editor === "new" ? editor : editor.id} venue={editor === "new" ? undefined : editor}
                        onSave={save} onCancel={closeEditor} />
                )}

                {venues.length === 0 ? (
                    <div className="venue-empty ui-card ui-state">
                        <p><strong>עדיין אין אולמות ברשימה</strong></p>
                        <p>מצאתם מקום שמעניין אתכם? הוסיפו את שמו ואת הפרטים שכבר ידועים לכם.</p>
                    </div>
                ) : (
                    <>
                        <p className="venue-selection ui-status" role="status">
                            {selection.length === 3
                                ? "נבחרו 3 אולמות. בטלו בחירה כדי להוסיף אולם אחר להשוואה."
                                : `נבחרו ${selection.length} מתוך 3. בחרו לפחות שני אולמות להשוואה.`}
                        </p>
                        <ul className="venue-cards">
                            {venues.map((venue) => {
                                const selected = selection.includes(venue.id);
                                return (
                                    <li key={venue.id} className="venue-card ui-card">
                                        <VenuePhoto key={venue.imageUrl} venue={venue} />
                                        <div className="venue-card-body">
                                            <h5><bdi>{venue.name}</bdi></h5>
                                            <VenueFacts venue={venue} />
                                            <div className="venue-actions">
                                                <button className="ui-button ui-button--secondary venue-select" type="button"
                                                    aria-pressed={selected} aria-label={`השוואת ${venue.name}`}
                                                    disabled={!selected && selection.length >= 3}
                                                    onClick={() => toggleSelection(venue.id)}>
                                                    {selected ? "נבחר להשוואה" : "לבחירה להשוואה"}
                                                </button>
                                                <button className="ui-button ui-button--text" type="button" aria-label={`עריכת ${venue.name}`}
                                                    onClick={() => setEditor(venue)}>עריכה</button>
                                                <button className="ui-button ui-button--text" type="button" aria-label={`הסרת ${venue.name}`}
                                                    onClick={() => remove(venue.id)}>הסרה</button>
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </>
                )}

                {compared.length >= 2 && <VenueComparison venues={compared} id={`${id}-compare`} />}
            </div>
        </section>
    );
}
