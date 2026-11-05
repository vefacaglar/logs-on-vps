package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

const nativeHTML = `<!doctype html><html><head><script src="./assets/native.js"></script><link rel="stylesheet" href="./assets/native.css"></head><body><div id="root"></div></body></html>`

func TestVMUIThemeInjectionPreservesApplicationAndCompression(t *testing.T) {
	for _, compressed := range []bool{false, true} {
		t.Run(strconv.FormatBool(compressed), func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Accept-Encoding") != "identity" {
					t.Error("HTML was not requested uncompressed")
				}
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.Header().Set("ETag", `"original"`)
				w.Header().Set("Cache-Control", "public, max-age=3600")
				if compressed {
					w.Header().Set("Content-Encoding", "gzip")
					gz := gzip.NewWriter(w)
					_, _ = gz.Write([]byte(nativeHTML))
					_ = gz.Close()
				} else {
					_, _ = w.Write([]byte(nativeHTML))
				}
			}))
			defer upstream.Close()
			s := testServer(t, upstream.URL, false)
			cookie := signIn(t, s)
			w := request(s, "GET", "/select/vmui/", "", cookie)
			if w.Code != 200 {
				t.Fatalf("theme proxy: %d %s", w.Code, w.Body)
			}
			body := w.Body.String()
			for _, part := range []string{`src="./assets/native.js"`, `href="./assets/native.css"`, `id="root"`, `href="/static/advanced.css"`, `src="/static/advanced.js"`, `id="logs-advanced-shell"`, `Gelişmiş sorgu`, `Konsola dön`} {
				if !strings.Contains(body, part) {
					t.Errorf("lost HTML element %s", part)
				}
			}
			if strings.Index(body, "advanced.css") < strings.Index(body, "native.css") {
				t.Error("theme must follow native styles")
			}
			if strings.Index(body, "logs-advanced-shell") > strings.Index(body, `id="root"`) {
				t.Error("masthead must precede app root")
			}
			if w.Header().Get("Content-Encoding") != "" || w.Header().Get("ETag") != "" || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("stale encoding or cache metadata")
			}
			if w.Header().Get("Content-Length") != strconv.Itoa(len(w.Body.Bytes())) {
				t.Fatal("incorrect rewritten byte length")
			}
		})
	}
}

func TestVMUIThemeLeavesAssetsQueryStreamsAndErrorsUntouched(t *testing.T) {
	for _, tt := range []struct {
		path, kind string
		code       int
	}{
		{"/select/vmui/assets/native.js", "text/javascript", 200},
		{"/select/vmui/assets/native.css", "text/css", 200},
		{"/select/logsql/query", "text/html", 200},
		{"/select/vmui/", "text/html", 503},
	} {
		response := &http.Response{StatusCode: tt.code, Header: http.Header{"Content-Type": {tt.kind}, "Etag": {`"unchanged"`}}, Body: io.NopCloser(strings.NewReader("untouched")), Request: httptest.NewRequest("GET", tt.path, nil)}
		if err := styleVMUI(response); err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		if string(body) != "untouched" || response.Header.Get("ETag") != `"unchanged"` {
			t.Fatalf("rewrote %s", tt.path)
		}
	}
}

func TestVMUIThemeRejectsUnexpectedOrOversizedHTML(t *testing.T) {
	for _, body := range []string{"<html>unexpected</html>", strings.Repeat("x", (1<<20)+1)} {
		response := &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/html"}}, Body: io.NopCloser(strings.NewReader(body)), Request: httptest.NewRequest("GET", "/select/vmui/", nil)}
		if err := styleVMUI(response); err == nil {
			t.Fatal("unexpected HTML silently accepted")
		}
	}
}

func TestVMUIThemeIsIdempotent(t *testing.T) {
	response := &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/html"}}, Body: io.NopCloser(strings.NewReader(nativeHTML)), Request: httptest.NewRequest("GET", "/select/vmui/", nil)}
	if err := styleVMUI(response); err != nil {
		t.Fatal(err)
	}
	first, _ := io.ReadAll(response.Body)
	response.Body = io.NopCloser(bytes.NewReader(first))
	if err := styleVMUI(response); err != nil {
		t.Fatal(err)
	}
	second, _ := io.ReadAll(response.Body)
	if !bytes.Equal(first, second) {
		t.Fatal("theme was injected twice")
	}
}
