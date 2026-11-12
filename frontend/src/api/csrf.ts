export function getCsrfToken(): string {
    const cookie = document.cookie
        .split("; ")
        .find((item) => item.startsWith("csrftoken="));

    return cookie
        ? decodeURIComponent(cookie.substring("csrftoken=".length))
        : "";
}
