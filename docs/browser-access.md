# Tarayıcıdan şifreli log erişimi

Hedef adres `https://logs.vefacaglar.com`. Günlük kullanımda SSH bağlantısı veya tünel gerekmez. Bir defalık DNS ve mevcut Caddy route ayarı aşağıdadır.

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

Browser servisi mevcut Caddy ile `databases_default` ağını kullanır. VPS'te Caddy'nin ağını kontrol et:

```sh
docker inspect caddy --format '{{json .NetworkSettings.Networks}}'
```

Farklı bir ağ kullanıyorsan `/opt/logs-on-vps/.env` içindeki `LOGS_PROXY_NETWORK` değerini o ağın adıyla ayarla ve yeniden deploy et. Bu ağın mevcut olması gerekir. VictoriaLogs ve Vector kendi Compose ağlarında kalır; yalnız korumalı browser servisi ortak ağa eklenir.

Browser ayarları release içinde tutulur. Deploy başarısızsa önceki release'e dönüş, önceki kullanıcı adı/şifre hash'ini de geri getirir. Ana `.env` ve log volume'ları korunur.

## DNS

Cloudflare DNS'te `logs` adında A kaydı oluştur; önceki VPS adresin değişmediyse değer `187.126.24.87`. İlk kurulumda `DNS only` seç. HTTPS sertifikasını mevcut Caddy alır; sunucunun 80/443 portları mevcut Caddy'ye ulaşmalıdır.

## Mevcut Caddy route'u

Bu adım bir defalıktır. Şifre ana Caddyfile'a yazılmaz; giriş denetimi browser servisinde yapılır. Mevcut auth/API/Typesense bloklarını koru. `logs.vefacaglar.com` zaten tanımlıysa aynı domain için ikinci blok ekleme.

VPS'te mevcut dosyanın yedeğini al:

```sh
cp /opt/databases/Caddyfile /opt/databases/Caddyfile.before-logs
```

[Örnek route](../deploy/Caddyfile.example) içindeki bloğu mevcut dosyanın sonuna bir kez ekle. Aşağıdaki append işlemi mevcut dosyanın inode'unu korur; tek dosya bind mount kullanan Caddy'de de değişiklik görünür:

```sh
cat >> /opt/databases/Caddyfile <<'CADDY'

logs.vefacaglar.com {
    reverse_proxy logs-on-vps-browser:8080
}
CADDY
```

Önce doğrula, başarılıysa yeniden yükle:

```sh
docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && \
docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Container veya Caddyfile yolun farklıysa bu komutları mevcut kurulumuna göre değiştir. Doğrulama başarısızsa yedeği `cat /opt/databases/Caddyfile.before-logs > /opt/databases/Caddyfile` ile geri yaz; hatalı ayarla reload yapma.

## Giriş ve şifre değişikliği

[Log arayüzünü aç](https://logs.vefacaglar.com). Tarayıcı kullanıcı adı ve şifre isteyecek; GitHub'a girdiğin değerleri kullan. Doğru girişten sonra `/select/vmui/` arayüzüne yönlenirsin.

Şifreyi değiştirmek için `LOGS_UI_PASSWORD` secret'ını güncelle ve tekrar `Run workflow` çalıştır. Browser servisi yeni hash ile yeniden oluşturulur. Tarayıcı eski giriş bilgisini tutarsa gizli pencereyle dene. Eski release'e rollback eski hash'i de geri getirir.

Kurulumdan sonra Mac'te `curl -I https://logs.vefacaglar.com/select/vmui/` isteği girişsiz `401` dönmeli. Şifreli girişte arayüz açılmalı; `/metrics` gibi yönetim yolları girişten sonra bile `404` kalmalı. CI bu davranışları gerçek Caddy ve VictoriaLogs container'larıyla HTTP üzerinde test eder. Gerçek DNS/HTTPS sertifikası sunucudaki route etkinleşince doğrulanır.

Resmi kaynaklar: [Caddy basic_auth](https://caddyserver.com/docs/caddyfile/directives/basic_auth), [Caddy şifre hash'leme](https://caddyserver.com/docs/command-line#caddy-hash-password), [VictoriaLogs sorgu yetkisi](https://docs.victoriametrics.com/victorialogs/security-and-lb/#search-authorization).
