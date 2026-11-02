import { useState, type FormEvent } from "react";

type User = {
    id: number;
    username: string;
};

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

            if (!csrfResponse.ok) {
                throw new Error("Could not initialize login");
            }

            const csrfToken = getCsrfToken();

            if (!csrfToken) {
                throw new Error("CSRF token is missing");
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

            if (!response.ok) {
                throw new Error("Login failed");
            }

            const data: User = await response.json();
            setUser(data);
            setPassword("");
        } catch {
            setError("ההתחברות נכשלה. בדקי את הפרטים ואת החיבור לשרת.");
        } finally {
            setLoading(false);
        }
    }

    if (user) {
        return (
            <main dir="rtl">
                <h1>Knotiqo 💍</h1>
                <h2>ברוכה הבאה, {user.username}!</h2>
                <p>ההתחברות הצליחה.</p>
            </main>
        );
    }

    return (
        <main dir="rtl">
            <h1>Knotiqo 💍</h1>
            <h2>התחברות</h2>

            <form onSubmit={handleLogin}>
                <div>
                    <label htmlFor="username">שם משתמש</label>
                    <input
                        id="username"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        required
                    />
                </div>

                <div>
                    <label htmlFor="password">סיסמה</label>
                    <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                    />
                </div>

                <button type="submit" disabled={loading}>
                    {loading ? "מתחברת..." : "התחברות"}
                </button>

                {error && <p role="alert">{error}</p>}
            </form>
        </main>
    );
}