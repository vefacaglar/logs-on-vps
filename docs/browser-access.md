# Tarayıcıdan şifreli log erişimi

Hedef adres `https://logs.vefacaglar.com`. Kurulum ve günlük kullanım için VPS'e elle bağlanman gerekmez. GitHub secret'larını ve DNS kaydını sen ayarlarsın; workflow mevcut Caddy route'unu otomatik ekleyip doğrular ve yeniden yükler.

Akış: tarayıcı → mevcut Caddy (HTTPS) → `browser` servisi (kullanıcı adı/şifre) → VictoriaLogs. Browser servisi yalnız `/select/*` sorgu ve arayüz yollarını geçirir; `/insert`, `/delete`, `/metrics`, `/debug` gibi yollar yayınlanmaz. VictoriaLogs'un `9428` portu host üzerinde yalnız loopback'te kalır; browser servisinin host portu yoktur.

## GitHub secrets

Repo'da `Settings → Environments → logs-production → Environment secrets` altında bu iki secret'ı ekle:

| Secret | Değer |
| --- | --- |
| `LOGS_UI_USERNAME` | Giriş kullanıcı adı, örneğin `vefa`. 1–64 karakter; harf, sayı, `_` veya `-`. |
| `LOGS_UI_PASSWORD` | Senin belirlediğin güçlü şifre. 12–72 UTF-8 byte; başta/sonda boşluk veya satır sonu olmamalı. ASCII bir şifre için 12–72 karakter. |

Şifreyi sohbete veya repo'ya koyma. Workflow şifreyi Caddy'ye stdin üzerinden verip bcrypt hash'i üretir. VPS'e yalnız kullanıcı adı ve hash içeren `browser.env` dosyası gider; dosya modu `600`dür. Açık şifre komut argümanına veya dosyaya yazılmaz. `browser.env` ve üretilen `compose.override.yml` Git tarafından yok sayılır.

Güncel dosyaları `main`e gönderip `Logs CI and deploy` workflow'unu çalıştır. Her iki secret da boşsa önceki loopback kurulumu devam eder. Yalnız biri girilmişse deploy hata verir. İkisi varsa korumalı browser servisi eklenir. İkisini birden kaldırmak sonraki deploy'da browser servisini kapatır; mevcut Caddy route'u bu durumda 502 verir, VictoriaLogs açığa çıkmaz.

## Ortak Docker ağı

Browser servisi mevcut Caddy ile `databases_default` ağını kullanır. Workflow Caddy'nin bu ağ üzerinden browser servisine ulaşabildiğini doğrular. Farklı bir ağ/container/config yolu kullanıyorsan GitHub'da `Settings → Environments → logs-production → Environment variables` bölümündeki isteğe bağlı ayarları kullan; sunucudaki `.env` dosyasını elle düzenlemek gerekmez:

| Environment variable | Varsayılan / kullanım |
| --- | --- |
| `LOGS_PROXY_NETWORK` | Boşsa mevcut `.env` değeri veya `databases_default`. Caddy ile ortak, zaten mevcut Docker ağı. |
| `LOGS_CADDY_CONTAINER` | `caddy`. Mevcut ana Caddy container'ının adı. |
| `LOGS_CADDY_CONFIG_PATH` | Boş bırakılırsa container'ın `--config` argümanı veya `/etc/caddy/Caddyfile` otomatik bulunur. Gerekirse container içindeki mutlak yolu yaz. |

VictoriaLogs ve Vector kendi Compose ağlarında kalır; yalnız korumalı browser servisi ortak ağa eklenir.

Browser ayarları release içinde tutulur. Deploy başarısızsa önceki release'e dönüş, önceki kullanıcı adı/şifre hash'ini de geri getirir. Ana `.env` ve log volume'ları korunur.

## DNS

Cloudflare DNS'te `logs` adında A kaydı oluştur; önceki VPS adresin değişmediyse değer `187.126.24.87`. İlk kurulumda `DNS only` seç. HTTPS sertifikasını mevcut Caddy alır; sunucunun 80/443 portları mevcut Caddy'ye ulaşmalıdır.

## Otomatik Caddy kurulumu

`main`e güncel kodu gönderip `Logs CI and deploy → Run workflow` çalıştırman yeterli. SSH kullanıcısı mevcut kalıcı Caddyfile'a yazabilmeli; VPS'te Python 3 bulunmalı. Workflow mevcut container'ın persistent mount'unu bulur, auth/API/Typesense bloklarını koruyarak yalnız [log domain route'unu](../deploy/Caddyfile.example) ekler. Aynı route zaten varsa çoğaltmaz; başka bir servise giden mevcut log domain'ini sessizce değiştirmez.

Değişiklikten önce `/opt/logs-on-vps/caddy-backups/` altında dosya modu `600` olan yedek alınır. Dosyanın inode'u korunarak yazılır; tek dosya bind mount'unda da değişiklik görünür. Caddy doğrulaması ve reload başarısızsa eski dosya geri yazılıp tekrar yüklenir. Başka bir deployment aynı anda Caddyfile'ı değiştirmişse onun değişikliğinin üzerine yazılmaz ve workflow hata bildirir.

Ana Caddy'de şifre tutulmaz; giriş denetimi browser servisindedir. Caddy `--watch` veya `--resume` ile çalışıyorsa ya da config kalıcı bir mount'ta değilse workflow bu dosyayı değiştirmez. Standart mevcut Caddyfile kurulumu desteklenir.

## Giriş ve şifre değişikliği

[Log arayüzünü aç](https://logs.vefacaglar.com). Tarayıcı kullanıcı adı ve şifre isteyecek; GitHub'a girdiğin değerleri kullan. Doğru girişten sonra `/select/vmui/` arayüzüne yönlenirsin.

Şifreyi değiştirmek için `LOGS_UI_PASSWORD` secret'ını güncelle ve tekrar `Run workflow` çalıştır. Browser servisi yeni hash ile yeniden oluşturulur. Tarayıcı eski giriş bilgisini tutarsa gizli pencereyle dene. Eski release'e rollback eski hash'i de geri getirir.

Kurulumdan sonra Mac'te `curl -I https://logs.vefacaglar.com/select/vmui/` isteği girişsiz `401` dönmeli. Şifreli girişte arayüz açılmalı; `/metrics` gibi yönetim yolları girişten sonra bile `404` kalmalı. CI bu davranışları gerçek Caddy ve VictoriaLogs container'larıyla HTTP üzerinde test eder. Gerçek DNS/HTTPS sertifikası sunucudaki route etkinleşince doğrulanır.

Resmi kaynaklar: [Caddy basic_auth](https://caddyserver.com/docs/caddyfile/directives/basic_auth), [Caddy şifre hash'leme](https://caddyserver.com/docs/command-line#caddy-hash-password), [VictoriaLogs sorgu yetkisi](https://docs.victoriametrics.com/victorialogs/security-and-lb/#search-authorization).
