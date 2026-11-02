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
        throw new LoginError("בדיקת האבטחה נכשלה. רענני את הדף ונסי שוב.");
    }
    if (response.status >= 500) {
        throw new LoginError("אירעה תקלה בשרת. נסי שוב מאוחר יותר.");
    }
    throw new LoginError("התקבלה תשובה לא צפויה מהשרת. נסי שוב.");
}

function getCsrfToken(): string {
    const cookie = document.cookie
        .split("; ")
        .find((item) => item.startsWith("csrftoken="));

    return cookie
        ? decodeURIComponent(cookie.split("=")[1])
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
            // Ask Django to set the CSRF cookie
            const csrfResponse = await fetch("/api/auth/csrf/", {
                credentials: "same-origin",
            });

            checkResponse(csrfResponse);

            const csrfToken = getCsrfToken();

            if (!csrfToken) {
                throw new LoginError("לא ניתן לאתחל את בדיקת האבטחה. בדקי שהדפדפן מאפשר cookies ונסי שוב.");
            }

            // Send credentials to Django
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
                throw new LoginError("התקבלה תשובה לא צפויה מהשרת. נסי שוב.");
            }
            if (
                typeof data !== "object" || data === null ||
                !("id" in data) || typeof data.id !== "number" ||
                !("username" in data) || typeof data.username !== "string"
            ) {
                throw new LoginError("התקבלה תשובה לא צפויה מהשרת. נסי שוב.");
            }
            setUser({ id: data.id, username: data.username });
            setPassword("");
        } catch (error) {
            setError(error instanceof LoginError
                ? error.message
                : "לא ניתן להתחבר לשרת. בדקי את החיבור ונסי שוב.");
        } finally {
            setLoading(false);
        }
    }

    if (user) {
        return (
            <main className="welcome-page" dir="rtl">
                <a className="wordmark" href="/" lang="en">Knotiqo<span>WEDDING PLANNING, WITH INTENTION</span></a>
                <div className="welcome-card">
                <p className="eyebrow">המקום שלכם לתכנן יחד</p>
                <h2>ברוכה הבאה, {user.username}!</h2>
                <p>ההתחברות הצליחה.</p>
                </div>
            </main>
        );
    }

    return (
        <div className="landing-page" dir="rtl">
            <header className="site-header">
                <a className="wordmark" href="/" aria-label="Knotiqo — עמוד הבית" lang="en">Knotiqo<span>WEDDING PLANNING, WITH INTENTION</span></a>
                <a className="header-link" href="#login">למרחב שלכם <span aria-hidden="true">↗</span></a>
            </header>
            <main className="landing-main">
                <section className="editorial" aria-labelledby="intro-title">
                    <p className="eyebrow">קצת פחות עומס. קצת יותר אתם.</p>
                    <h1 id="intro-title">יום אחד מיוחד.<br /><span>דרך נעימה עד אליו.</span></h1>
                    <p className="intro-copy">בין כל הרעיונות, ההחלטות והפרטים הקטנים — מקום שקט לתכנון החתונה שלכם. ביחד, בקצב שלכם.</p>
                    <a className="text-link" href="#login">מתחילים כאן <span aria-hidden="true">←</span></a>
                    <div className="editorial-art" aria-hidden="true">
                        <div className="art-arch art-arch-back" />
                        <div className="art-arch art-arch-front"><span>the beginning<br /><i>of something beautiful.</i></span></div>
                        <div className="art-line" />
                        <span className="art-caption">A LITTLE SPACE FOR YOUR BIG DAY</span>
                    </div>
                </section>
                <section className="login-card" id="login" aria-labelledby="login-title">
                    <span className="card-index" aria-hidden="true">01 / YOUR SPACE</span>
                    <p className="eyebrow">טוב שחזרתם</p>
                    <h2 id="login-title">ממשיכים לתכנן.</h2>
                    <p className="card-copy">היכנסו למרחב האישי שלכם ב־Knotiqo.</p>
            <form onSubmit={handleLogin}>
                <div>
                    <label htmlFor="username">שם משתמש</label>
                    <input
                        id="username"
                        name="username"
                        autoComplete="username"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        required
                    />
                </div>

                <div>
                    <label htmlFor="password">סיסמה</label>
                    <input
                        id="password"
                        name="password"
                        autoComplete="current-password"
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                    />
                </div>

                <button type="submit" disabled={loading}>
                    {loading ? "מתחברת..." : "כניסה למרחב שלי"} <span aria-hidden="true">←</span>
                </button>

                {error && <p role="alert">{error}</p>}
            </form>
                    <p className="card-footnote">כל הפרטים הקטנים. התחלה אחת משותפת.</p>
                </section>
            </main>
            <footer className="site-footer"><span lang="en">Thoughtfully planned. Beautifully yours.</span><span>Knotiqo · מתחילים את הפרק הבא</span></footer>
        </div>
    );
}
