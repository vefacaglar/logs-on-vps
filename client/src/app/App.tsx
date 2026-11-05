import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { usePreferences } from "./Preferences";
import { Shell, ErrorMessage } from "./Shell";
import styles from "./App.module.css";
const Login = lazy(() => import("../features/auth/Login"));
const Console = lazy(() => import("../features/logs/Console"));
const Explore = lazy(() => import("../features/explore/Explore"));
const Overview = lazy(() => import("../features/overview/Overview"));
function Loading() {
  const { t } = usePreferences();
  return (
    <p className={styles.loading} role="status">
      {t("loading")}
    </p>
  );
}
function Protected() {
  const location = useLocation();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: ({ signal }) =>
      api<{ username: string }>("/api/session", undefined, signal),
    retry: false,
    staleTime: 60000,
  });
  if (session.isPending) return <Loading />;
  if (session.error instanceof ApiError && session.error.status === 401)
    return (
      <Navigate
        replace
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
      />
    );
  if (session.error) return <ErrorMessage error={session.error} />;
  return (
    <Shell username={session.data!.username}>
      <Outlet />
    </Shell>
  );
}
export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Protected />}>
          <Route index element={<Console />} />
          <Route path="explore" element={<Explore />} />
          <Route path="overview" element={<Overview />} />
        </Route>
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </Suspense>
  );
}
