package main

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// The upstream remains responsible for the editor, charts, queries and views.
// Only its HTML shell is adapted; bundles and query responses are untouched.
func styleVMUI(response *http.Response) error {
	if response.StatusCode != http.StatusOK || response.Request == nil ||
		!strings.HasPrefix(response.Request.URL.Path, "/select/vmui/") ||
		!strings.HasPrefix(response.Header.Get("Content-Type"), "text/html") {
		return nil
	}
	defer response.Body.Close()
	var reader io.Reader = response.Body
	switch response.Header.Get("Content-Encoding") {
	case "", "identity":
	case "gzip":
		decoded, err := gzip.NewReader(response.Body)
		if err != nil {
			return err
		}
		defer decoded.Close()
		reader = decoded
	default:
		return fmt.Errorf("unsupported VMUI HTML encoding")
	}
	const maxHTML = 1 << 20
	body, err := io.ReadAll(io.LimitReader(reader, maxHTML+1))
	if err != nil {
		return err
	}
	if len(body) > maxHTML {
		return fmt.Errorf("VMUI HTML exceeds limit")
	}
	if !bytes.Contains(body, []byte(`id="logs-advanced-shell"`)) {
		if !bytes.Contains(body, []byte("</head>")) || !bytes.Contains(body, []byte("<body>")) {
			return fmt.Errorf("unrecognized VMUI HTML shell")
		}
		body = bytes.Replace(body, []byte("</head>"), []byte(`<link rel="stylesheet" href="/static/advanced.css">
<script type="module" src="/static/advanced.js"></script>
</head>`), 1)
		body = bytes.ReplaceAll(body, []byte(`href="./assets/favicon.svg"`), []byte(`href="/static/favicon.svg"`))
		body = bytes.Replace(body, []byte("<body>"), []byte(`<body>
<header id="logs-advanced-shell" class="logs-advanced-masthead">
  <nav aria-label="Konum">
    <a href="https://vefacaglar.com">Vefa Çağlar</a><span class="logs-advanced-separator">/</span>
    <a href="/">Logs</a><span class="logs-advanced-separator">/</span>
    <span class="logs-advanced-current">Gelişmiş sorgu</span>
  </nav>
  <div class="logs-advanced-account"><a href="/">Konsola dön ↗</a><button id="logs-advanced-logout" type="button">Çıkış ↗</button></div>
</header>`), 1)
	}
	response.Body = io.NopCloser(bytes.NewReader(body))
	response.ContentLength = int64(len(body))
	response.Header.Set("Content-Length", strconv.Itoa(len(body)))
	response.Header.Set("Cache-Control", "no-store")
	for _, header := range []string{"Content-Encoding", "ETag", "Last-Modified", "Content-MD5", "Digest", "Accept-Ranges"} {
		response.Header.Del(header)
	}
	return nil
}
