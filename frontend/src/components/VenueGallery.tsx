import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { venuesApi, VenueApiError, type Venue, type VenueImage, type VenuePreview } from "../api/venues";

const selectionLimit = 20;
const expiredMessage = "תוקף התצוגה המקדימה פג. בקשו תצוגה חדשה ובחרו שוב תמונות.";

export function VenuePhoto({ url, alt = "" }: { url?: string; alt?: string }) {
    return <Photo key={url} url={url} alt={alt} />;
}

function Photo({ url, alt }: { url?: string; alt: string }) {
    const [failed, setFailed] = useState(false);
    return (
        <span className="venue-photo">
            {url && !failed
                ? <img src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer"
                    onError={() => setFailed(true)} />
                : <span className="venue-photo-placeholder">{failed ? "התמונה אינה זמינה" : "עדיין אין תמונות"}</span>}
        </span>
    );
}

function ImageRemoval({ busy, error, fallbackFocus, onClose, onConfirm }: {
    busy: boolean; error: string; fallbackFocus: RefObject<HTMLHeadingElement | null>;
    onClose: () => void; onConfirm: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const title = useId();

    useEffect(() => {
        const opener = document.activeElement;
        const heading = fallbackFocus.current;
        dialog.current?.showModal();
        return () => {
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
            else if (heading?.isConnected) heading.focus();
        };
    }, [fallbackFocus]);

    return (
        <dialog ref={dialog} className="venue-delete-dialog ui-card" aria-labelledby={title}
            aria-describedby={`${title}-description`}
            onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
            <h2 id={title}>מחיקת תמונה</h2>
            <p id={`${title}-description`}>להסיר את התמונה מגלריית האולם?</p>
            {error && <p className="ui-error" role="alert">{error}</p>}
            <div className="venue-management-actions">
                <button className="ui-button ui-button--secondary" type="button" autoFocus disabled={busy} onClick={onClose}>ביטול</button>
                <button className="ui-button" type="button" disabled={busy} onClick={onConfirm}>
                    {busy ? "מוחקים…" : "אישור מחיקה"}
                </button>
            </div>
        </dialog>
    );
}

export default function VenueGallery({ weddingId, venue, onUpdate }: {
    weddingId: number; venue: Venue; onUpdate: (venue: Venue) => void;
}) {
    const [open, setOpen] = useState(false);
    const [website, setWebsite] = useState(venue.website);
    const [preview, setPreview] = useState<(VenuePreview & { expiresAt: number }) | null>(null);
    const [selected, setSelected] = useState<string[]>([]);
    const [used, setUsed] = useState<string[]>([]);
    const [removal, setRemoval] = useState<VenueImage | null>(null);
    const [busy, setBusy] = useState<"preview" | "save" | "delete" | null>(null);
    const [error, setError] = useState("");
    const [status, setStatus] = useState("");
    const inFlight = useRef<AbortController | null>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    const panelId = useId();
    const api = venuesApi(weddingId);

    useEffect(() => () => inFlight.current?.abort(), []);
    useEffect(() => {
        if (!preview) return;
        const timer = window.setTimeout(() => {
            setPreview(null);
            setSelected([]);
            if (!inFlight.current) setError(expiredMessage);
        }, Math.max(0, preview.expiresAt - Date.now()));
        return () => window.clearTimeout(timer);
    }, [preview]);

    async function run(kind: NonNullable<typeof busy>, operation: (signal: AbortSignal) => Promise<void>) {
        if (inFlight.current) return;
        const controller = new AbortController();
        inFlight.current = controller;
        setBusy(kind);
        setError("");
        setStatus("");
        try {
            await operation(controller.signal);
        } catch (failure) {
            if (controller.signal.aborted) return;
            if (failure instanceof VenueApiError && ["invalid_preview", "unverified_image"].includes(failure.code ?? "")) {
                setPreview(null);
                setSelected([]);
            }
            setError(failure instanceof VenueApiError ? failure.message : "החיבור לשרת נכשל. בדקו את החיבור ונסו שוב.");
        } finally {
            if (!controller.signal.aborted) {
                inFlight.current = null;
                setBusy(null);
            }
        }
    }

    function requestPreview(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const url = website.trim();
        void run("preview", async (signal) => {
            setPreview(null);
            setSelected([]);
            setUsed([]);
            const result = await api.preview(venue.id, url === venue.website ? undefined : url, signal);
            if (!signal.aborted) setPreview({ ...result, expiresAt: Date.now() + result.expires_in * 1000 });
        });
    }

    async function refresh(images: VenueImage[], message: string, signal: AbortSignal) {
        if (signal.aborted) return;
        onUpdate({ ...venue, images });
        setStatus(message);
        try {
            const updated = await api.detail(venue.id, signal);
            if (!signal.aborted) onUpdate(updated);
        } catch {
            if (!signal.aborted) setStatus(`${message} רענון פרטי האולם נכשל. אפשר לרענן את הרשימה.`);
        }
    }

    function saveSelection() {
        if (!preview || !selected.length) return;
        void run("save", async (signal) => {
            if (Date.now() >= preview.expiresAt) throw new VenueApiError(expiredMessage, [], "invalid_preview");
            const saved = await api.saveImages(venue.id, preview.preview_token, selected, signal);
            if (signal.aborted) return;
            setUsed((previous) => [...previous, ...selected]);
            setSelected([]);
            await refresh(saved, "התמונות נשמרו בגלריית האולם.", signal);
        });
    }

    function deleteImage() {
        if (!removal) return;
        void run("delete", async (signal) => {
            await api.removeImage(venue.id, removal.id, signal);
            if (signal.aborted) return;
            setRemoval(null);
            await refresh(venue.images.filter(({ id }) => id !== removal.id), "התמונה הוסרה מהגלריה.", signal);
        });
    }

    const unavailable = new Set([...venue.images.map(({ image_url }) => image_url), ...used]);
    const metadata = preview?.metadata;
    const details = metadata && [
        ["שם", metadata.name], ["תיאור", metadata.description], ["כתובת", metadata.address], ["טלפון", metadata.phone],
    ].filter(([, value]) => value);

    return (
        <section className="venue-media" aria-label="תמונות האולם">
            <div className="venue-media-heading">
                <h3 ref={heading} tabIndex={-1}>גלריית האולם</h3>
                <button className="ui-button ui-button--secondary" type="button" disabled={busy !== null}
                    aria-expanded={open} aria-controls={panelId} onClick={() => {
                        setOpen(!open);
                        setError("");
                    }}>ייבוא פרטים ותמונות</button>
            </div>
            {status && <p className="ui-status" role="status">{status}</p>}
            {error && !removal && <p className="ui-error" role="alert">{error}</p>}
            {venue.images.length > 0
                ? <ul className="venue-gallery">
                    {venue.images.map((image, index) => (
                        <li key={image.id}>
                            <VenuePhoto url={image.image_url} alt={image.alt_text || `תמונת אולם ${index + 1}`} />
                            <div className="venue-gallery-caption">
                                {image.is_primary && <span>תמונה ראשית</span>}
                                <button className="ui-button ui-button--text" type="button" disabled={busy !== null}
                                    aria-label={`מחיקת תמונה ${index + 1}`}
                                    onClick={() => { setError(""); setRemoval(image); }}>מחיקת תמונה</button>
                            </div>
                        </li>
                    ))}
                </ul>
                : <div className="venue-gallery-empty"><VenuePhoto /></div>}

            <div id={panelId} hidden={!open}>
                <div className="venue-import ui-panel">
                    <form className="venue-import-form" onSubmit={requestPreview}>
                        <label className="ui-field">כתובת אתר האולם
                            <input className="ui-input" type="url" name="website" dir="ltr" value={website} required
                                disabled={busy !== null} onChange={(event) => {
                                    setWebsite(event.target.value);
                                    setPreview(null);
                                    setSelected([]);
                                    setError("");
                                }} />
                        </label>
                        <button className="ui-button" type="submit" disabled={busy !== null}>
                            {busy === "preview" ? "טוענים תצוגה מקדימה…" : "תצוגה מקדימה"}
                        </button>
                    </form>
                    {metadata && <>
                        <h4>תצוגה מקדימה מהאתר</h4>
                        <p>פרטי האולם לא ישתנו. רק התמונות שתבחרו יישמרו.</p>
                        {details && details.length > 0 && <dl className="venue-management-facts">
                            {details.map(([label, value]) => <div className="venue-preview-fact" key={label}>
                                <dt>{label}</dt><dd><bdi>{value}</bdi></dd>
                            </div>)}
                        </dl>}
                        {metadata.images.length ? <fieldset className="venue-candidates">
                            <legend>בחירת תמונות לגלריה</legend>
                            <p role="status">נבחרו {selected.length} מתוך {selectionLimit}</p>
                            <div className="venue-gallery">
                                {metadata.images.map((image, index) => {
                                    const checked = selected.includes(image.image_url);
                                    const disabled = unavailable.has(image.image_url);
                                    return <label className="venue-candidate" key={image.image_url}>
                                        <VenuePhoto url={image.image_url} />
                                        <span className="venue-gallery-caption">
                                            <input type="checkbox" checked={checked}
                                                disabled={busy !== null || disabled || (!checked && selected.length >= selectionLimit)}
                                                onChange={(event) => {
                                                    const select = event.target.checked;
                                                    setSelected((current) => select
                                                        ? current.length < selectionLimit ? [...current, image.image_url] : current
                                                        : current.filter((url) => url !== image.image_url));
                                                }} />
                                            <span>{image.alt_text || `תמונה ${index + 1}`}{disabled && " · כבר נבחרה או נשמרה"}</span>
                                        </span>
                                    </label>;
                                })}
                            </div>
                            <button className="ui-button" type="button" disabled={busy !== null || !selected.length}
                                onClick={saveSelection}>{busy === "save" ? "שומרים תמונות…" : "שמירת התמונות שנבחרו"}</button>
                        </fieldset> : <p>לא נמצאו באתר תמונות לייבוא.</p>}
                    </>}
                </div>
            </div>
            {removal && <ImageRemoval busy={busy !== null} error={error} fallbackFocus={heading} onConfirm={deleteImage}
                onClose={() => { setRemoval(null); setError(""); }} />}
        </section>
    );
}
