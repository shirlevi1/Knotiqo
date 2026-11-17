import { useEffect, useRef, useState, type FormEvent } from "react";
import {
    readCoupleNames, updateCoupleNames, validateCoupleNames, WeddingApiError,
    type CoupleNames, type WeddingFieldErrors,
} from "../api/weddings";
import CoupleNameFields from "./CoupleNameFields";

export default function CoupleNamesEditor({ weddingId, names, onSaved }: {
    weddingId: number;
    names: CoupleNames;
    onSaved: (names: CoupleNames) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");
    const [fields, setFields] = useState<WeddingFieldErrors>({});
    const button = useRef<HTMLButtonElement>(null);
    const request = useRef<AbortController | null>(null);
    useEffect(() => () => request.current?.abort(), []);

    function close() {
        setEditing(false);
        setError("");
        setFields({});
        button.current?.focus();
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (request.current) return;
        const input = readCoupleNames(new FormData(event.currentTarget));
        const errors = validateCoupleNames(input);
        setFields(errors);
        setError("");
        if (Object.keys(errors).length) return;

        const controller = new AbortController();
        request.current = controller;
        setPending(true);
        try {
            const saved = await updateCoupleNames(weddingId, input, controller.signal);
            if (!controller.signal.aborted) {
                onSaved(saved);
                close();
            }
        } catch (failure) {
            if (!controller.signal.aborted) {
                setError(failure instanceof WeddingApiError ? failure.message : "לא הצלחנו לשמור את השמות. בדקו את החיבור ונסו שוב.");
                if (failure instanceof WeddingApiError) setFields(failure.fields);
            }
        } finally {
            request.current = null;
            if (!controller.signal.aborted) setPending(false);
        }
    }

    const hasBothNames = names.creator_display_name.trim() && names.partner_display_name.trim();
    return (
        <div className="couple-name-editor">
            <button className="ui-button ui-button--secondary" type="button" ref={button}
                aria-expanded={editing} disabled={pending} onClick={() => editing ? close() : setEditing(true)}>
                {hasBothNames ? "עריכת שמות הזוג" : "השלמת שמות הזוג"}
            </button>
            {editing && (
                <form className="ui-panel couple-name-form" onSubmit={submit} aria-busy={pending}>
                    <fieldset className="ui-fieldset" disabled={pending}>
                        <CoupleNameFields names={names} errors={fields} />
                        {error && <p className="ui-error" role="alert">{error}</p>}
                        <div className="couple-name-actions">
                            <button className="ui-button" type="submit">{pending ? "שומרים…" : "שמירת השמות"}</button>
                            <button className="ui-button ui-button--text" type="button" onClick={close}>ביטול</button>
                        </div>
                    </fieldset>
                </form>
            )}
        </div>
    );
}
