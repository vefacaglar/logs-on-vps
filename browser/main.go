package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

//go:embed static
var assets embed.FS

const sessionLifetime = 12 * time.Hour

type server struct {
	username, passwordHash, upstream string
	insecure                         bool
	client                           *http.Client
	proxy                            *httputil.ReverseProxy
	mu                               sync.Mutex
	sessions                         map[[32]byte]time.Time
	loginAttempts                    []time.Time
	loginSlot                        chan struct{}
	querySlots                       chan struct{}
}

func newServer(username, hash, upstream string, insecure bool) (*server, error) {
	if username == "" {
		return nil, fmt.Errorf("LOGS_UI_USERNAME is required")
	}
	if _, err := bcrypt.Cost([]byte(hash)); err != nil {
		return nil, fmt.Errorf("LOGS_UI_PASSWORD_HASH must be a bcrypt hash")
	}
	u, err := url.Parse(upstream)
	if err != nil || u.Scheme != "http" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Path != "" {
		return nil, fmt.Errorf("invalid VICTORIALOGS_URL")
	}
	s := &server{username: username, passwordHash: hash, upstream: upstream, insecure: insecure,
		client: &http.Client{Timeout: 25 * time.Second}, sessions: make(map[[32]byte]time.Time), loginSlot: make(chan struct{}, 1), querySlots: make(chan struct{}, 2)}
	s.proxy = httputil.NewSingleHostReverseProxy(u)
	director := s.proxy.Director
	s.proxy.Director = func(r *http.Request) {
		director(r)
		r.Header.Del("Authorization")
		r.Header.Del("Cookie")
	}
	s.proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) { fail(w, 502, "Log servisine ulaşılamıyor.") }
	return s, nil
}

func (s *server) cookieName() string {
	if s.insecure {
		return "logs_session"
	}
	return "__Host-logs_session"
}

func (s *server) authenticated(r *http.Request) bool {
	c, err := r.Cookie(s.cookieName())
	if err != nil || len(c.Value) != 64 {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	key := sha256.Sum256([]byte(c.Value))
	expires, ok := s.sessions[key]
	if !ok || time.Now().After(expires) {
		delete(s.sessions, key)
		return false
	}
	return true
}

func (s *server) sameOrigin(r *http.Request) bool {
	scheme := "https"
	if s.insecure {
		scheme = "http"
	}
	return r.Header.Get("Origin") == scheme+"://"+r.Host && r.Header.Get("X-Requested-With") == "logs-ui"
}

func (s *server) setCookie(w http.ResponseWriter, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: s.cookieName(), Value: token, Path: "/", MaxAge: maxAge,
		Secure: !s.insecure, HttpOnly: true, SameSite: http.SameSiteStrictMode})
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, message string) {
	respond(w, status, map[string]string{"error": message})
}

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	if r.Header.Get("Content-Type") != "application/json" {
		fail(w, 415, "JSON isteği bekleniyor.")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		fail(w, 400, "İstek okunamadı.")
		return false
	}
	if d.Decode(new(any)) != io.EOF {
		fail(w, 400, "Geçersiz istek.")
		return false
	}
	return true
}

func (s *server) login(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		fail(w, 403, "Geçersiz istek kaynağı.")
		return
	}
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &input) {
		return
	}
	if len(input.Password) > 72 || len(input.Username) > 64 {
		fail(w, 401, "Kullanıcı adı veya şifre yanlış.")
		return
	}
	now := time.Now()
	s.mu.Lock()
	fresh := s.loginAttempts[:0]
	for _, t := range s.loginAttempts {
		if now.Sub(t) < time.Minute {
			fresh = append(fresh, t)
		}
	}
	s.loginAttempts = fresh
	limited := len(fresh) >= 6
	if !limited {
		s.loginAttempts = append(s.loginAttempts, now)
	}
	s.mu.Unlock()
	if limited {
		w.Header().Set("Retry-After", "60")
		fail(w, 429, "Çok fazla deneme. Bir dakika sonra tekrar dene.")
		return
	}
	select {
	case s.loginSlot <- struct{}{}:
		defer func() { <-s.loginSlot }()
	default:
		fail(w, 429, "Biraz sonra tekrar dene.")
		return
	}
	validPassword := bcrypt.CompareHashAndPassword([]byte(s.passwordHash), []byte(input.Password)) == nil
	validUser := subtle.ConstantTimeCompare([]byte(input.Username), []byte(s.username)) == 1
	if !validPassword || !validUser {
		fail(w, 401, "Kullanıcı adı veya şifre yanlış.")
		return
	}
	var tokenBytes [32]byte
	if _, err := rand.Read(tokenBytes[:]); err != nil {
		fail(w, 500, "Oturum açılamadı.")
		return
	}
	token := hex.EncodeToString(tokenBytes[:])
	s.mu.Lock()
	for k, t := range s.sessions {
		if now.After(t) {
			delete(s.sessions, k)
		}
	}
	if c, err := r.Cookie(s.cookieName()); err == nil {
		delete(s.sessions, sha256.Sum256([]byte(c.Value)))
	}
	if len(s.sessions) >= 64 {
		s.mu.Unlock()
		fail(w, 429, "Oturum sınırına ulaşıldı.")
		return
	}
	s.sessions[sha256.Sum256([]byte(token))] = now.Add(sessionLifetime)
	s.mu.Unlock()
	s.setCookie(w, token, int(sessionLifetime.Seconds()))
	respond(w, 200, map[string]string{"username": s.username})
}

type logRequest struct {
	Query   string `json:"query"`
	Service string `json:"service"`
	Level   string `json:"level"`
	Start   string `json:"start"`
	End     string `json:"end"`
	Offset  int    `json:"offset"`
}

func (input logRequest) params() (url.Values, error) {
	start, e1 := time.Parse(time.RFC3339Nano, input.Start)
	end, e2 := time.Parse(time.RFC3339Nano, input.End)
	if e1 != nil || e2 != nil || !end.After(start) || end.Sub(start) > 31*24*time.Hour || end.After(time.Now().Add(time.Minute)) {
		return nil, fmt.Errorf("Geçerli bir zaman aralığı seç (en fazla 31 gün).")
	}
	if len(input.Query) > 4096 || strings.Contains(input.Query, "|") {
		return nil, fmt.Errorf("Burada yalnız LogsQL filtreleri kullanılabilir. Pipeline sorguları için gelişmiş arayüzü aç.")
	}
	if input.Offset < 0 || input.Offset > 1000000 || len(input.Service) > 256 {
		return nil, fmt.Errorf("Sorgu sınırı aşıldı. Zaman aralığını daralt.")
	}
	query := strings.TrimSpace(input.Query)
	if query == "" {
		query = "*"
	}
	filters := []string{}
	if input.Service != "" {
		filters = append(filters, "compose_service:="+strconv.Quote(input.Service))
	}
	switch input.Level {
	case "":
	case "error":
		filters = append(filters, `level:in("error", "fatal", "panic")`)
	case "warn", "info", "debug":
		filters = append(filters, "level:="+strconv.Quote(input.Level))
	default:
		return nil, fmt.Errorf("Geçersiz log seviyesi.")
	}
	p := url.Values{"query": {query}, "start": {start.UTC().Format(time.RFC3339Nano)}, "end": {end.UTC().Format(time.RFC3339Nano)}, "timeout": {"20s"}}
	if len(filters) > 0 {
		p.Set("extra_filters", strings.Join(filters, " AND "))
	}
	return p, nil
}

func (s *server) query(r *http.Request, p url.Values) ([]map[string]any, error) {
	select {
	case s.querySlots <- struct{}{}:
		defer func() { <-s.querySlots }()
	case <-r.Context().Done():
		return nil, r.Context().Err()
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", s.upstream+"/select/logsql/query", strings.NewReader(p.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("query rejected (%d)", res.StatusCode)
	}
	scanner := bufio.NewScanner(io.LimitReader(res.Body, (8<<20)+1))
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	rows := make([]map[string]any, 0)
	size := 0
	for scanner.Scan() {
		size += len(scanner.Bytes()) + 1
		if size > 8<<20 || len(rows) >= 1000 {
			return nil, fmt.Errorf("response too large")
		}
		var row map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &row); err != nil {
			return nil, err
		}
		rows = append(rows, row)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return rows, nil
}

func (s *server) logs(w http.ResponseWriter, r *http.Request, services bool) {
	if !s.sameOrigin(r) {
		fail(w, 403, "Geçersiz istek kaynağı.")
		return
	}
	var input logRequest
	if !decode(w, r, &input) {
		return
	}
	p, err := input.params()
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	if services {
		// Service list is independent of the selected service/level/search filter.
		p.Set("query", "* | stats by (compose_service) count() as count | sort by (count) desc | limit 100")
		p.Del("extra_filters")
	} else {
		// Explicit secondary keys keep equal timestamps in a repeatable order.
		p.Set("query", fmt.Sprintf("(%s) | sort by (_time desc, _stream_id, _msg) offset %d limit 101", p.Get("query"), input.Offset))
	}
	rows, err := s.query(r, p)
	if err != nil {
		fail(w, 502, "Sorgu tamamlanamadı. Filtreyi kontrol et veya zaman aralığını daralt.")
		return
	}
	if services {
		respond(w, 200, map[string]any{"services": rows})
		return
	}
	hasMore := len(rows) > 100
	if hasMore {
		rows = rows[:100]
	}
	respond(w, 200, map[string]any{"logs": rows, "hasMore": hasMore, "nextOffset": input.Offset + len(rows)})
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	path := r.URL.Path
	if r.Method == "GET" && (strings.HasPrefix(path, "/assets/") || strings.HasPrefix(path, "/fonts/") || path == "/favicon.svg" || path == "/preferences.js") {
		if strings.Contains(path, "..") || strings.HasSuffix(path, "/") {
			http.NotFound(w, r)
			return
		}
		sub, _ := fs.Sub(assets, "static")
		http.FileServer(http.FS(sub)).ServeHTTP(w, r)
		return
	}
	// Old bookmarks reach our workspace. Native VictoriaLogs UI/assets are never served.
	if path == "/select/vmui" || path == "/select/vmui/" || path == "/select/vmui/index.html" {
		http.Redirect(w, r, "/explore", http.StatusSeeOther)
		return
	}
	if path == "/api/login" && r.Method == "POST" {
		s.login(w, r)
		return
	}
	if path == "/login" && r.Method == "GET" {
		if s.authenticated(r) {
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}
		servePage(w, "index.html")
		return
	}
	page := path == "/" || path == "/explore" || path == "/overview"
	known := page || path == "/api/session" || path == "/api/logout" || path == "/api/logs" || path == "/api/services" || readAPI[path]
	if !known {
		http.NotFound(w, r)
		return
	}
	if !s.authenticated(r) {
		if r.Method == "GET" && page {
			destination := "/login"
			if path != "/" {
				destination += "?next=" + url.QueryEscape(r.URL.RequestURI())
			}
			http.Redirect(w, r, destination, http.StatusSeeOther)
		} else {
			fail(w, 401, "Oturum sona erdi. Tekrar giriş yap.")
		}
		return
	}
	switch {
	case page && r.Method == "GET":
		servePage(w, "index.html")
	case path == "/api/session" && r.Method == "GET":
		respond(w, 200, map[string]string{"username": s.username})
	case path == "/api/logout" && r.Method == "POST":
		if !s.sameOrigin(r) {
			fail(w, 403, "Geçersiz istek kaynağı.")
			return
		}
		c, _ := r.Cookie(s.cookieName())
		s.mu.Lock()
		delete(s.sessions, sha256.Sum256([]byte(c.Value)))
		s.mu.Unlock()
		s.setCookie(w, "", -1)
		respond(w, 200, map[string]bool{"ok": true})
	case path == "/api/logs" && r.Method == "POST":
		s.logs(w, r, false)
	case path == "/api/services" && r.Method == "POST":
		s.logs(w, r, true)
	case readAPI[path] && (r.Method == "GET" || r.Method == "POST"):
		if path == "/select/logsql/tail" {
			// Streams flush immediately and may stay open beyond normal page timeouts.
			_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
			cookie, _ := r.Cookie(s.cookieName())
			s.mu.Lock()
			expires := s.sessions[sha256.Sum256([]byte(cookie.Value))]
			s.mu.Unlock()
			ctx, cancel := context.WithDeadline(r.Context(), expires)
			defer cancel()
			r = r.WithContext(ctx)
		}
		s.proxy.ServeHTTP(w, r)
	default:
		fail(w, 405, "Bu yöntem desteklenmiyor.")
	}
}

func servePage(w http.ResponseWriter, name string) {
	data, err := assets.ReadFile("static/" + name)
	if err != nil {
		fail(w, 503, "Client is not built. Run npm ci && npm run build in client/.")
		return
	}
	var nonceBytes [16]byte
	if _, err := rand.Read(nonceBytes[:]); err != nil {
		fail(w, 500, "Client could not be loaded.")
		return
	}
	nonce := hex.EncodeToString(nonceBytes[:])
	data = []byte(strings.ReplaceAll(string(data), "__CSP_NONCE__", nonce))
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'nonce-"+nonce+"'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(data)
}

var readAPI = map[string]bool{
	"/select/logsql/query": true, "/select/logsql/tail": true, "/select/logsql/hits": true,
	"/select/logsql/field_names": true, "/select/logsql/field_values": true,
	"/select/logsql/facets": true, "/select/logsql/streams": true, "/select/logsql/stream_ids": true,
	"/select/logsql/stream_field_names": true, "/select/logsql/stream_field_values": true,
	"/select/logsql/stats_query": true, "/select/logsql/stats_query_range": true,
}

func main() {
	upstream := os.Getenv("VICTORIALOGS_URL")
	if upstream == "" {
		upstream = "http://victorialogs:9428"
	}
	s, err := newServer(os.Getenv("LOGS_UI_USERNAME"), os.Getenv("LOGS_UI_PASSWORD_HASH"), upstream, os.Getenv("LOGS_INSECURE_COOKIE") == "1")
	if err != nil {
		log.Fatal(err)
	}
	address := os.Getenv("LOGS_LISTEN")
	if address == "" {
		address = ":8080"
	}
	log.Printf("Log console listening on %s", address)
	log.Fatal((&http.Server{Addr: address, Handler: s, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 35 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}).ListenAndServe())
}
