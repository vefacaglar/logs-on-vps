import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PreferencesProvider } from "./app/Preferences";
import App from "./app/App";
import { ClientBoundary } from "./app/ClientBoundary";
import "./styles/global.css";
const cache = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={cache}>
    <PreferencesProvider>
      <BrowserRouter>
        <ClientBoundary>
          <App />
        </ClientBoundary>
      </BrowserRouter>
    </PreferencesProvider>
  </QueryClientProvider>,
);
