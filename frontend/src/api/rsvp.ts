import { getCsrfToken } from "./csrf";
import type { AgeField } from "./guests";

export const rsvpStatuses = { attending: "מגיעים", declining: "לא מגיעים", maybe: "עדיין לא בטוחים" } as const;
export type RSVPStatus = keyof typeof rsvpStatuses;
export type RSVPInvitation = {
    creator_display_name: string; partner_display_name: string; wedding_date: string | null;
    invited_count: number; age_limits: Record<AgeField, number> | null; options: RSVPStatus[];
};
type RSVPResponse = { status: RSVPStatus; attendee_count: number; responded_at: string } & Record<AgeField, number | null>;
export type LinkState = { sharing_enabled: boolean; link_active: boolean; expires_at: string | null; response: RSVPResponse | null; url?: string };

export const unavailable = "הקישור אינו זמין. אפשר לבקש קישור חדש מבני הזוג.";
export const noPublicSite = "שיתוף חיצוני זמין רק לאחר הגדרת אתר ציבורי מאובטח (HTTPS). אורחים אינם יכולים לפתוח קישור מהמחשב המקומי.";

async function request(path: string, signal: AbortSignal, method = "GET", body?: unknown) {
    const options = { credentials: "same-origin", cache: "no-store", signal } as const;
    const headers: Record<string, string> = {};
    if (method !== "GET") {
        const csrf = await fetch("/api/auth/csrf/", options);
        const token = getCsrfToken();
        if (!csrf.ok || !token) throw new Error("לא ניתן לאמת את הבקשה. רעננו את הדף ונסו שוב.");
        headers["X-CSRFToken"] = token;
        headers["Content-Type"] = "application/json";
    }
    const result = await fetch(path, { ...options, method, headers, body: body ? JSON.stringify(body) : undefined });
    if (result.status === 404) throw new Error(unavailable);
    if (result.status === 409) throw new Error(noPublicSite);
    if (result.status === 429) throw new Error("בוצעו יותר מדי ניסיונות. המתינו דקה ונסו שוב.");
    if (result.status === 403) throw new Error("לא ניתן לאמת את הבקשה. רעננו את הדף ונסו שוב.");
    if (result.status === 400) throw new Error("בדקו שמספר המשתתפים אינו עולה על הכמות בהזמנה.");
    if (!result.ok) throw new Error("השירות אינו זמין כרגע. נסו שוב מאוחר יותר.");
    return result.json();
}

export function getLinkState(weddingId: number, guestId: number, signal: AbortSignal, method?: "POST" | "DELETE"): Promise<LinkState> {
    return request(`/api/weddings/${weddingId}/guests/${guestId}/rsvp-link/`, signal, method);
}

export function readInvitation(token: string, signal: AbortSignal): Promise<RSVPInvitation> {
    return request("/api/rsvp/", signal, "POST", { token, action: "read" });
}

export function sendResponse(token: string, status: RSVPStatus,
    counts: Partial<Record<AgeField | "attendee_count", number>>, signal: AbortSignal): Promise<{ saved: boolean }> {
    return request("/api/rsvp/", signal, "POST", { token, action: "respond", status, ...counts });
}

export function invitationMessage(template: string, link: string) {
    const text = template.trim();
    return text.includes("{link}") ? text.replaceAll("{link}", link) : [text, link].filter(Boolean).join("\n");
}

export function whatsappUrl(message: string, phone: string) {
    const formatted = phone.replace(/[().\s-]/g, "");
    const international = /^(?:\+|00)[1-9][0-9]{6,14}$/.test(formatted) ? formatted.replace(/^(?:\+|00)/, "") : "";
    return `https://wa.me/${international}?text=${encodeURIComponent(message)}`;
}
