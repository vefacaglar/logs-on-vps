package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func testServer(t *testing.T, upstream string, insecure bool) *server {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("test-password-123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	s, err := newServer("vefa", string(hash), upstream, insecure)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func request(s *server, method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://logs.example.test"+path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Requested-With", "logs-ui")
	scheme := "https"
	if s.insecure {
		scheme = "http"
	}
	r.Header.Set("Origin", scheme+"://logs.example.test")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}

func signIn(t *testing.T, s *server) *http.Cookie {
	t.Helper()
	w := request(s, "POST", "/api/login", `{"username":"vefa","password":"test-password-123"}`, nil)
	if w.Code != 200 {
		t.Fatalf("login: %d %s", w.Code, w.Body)
	}
	return w.Result().Cookies()[0]
}

func TestSessionLifecycleAndProtection(t *testing.T) {
	s := testServer(t, "http://localhost:9428", false)
	for _, path := range []string{"/api/session", "/api/logs", "/select/logsql/query"} {
		if got := request(s, "GET", path, "", nil).Code; got != 401 {
			t.Fatalf("%s: %d", path, got)
		}
	}
	if w := request(s, "GET", "/", "", nil); w.Code != 303 || w.Header().Get("Location") != "/login" {
		t.Fatal("anonymous UI did not redirect to login")
	}
	w := request(s, "POST", "/api/login", `{"username":"vefa","password":"incorrect"}`, nil)
	if w.Code != 401 || w.Header().Get("WWW-Authenticate") != "" {
		t.Fatal("invalid login must not trigger browser Basic Auth")
	}
	c := signIn(t, s)
	if !c.Secure || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.Path != "/" || c.Name != "__Host-logs_session" || c.MaxAge != 43200 {
		t.Fatalf("unsafe cookie: %+v", c)
	}
	if w := request(s, "GET", "/", "", c); w.Code != 200 || !strings.Contains(w.Body.String(), "tüm loglar") {
		t.Fatal("authenticated UI failed")
	}
	if w := request(s, "GET", "/api/session", "", c); w.Code != 200 {
		t.Fatal("session missing")
	}
	for _, path := range []string{"/insert/jsonline", "/delete/0", "/metrics", "/flags", "/debug/pprof/", "/health"} {
		if w := request(s, "POST", path, "", c); w.Code != 404 {
			t.Fatalf("published forbidden path: %s %d", path, w.Code)
		}
	}
	if w := request(s, "POST", "/api/logout", `{}`, c); w.Code != 200 || w.Result().Cookies()[0].MaxAge != -1 {
		t.Fatal("logout failed")
	}
	if w := request(s, "GET", "/api/session", "", c); w.Code != 401 {
		t.Fatal("logout did not revoke session")
	}
}

func TestOriginRateLimitExpirationAndRestart(t *testing.T) {
	s := testServer(t, "http://localhost:9428", false)
	for _, origin := range []string{"", "https://evil.example", "http://logs.example.test"} {
		r := httptest.NewRequest("POST", "http://logs.example.test/api/login", strings.NewReader(`{"username":"vefa","password":"test-password-123"}`))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Requested-With", "logs-ui")
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatalf("accepted Origin %q", origin)
		}
	}
	c := signIn(t, s)
	for key := range s.sessions {
		s.sessions[key] = time.Now().Add(-time.Second)
	}
	if request(s, "GET", "/api/session", "", c).Code != 401 {
		t.Fatal("expired session accepted")
	}
	other := testServer(t, "http://localhost:9428", false)
	if request(other, "GET", "/api/session", "", c).Code != 401 {
		t.Fatal("session survived server restart")
	}
	for i := 0; i < 6; i++ {
		request(s, "POST", "/api/login", `{"username":"vefa","password":"bad"}`, nil)
	}
	if w := request(s, "POST", "/api/login", `{"username":"vefa","password":"bad"}`, nil); w.Code != 429 || w.Header().Get("Retry-After") == "" {
		t.Fatal("missing login throttling")
	}
}

func TestQueryPaginationFiltersAndProxyIsolation(t *testing.T) {
	var received []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			t.Error("credentials forwarded upstream")
		}
		if r.URL.Path == "/select/vmui/" {
			w.Write([]byte("native UI"))
			return
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		received = append(received, r.Form.Get("query"))
		if r.Form.Get("start") != "2026-11-01T00:00:00Z" || r.Form.Get("end") != "2026-11-02T00:00:00Z" {
			t.Error("snapshot range changed")
		}
		if strings.Contains(r.Form.Get("query"), "stats by") {
			if r.Form.Get("extra_filters") != "" {
				t.Error("service list inherited filters")
			}
			fmt.Fprintln(w, `{"compose_service":"api","count":"260"}`)
			return
		}
		if r.Form.Get("extra_filters") != `compose_service:="api" AND level:in("error", "fatal", "panic")` {
			t.Errorf("filters: %s", r.Form.Get("extra_filters"))
		}
		offset := 0
		count := 101
		if strings.Contains(r.Form.Get("query"), "offset 100 ") {
			offset = 100
			count = 60
		}
		for i := 0; i < count; i++ {
			fmt.Fprintf(w, "{\"_time\":\"2026-11-01T12:00:00Z\",\"_msg\":\"message-%03d\"}\n", offset+i)
		}
	}))
	defer upstream.Close()
	s := testServer(t, upstream.URL, false)
	c := signIn(t, s)
	body := `{"query":"timeout","service":"api","level":"error","start":"2026-11-01T00:00:00Z","end":"2026-11-02T00:00:00Z","offset":%d}`
	seen := map[string]bool{}
	for _, offset := range []int{0, 100} {
		w := request(s, "POST", "/api/logs", fmt.Sprintf(body, offset), c)
		if w.Code != 200 {
			t.Fatalf("query: %s", w.Body)
		}
		var result struct {
			Logs       []map[string]any
			HasMore    bool
			NextOffset int
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.HasMore != (offset == 0) {
			t.Fatal("incorrect hasMore")
		}
		for _, row := range result.Logs {
			msg := row["_msg"].(string)
			if seen[msg] {
				t.Fatal("duplicate page row")
			}
			seen[msg] = true
		}
	}
	if len(seen) != 160 {
		t.Fatalf("lost rows: %d", len(seen))
	}
	if !strings.Contains(received[0], "sort by (_time desc, _stream_id, _msg)") {
		t.Fatal("missing deterministic sort")
	}
	if request(s, "POST", "/api/services", fmt.Sprintf(body, 0), c).Code != 200 {
		t.Fatal("service query failed")
	}
	r := httptest.NewRequest("GET", "http://logs.example.test/select/vmui/", nil)
	r.AddCookie(c)
	r.Header.Set("Authorization", "Basic test")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 200 || w.Body.String() != "native UI" {
		t.Fatal("native UI proxy failed")
	}
}

func TestInputAndUpstreamFailures(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "private internal failure", 500) }))
	defer upstream.Close()
	s := testServer(t, upstream.URL, false)
	c := signIn(t, s)
	valid := `{"query":"*","start":"2026-11-01T00:00:00Z","end":"2026-11-02T00:00:00Z"}`
	for _, body := range []string{`{}`, strings.Replace(valid, `"*"`, `"* | delete"`, 1), strings.Replace(valid, `"*"`, `"*","offset":-1`, 1), valid + `{}`} {
		if w := request(s, "POST", "/api/logs", body, c); w.Code != 400 {
			t.Fatalf("invalid input accepted: %s (%d)", body, w.Code)
		}
	}
	w := request(s, "POST", "/api/logs", valid, c)
	if w.Code != 502 || strings.Contains(w.Body.String(), "private internal") {
		t.Fatal("upstream failure leaked")
	}
}
