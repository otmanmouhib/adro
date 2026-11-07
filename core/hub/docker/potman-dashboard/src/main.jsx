import { lazy, Suspense } from "preact/compat";
import { render } from "preact";
import { Route, Router } from "wouter-preact";
import "./index.css";
import Sidebar from "@/components/Sidebar";
import Home from "@/pages/Home";
import Wifi from "@/pages/Wifi";

// Devices pulls in mqtt.js, so load it only when the page is opened.
const Devices = lazy(() => import("@/pages/Devices"));
const Systems = lazy(() => import("@/pages/Systems"));

function App() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 lg:p-12">
        <Router>
          <Route path="/" component={Home} />
          <Route path="/wifi" component={Wifi} />
          <Route path="/devices">
            <Suspense fallback={null}>
              <Devices />
            </Suspense>
          </Route>
          <Route path="/systems">
            <Suspense fallback={null}>
              <Systems />
            </Suspense>
          </Route>
        </Router>
      </main>
    </div>
  );
}

render(<App />, document.getElementById("app"));
