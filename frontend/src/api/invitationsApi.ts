
import { getCsrfToken } from "./csrf";

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
