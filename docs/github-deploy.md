# GitHub Actions ile VPS kurulumu

Bu rehber `.github/workflows/logs.yml` ile birebir eşleşir. GitHub repo/environment/DNS ayarlarını ve VPS hazırlığını sen yaparsın. Workflow dosyaları projede hazırdır; henüz commit, push veya sunucu deployment'ı yapılmadı.

## GitHub repo ve Environment

Projeyi GitHub'daki kendi `logs-on-vps` repo'na koy. Ana dal `main` olmalı. Repo'da `Settings → Actions → General` altında GitHub Actions çalışmasına ve `actions/checkout` kullanılmasına izin verildiğini kontrol et. Varsayılan `Read repository contents` izni yeterlidir.

`Settings → Environments → New environment` yolundan **`logs-production`** oluştur. `Deployment branches and tags` bölümünde `Selected branches and tags` seçip `main` dalını ekle. Hesabında seçenek varsa `Required reviewers` ile manuel onay ekleyebilirsin; workflow bunu zorunlu tutmaz.

Private repo'da Environment kullanımı GitHub planına bağlıdır. Menü görünmüyorsa [GitHub'ın Environment erişim koşullarına](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) bak.

## Environment secrets

`Settings → Environments → logs-production → Environment secrets → Add environment secret` yolunda şunları ekle. Diğer repo'lardaki aynı adlı Environment secret'ları bu repo'ya kendiliğinden taşınmaz.

| Secret | Değer |
| --- | --- |
| `VPS_HOST` | VPS IP'si veya DNS adı. Önceki VPS adresin değişmediyse `187.126.24.87`. `https://` veya port ekleme. |
| `VPS_USER` | SSH kullanıcısı. Mevcut kurulumdaki örnek `root`. |
| `VPS_SSH_KEY` | Bu sunucuya erişebilen, parolasız SSH private key'in **tam içeriği**. Başlangıç/bitiş satırları dahil. `.pub` dosyası değil. |
| `VPS_KNOWN_HOSTS` | Doğrulanmış SSH host key satırı/satırları. Aşağıdaki adımlarla hazırlanır; yalnız fingerprint yazılmaz. |
| `VPS_PORT` | İsteğe bağlı SSH portu. Eklenmezse `22`. |

SSH parola ile giriş bu workflow'da desteklenmez. Repo, registry PAT'i, GHCR login'i, `AUTH_ENV`, API/DB/Typesense secret'ları gerekmez; resmi public image'lar çekilir. `GITHUB_TOKEN` GitHub tarafından sağlanır, elle eklenmez.

## Deploy anahtarı

Mac'te bu repo'ya özel bir anahtar oluştur:

```sh
ssh-keygen -t ed25519 -C 'github-actions-logs-on-vps' -f ~/.ssh/logs_on_vps_actions -N ''
```

Public key'i mevcut SSH bağlantınla VPS'e ekle. IP/kullanıcı/anahtar yolu değiştiyse komutu güncelle:

```sh
cat ~/.ssh/logs_on_vps_actions.pub | ssh -i ~/.ssh/hostinger_vps root@187.126.24.87 \
  'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys'
```

Bağlantıyı test et:

```sh
ssh -i ~/.ssh/logs_on_vps_actions -o IdentitiesOnly=yes root@187.126.24.87 'docker compose version'
```

Private key'i terminale yazdırmadan panoya al, `VPS_SSH_KEY` secret'ına yapıştır:

```sh
pbcopy < ~/.ssh/logs_on_vps_actions
```

Bu anahtar GitHub repo erişimi için değil, VPS SSH erişimi içindir; `Settings → Deploy keys` bölümüne eklenmez. Private key'i repo'ya veya sohbete koyma. Docker yetkisi olan bu SSH kullanıcısı sunucuyu yönetebilir.

## SSH host key doğrulama

VPS'in güvendiğin konsolunda veya doğrulanmış mevcut SSH oturumunda sunucu fingerprint'ini gör:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Mac'te host key'i al ve fingerprint'i karşılaştır:

```sh
ssh-keyscan -p 22 -t ed25519 187.126.24.87 > /tmp/logs-vps-known-hosts
ssh-keygen -lf /tmp/logs-vps-known-hosts
```

İki fingerprint aynıysa satırı panoya alıp `VPS_KNOWN_HOSTS` secret'ına yapıştır:

```sh
pbcopy < /tmp/logs-vps-known-hosts
```

Port farklıysa hem `ssh-keyscan -p` hem `VPS_PORT` değerini değiştir. Workflow SSH host doğrulamasını kapatmaz. Host key değişirse secret'ı yeni fingerprint'i doğruladıktan sonra güncelle.

## Variables

Önce `Settings → Secrets and variables → Actions → Variables → New repository variable` altında şunu ekle:

| Repository variable | Değer |
| --- | --- |
| `LOGS_DEPLOY_ENABLED` | Deploy'a hazır olduğunda `true`. Eksik veya başka değerdeyse yalnız CI çalışır. |

Bu değişken **repository** seviyesinde olmalı; deploy job'unun başlaması Environment değişkenleri yüklenmeden önce değerlendirilir.

İsteğe bağlı olarak `Settings → Environments → logs-production → Environment variables` altında `VPS_DEPLOY_DIR` tanımlayabilirsin. Varsayılan `/opt/logs-on-vps`. Yol mutlak olmalı; harf, sayı, `_`, `-` ve `/` kullanabilir. SSH kullanıcısının bu dizini oluşturma/yazma yetkisi olmalı.

## VPS hazırlığı ve runtime ayarları

VPS'te Docker Engine, Compose v2+, Bash, `tar`, `curl` ve `flock` gerekir. Mevcut Docker daemon'ı kullanılmalı; ayrıca Docker kurulumu yapma. GitHub runner'ının SSH portuna bağlanabilmesi gerekir. SSH kullanıcısı Docker komutlarını etkileşimsiz, `sudo` istemeden çalıştırabilmeli.

Sunucuda kontrol et:

```sh
docker info >/dev/null
docker compose version
command -v bash tar curl flock
```

İlk deploy'da `/opt/logs-on-vps/.env`, örnek değerlerle otomatik oluşturulur. Sonraki deploy'lar bu dosyayı değiştirmez. Önceden ayarlamak istersen VPS'te:

```sh
mkdir -p /opt/logs-on-vps
umask 077
cat > /opt/logs-on-vps/.env <<'ENV'
VPS_LOG_HOST=vefa-vps
LOG_HTTP_PORT=9428
LOG_RETENTION=14d
LOG_DISK_BUDGET=10GiB
LOG_MEMORY_LIMIT=768m
LOG_CPU_LIMIT=1.0
VECTOR_MEMORY_LIMIT=256m
VECTOR_CPU_LIMIT=0.5
DOCKER_SOCKET_PATH=/var/run/docker.sock
ENV
```

Bu dosya zaten varsa üzerine yazma; `nano /opt/logs-on-vps/.env` ile düzenle. Farklı `VPS_DEPLOY_DIR` seçtiysen yolları değiştir. `.env` GitHub'a yüklenmez. Uygulamalar stdout/stderr'e yazmaya devam eder; network veya uygulama secret'ı aktarılmaz.

## İlk çalıştırma ve sonraki deploy'lar

Secret'ları ve Environment'ı hazırladıktan sonra repository variable `LOGS_DEPLOY_ENABLED=true` olsun. GitHub'da `Actions → Logs CI and deploy → Run workflow` üzerinden `main` seçerek çalıştır. Workflow'un bu menüde görünmesi için dosyanın önce default branch'e push edilmiş olması gerekir.

PR'larda yalnız kontrol ve geçici Docker log testi çalışır. `main` push'ları ve `main` üzerinde manuel çalıştırmalar, kontroller geçince `logs-production` üzerinden deploy eder. Başka dalda manuel çalıştırma deploy etmez. Varsa Environment onayını GitHub'da sen verirsin.

Her deploy dosyaları `releases/<commit>-<run>-<attempt>/` altına yükler. Kalıcı `.env` ortak kalır. Sağlık ve gerçek Docker log testi geçince `current` symlink'i yeni release'e alınır. Docker volume adları sabittir; release dizini değiştiğinde log verisi korunur. Mevcut Caddy, DNS ve uygulama servisleri değiştirilmez. Bu akışı kullanırken aynı Compose projesine paralel olarak eski rsync dizininden deploy yapma.

## Hata ve geri dönüş

Deploy başarısızsa workflow kırmızı olur. Önceki başarılı release varsa otomatik tekrar başlatılmaya çalışılır; ilk yönetilen deploy'da geri dönülecek release yoktur. Rollback de başarısızsa workflow bunu açıkça yazar. Veri volume'ları geri sarılmaz; sürüm düşürürken VictoriaLogs veri uyumluluğunu ayrıca değerlendir.

VPS'te son başarılı release'in durumunu incele:

```sh
cd /opt/logs-on-vps/current
docker compose ps
docker compose logs --tail=100
```

İlk deploy hiç başarılı olmadıysa `current` bulunmaz; başarısız run'ın logunda yazan `releases/<id>` dizinine gir. Runtime ayarını değiştirdikten sonra yeniden `Run workflow` kullanabilir veya VPS'te başarılı release'ten `./scripts/start.sh` çalıştırabilirsin. Manuel yeniden başlatma GitHub Environment onayından geçmez. Eski koda dönmek için GitHub'da ilgili değişikliği revert edip `main`e gönder; normal doğrulama/deploy akışı çalışır.

Arayüz için Mac'te `ssh -i ~/.ssh/hostinger_vps -N -L 9428:127.0.0.1:9428 root@187.126.24.87` tünelini açık tut ve [VictoriaLogs'u aç](http://localhost:9428/select/vmui/). Runtime portunu değiştirdiysen tünelin sağ tarafını güncelle.

Resmi kaynaklar: [Environment yönetimi](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments), [Environment secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), [configuration variables](https://docs.github.com/en/actions/learn-github-actions/variables).
