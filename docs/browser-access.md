# Tarayıcıdan şifreli log erişimi

Hedef adres `https://logs.vefacaglar.com`. Kurulum ve günlük kullanım için VPS'e elle bağlanman gerekmez. GitHub secret'larını ve DNS kaydını sen ayarlarsın; workflow mevcut Caddy route'unu otomatik ekleyip doğrular ve yeniden yükler.

Akış: tarayıcı → mevcut Caddy (HTTPS) → `browser` servisi (özel log konsolu ve oturum denetimi) → VictoriaLogs. Go servisi, gömülü HTML/CSS/JS arayüzünü sunar; Node veya frontend build sistemi gerekmez. Browser servisi oturum denetiminden sonra yalnız `/select/*` sorgu ve gelişmiş arayüz yollarını geçirir; `/insert`, `/delete`, `/metrics`, `/debug` gibi yollar yayınlanmaz. VictoriaLogs'un `9428` portu host üzerinde yalnız loopback'te kalır; browser servisinin host portu yoktur.

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

[Log arayüzünü aç](https://logs.vefacaglar.com). `/login` sayfasında GitHub secret'larına girdiğin kullanıcı adı ve şifreyi kullan. Doğru girişten sonra `/` adresindeki özel log konsolu açılır. Tarayıcının Basic Auth penceresi artık kullanılmaz; mevcut secret'ları değiştirmek gerekmez.

Konsol vefacaglar.com'un siyah, Fira Code ve keskin köşeli tasarımını kullanır. Font dosyası yerelden sunulur; üçüncü taraf font isteği yoktur. Servis ve seviye filtreleri, LogsQL filtre alanı, zaman aralıkları, satır içinde alan detayları, kopyalama ve yüklenmiş kayıtları JSONL olarak indirme bulunur. `gelişmiş sorgu` bağlantısı VictoriaLogs'un mevcut arayüzünü aynı oturumla açar; pipeline sorguları burada çalıştırılır.

Kayıtlar 100'er yüklenir. Aşağı kaydırmak veya `daha eski kayıtlar` düğmesine basmak sonraki sayfayı getirir. Başlangıç/bitiş zamanı sayfalar arasında sabit kalır; `yenile` yeni bir zaman aralığı açar. Eşit zaman damgaları stream ve mesaj ile sıralanır. Geç gelen geçmiş logların depoya eklenmesi veya retention silmeleri sırasında offset sayfalama gerçek bir veritabanı snapshot'ı değildir; tam aktarım garantisi vermez. Otomatik yenileme 5 saniyede bir çalışır; eski sayfalara geçildiğinde, bir log detayı açıkken veya sekme arka plandayken bekler. Sorgu başına 20 saniye ve geçmişte 1.000.000 offset sınırı vardır; çok geniş aralıkları daralt.

Oturum çerezi `Secure`, `HttpOnly`, `SameSite=Strict` ve `__Host-` öneki kullanır; 12 saat sonra sona erer. Oturumlar bellekte tutulur, servis yeniden başladığında yeniden giriş gerekir. Çıkış oturumu sunucuda iptal eder. Giriş denemeleri dakikada altı istekle ve tek eşzamanlı bcrypt doğrulamasıyla sınırlıdır. Giriş, çıkış ve özel API POST istekleri aynı Origin ve özel istek başlığı gerektirir. Kullanıcı adı/şifre ve loglar tarayıcı depolamasına yazılmaz.

Şifreyi değiştirmek için `LOGS_UI_PASSWORD` secret'ını güncelle ve tekrar `Run workflow` çalıştır. Browser servisi yeni hash ile yeniden oluşturulur, eski oturumlar sona erer. Eski release'e rollback eski hash'i de geri getirir.

Kurulumdan sonra Mac'te `curl -s -o /dev/null -w '%{http_code}\n' https://logs.vefacaglar.com/` isteği girişsiz `303` ile `/login` sayfasına yönlenmeli; `/api/session` ve sorgu API'leri girişsiz `401` dönmeli. Giriş sayfası `200` dönmeli; `/metrics` gibi yönetim yolları girişten sonra bile `404` kalmalı. CI oturum korumasını Go testleriyle, arayüz/proxy davranışlarını gerçek Caddy ve VictoriaLogs container'larıyla test eder. Gerçek DNS/HTTPS sertifikası sunucudaki route etkinleşince doğrulanır.

Yerel geliştirme: `cd browser && go test -race ./...` çalıştır. `LOGS_UI_USERNAME` ve bcrypt `LOGS_UI_PASSWORD_HASH` ile `go run .` servisi başlatır. Yalnız HTTP yerel testleri için `LOGS_INSECURE_COOKIE=1` kullanılabilir; üretim Compose dosyası bu ayarı içermez. İsteğe bağlı `LOGS_LISTEN` ve `VICTORIALOGS_URL` yerel portları ayarlar. Docker varsa `RUN_BROWSER_TEST=1 python3 -m unittest discover -s tests -p 'test_browser.py' -v` gerçek container kontrolünü çalıştırır.

Resmi kaynaklar: [Caddy şifre hash'leme](https://caddyserver.com/docs/command-line#caddy-hash-password), [VictoriaLogs sorgu API'si](https://docs.victoriametrics.com/victorialogs/querying/), [VictoriaLogs sorgu yetkisi](https://docs.victoriametrics.com/victorialogs/security-and-lb/#search-authorization).
