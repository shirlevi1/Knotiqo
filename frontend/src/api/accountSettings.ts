import { getCsrfToken } from "./csrf";

export type Profile = { first_name: string; last_name: string; email: string };
export type PasswordChange = { old_password: string; new_password: string; confirm_password: string };

const messages: Record<string, string> = {
    "Email already exists": "כתובת הדוא״ל כבר משויכת לחשבון אחר.",
    "Invalid email address": "יש להזין כתובת דוא״ל תקינה.",
    "Invalid profile field": "בדקו את האורך ואת התווים בפרטים שהזנתם.",
    "Current password is incorrect": "הסיסמה הנוכחית שגויה.",
    "Passwords do not match": "הסיסמאות החדשות אינן תואמות.",
    "Password validation failed": "בחרו סיסמה ארוכה יותר שאינה נפוצה, מספרית בלבד או דומה לפרטי החשבון.",
};

async function request(path: string, signal: AbortSignal, input?: Profile | PasswordChange) {
    const options = { credentials: "same-origin", cache: "no-store", signal } as const;
    let mutation: RequestInit = {};
    if (input) {
        const csrf = await fetch("/api/auth/csrf/", options);
        const token = getCsrfToken();
        if (!csrf.ok || !token) throw new Error("לא ניתן לאמת את הבקשה. רעננו את הדף ונסו שוב.");
        mutation = { method: "POST", headers: { "X-CSRFToken": token, "Content-Type": "application/json" },
            body: JSON.stringify(input) };
    }
    const response = await fetch(path, { ...options, ...mutation });
    if (response.status === 401 || response.status === 403) {
        throw new Error("לא ניתן לאמת את הבקשה. רעננו את הדף או התחברו מחדש.");
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(response.status === 400 && Object.hasOwn(messages, data?.error)
        ? messages[data.error] : "לא ניתן להשלים את הבקשה. בדקו את הפרטים ונסו שוב.");
    return data;
}

export async function accountProfile(signal: AbortSignal, input?: Profile): Promise<Profile> {
    const data = await request("/api/auth/profile/", signal, input);
    if (typeof data?.first_name !== "string" || typeof data.last_name !== "string" || typeof data.email !== "string") {
        throw new Error("לא ניתן לאשר את פרטי החשבון. נסו שוב.");
    }
    return data;
}

export async function changePassword(input: PasswordChange, signal: AbortSignal) {
    await request("/api/auth/change-password/", signal, input);
}
