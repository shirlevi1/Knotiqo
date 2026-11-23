import { useEffect, useRef, useState } from "react";
import { formatVenueMoney, venuesApi, VenueApiError, venueStatuses, type Venue, type VenueQuote } from "./api/venues";
import { QuoteForm, VenueForm } from "./components/VenueForms";
import VenueGallery, { VenuePhoto } from "./components/VenueGallery";
import "./VenuesPage.css";

type Entry = { venue: Venue; quotes: VenueQuote[] };
type Editor = { kind: "venue"; venue?: Venue } | { kind: "quote"; venueId: number; quote?: VenueQuote };
type Removal = { venue: Venue; quote?: VenueQuote };

function message(error: unknown) {
    return error instanceof VenueApiError ? error.message : "לא הצלחנו להשלים את הבקשה. בדקו את החיבור ונסו שוב.";
}

function DeleteDialog({ removal, busy, error, onConfirm, onClose }: {
    removal: Removal; busy: boolean; error: string; onConfirm: () => void; onClose: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const opener = document.activeElement;
        dialog.current?.showModal();
        return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
    }, []);
    return (
        <dialog className="venue-delete-dialog ui-card" ref={dialog} dir="rtl"
            aria-labelledby="venue-delete-title" aria-describedby="venue-delete-description"
            onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
            <h2 id="venue-delete-title">{removal.quote ? "מחיקת הצעת מחיר" : "מחיקת אולם"}</h2>
            <p id="venue-delete-description">
                {removal.quote
                    ? `למחוק את הצעת המחיר של ${removal.venue.name}?`
                    : `למחוק את ${removal.venue.name}? מחיקת האולם תמחק גם את כל הצעות המחיר שלו. לא ניתן לשחזר את המחיקה.`}
            </p>
            {error && <p className="ui-error" role="alert">{error}</p>}
            <div className="venue-management-actions">
                <button className="ui-button ui-button--secondary" type="button" autoFocus disabled={busy} onClick={onClose}>ביטול</button>
                <button className="ui-button" type="button" disabled={busy} onClick={onConfirm}>{busy ? "מוחקים…" : "אישור מחיקה"}</button>
            </div>
        </dialog>
    );
}

export default function VenuesPage({ weddingId, weddingName }: { weddingId: number; weddingName: string }) {
    return <WeddingVenues key={weddingId} weddingId={weddingId} weddingName={weddingName} />;
}

function WeddingVenues({ weddingId, weddingName }: { weddingId: number; weddingName: string }) {
    const [rows, setRows] = useState<Entry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [attempt, setAttempt] = useState(0);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [editor, setEditor] = useState<Editor | null>(null);
    const [removal, setRemoval] = useState<Removal | null>(null);
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState("");
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const action = useRef<AbortController | null>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    const detailHeading = useRef<HTMLHeadingElement>(null);
    const api = venuesApi(weddingId);
    const selected = rows.find(({ venue }) => venue.id === selectedId);

    useEffect(() => {
        heading.current?.focus();
        return () => action.current?.abort();
    }, []);

    useEffect(() => {
        if (!editor && !removal) {
            (selectedId === null ? heading.current : detailHeading.current)?.focus();
        }
    }, [selectedId, editor, removal]);

    useEffect(() => {
        const controller = new AbortController();
        const scopedApi = venuesApi(weddingId);
        async function load() {
            setLoading(true);
            setError("");
            try {
                const venues = await scopedApi.list(controller.signal);
                const entries = await Promise.all(venues.map(async (venue) => ({
                    venue, quotes: await scopedApi.quotes(venue.id, controller.signal),
                })));
                if (!controller.signal.aborted) setRows(entries);
            } catch (failure) {
                if (!controller.signal.aborted) setError(message(failure));
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void load();
        return () => controller.abort();
    }, [weddingId, attempt]);

    async function mutate<T>(operation: (signal: AbortSignal) => Promise<T>, apply: (result: T) => void) {
        if (action.current) throw new VenueApiError("בקשה קודמת עדיין מתבצעת.");
        const controller = new AbortController();
        action.current = controller;
        setBusy(true);
        setError("");
        setSuccess("");
        try {
            const result = await operation(controller.signal);
            if (!controller.signal.aborted) apply(result);
        } finally {
            if (!controller.signal.aborted) { action.current = null; setBusy(false); }
        }
    }

    function closeEditor() {
        setEditor(null);
    }

    async function toggleFavorite(venue: Venue) {
        try {
            await mutate((signal) => api.save({ is_favorite: !venue.is_favorite }, signal, venue.id), (saved) => {
                setRows((current) => current.map((row) => row.venue.id === saved.id ? { ...row, venue: saved } : row));
                setSuccess(saved.is_favorite ? "האולם נוסף למועדפים." : "האולם הוסר מהמועדפים.");
            });
        } catch (failure) { if (!action.current?.signal.aborted) setError(message(failure)); }
    }

    async function confirmRemoval() {
        if (!removal) return;
        const { venue, quote } = removal;
        try {
            await mutate((signal) => quote ? api.removeQuote(venue.id, quote.id, signal) : api.remove(venue.id, signal), () => {
                setRows((current) => quote
                    ? current.map((row) => row.venue.id === venue.id ? { ...row, quotes: row.quotes.filter(({ id }) => id !== quote.id) } : row)
                    : current.filter((row) => row.venue.id !== venue.id));
                if (!quote) setSelectedId(null);
                setRemoval(null);
                setSuccess(quote ? "הצעת המחיר נמחקה." : "האולם והצעות המחיר שלו נמחקו.");
            });
        } catch (failure) { setError(message(failure)); }
    }

    const filtered = rows.filter(({ venue }) => (!status || venue.status === status)
        && (!favoritesOnly || venue.is_favorite)
        && `${venue.name} ${venue.location}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

    return (
        <section className="venues-page" dir="rtl" aria-labelledby="venues-title">
            <a className="ui-button ui-button--text" href="#workspace">חזרה למרחב החתונה</a>
            <header className="venues-page-header ui-card">
                <p className="eyebrow">אולמות וגני אירועים · <bdi>{weddingName}</bdi></p>
                <h1 id="venues-title" ref={heading} tabIndex={-1}>המקום שבו הסיפור שלכם מתחיל.</h1>
                <p>האולמות, הפגישות והצעות המחיר שלכם, במקום אחד.</p>
            </header>
            {success && <p className="ui-panel ui-state ui-status" role="status">{success}</p>}
            {error && !removal && <p className="ui-error" role="alert">{error}</p>}
            <div className="venue-management-actions">
                <button className="ui-button" type="button" disabled={busy || loading} onClick={() => {
                    setEditor({ kind: "venue" }); setSuccess("");
                }}>הוספת אולם</button>
                <button className="ui-button ui-button--secondary" type="button" disabled={busy || loading}
                    onClick={() => { closeEditor(); setAttempt((value) => value + 1); }}>רענון הרשימה</button>
            </div>

            {loading ? <p className="ui-status ui-status--loading" role="status">טוענים אולמות והצעות מחיר…</p> : (
                <>
                    {editor?.kind === "venue" && <VenueForm key={`venue-${editor.venue?.id ?? "new"}`} initial={editor.venue}
                        onCancel={closeEditor} onSave={async (input) => {
                            await mutate((signal) => api.save(input, signal, editor.venue?.id), (saved) => {
                                setRows((current) => editor.venue
                                    ? current.map((row) => row.venue.id === saved.id ? { ...row, venue: saved } : row)
                                    : [...current, { venue: saved, quotes: [] }]);
                                closeEditor(); setSuccess("פרטי האולם נשמרו.");
                            });
                        }} />}

                    {selected && !editor ? (
                        <section className="venue-detail ui-card" aria-labelledby="venue-detail-title">
                            <button className="ui-button ui-button--text" type="button" disabled={busy} onClick={() => setSelectedId(null)}>חזרה לאולמות</button>
                            <h2 id="venue-detail-title" ref={detailHeading} tabIndex={-1}><bdi>{selected.venue.name}</bdi></h2>
                            <dl className="venue-management-facts">
                                <dt>מיקום</dt><dd>{selected.venue.location || "לא הוזן"}</dd>
                                <dt>סטטוס</dt><dd>{venueStatuses[selected.venue.status]}</dd>
                                <dt>קיבולת</dt><dd>{selected.venue.capacity ?? "לא הוזנה"}</dd>
                                <dt>איש או אשת קשר</dt><dd>{selected.venue.contact_name || "לא הוזן"}</dd>
                                <dt>טלפון</dt><dd><bdi>{selected.venue.phone || "לא הוזן"}</bdi></dd>
                                <dt>אתר</dt><dd><bdi>{selected.venue.website || "לא הוזן"}</bdi></dd>
                            </dl>
                            {selected.venue.description && <p className="venue-notes">{selected.venue.description}</p>}
                            {selected.venue.notes && <p className="venue-notes">{selected.venue.notes}</p>}
                            <VenueGallery key={selected.venue.id} weddingId={weddingId} venue={selected.venue}
                                onUpdate={(venue) => setRows((current) => current.map((row) =>
                                    row.venue.id === venue.id ? { ...row, venue } : row))} />
                            <h3>הצעות מחיר</h3>
                            <button className="ui-button" type="button" disabled={busy} onClick={() => {
                                setEditor({ kind: "quote", venueId: selected.venue.id });
                            }}>הוספת הצעת מחיר</button>
                            {!selected.quotes.length && <p>עדיין אין הצעות מחיר לאולם הזה.</p>}
                            <ul className="venue-quote-list">
                                {selected.quotes.map((quote) => (
                                    <li className="ui-panel" key={quote.id}>
                                        <dl className="venue-management-facts">
                                            <dt>תאריך האירוע</dt><dd>{quote.event_date ? new Intl.DateTimeFormat("he-IL").format(new Date(`${quote.event_date}T00:00:00`)) : "טרם נקבע"}</dd>
                                            <dt>מחיר לאורח</dt><dd><bdi>{formatVenueMoney(quote.price_per_guest)}</bdi></dd>
                                            <dt>מינימום אורחים</dt><dd>{quote.minimum_guests}</dd>
                                            <dt>עלויות נוספות</dt><dd><bdi>{formatVenueMoney(quote.additional_costs)}</bdi></dd>
                                        </dl>
                                        {quote.notes && <p className="venue-notes">{quote.notes}</p>}
                                        <div className="venue-management-actions">
                                            <button className="ui-button ui-button--secondary" type="button" disabled={busy} onClick={() => {
                                                setEditor({ kind: "quote", venueId: selected.venue.id, quote });
                                            }}>עריכת הצעה</button>
                                            <button className="ui-button ui-button--text" type="button" disabled={busy}
                                                onClick={() => { setError(""); setRemoval({ venue: selected.venue, quote }); }}>מחיקת הצעה</button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ) : !editor && (
                        <>
                            <div className="venue-management-filters ui-panel">
                                <label>חיפוש לפי שם או מיקום<input className="ui-input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
                                <label>סינון לפי סטטוס<select className="ui-input" value={status} onChange={(event) => setStatus(event.target.value)}>
                                    <option value="">כל הסטטוסים</option>
                                    {Object.entries(venueStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </select></label>
                                <label className="venue-checkbox"><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />מועדפים בלבד</label>
                            </div>
                            {!filtered.length && <div className="ui-card ui-state">
                                <h2>{rows.length ? "לא נמצאו אולמות התואמים לחיפוש" : "רשימת האולמות שלכם מתחילה כאן"}</h2>
                                <p>{rows.length ? "נסו לשנות את החיפוש או הסינון." : "הוסיפו אולם כדי לשמור פרטים והצעות מחיר ולתכנן יחד."}</p>
                            </div>}
                            <ul className="venue-management-cards">
                                {filtered.map(({ venue, quotes }) => {
                                    const cover = venue.images.find((image) => image.is_primary) ?? venue.images[0];
                                    return (
                                    <li className="ui-card" key={venue.id}>
                                        <div className="venue-card-cover"><VenuePhoto url={cover?.image_url} alt={cover?.alt_text} /></div>
                                        <p className="eyebrow">{venueStatuses[venue.status]}</p>
                                        <h2><bdi>{venue.name}</bdi></h2>
                                        {venue.location && <p>{venue.location}</p>}
                                        {venue.capacity !== null && <p>קיבולת · {venue.capacity.toLocaleString("he-IL")} אורחים</p>}
                                        {quotes.length > 0 && <p>הצעה אחרונה · <bdi>{formatVenueMoney(quotes.at(-1)!.price_per_guest)}</bdi> לאורח</p>}
                                        <div className="venue-management-actions">
                                            <button className="ui-button ui-button--secondary" type="button" disabled={busy}
                                                aria-pressed={venue.is_favorite} aria-label={`מועדף: ${venue.name}`}
                                                onClick={() => void toggleFavorite(venue)}>{venue.is_favorite ? "♥ מועדף" : "♡ הוספה למועדפים"}</button>
                                            <button className="ui-button" type="button" disabled={busy} onClick={() => setSelectedId(venue.id)}>פרטים והצעות מחיר</button>
                                            <button className="ui-button ui-button--text" type="button" disabled={busy} onClick={() => {
                                                setEditor({ kind: "venue", venue });
                                            }}>עריכת אולם</button>
                                            <button className="ui-button ui-button--text" type="button" disabled={busy}
                                                onClick={() => { setError(""); setRemoval({ venue }); }}>מחיקת אולם</button>
                                        </div>
                                    </li>
                                    );
                                })}
                            </ul>
                        </>
                    )}
                    {editor?.kind === "quote" && <QuoteForm key={`quote-${editor.venueId}-${editor.quote?.id ?? "new"}`}
                        initial={editor.quote} onCancel={closeEditor} onSave={async (input) => {
                            await mutate((signal) => api.saveQuote(editor.venueId, input, signal, editor.quote?.id), (saved) => {
                                setRows((current) => current.map((row) => row.venue.id === editor.venueId ? {
                                    ...row, quotes: editor.quote
                                        ? row.quotes.map((quote) => quote.id === saved.id ? saved : quote)
                                        : [...row.quotes, saved],
                                } : row));
                                closeEditor(); setSuccess("הצעת המחיר נשמרה.");
                            });
                        }} />}
                </>
            )}
            {removal && <DeleteDialog removal={removal} busy={busy} error={error} onClose={() => { setRemoval(null); setError(""); }}
                onConfirm={() => void confirmRemoval()} />}
        </section>
    );
}
