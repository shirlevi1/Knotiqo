import { getCsrfToken } from "./api/csrf";
import "./Register.css";
import { useState, type FormEvent } from "react";

type RegisterProps = {
    onBack: () => void;
    onRegistered: (username: string) => void;
};

type RegistrationData = {
    username: string;
    email: string;
    password: string;
    confirm_password: string;
};



export default function Register({
                                     onBack,
                                     onRegistered,
                                 }: RegisterProps) {
    const [form, setForm] = useState<RegistrationData>({
        username: "",
        email: "",
        password: "",
        confirm_password: "",
    });

    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    function updateField(
        field: keyof RegistrationData,
        value: string
    ) {
        setForm((previous) => ({
            ...previous,
            [field]: value,
        }));
    }

    async function handleSubmit(
        event: FormEvent<HTMLFormElement>
    ) {
        event.preventDefault();
        setError("");

        if (form.password !== form.confirm_password) {
            setError("הסיסמאות אינן תואמות.");
            return;
        }

        setLoading(true);

        try {
            // Request a CSRF cookie from Django.
            const csrfResponse = await fetch("/api/auth/csrf/", {
                credentials: "same-origin",
            });

            if (!csrfResponse.ok) {
                throw new Error("לא ניתן לבצע בדיקת אבטחה.");
            }

            const csrfToken = getCsrfToken();

            if (!csrfToken) {
                throw new Error("לא נמצא אישור אבטחה. רענני את הדף.");
            }

            // Send registration data to Django.
            const response = await fetch("/api/auth/register/", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": csrfToken,
                },
                body: JSON.stringify({
                    ...form,
                    username: form.username.trim(),
                    email: form.email.trim(),
                }),
            });

            if (!response.ok) {
                if (response.status === 400) {
                    const data = await response.json().catch(() => null);
                    const messages: Record<string, string> = {
                        "Username already exists": "שם המשתמש כבר תפוס.",
                        "Email already exists": "כתובת האימייל כבר רשומה.",
                        "Passwords do not match": "הסיסמאות אינן תואמות.",
                        "Invalid email address": "כתובת האימייל אינה תקינה.",
                        "Validation failed":
                            "בדקו את שם המשתמש ואת דרישות הסיסמה שמופיעות מתחת לטופס.",
                    };

                    const serverError =
                        data && typeof data.error === "string"
                            ? data.error
                            : "";

                    throw new Error(
                        messages[serverError] ??
                        "בדקי את הפרטים שהזנת ונסי שוב."
                    );
                }

                if (response.status === 403) {
                    throw new Error(
                        "בדיקת האבטחה נכשלה. רענני את הדף ונסי שוב."
                    );
                }

                throw new Error("לא ניתן ליצור חשבון כרגע.");
            }

            if (response.status !== 201) {
                throw new Error("התקבלה תשובה לא צפויה מהשרת.");
            }

            onRegistered(form.username.trim());
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "אירעה שגיאה. נסי שוב."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="landing-page" dir="rtl">
            <header className="register-header">
        <span className="wordmark" lang="en">
          Knotiqo
          <span lang="he">מתחילים את הפרק הבא</span>
        </span>
            </header>

            <main className="register-page">
                <section
                    className="login-card register-card"
                    aria-labelledby="register-title"
                >
                    <p className="eyebrow">הסיפור שלכם מתחיל כאן</p>

                    <h1 id="register-title">נעים להכיר 🤍</h1>

                    <p className="card-copy">
                        עוד רגע יהיה לכם מקום משלכם לתכנן בו את
                        היום הגדול.
                    </p>

                    <form onSubmit={handleSubmit}>
                        <div>
                            <label htmlFor="register-username">
                                שם משתמש
                            </label>
                            <input
                                id="register-username"
                                autoComplete="username"
                                value={form.username}
                                onChange={(event) =>
                                    updateField("username", event.target.value)
                                }
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="register-email">
                                כתובת אימייל
                            </label>
                            <input
                                id="register-email"
                                type="email"
                                autoComplete="email"
                                value={form.email}
                                onChange={(event) =>
                                    updateField("email", event.target.value)
                                }
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="register-password">
                                סיסמה
                            </label>
                            <input
                                id="register-password"
                                type={showPassword ? "text" : "password"}
                                autoComplete="new-password"
                                value={form.password}
                                onChange={(event) =>
                                    updateField("password", event.target.value)
                                }
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="register-confirm-password">
                                אימות סיסמה
                            </label>
                            <input
                                id="register-confirm-password"
                                type={showPassword ? "text" : "password"}
                                autoComplete="new-password"
                                value={form.confirm_password}
                                onChange={(event) =>
                                    updateField(
                                        "confirm_password",
                                        event.target.value
                                    )
                                }
                                required
                            />
                        </div>

                        <label className="password-toggle">
                            <input
                                type="checkbox"
                                checked={showPassword}
                                onChange={(event) =>
                                    setShowPassword(event.target.checked)
                                }
                            />
                            הצגת הסיסמאות
                        </label>

                        <p className="password-hint">
                            בחרו לפחות 8 תווים, עם אות אחת ותו מיוחד אחד לפחות.
                            הימנעו מסיסמה נפוצה או דומה לפרטי החשבון.
                        </p>

                        {error && <p role="alert">{error}</p>}

                        <button type="submit" disabled={loading}>
                            {loading ? "יוצרים חשבון..." : "יוצרים חשבון"}
                            <span aria-hidden="true">←</span>
                        </button>
                    </form>

                    <p className="card-footnote">
                        כבר יש לכם חשבון?{" "}
                        <button
                            type="button"
                            className="auth-text-button"
                            onClick={onBack}
                        >
                            חוזרים להתחברות
                        </button>
                    </p>
                </section>
            </main>
        </div>
    );
}
