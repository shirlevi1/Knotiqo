import { getCsrfToken } from "./csrf";

export const sides = { bride: "כלה", groom: "חתן", joint: "משותף", unassigned: "לא משויך" } as const;
export const categories = { adult: "מבוגר", child: "ילד", infant: "תינוק" } as const;
export const archives = { active: "פעילים", archived: "בארכיון", all: "הכול" } as const;
export const guestFields = {
    full_name: "שם מלא", phone: "טלפון", email: "אימייל", side: "צד בחתונה",
    category: "קטגוריה", party_size: "כמות מוזמנים", family_group: "קבוצה משפחתית", notes: "הערות",
    adult_count: "מבוגרים", child_count: "ילדים", infant_count: "תינוקות",
} as const;
export const ageFields = ["adult_count", "child_count", "infant_count"] as const;
export type AgeField = (typeof ageFields)[number];
export type ImportField = keyof typeof guestFields;
export type Side = keyof typeof sides;
export type Category = keyof typeof categories;
export type Archive = keyof typeof archives;
export type GuestInput = {
    full_name: string; phone: string; email: string; side: Side; category: Category;
    party_size: number; family_group: string; notes: string; tags: string[];
} & Partial<Record<AgeField, number>>;
export type Guest = Omit<GuestInput, AgeField> & {
    id: number; unnamed_companions: number; is_archived: boolean; created_at: string; updated_at: string;
    unclassified_count: number;
} & { [Field in AgeField]: number | null };
export type GuestFilters = { search: string; side: Side | ""; category: Category | ""; archive: Archive; page: number };
export type GuestList = {
    count: number; next: string | null; previous: string | null; results: Guest[];
    summary: Record<Side | AgeField, number> & { records: number; attendees: number; unnamed_companions: number; unclassified_count: number };
};
export type Column = { column: number; heading: string; suggested_field: ImportField | null };
export type Worksheet = { name: string; columns: Column[] };
export type ImportSession = { session_id: string; expires_at: string; worksheets: Worksheet[] };
export type Mapping = Partial<Record<ImportField, number>>;
export type MatchReason = "phone" | "email" | "name";
export type Candidate = Pick<Guest, "id" | "full_name" | "phone" | "email" | "is_archived" | "updated_at"> & {
    matched_on: MatchReason[];
};
export type PreviewRow = {
    row: number; values: Partial<Record<ImportField, string>>; errors: Record<string, string[]>; warnings: string[];
    duplicates?: { rows: { row: number; matched_on: MatchReason[] }[]; guests: Candidate[] };
};
export type Preview = { preview_id: string; worksheet: string; rows: PreviewRow[]; unmapped_columns: Column[] };
export type Decision = { row: number } & (
    { action: "create" | "skip" } | { action: "update" | "restore"; guest_id: number }
);
export type ImportResult = { created: number; skipped: number; updated: number; restored: number };

const errors: Record<string, string> = {
    invalid_upload: "בחרו קובץ Excel אחד.",
    unsupported_file: "יש לבחור קובץ בפורמט XLSX.",
    invalid_workbook: "מבנה קובץ האקסל אינו תקין. פתחו אותו באקסל ושמרו מחדש כקובץ XLSX.",
    unsupported_workbook: "מבנה הקובץ אינו נתמך. שמרו אותו כקובץ XLSX רגיל.",
    workbook_limits: "הקובץ חורג ממגבלות הייבוא. נסו לצמצם את מספר השורות או העמודות.",
    workbook_row_limit: "בגיליון יש יותר מ־500 שורות עם נתונים. פצלו את הרשימה לכמה גיליונות וייבאו כל גיליון בנפרד.",
    workbook_row_position: "יש נתונים אחרי שורה 4096. העבירו אותם קרוב יותר לתחילת הגיליון ונסו שוב.",
    workbook_column_limit: "יש נתונים מעבר ל־32 העמודות הראשונות בגיליון. העבירו את הנתונים לעמודות הראשונות.",
    workbook_package_limit: "מבנה קובץ האקסל גדול מדי לאחר פתיחה. העתיקו את הנתונים לקובץ XLSX חדש ונסו שוב.",
    workbook_metadata_limit: "הגיליון מכיל יותר מדי תאים או שורות מעוצבים. העתיקו את הנתונים בלבד לגיליון חדש.",
    workbook_sheet_limit: "אפשר לייבא קובץ עם עד שמונה גיליונות. צמצמו את מספר הגיליונות ונסו שוב.",
    workbook_text_limit: "הטקסט בקובץ ארוך מדי לייבוא. קצרו הערות או פצלו את הנתונים בין קבצים.",
    workbook_timeout: "קריאת הקובץ נמשכה זמן רב מדי. נסו קובץ קטן יותר.",
    file_size: "הקובץ גדול מדי. הגודל המרבי הוא 2 MiB.",
    request_size: "הבקשה גדולה מדי. צמצמו את הבחירה או את גודל הקובץ.",
    invalid_mapping: "בדקו את הגיליון ואת מיפוי העמודות.",
    invalid_selection: "חלק מההחלטות אינן תקינות. בדקו את השורות והבחירות.",
    session_expired: "תוקף הייבוא פג. העלו את הקובץ מחדש.",
    already_confirmed: "הייבוא הזה כבר אושר. רעננו את הרשימה.",
    stale_preview: "התצוגה המקדימה השתנתה. הכינו תצוגה חדשה.",
    guest_changed: "אחד המוזמנים השתנה בינתיים. חזרו למיפוי והכינו תצוגה חדשה.",
    guest_age_conflict: "כדי לשנות את הכמות ברשומה עם פירוט גילאים, מַפּו גם את עמודות הגילאים או הסירו את מיפוי הכמות.",
    guest_list_limit: "רשימת המוזמנים גדולה מדי לבדיקת כפילויות.",
    session_limit: "יש יותר מדי ייבואים פתוחים. המתינו ונסו שוב.",
    export_limit: "הרשימה גדולה מדי לייצוא אחד. נסו לייצא מצב ארכיון אחר.",
};
const authError = "לא ניתן לאמת את הבקשה. רעננו את העמוד והתחברו שוב במידת הצורך.";
export class GuestApiError extends Error {
    constructor(message: string, fields: string[] = [], code = "") {
        super(message);
        this.fields = fields;
        this.code = code;
    }
    readonly fields: string[];
    readonly code: string;
}

async function guestRequest(url: string, signal: AbortSignal, method = "GET", body?: object) {
    const options = { signal, credentials: "same-origin", cache: "no-store" } as const;
    const headers: Record<string, string> = {};
    if (method !== "GET") {
        const csrf = await fetch("/api/auth/csrf/", options);
        const token = getCsrfToken();
        if (!csrf.ok || !token) throw new GuestApiError(authError);
        headers["X-CSRFToken"] = token;
        if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
    }
    signal.throwIfAborted();
    const response = await fetch(url, {
        ...options, method, headers, body: body instanceof FormData ? body : body && JSON.stringify(body),
    });
    if (response.ok) return response;
    const data = await response.json().catch(() => null);
    const code = typeof data?.error?.code === "string" ? data.error.code : "";
    if (Object.hasOwn(errors, code)) throw new GuestApiError(errors[code], [], code);
    if (response.status === 401 || response.status === 403) throw new GuestApiError(authError);
    if (response.status === 404) throw new GuestApiError("הפריט אינו זמין בחתונה הזו. רעננו את הרשימה.");
    if (response.status === 400) throw new GuestApiError("בדקו את הפרטים שהוזנו ונסו שוב.", Object.keys(data ?? {}));
    throw new GuestApiError("לא ניתן להשלים את הבקשה כרגע. נסו שוב.");
}

export function guestError(error: unknown) {
    return error instanceof GuestApiError ? error.message : "לא הצלחנו להתחבר לשרת. בדקו את החיבור ונסו שוב.";
}

export function guestsApi(weddingId: number) {
    const base = `/api/weddings/${weddingId}/guests/`;
    const session = (id: string) => `${base}import/${encodeURIComponent(id)}/`;
    async function json<T>(url: string, signal: AbortSignal, method = "GET", body?: object): Promise<T> {
        return (await guestRequest(url, signal, method, body)).json();
    }
    return {
        list(filters: GuestFilters, signal: AbortSignal) {
            const query = new URLSearchParams({ archive: filters.archive, page: String(filters.page) });
            for (const field of ["search", "side", "category"] as const) {
                if (filters[field]) query.set(field, filters[field]);
            }
            return json<GuestList>(`${base}?${query}`, signal);
        },
        save(data: GuestInput, signal: AbortSignal, id?: number) {
            return json<Guest>(id ? `${base}${id}/` : base, signal, id ? "PATCH" : "POST", data);
        },
        archive(id: number, archived: boolean, signal: AbortSignal) {
            return guestRequest(`${base}${id}/`, signal, archived ? "DELETE" : "PATCH", archived ? undefined : { is_archived: false });
        },
        upload(file: File, signal: AbortSignal) {
            const data = new FormData();
            data.append("workbook", file);
            return json<ImportSession>(base + "import/", signal, "POST", data);
        },
        preview(id: string, worksheet: string, mapping: Mapping, signal: AbortSignal) {
            return json<Preview>(session(id) + "preview/", signal, "POST", { worksheet, mapping });
        },
        confirm(id: string, preview_id: string, decisions: Decision[], signal: AbortSignal) {
            return json<ImportResult>(session(id) + "confirm/", signal, "POST", { preview_id, decisions });
        },
        async download(kind: "template" | "export", archive: Archive, signal: AbortSignal) {
            const query = kind === "export" && archive !== "active" ? `?archive=${archive}` : "";
            const response = await guestRequest(`${base}${kind}/${query}`, signal);
            if (response.headers.get("Content-Type")?.split(";")[0] !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
                throw new GuestApiError("השרת לא החזיר קובץ Excel תקין.");
            }
            const name = /filename="?([\w.-]+\.xlsx)"?(?:;|$)/i.exec(response.headers.get("Content-Disposition") ?? "")?.[1];
            const blob = await response.blob();
            signal.throwIfAborted();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = name ?? (kind === "template" ? "knotiqo-guest-template.xlsx" : "knotiqo-guests.xlsx");
            document.body.append(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
    };
}
