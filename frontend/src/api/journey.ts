import { getCsrfToken } from "./csrf";

export type TaskStatus = "open" | "done" | "skipped";
export type JourneyTask = {
    key: string; stage: number; title: string; description: string; status: TaskStatus;
    priority: "normal" | "high"; due_date: string | null; overdue: boolean; custom: boolean; module: string; has_evidence: boolean;
};
export type Progress = { completed: number; total: number; skipped: number; percentage: number | null };
export type PlanningFeature = "vendors" | "payments" | "rsvp";
export type FeatureVisibility = Record<PlanningFeature, { visible: boolean; activated: boolean; has_data: boolean; recommended: boolean }>;
export type JourneySummary = { wedding_date: string | null; recommended_stage: number | null;
    recommended_stage_title: string | null; progress: Progress; next_actions: JourneyTask[]; features?: FeatureVisibility };
export type Journey = JourneySummary & {
    stages: { id: number; title: string; progress: Progress; tasks: JourneyTask[] }[];
};
export type TaskInput = Partial<Pick<JourneyTask, "stage" | "title" | "description" | "status" | "priority" | "due_date">>
    & { move?: "up" | "down" };

export function journeyApi(weddingId: number) {
    const base = `/api/weddings/${weddingId}/journey/`;
    async function request<T>(path: string, signal: AbortSignal, method = "GET", data?: TaskInput): Promise<T> {
        const options = { signal, credentials: "same-origin", cache: "no-store" } as const;
        const headers: Record<string, string> = {};
        if (method !== "GET") {
            const csrf = await fetch("/api/auth/csrf/", options);
            const token = getCsrfToken();
            if (!csrf.ok || !token) throw new Error("לא ניתן לאמת את הבקשה. רעננו את הדף ונסו שוב.");
            headers["X-CSRFToken"] = token;
            headers["Content-Type"] = "application/json";
        }
        const response = await fetch(path, { ...options, headers, method, body: data ? JSON.stringify(data) : undefined });
        if (response.status === 400) throw new Error("בדקו את פרטי המשימה ונסו שוב.");
        if (response.status === 404) throw new Error("המשימה או החתונה אינן זמינות.");
        if (response.status === 403) throw new Error("לא ניתן לאמת את הבקשה. התחברו מחדש ונסו שוב.");
        if (!response.ok) throw new Error("לא הצלחנו לטעון או לשמור את המסלול כרגע.");
        const result = await response.json();
        if (!result?.progress || !Array.isArray(result.next_actions)) throw new Error("התקבלה תשובה לא צפויה מהשרת.");
        return result;
    }
    return {
        load: (signal: AbortSignal) => request<Journey>(base, signal),
        summary: (signal: AbortSignal) => request<JourneySummary>(base + "?summary=1", signal),
        activate: (feature: PlanningFeature, signal: AbortSignal) => request<JourneySummary>(`${base}features/${feature}/`, signal, "POST"),
        create: (input: TaskInput, signal: AbortSignal) => request<Journey>(base, signal, "POST", input),
        edit: (key: string, input: TaskInput, signal: AbortSignal) => request<Journey>(`${base}tasks/${key}/`, signal, "PATCH", input),
        remove: (key: string, signal: AbortSignal) => request<Journey>(`${base}tasks/${key}/`, signal, "DELETE"),
    };
}

export const journeyError = (value: unknown) => value instanceof Error && !(value instanceof TypeError) ? value.message
    : "לא הצלחנו להתחבר לשרת. נסו שוב.";
