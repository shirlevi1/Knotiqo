

import { useState, type FormEvent } from "react";
import {
    createPartnerInvitation,
    InvitationApiError,
} from "../api/invitationsApi";

type Props = {
    weddingId: number;
};

export default function PartnerInvitation({ weddingId }: Props) {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [invitationUrl, setInvitationUrl] = useState("");
    const [copied, setCopied] = useState(false);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (loading) return;

        setError("");
        setCopied(false);
        setLoading(true);

        try {
            const invitation = await createPartnerInvitation(
                weddingId,
                email.trim()
            );

            setInvitationUrl(
                new URL(invitation.invitation_url, window.location.origin).href
            );
        } catch (err) {
            setError(
                err instanceof InvitationApiError
                    ? err.message
                    : "לא ניתן לאשר שההזמנה נוצרה. בדקו את החיבור לפני ניסיון נוסף."
            );
        } finally {
            setLoading(false);
        }
    }

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(invitationUrl);
            setCopied(true);
        } catch {
            setError("לא הצלחנו להעתיק את הקישור. אפשר להעתיק אותו ידנית.");
        }
    }

    return (
        <section className="partner-invitation" dir="rtl">
            <h4>הזמנת בן/בת הזוג</h4>
            <p>הזמינו את בן או בת הזוג לתכנן את החתונה יחד.</p>

            {!invitationUrl ? (
                <form onSubmit={handleSubmit} aria-busy={loading}>
                    <fieldset disabled={loading}>
                        <div className="wedding-field">
                            <label htmlFor={`partner-email-${weddingId}`}>
                                כתובת האימייל
                            </label>

                            <input
                                id={`partner-email-${weddingId}`}
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                placeholder="partner@example.com"
                                autoComplete="email"
                                required
                            />
                        </div>

                        <button className="wedding-button" type="submit">
                            {loading ? "יוצרים הזמנה..." : "יצירת קישור הזמנה"}
                        </button>
                    </fieldset>
                </form>
            ) : (
                <div className="invitation-success">
                    <p role="status">ההזמנה נוצרה בהצלחה!</p>
                    <p>הקישור תקף לשבעה ימים.</p>

                    <div className="wedding-field">
                        <label htmlFor={`invitation-link-${weddingId}`}>
                            קישור ההזמנה
                        </label>
                        <input
                            id={`invitation-link-${weddingId}`}
                            type="text"
                            value={invitationUrl}
                            readOnly
                            onFocus={(event) => event.target.select()}
                        />
                    </div>

                    <button
                        className="wedding-button"
                        type="button"
                        onClick={handleCopy}
                    >
                        {copied ? "הקישור הועתק!" : "העתקת קישור"}
                    </button>
                </div>
            )}

            {error && (
                <p className="wedding-error" role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}
