import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { updateWeddingCover, WeddingApiError } from "../api/weddings";

export default function WeddingCoverEditor({ weddingId, hasCover, onSaved }: {
    weddingId: number; hasCover: boolean; onSaved: (url: string | null) => void;
}) {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState("");

    return <>
        <button className="workspace-cover-trigger" type="button" aria-haspopup="dialog"
            onClick={() => { setStatus(""); setOpen(true); }}>שינוי תמונת רקע</button>
        <span className="workspace-cover-status" role="status">{status}</span>
        {open && <CoverDialog weddingId={weddingId} hasCover={hasCover} onClose={() => setOpen(false)} onSaved={(url) => {
            onSaved(url);
            setStatus(url ? "תמונת הרקע נשמרה." : "תמונת ברירת המחדל הוחזרה.");
            setOpen(false);
        }} />}
    </>;
}

function CoverDialog({ weddingId, hasCover, onClose, onSaved }: {
    weddingId: number; hasCover: boolean; onClose: () => void; onSaved: (url: string | null) => void;
}) {
    const titleId = useId();
    const dialog = useRef<HTMLDialogElement>(null);
    const request = useRef<AbortController | null>(null);
    const [selection, setSelection] = useState<{ file: File; url: string } | null>(null);
    const [previewFailed, setPreviewFailed] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        const opener = document.activeElement;
        dialog.current?.showModal();
        return () => {
            request.current?.abort();
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        };
    }, []);
    useEffect(() => () => {
        if (selection) URL.revokeObjectURL(selection.url);
    }, [selection]);

    function choose(file?: File) {
        setSelection(null);
        setPreviewFailed(false);
        setError("");
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            setError("אפשר להעלות תמונה בגודל של עד 5 MB.");
        } else if (file.type && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            setError("בחרו תמונה בפורמט JPEG, PNG או WebP.");
        } else {
            setSelection({ file, url: URL.createObjectURL(file) });
        }
    }

    async function save(event: FormEvent) {
        event.preventDefault();
        const file = confirming ? null : selection?.file;
        if (request.current || file === undefined || (!confirming && previewFailed)) return;
        const controller = new AbortController();
        request.current = controller;
        setBusy(true);
        setError("");
        try {
            const url = await updateWeddingCover(weddingId, file, controller.signal);
            if (!controller.signal.aborted) onSaved(url);
        } catch (failure) {
            if (!controller.signal.aborted) setError(failure instanceof WeddingApiError
                ? failure.message : "לא ניתן לעדכן את התמונה. בדקו את החיבור ונסו שוב.");
        } finally {
            if (!controller.signal.aborted) {
                request.current = null;
                setBusy(false);
            }
        }
    }

    return <dialog className="workspace-cover-dialog ui-card" ref={dialog} dir="rtl" aria-labelledby={titleId}
        onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
        <h2 id={titleId}>{confirming ? "חזרה לתמונת ברירת המחדל" : "שינוי תמונת רקע"}</h2>
        <form onSubmit={(event) => void save(event)} aria-busy={busy}>
            {confirming ? <p>להסיר את התמונה האישית מהמרחב המשותף?</p> : <>
                <label className="ui-field">בחירת תמונה
                    <input className="ui-input" type="file" accept="image/jpeg,image/png,image/webp"
                        autoFocus disabled={busy} onChange={(event) => choose(event.target.files?.[0])} />
                </label>
                <p className="workspace-cover-hint">JPEG, PNG או WebP, עד 5 MB. התמונה משותפת לחברי החתונה.</p>
                {selection && !previewFailed && <img className="workspace-cover-preview" src={selection.url}
                    alt="תצוגה מקדימה של תמונת הרקע"
                    onError={() => { setPreviewFailed(true); setError("לא הצלחנו להציג את התמונה. בחרו קובץ תמונה תקין."); }} />}
            </>}
            {error && <p className="ui-error" role="alert">{error}</p>}
            {busy && <p className="ui-status" role="status">{confirming ? "מסירים תמונה…" : "שומרים תמונה…"}</p>}
            <div className="workspace-cover-actions">
                <button className="ui-button" type="submit" disabled={busy || (!confirming && (!selection || previewFailed))}>
                    {confirming ? "אישור הסרה" : "שמירת תמונה"}
                </button>
                <button className="ui-button ui-button--secondary" type="button" disabled={busy}
                    onClick={() => {
                        if (confirming) { setConfirming(false); setError(""); }
                        else onClose();
                    }}>{confirming ? "ביטול הסרה" : "ביטול"}</button>
                {hasCover && !confirming && <button className="ui-button ui-button--text" type="button" disabled={busy}
                    onClick={() => { setConfirming(true); setSelection(null); setError(""); }}>חזרה לתמונת ברירת המחדל</button>}
            </div>
        </form>
    </dialog>;
}
