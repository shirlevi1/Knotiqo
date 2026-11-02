
import { useState, type FormEvent } from "react";

type User = {
    id: number;
    username: string;
};

class LoginError extends Error {}

function checkResponse(response: Response): void {
    if (response.ok) return;

    if (response.status === 401) {
        throw new LoginError("שם המשתמש או הסיסמה אינם נכונים.");
    }

    if (response.status === 403) {
        throw new LoginError(
            "בדיקת האבטחה נכשלה. רענני את הדף ונסי שוב."
        );
    }

    if (response.status >= 500) {
        throw new LoginError(
            "אירעה תקלה בשרת. נסי שוב מאוחר יותר."
        );
    }

    throw new LoginError(
        "התקבלה תשובה לא צפויה מהשרת. נסי שוב."
    );
}

function getCsrfToken(): string {
    const cookie = document.cookie
        .split("; ")
        .find((item) => item.startsWith("csrftoken="));

    return cookie
        ? decodeURIComponent(cookie.substring("csrftoken=".length))
        : "";
}

export default function Login() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [user, setUser] = useState<User | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleLogin(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setLoading(true);

        try {
            // Request CSRF cookie from Django
            const csrfResponse = await fetch("/api/auth/csrf/", {
                credentials: "same-origin",
            });

            checkResponse(csrfResponse);

            const csrfToken = getCsrfToken();

            if (!csrfToken) {
                throw new LoginError(
                    "לא ניתן לאתחל את בדיקת האבטחה. בדקי שהדפדפן מאפשר cookies ונסי שוב."
                );
            }

            // Send login credentials to Django
            const response = await fetch("/api/auth/login/", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": csrfToken,
                },
                body: JSON.stringify({ username, password }),
            });

            checkResponse(response);

            let data: unknown;

            try {
                data = await response.json();
            } catch {
                throw new LoginError(
                    "התקבלה תשובה לא צפויה מהשרת. נסי שוב."
                );
            }

            if (
                typeof data !== "object" ||
                data === null ||
                !("id" in data) ||
                typeof data.id !== "number" ||
                !("username" in data) ||
                typeof data.username !== "string"
            ) {
                throw new LoginError(
                    "התקבלה תשובה לא צפויה מהשרת. נסי שוב."
                );
            }

            setUser({
                id: data.id,
                username: data.username,
            });

            setPassword("");
        } catch (error) {
            setError(
                error instanceof LoginError
                    ? error.message
                    : "לא ניתן להתחבר לשרת. בדקי את החיבור ונסי שוב."
            );
        } finally {
            setLoading(false);
        }
    }

    if (user) {
        return (
            <main className="welcome-page" dir="rtl">
                <a className="wordmark" href="/" lang="en">
                    Knotiqo
                    <span lang="he">מתחילים את הפרק הבא</span>
                </a>

                <div className="welcome-card">
                    <p className="eyebrow">
                        הסיפור שלכם ממשיך כאן
                    </p>

                    <h2>איזה כיף שחזרת, {user.username}!</h2>

                    <p>
                        עוד צעד קטן בדרך ליום הגדול שלכם.
                    </p>
                </div>
            </main>
        );
    }

    return (
        <div className="landing-page" dir="rtl">
            <header className="site-header">
                <div className="nav-shell">
                    <div className="nav-side nav-side-left">
                        <span className="nav-kicker">ביחד, בדרך שלכם</span>

                    </div>

                    <a
                        className="wordmark"
                        href="/"
                        aria-label="Knotiqo - עמוד הבית"
                        lang="en"
                    >
                        Knotiqo
                        <span lang="he">מתחילים את הפרק הבא</span>
                    </a>

                    <div className="nav-side nav-side-right">
                        <a className="nav-cta" href="#login">
                            כניסה למרחב
                        </a>
                    </div>
                </div>
            </header>

            <main className="landing-main" aria-labelledby="intro-title">
                <div className="editorial">
                    <p className="eyebrow">מתחילים את הפרק הבא</p>
                    <h1 id="intro-title">אמרתם כן.<br /><span>עכשיו מתחיל כל הקסם.</span></h1>
                    <p className="intro-copy">יש לכם תאריך לחלום עליו, אנשים שאתם אוהבים לחגוג איתם, ואלף רעיונות שרק מחכים להפוך למציאות.</p>
                    <p className="intro-copy">כאן מתחילים לתכנן את החתונה שלכם. ביחד, בדרך שלכם.</p>
                    <a className="text-link" href="#login">בואו נתחיל את הסיפור שלנו <span aria-hidden="true">←</span></a>
                </div>
                <figure className="wedding-photo">
                    <img
                        src="/images/engagement-ring.png"
                        width="1199"
                        height="1312"
                        fetchPriority="high"
                        alt="טבעת אירוסין בקופסת קטיפה פתוחה, לצד פרחים בגוני שנהב ותכלת על בד משי בהיר"
                    />
                </figure>
                <section
                    className="login-card"
                    id="login"
                    aria-labelledby="login-title"
                >
                    <p className="eyebrow">
                        איזה כיף שחזרתם
                    </p>

                    <h2 id="login-title">
                        ממשיכים לתכנן.
                    </h2>

                    <p className="card-copy">
                        כל התוכניות שלכם מחכות לכם כאן.
                    </p>

                    <form onSubmit={handleLogin}>
                        <div>
                            <label htmlFor="username">
                                שם משתמש
                            </label>

                            <input
                                id="username"
                                name="username"
                                autoComplete="username"
                                value={username}
                                onChange={(event) =>
                                    setUsername(event.target.value)
                                }
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="password">
                                סיסמה
                            </label>

                            <input
                                id="password"
                                name="password"
                                autoComplete="current-password"
                                type="password"
                                value={password}
                                onChange={(event) =>
                                    setPassword(event.target.value)
                                }
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                        >
                            {loading
                                ? "מתחברת..."
                                : "חוזרים לתכנון שלנו"}

                            <span aria-hidden="true">
                                ←
                            </span>
                        </button>

                        {error && (
                            <p role="alert">
                                {error}
                            </p>
                        )}
                    </form>

                    <p className="card-footnote">
                        עוד צעד קטן בדרך ליום הגדול שלכם.
                    </p>
                </section>

            </main>

            <footer className="site-footer">
                <span>ביחד, מהרגע הראשון.</span>

                <span>
                    Knotiqo · מתחילים את הפרק הבא
                </span>
            </footer>
        </div>
    );
}
