import { useEffect, useRef, useState } from "react";
import { acceptInvitation, InvitationApiError, validateInvitation } from "./api/invitationsApi";
import "./AcceptInvitation.css";

type Props = {
    token: string;
    signedIn: boolean;
    onLogin: () => void;
    onRegister: () => void;
    onLogout: () => void;
    signingOut: boolean;
    logoutError: string;
    onAccepted: (weddingId: number) => void;
};

type Preview = { name: string } | { error: string };

export default function AcceptInvitation({
    token, signedIn, onLogin, onRegister, onLogout, signingOut, logoutError, onAccepted,
}: Props) {
    const [preview, setPreview] = useState<Preview>();
    const [accepting, setAccepting] = useState(false);
    const [acceptError, setAcceptError] = useState("");
    const submitting = useRef(false);

    useEffect(() => {
        if (!token) return;
        const controller = new AbortController();
        void validateInvitation(token, controller.signal)
            .then((name) => {
                if (!controller.signal.aborted) setPreview({ name });
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) {
                    setPreview({ error: error instanceof InvitationApiError
                        ? error.message
                        : "לא הצלחנו לבדוק את ההזמנה. רעננו את הדף ונסו שוב." });
                }
            });
        return () => controller.abort();
    }, [token]);

    async function handleAccept() {
        if (submitting.current) return;
        submitting.current = true;
        setAccepting(true);
        setAcceptError("");
        try {
            const wedding = await acceptInvitation(token);
            onAccepted(wedding.id);
        } catch (error) {
            setAcceptError(error instanceof InvitationApiError
                ? error.message
                : "לא הצלחנו לאשר את ההצטרפות. בדקו את החיבור או עברו למרחב שלכם.");
        } finally {
            submitting.current = false;
            setAccepting(false);
        }
    }

    return (
        <main className="welcome-page invitation-page" dir="rtl">
            <a className="wordmark" href="/" lang="en">Knotiqo</a>
            <section className="welcome-card invitation-card" aria-labelledby="invitation-title">
                <h1 id="invitation-title">הזמנה לתכנון החתונה</h1>
                {!token && <p role="alert">חסר קוד הזמנה. פתחו את הקישור המלא שקיבלתם.</p>}
                {token && !preview && <p role="status">בודקים את ההזמנה...</p>}
                {preview && "error" in preview && <p role="alert">{preview.error}</p>}
                {preview && "name" in preview && (
                    <>
                        <h2>{preview.name}</h2>
                        {signedIn ? (
                            <>
                                <button className="wedding-button" type="button"
                                    onClick={() => void handleAccept()} disabled={accepting || signingOut}>
                                    {accepting ? "מצטרפים לחתונה..." : "מאשרים ומצטרפים לחתונה"}
                                </button>
                                <button className="auth-text-button" type="button"
                                    onClick={onLogout} disabled={accepting || signingOut}>
                                    {signingOut ? "מתנתקים..." : "התחברות עם חשבון אחר"}
                                </button>
                                {(acceptError || logoutError) && <p role="alert">{acceptError || logoutError}</p>}
                            </>
                        ) : (
                            <>
                                <p>כדי להצטרף, התחברו או הירשמו עם כתובת האימייל שאליה נשלח הקישור.</p>
                                <button className="wedding-button" type="button" onClick={onLogin}>התחברות</button>
                                <button className="auth-text-button" type="button" onClick={onRegister}>הרשמה</button>
                            </>
                        )}
                    </>
                )}
                <a className="text-link" href="/">למרחב שלי</a>
            </section>
        </main>
    );
}
