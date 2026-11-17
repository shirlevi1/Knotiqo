import { useState, type FormEvent } from "react";
import CoupleNameFields from "./components/CoupleNameFields";
import { createWedding, readCoupleNames, validateCoupleNames, WeddingApiError, type Wedding, type WeddingFieldErrors } from "./api/weddings";
import "./WeddingWorkspace.css";

type Props = { onCreated: (wedding: Wedding) => void };

export default function CreateWedding({ onCreated }: Props) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [fields, setFields] = useState<WeddingFieldErrors>({});

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (loading) return;
        const data = new FormData(event.currentTarget);
        const nameValue = data.get("name");
        const dateValue = data.get("wedding_date");
        const name = typeof nameValue === "string" ? nameValue.trim() : "";
        const date = typeof dateValue === "string" ? dateValue : "";
        setError("");
        const names = readCoupleNames(data);
        const errors = validateCoupleNames(names);
        if (!name) errors.name = "יש להזין שם לחתונה.";
        setFields(errors);
        if (Object.keys(errors).length) return;
        setLoading(true);
        try {
            const wedding = await createWedding({ ...names, name, wedding_date: date || null });
            onCreated(wedding);
        } catch (err) {
            setError(err instanceof WeddingApiError ? err.message
                : "לא ניתן לאשר שהחתונה נוצרה. בדקו את החיבור ורעננו לפני ניסיון נוסף.");
            if (err instanceof WeddingApiError) setFields(err.fields);
        } finally {
            setLoading(false);
        }
    }

    return (
        <section className="wedding-create ui-card" dir="rtl" aria-labelledby="create-wedding-title">
            <h2 id="create-wedding-title">מתחילים לתכנן את היום הגדול שלכם</h2>
            <p>לפני שמתחילים, בואו ניצור את המרחב המשותף שלכם.</p>
            <form onSubmit={handleSubmit} aria-busy={loading}>
                <fieldset className="ui-fieldset" disabled={loading}>
                    <div className="ui-field">
                        <label htmlFor="wedding-name">שם החתונה</label>
                        <input className="ui-input" id="wedding-name" name="name" required maxLength={150}
                            aria-invalid={Boolean(fields.name)}
                            aria-describedby={fields.name ? "wedding-name-error" : undefined} />
                        {fields.name && <p id="wedding-name-error" className="ui-error" role="alert">{fields.name}</p>}
                    </div>
                    <CoupleNameFields errors={fields} />
                    <div className="ui-field">
                        <label htmlFor="wedding-date">תאריך החתונה (לא חובה)</label>
                        <input className="ui-input" id="wedding-date" name="wedding_date" type="date" dir="ltr"
                            aria-invalid={Boolean(fields.wedding_date)}
                            aria-describedby={fields.wedding_date ? "wedding-date-error" : undefined} />
                        {fields.wedding_date && <p id="wedding-date-error" className="ui-error" role="alert">{fields.wedding_date}</p>}
                    </div>
                    {error && <p className="ui-error" role="alert">{error}</p>}
                    <button className="ui-button" type="submit">
                        {loading ? "יוצרים את המרחב שלכם..." : "יוצרים את החתונה שלנו"}
                    </button>
                </fieldset>
            </form>
        </section>
    );
}
