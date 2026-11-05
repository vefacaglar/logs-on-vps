# VPS log merkezi

VictoriaLogs logları saklar; Vector aynı Docker daemon'ındaki container'ların stdout/stderr loglarını otomatik toplar. Mevcut authserver-go, vefacaglar-site API ve worker Compose dosyaları `json-file` kullandığından uygulama koduna veya Docker network'lerine ekleme gerekmez. Yeni container'lar ve blue/green sürümler otomatik keşfedilir.

GitHub üzerinden otomatik deploy için [Environment, secret ve VPS hazırlık rehberi](docs/github-deploy.md) hazır. Aşağıdaki rsync kurulumu manuel alternatiftir.

## VPS'e gönderme

Mac'te, `VPS_SSH` yerine mevcut SSH alias'ını veya `kullanici@sunucu` adresini yaz:

```sh
cd /Users/vefa/Projects/logs-on-vps
rsync -av --exclude='.git' --exclude='.env' ./ VPS_SSH:~/logs-on-vps/
```

VPS'te Docker Engine, Compose v2+ ve `curl` gerekir. Docker komutlarını çalıştırabilen kullanıcıyla:

```sh
cd ~/logs-on-vps
cp -n .env.example .env
./scripts/start.sh
```

Script sabit sürümlü image'ları çeker, Vector ayarlarını ve JSON dönüşümlerini doğrular, servisleri başlatır, gerçek bir geçici Docker container'ından yazılan logları sorgular. Probe container'ı test sonunda silinir. Sonraki güncellemelerde dosyaları tekrar gönderip aynı script'i çalıştır; `.env` ve veri volume'ları korunur. Yeni ayarları uygulamak için her çalıştırmada iki servis de yeniden oluşturulur; kısa bir log toplama aralığı oluşabilir.

## Arayüz

Sunucuya bağlanmadan `https://logs.vefacaglar.com` üzerinden kullanıcı adı ve şifreyle erişim için [GitHub secrets ve HTTPS kurulumunu](docs/browser-access.md) uygula.

Domain özel log konsolunu açar: vefacaglar.com ile aynı siyah/monospace tasarım, sayfa içi giriş, servis/seviye/zaman filtreleri ve aşağı kaydırarak eski kayıtları yükleme. Gelişmiş LogsQL sorguları için konsoldaki `gelişmiş sorgu` bağlantısı VictoriaLogs arayüzünü açar. Mevcut kullanıcı adı ve şifre secret'ları geçerlidir; yeni servis ilk güncellemede VPS'te derlenir.

Mac'te ayrı terminalde tüneli açık tut:

```sh
ssh -N -L 9428:127.0.0.1:9428 VPS_SSH
```

[VictoriaLogs arayüzünü aç](http://localhost:9428/select/vmui/). `LOG_HTTP_PORT` değişirse tünelin sağ tarafındaki portu da değiştir. VictoriaLogs yalnızca VPS'in `127.0.0.1` adresine yayınlanır. Tünel, domain erişiminin alternatifidir.

## Uygulamalar

Uygulamalar normal logger'larıyla stdout/stderr'e yazmaya devam eder. JSON loglarda `msg` veya `message` metin olarak, uygulamanın diğer alanları `app.*` altında saklanır. Pino sayısal seviyeleri ve slog seviyeleri `level` alanında normalize edilir. Container kimliği ve Compose etiketleri uygulama JSON'u tarafından değiştirilemez. Düz metin logları da toplanır.

Arayüzde örnek sorgular:

```text
_time:1h compose_service:authserver
_time:1h compose_service:api
_time:1h compose_service:worker level:error
_time:1h app.request_id:="req-42"
```

Yalnız dosyaya yazılan loglar, host systemd servisleri ve başka makinelerdeki uygulamalar bu kurulumun kapsamına girmez. Caddy/Postgres container'ları stdout/stderr'e yazıyorsa onlar da toplanır. VictoriaLogs ve Vector kendi loglarını döngü oluşturmamak için toplamaz; bunlara `docker compose logs` ile bakılır. Mevcut Typesense log aktarımı varsa bu kurulum onu kapatmaz.

## Kaynaklar ve işletim

`.env` isteğe bağlıdır. Varsayılan saklama süresi 14 gün, VictoriaLogs bellek tavanı 768 MiB, Vector bellek tavanı 256 MiB'dir; iş yüküne göre ayarlanabilir. `LOG_DISK_BUDGET=10GiB` eski günlük bölümleri sildiren yumuşak eşiktir, kesin disk kotası değildir: en az son iki gün tutulur ve eşik aşılabilir. Diskte boş alan bırak. Vector gönderilemeyen loglar için kalıcı volume'da 512 MiB kuyruk tutar.

Docker kaynağı kalıcı okuma checkpoint'i tutmaz. Vector kapalıyken oluşan loglar yeniden başlangıçta eksik kalabilir; kaynak tam kayıpsızlık garantisi vermez. Disk kuyruğu yalnız Vector'ün zaten aldığı logları korur. Docker'ın kendi log rotasyonunu mevcut uygulamalarda açık tut.

Vector Docker API erişimi için socket bağlar. `:ro` mount Docker API'yi salt okunur yapmaz; bu container'a Docker yetkisi verir. Socket'i TCP üzerinden yayınlama. Rootless Docker kullanıyorsan `.env` içindeki `DOCKER_SOCKET_PATH` değerini güncelle.

```sh
docker compose ps
docker compose logs --tail=100 vector
./scripts/smoke-test.sh
docker compose stop
docker compose start
```

`docker compose down` veriyi korur. `docker compose down -v` kalıcı logları ve gönderim kuyruğunu siler.

Resmi kaynaklar: [VictoriaLogs + Vector](https://docs.victoriametrics.com/victorialogs/data-ingestion/vector/), [Docker log kaynağı](https://vector.dev/docs/reference/configuration/sources/docker_logs/), [saklama ve disk eşiği](https://docs.victoriametrics.com/victorialogs/#retention-by-disk-space-usage).
