
import { getCsrfToken } from "./csrf";
import { isWedding, type Wedding } from "./weddings";

export type InvitationResponse = {
    id: number;
    email: string;
    status: "pending";
    expires_at: string;
    invitation_url: string;
};

export class InvitationApiError extends Error {}

function isInvitation(value: unknown): value is InvitationResponse {
    return (
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof value.id === "number" &&
        "email" in value &&
        typeof value.email === "string" &&
        "status" in value &&
        value.status === "pending" &&
        "expires_at" in value &&
        typeof value.expires_at === "string" &&
        "invitation_url" in value &&
        typeof value.invitation_url === "string" &&
        value.invitation_url.startsWith("/invite/")
    );
}

export async function createPartnerInvitation(
    weddingId: number,
    email: string
): Promise<InvitationResponse> {
    const csrfResponse = await fetch("/api/auth/csrf/", {
        credentials: "same-origin",
    });

    if (!csrfResponse.ok) {
        throw new InvitationApiError(
            "לא ניתן לאתחל את בדיקת האבטחה. נסו שוב."
        );
    }

    const csrfToken = getCsrfToken();

    if (!csrfToken) {
        throw new InvitationApiError(
            "לא נמצא אישור אבטחה. רעננו את הדף ונסו שוב."
        );
    }

    const response = await fetch(
        `/api/weddings/${weddingId}/invitations/`,
        {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": csrfToken,
            },
            body: JSON.stringify({ email }),
        }
    );

    if (!response.ok) {
        if (response.status === 400) {
            throw new InvitationApiError(
                "כתובת האימייל אינה תקינה או שכבר קיימת הזמנה פעילה."
            );
        }

        if (response.status === 401 || response.status === 403) {
            throw new InvitationApiError(
                "אין הרשאה ליצור הזמנה לחתונה זו. נסו להתחבר מחדש."
            );
        }

        if (response.status === 404) {
            throw new InvitationApiError(
                "החתונה המבוקשת לא נמצאה."
            );
        }

        throw new InvitationApiError(
            "אירעה תקלה ביצירת ההזמנה. נסו שוב."
        );
    }

    let data: unknown;

    try {
        data = await response.json();
    } catch {
        throw new InvitationApiError(
            "התקבלה תשובה לא תקינה מהשרת."
        );
    }

    if (response.status !== 201 || !isInvitation(data)) {
        throw new InvitationApiError(
            "לא ניתן לאמת את תוצאת יצירת ההזמנה."
        );
    }

    return data;
}

const unavailable = "קישור ההזמנה אינו תקין, פג תוקפו, בוטל או שכבר השתמשו בו.";

async function sendInvitationToken(
    action: "validate" | "accept",
    token: string,
    options: RequestInit = {},
): Promise<unknown> {
    const response = await fetch(`/api/wedding-invitations/${action}/`, {
        ...options,
        method: "POST",
        credentials: "same-origin",
        headers: { ...options.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
    });
    if (response.status === 400 || response.status === 404) {
        throw new InvitationApiError(unavailable);
    }
    if (response.status === 403) {
        throw new InvitationApiError("לא ניתן להצטרף מחשבון זה. התחברו עם החשבון שנרשם בכתובת שאליה נשלחה ההזמנה.");
    }
    if (response.status === 409) {
        throw new InvitationApiError("לא ניתן להצטרף. ייתכן שאתם כבר חברים בחתונה או ששני המקומות תפוסים.");
    }
    if (!response.ok) {
        throw new InvitationApiError("לא ניתן להשלים את הבקשה כרגע. נסו שוב.");
    }
    return response.json();
}

export async function validateInvitation(token: string, signal: AbortSignal): Promise<string> {
    const data = await sendInvitationToken("validate", token, { signal });
    if (typeof data !== "object" || data === null || !("name" in data) || typeof data.name !== "string") {
        throw new InvitationApiError("התקבלה תשובה לא תקינה מהשרת.");
    }
    return data.name;
}

export async function acceptInvitation(token: string): Promise<Wedding> {
    const csrfResponse = await fetch("/api/auth/csrf/", { credentials: "same-origin" });
    const csrfToken = getCsrfToken();
    if (!csrfResponse.ok || !csrfToken) {
        throw new InvitationApiError("לא ניתן לאתחל את בדיקת האבטחה. נסו שוב.");
    }
    const data = await sendInvitationToken("accept", token, {
        headers: { "X-CSRFToken": csrfToken },
    });
    if (!isWedding(data)) {
        throw new InvitationApiError("לא ניתן לאשר את ההצטרפות. בדקו את רשימת החתונות שלכם.");
    }
    return data;
}
