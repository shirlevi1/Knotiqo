import { useEffect, useState } from "react";
import Login from "./Login";
import RSVPPage from "./RSVPPage";

const rsvpPrefix = "#/rsvp/";

function currentRSVPToken() {
  const hash = window.location.hash;
  return hash.startsWith(rsvpPrefix) ? hash.slice(rsvpPrefix.length) : null;
}

function App() {
  const [token, setToken] = useState(currentRSVPToken);
  const { pathname, hash } = window.location;
  useEffect(() => {
    const update = () => setToken(currentRSVPToken());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  if (token !== null) return <RSVPPage key={token} token={token} />;
  if (pathname === "/invite" || pathname.startsWith("/invite/")) {
    return <Login invitationToken={hash.slice(1) || pathname.slice("/invite/".length)} />;
  }
  return <Login />;
}

export default App;
