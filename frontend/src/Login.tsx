import WeddingWorkspace from "./WeddingWorkspace";
import { getCsrfToken } from "./api/csrf";

import { useEffect, useState, type FormEvent } from "react";
import Register from "./Register";
// ==========================================
// Types & Error Handling
// ==========================================

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

// ==========================================
// Login Component
// ==========================================

export default function Login() {
    const [showRegister, setShowRegister] = useState(false);
    const [registrationSuccess, setRegistrationSuccess] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [user, setUser] = useState<User | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [checkingSession, setCheckingSession] = useState(true);

    // ======================================
    // Restore Existing Session
    // ======================================

    useEffect(() => {
        const controller = new AbortController();

        async function restoreSession() {
            try {
                const response = await fetch("/api/auth/me/", {
                    credentials: "same-origin",
                    signal: controller.signal,
                });

                if (!response.ok) {
                    return;
                }

                const data: User = await response.json();

                if (!controller.signal.aborted) {
                    setUser(data);
                }
            } catch {
                // The user can still log in manually.
            } finally {
                if (!controller.signal.aborted) {
                    setCheckingSession(false);
                }
            }
        }

        void restoreSession();

        return () => controller.abort();
    }, []);

    // ======================================
    // Handle Login
    // ======================================

    async function handleLogin(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setLoading(true);

        try {
            // Ask Django to set the CSRF cookie.
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

            // Send credentials to Django.
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

            // Validate the response structure.
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

            // Update React state after successful login.
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

    // ======================================
    // Handle Logout
    // ======================================

    async function handleLogout() {
        setError("");
        setLoading(true);

        try {
            // Make sure we have a valid CSRF cookie.
            const csrfResponse = await fetch("/api/auth/csrf/", {
                credentials: "same-origin",
            });

            checkResponse(csrfResponse);

            const csrfToken = getCsrfToken();

            if (!csrfToken) {
                throw new LoginError(
                    "לא ניתן לבצע התנתקות כרגע."
                );
            }

            // Ask Django to invalidate the session.
            const response = await fetch("/api/auth/logout/", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "X-CSRFToken": csrfToken,
                },
            });

            checkResponse(response);

            // Clear React state only after logout succeeds.
            setUser(null);
            setPassword("");
        } catch {
            setError("ההתנתקות נכשלה. נסי שוב.");
        } finally {
            setLoading(false);
        }
    }

    // ======================================
    // Session Loading Screen
    // ======================================

    if (checkingSession) {
        return (
            <main
                className="welcome-page"
                dir="rtl"
                role="status"
            >
                <p>מכינים את המרחב שלכם...</p>
            </main>
        );
    }

    // ======================================
    // Authenticated Welcome Screen
    // ======================================

    if (user) {
        return (
            <main className="welcome-page" dir="rtl">
                <a className="wordmark" href="/" lang="en">
                    Knotiqo
                    <span lang="he">
                        מתחילים את הפרק הבא
                    </span>
                </a>

                <div className="welcome-card">
                    <p className="eyebrow">
                        הסיפור שלכם ממשיך כאן
                    </p>

                    <h2>
                        איזה כיף שחזרת, {user.username}!
                    </h2>

                    <p>
                        עוד צעד קטן בדרך ליום הגדול שלכם.
                    </p>

                    <WeddingWorkspace key={user.id} />

                    <button
                        className="logout-button"
                        type="button"
                        onClick={handleLogout}
                        disabled={loading}
                    >
                        {loading ? "מתנתקת..." : "התנתקות"}
                    </button>

                    {error && (
                        <p role="alert">
                            {error}
                        </p>
                    )}
                </div>
            </main>
        );
    }
    if (showRegister) {
        return (
            <Register
                onBack={() => setShowRegister(false)}
                onRegistered={(registeredUsername) => {
                    setUsername(registeredUsername);
                    setPassword("");
                    setError("");
                    setRegistrationSuccess(true);
                    setShowRegister(false);
                }}
            />
        );
    }

    // ======================================
    // Landing Page
    // ======================================

    return (
        <div className="landing-page" dir="rtl">
            {/* Navigation */}

            <header className="site-header">
                <div className="nav-shell">
                    <div className="nav-side nav-side-left">
                        <span className="nav-kicker">
                            ביחד, בדרך שלכם
                        </span>
                    </div>

                    <a
                        className="wordmark"
                        href="/"
                        aria-label="Knotiqo - עמוד הבית"
                        lang="en"
                    >
                        Knotiqo
                        <span lang="he">
                            מתחילים את הפרק הבא
                        </span>
                    </a>

                    <div className="nav-side nav-side-right">
                        <a className="nav-cta" href="#login">
                            כניסה למרחב
                        </a>
                    </div>
                </div>
            </header>

            {/* Main Content */}

            <main
                className="landing-main"
                aria-labelledby="intro-title"
            >
                {/* Hero Text */}

                <div className="editorial">
                    <p className="eyebrow">
                        מתחילים את הפרק הבא
                    </p>

                    <h1 id="intro-title">
                        אמרתם כן.
                        <br />
                        <span>עכשיו מתחיל כל הקסם.</span>
                    </h1>

                    <p className="intro-copy">
                        יש לכם תאריך לחלום עליו,
                        אנשים שאתם אוהבים לחגוג איתם,
                        ואלף רעיונות שרק מחכים להפוך למציאות.
                    </p>

                    <p className="intro-copy">
                        כאן מתחילים לתכנן את החתונה שלכם.
                        ביחד, בדרך שלכם.
                    </p>

                    <a className="text-link" href="#login">
                        בואו נתחיל את הסיפור שלנו
                        <span aria-hidden="true">←</span>
                    </a>
                </div>

                {/* Engagement Ring Image */}

                <figure className="wedding-photo">
                    <img
                        src="/images/engagement-ring.png"
                        width="1199"
                        height="1312"
                        fetchPriority="high"
                        alt="טבעת אירוסין בקופסת קטיפה פתוחה, לצד פרחים בגוני שנהב ותכלת על בד משי בהיר"
                    />
                </figure>

                {/* Login Form */}

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

                    {registrationSuccess && (
                        <p role="status" className="registration-success">
                            החשבון נוצר בהצלחה! אפשר להתחבר עכשיו.
                        </p>
                    )}

                    <p className="card-footnote">
                        עדיין אין לכם חשבון?{" "}
                        <button
                            type="button"
                            className="auth-text-button"
                            onClick={() => {
                                setRegistrationSuccess(false);
                                setError("");
                                setShowRegister(true);
                            }}
                        >
                            יוצרים חשבון כאן
                        </button>
                    </p>


                    <p className="card-footnote">
                        עוד צעד קטן בדרך ליום הגדול שלכם.
                    </p>
                </section>
            </main>

            {/* Footer */}

            <footer className="site-footer">
                <span>
                    ביחד, מהרגע הראשון.
                </span>

                <span>
                    Knotiqo · מתחילים את הפרק הבא
                </span>
            </footer>
        </div>
    );
}
