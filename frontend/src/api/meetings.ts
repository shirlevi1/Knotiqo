import { getCsrfToken } from "./csrf";

export const meetingTypes = { venue_tour: "סיור באולם", in_person: "פגישה פנים אל פנים", phone: "שיחת טלפון",
    video: "שיחת וידאו", fitting: "מדידה", other: "אחר" } as const;
export const meetingStatuses = { scheduled: "נקבעה", completed: "הושלמה", cancelled: "בוטלה" } as const;
export type Resource = { kind: "venue" | "vendor"; id: number; name: string; location?: string };
export type MeetingInput = {
    title: string; meeting_type: keyof typeof meetingTypes; date: string; start_time: string; end_time: string | null;
    status: keyof typeof meetingStatuses; venue_id: number | null; vendor_id: number | null;
    contact_person: string; phone: string; location: string; video_url: string; notes: string;
};
export type Meeting = MeetingInput & {
    venue_details?: { location: string; contact_person: string; phone: string; image_url: string | null; image_alt: string };
    vendor_details?: { category: string; contact_person: string; phone: string };
    id: number; starts_at: string; ends_at: string | null; venue_name: string | null; vendor_name: string | null;
};
export type MeetingPage = { count: number; next: string | null; previous: string | null; results: Meeting[] };
export type Scope = "dashboard" | "venues" | "vendors";

const fieldErrors: Record<string, string> = {
    start_time: "בחרו שעת התחלה תקינה. שעות במעבר לשעון קיץ או חורף עשויות להיות לא זמינות.",
    end_time: "שעת הסיום צריכה להיות מאוחרת משעת ההתחלה באותו יום וזמינה לפי שעון ישראל.",
    phone: "הזינו מספר טלפון תקין.",
    video_url: "הזינו קישור תקין שמתחיל ב־http או https.",
};

async function request<T>(url: string, signal: AbortSignal, method = "GET", body?: unknown): Promise<T> {
    const options = { signal, credentials: "same-origin", cache: "no-store" } as const;
    const headers: Record<string, string> = {};
    if (method !== "GET") {
        const csrf = await fetch("/api/auth/csrf/", options);
        const token = getCsrfToken();
        if (!csrf.ok || !token) throw new Error("לא ניתן לאמת את הבקשה. רעננו את הדף ונסו שוב.");
        headers["X-CSRFToken"] = token;
        headers["Content-Type"] = "application/json";
    }
    const response = await fetch(url, { ...options, method, headers, body: body ? JSON.stringify(body) : undefined });
    if (response.status === 204) return undefined as T;
    if (response.status === 404) throw new Error("הפגישה או הקישור אליה אינם זמינים בחתונה הזו.");
    if (response.status === 401 || response.status === 403) throw new Error("לא ניתן לאמת את הבקשה. התחברו מחדש ונסו שוב.");
    if (response.status === 400) {
        const data = await response.json().catch(() => null);
        const field = Object.keys(fieldErrors).find((key) => data?.[key]);
        throw new Error(field ? fieldErrors[field] : "בדקו את פרטי הפגישה ונסו שוב.");
    }
    if (!response.ok) throw new Error("לא הצלחנו להשלים את הפעולה כרגע. נסו שוב.");
    return response.json();
}

export function meetingsApi(weddingId: number) {
    const base = `/api/weddings/${weddingId}/meetings/`;
    return {
        list: (params: URLSearchParams, signal: AbortSignal) => request<MeetingPage>(`${base}?${params}`, signal),
        summary: (params: URLSearchParams, signal: AbortSignal) => request<{ count: number; first: Meeting | null }>(`${base}?summary=1&${params}`, signal),
        detail: (id: number, signal: AbortSignal) => request<Meeting>(`${base}${id}/`, signal),
        save: (data: Partial<MeetingInput>, signal: AbortSignal, id?: number) =>
            request<Meeting>(id ? `${base}${id}/` : base, signal, id ? "PATCH" : "POST", data),
        remove: (id: number, signal: AbortSignal) => request<void>(`${base}${id}/`, signal, "DELETE"),
        dates: (params: URLSearchParams, signal: AbortSignal) => request<string[]>(`${base}dates/?${params}`, signal),
        options: (signal: AbortSignal) => request<Resource[]>(`${base}options/`, signal),
        upcoming: (scope: Scope, signal: AbortSignal) => request<Meeting[]>(`${base}upcoming/?scope=${scope}`, signal),
    };
}

const dayFormat = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const todayFormat = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Jerusalem" });
export const meetingDateLabel = (date: string) => dayFormat.format(new Date(date + "T12:00:00Z"));
export const meetingToday = () => todayFormat.format(new Date());
export const meetingError = (cause: unknown) => cause instanceof Error && !(cause instanceof TypeError)
    ? cause.message : "לא הצלחנו להתחבר לשרת. נסו שוב.";

export const resourceValue = (resource: Resource) => `${resource.kind}:${resource.id}`;

export function isMeetingSummary(value: unknown): value is Meeting {
    if (!value || typeof value !== "object") return false;
    const meeting = value as Partial<Meeting>;
    return Number.isSafeInteger(meeting.id) && typeof meeting.title === "string" && typeof meeting.date === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(meeting.date) && Number.isFinite(Date.parse(meeting.date))
        && typeof meeting.start_time === "string" && typeof meeting.starts_at === "string";
}
