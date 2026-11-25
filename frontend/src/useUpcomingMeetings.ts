import { useEffect, useState } from "react";
import { isMeetingSummary, meetingError, meetingsApi, type Meeting, type Scope } from "./api/meetings";

export function useUpcomingMeetings(weddingId: number, scope: Scope) {
    const [state, setState] = useState<{ id: number; records: Meeting[]; error: string }>();
    useEffect(() => {
        const controller = new AbortController();
        void meetingsApi(weddingId).upcoming(scope, controller.signal).then((records) => {
            if (!controller.signal.aborted && Array.isArray(records) && records.every(isMeetingSummary)) setState({ id: weddingId, records, error: "" });
        }).catch((cause) => {
            if (!controller.signal.aborted) setState({ id: weddingId, records: [], error: meetingError(cause) });
        });
        return () => controller.abort();
    }, [weddingId, scope]);
    return state?.id === weddingId ? state : undefined;
}

