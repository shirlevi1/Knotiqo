import Login from "./Login";

function App() {
  const { pathname, hash } = window.location;
  if (pathname === "/invite" || pathname.startsWith("/invite/")) {
    return <Login invitationToken={hash.slice(1) || pathname.slice("/invite/".length)} />;
  }
  return <Login />;
}

export default App;
