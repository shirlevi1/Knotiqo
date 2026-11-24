import { useEffect, useRef, useState, type FormEvent } from "react";
import { accountProfile, changePassword, type Profile } from "../api/accountSettings";
import { updateWeddingDate, type CoupleNames, type WeddingDetails } from "../api/weddings";
import CoupleNamesEditor from "./CoupleNamesEditor";
import PartnerInvitation from "./PartnerInvitation";

function useSave() {
    const pending = useRef<AbortController | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [saved, setSaved] = useState(false);
    useEffect(() => () => pending.current?.abort(), []);

    async function save(action: (signal: AbortSignal) => Promise<void>) {
        if (pending.current) return;
        const controller = new AbortController();
        pending.current = controller;
        setBusy(true);
        setError("");
        setSaved(false);
        try {
            await action(controller.signal);
            if (!controller.signal.aborted) setSaved(true);
        } catch (cause) {
            if (!controller.signal.aborted) setError(cause instanceof Error && !(cause instanceof TypeError)
                ? cause.message : "לא הצלחנו להתחבר לשרת. נסו שוב.");
        } finally {
            pending.current = null;
            if (!controller.signal.aborted) setBusy(false);
        }
    }

    return { save, busy, error, saved };
}

function SaveControls({ busy, error, saved }: Pick<ReturnType<typeof useSave>, "busy" | "error" | "saved">) {
    return <>
        {error && <p className="ui-error" role="alert">{error}</p>}
        {saved && <p role="status">השינויים נשמרו.</p>}
        <button className="ui-button" disabled={busy}>{busy ? "שומרים…" : "שמירת שינויים"}</button>
    </>;
}

export function ProfileSettings() {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const save = useSave();
    useEffect(() => {
        const controller = new AbortController();
        void accountProfile(controller.signal).then((data) => {
            if (!controller.signal.aborted) setProfile(data);
        }).catch(() => {
            if (!controller.signal.aborted) setLoadError(true);
        });
        return () => controller.abort();
    }, [attempt]);

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void save.save(async (signal) => {
            const updated = await accountProfile(signal, {
                first_name: String(data.get("first_name")).trim(),
                last_name: String(data.get("last_name")).trim(),
                email: String(data.get("email")).trim(),
            });
            if (!signal.aborted) setProfile(updated);
        });
    }

    return <section className="atelier-settings">
        <h1>הפרופיל שלי</h1>
        <p>פרטי החשבון האישיים שלכם.</p>
        {loadError ? <>
            <p className="ui-error" role="alert">לא ניתן לטעון את פרטי הפרופיל.</p>
            <button className="ui-button" onClick={() => { setLoadError(false); setAttempt(attempt + 1); }}>טעינה מחדש</button>
        </> : profile ? <form className="ui-panel atelier-settings-form" onSubmit={submit}>
            <label className="ui-field">שם פרטי<input className="ui-input" name="first_name" autoComplete="given-name"
                required maxLength={150} defaultValue={profile.first_name} /></label>
            <label className="ui-field">שם משפחה<input className="ui-input" name="last_name" autoComplete="family-name"
                maxLength={150} defaultValue={profile.last_name} /></label>
            <label className="ui-field">כתובת דוא״ל<input className="ui-input" type="email" name="email" dir="ltr"
                autoComplete="email" required maxLength={254} defaultValue={profile.email} /></label>
            <SaveControls {...save} />
        </form> : <p role="status">טוענים את פרטי הפרופיל…</p>}
    </section>;
}

export function SecuritySettings() {
    const save = useSave();
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const new_password = String(data.get("new_password"));
        const confirm_password = String(data.get("confirm_password"));
        void save.save(async (signal) => {
            if (new_password !== confirm_password) throw new Error("הסיסמאות החדשות אינן תואמות.");
            await changePassword({ old_password: String(data.get("old_password")), new_password, confirm_password }, signal);
            if (!signal.aborted) form.reset();
        });
    }
    return <section className="atelier-settings">
        <h1>אבטחת החשבון</h1>
        <form className="ui-panel atelier-settings-form" onSubmit={submit}>
            <h2>שינוי סיסמה</h2>
            <fieldset disabled={save.busy}>
                <label className="ui-field">סיסמה נוכחית<input className="ui-input" name="old_password"
                    type="password" autoComplete="current-password" required maxLength={4096} /></label>
                <label className="ui-field">סיסמה חדשה<input className="ui-input" name="new_password"
                    type="password" autoComplete="new-password" required maxLength={4096} /></label>
                <label className="ui-field">אימות הסיסמה החדשה<input className="ui-input" name="confirm_password"
                    type="password" autoComplete="new-password" required maxLength={4096} /></label>
            </fieldset>
            <SaveControls {...save} />
        </form>
    </section>;
}

export function WeddingSettings({ wedding, onSaveNames, onSaveDate }: {
    wedding: WeddingDetails; onSaveNames: (names: CoupleNames) => void; onSaveDate: (date: string | null) => void;
}) {
    const save = useSave();
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const date = String(new FormData(event.currentTarget).get("date")) || null;
        void save.save(async (signal) => {
            const updated = await updateWeddingDate(wedding.id, date, signal);
            if (!signal.aborted) onSaveDate(updated);
        });
    }

    return <section className="atelier-settings">
        <h1>הגדרות החתונה</h1>
        <p><bdi>{wedding.name}</bdi> · הפרטים משותפים לשני חברי מרחב החתונה.</p>
        <div className="atelier-settings-grid">
            <form className="ui-panel atelier-settings-form" onSubmit={submit}>
                <label className="ui-field">תאריך החתונה<input className="ui-input" type="date" name="date"
                    min="0001-01-01" max="9999-12-31" defaultValue={wedding.wedding_date ?? ""} /></label>
                <SaveControls {...save} />
            </form>
            <div className="ui-panel atelier-settings-form">
                <h2>שמות הזוג</h2>
                <CoupleNamesEditor weddingId={wedding.id} names={wedding} onSaved={onSaveNames} />
            </div>
        </div>
        {wedding.memberships.length < 2 && <PartnerInvitation weddingId={wedding.id} />}
    </section>;
}
