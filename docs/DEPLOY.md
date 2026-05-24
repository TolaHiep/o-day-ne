# Triển khai Ở Đây Nè — production checklist

Tài liệu này ghi lại quy trình đưa **Ở Đây Nè** lên một VPS thật cho người
dùng cuối. Stack đơn giản: 1 container Docker chạy cả web tier + API tier,
SQLite gắn vào named volume, TLS do reverse proxy bên ngoài lo (Caddy hoặc
Cloudflare Tunnel).

> Sao lưu DB là phần dễ bị bỏ quên nhất — hãy đọc kỹ phần `4. Sao lưu` rồi mới
> mở public.

---

## 0. Điều kiện cần

- VPS Linux (Ubuntu 22.04+ / Debian 12 — bất kỳ host nào chạy Docker đều OK)
- Docker Engine ≥ 24 + Docker Compose plugin
- Một tên miền trỏ về IP VPS (hoặc Cloudflare Tunnel nếu không có IP public)
- Tài khoản Google Cloud (cho OAuth thật) — tùy chọn nhưng khuyến nghị

Cài Docker xong: kiểm tra `docker compose version` không lỗi.

---

## 1. Lấy mã nguồn + cấu hình env

```bash
git clone https://github.com/<you>/o-day-ne.git
cd o-day-ne
cp .env.example .env
```

Sửa `.env`:

| Biến | Production value | Ghi chú |
| --- | --- | --- |
| `PUBLIC_URL` | `https://odayne.vn` | Domain thật. Khóa CORS + CSP. |
| `PORT` | `4174` | Giữ nguyên — reverse proxy sẽ chuyển 443 → 4174. |
| `BIND_HOST` | `0.0.0.0` | Bắt buộc khi chạy trong container. |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | … | Bật OAuth thật. Để trống → app chạy chế độ demo. |
| `ALLOW_DEMO_AUTH` | `false` | Sau khi OAuth thật chạy, tắt demo provider. |
| `ADMIN_TOKEN` | `openssl rand -hex 32` | Cho phép ops chạm `/api/admin/*` không cần login. Cất kỹ. |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | … | Bật Cloudinary signed upload. Để trống → ảnh lưu local trong volume. Xem mục 3C. |
| `CLOUDINARY_UPLOAD_FOLDER` | `odayne/rooms` | Folder trong Cloudinary account để gom ảnh. |
| `BACKUP_INTERVAL_MIN` | `360` | 6 giờ một lần. Giảm nếu tin phòng rất sôi động. |
| `BACKUP_KEEP` | `10` | Đủ rollback 2.5 ngày nếu kết hợp với 4.2. |

`.env` đã có trong `.gitignore` — đừng commit.

---

## 2. Cấu hình Google OAuth (khuyến nghị)

1. <https://console.cloud.google.com/> → tạo project mới hoặc dùng project hiện có.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://odayne.vn`
   - Authorized redirect URIs: `https://odayne.vn/`
3. Sao client ID + client secret vào `.env`.
4. Đặt `GOOGLE_REDIRECT_URI=https://odayne.vn/` (slash cuối — khớp với URI đăng ký).
5. Đặt `ALLOW_DEMO_AUTH=false` để tắt đường demo.

App sẽ tự đổi nút "Đăng nhập" trong popup sang "Tiếp tục với Google (thật)"
khi cả 3 biến trên đều có giá trị.

---

## 3. TLS / reverse proxy

Container chỉ phục vụ HTTP `:4174`. TLS phải do tầng phía trên đảm nhiệm.
Hai cách phổ biến — chọn 1:

### 3A. Caddy (đơn giản nhất, có cert tự động)

```caddy
# /etc/caddy/Caddyfile
odayne.vn {
    encode zstd gzip
    reverse_proxy 127.0.0.1:4174
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        # CSP đã được app tự gửi, header này chỉ ép HSTS ở edge.
    }
}
```

`sudo systemctl reload caddy` xong là có HTTPS. Caddy tự xin Let's Encrypt cert.

### 3B. Cloudflare Tunnel (khi VPS không có IP public)

```bash
cloudflared tunnel create odayne
cloudflared tunnel route dns odayne odayne.vn
```

Tạo `~/.cloudflared/config.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: odayne.vn
    service: http://localhost:4174
  - service: http_status:404
```

Chạy `cloudflared tunnel run odayne` (hoặc cài systemd unit). Cloudflare
tự cấp TLS, app vẫn nghe HTTP nội bộ.

> Lưu ý: `cloudflared.exe` trong repo (Windows binary) chỉ dành cho dev máy
> Windows; trên VPS Linux dùng package `cloudflared` của Debian/Ubuntu.

---

## 3C. Upload ảnh — local hay Cloudinary?

App hỗ trợ 2 backend lưu ảnh, chọn 1 cho production:

### Cách A — Lưu cục bộ (default, không cần config)

Ảnh ghi vào volume `odn-data` tại `/app/backend/data/uploads/`. Đơn giản,
ops trong tầm tay, nhưng tốn bandwidth VPS mỗi request hiển thị + cần
rsync để DR.

→ Bỏ trống các biến `CLOUDINARY_*` và xong.

### Cách B — Cloudinary signed upload (khuyến nghị khi public ra user thật)

Lý do nên đổi:
- File đi thẳng từ browser → edge Cloudinary, không qua VPS bạn
- Auto convert HEIC iPhone sang JPEG/WebP (hiện local đang reject HEIC)
- `f_auto`, `q_auto` trả WebP cho Chrome, AVIF cho Safari, JPEG fallback
- CDN toàn cầu (edge Singapore + nhiều site khác)
- Free tier 25 GB storage + 25 GB bandwidth/tháng — đủ ~12k ảnh phòng

Setup 4 bước:

1. Tạo tài khoản tại <https://cloudinary.com/users/register/free>
2. Dashboard → copy 3 giá trị:
   - `Cloud Name`
   - `API Key`
   - `API Secret`
3. Settings → Upload → Upload presets → tạo preset (optional, hoặc dùng
   default). Settings → Security → bật "Restricted media types" nếu muốn
   chỉ accept image format. Có thể bỏ qua, signed upload đã enforce qua
   `allowed_formats` của chúng ta.
4. Điền vào `.env`:

   ```bash
   CLOUDINARY_CLOUD_NAME=<cloud-name>
   CLOUDINARY_API_KEY=<key>
   CLOUDINARY_API_SECRET=<secret>
   CLOUDINARY_UPLOAD_FOLDER=odayne/rooms
   ```

5. `docker compose up -d --build`. Kiểm tra:

   ```bash
   curl -fsS https://odayne.vn/api/health
   # Expect: "uploads":"cloudinary:<cloud-name>"
   ```

Sau khi bật, frontend tự gọi `/api/uploads/config` → thấy provider
Cloudinary → chuyển toàn bộ upload sang signed-multipart đi thẳng tới
Cloudinary. File cũ ở `backend/data/uploads/` không bị mất (URL vẫn
hoạt động vì backend còn route `/uploads/:name`), tin mới sẽ có URL
`https://res.cloudinary.com/<cloud>/image/upload/...`.

Quan trọng:
- `CLOUDINARY_API_SECRET` là bí mật — đừng commit. Treat như password.
- Khi cập nhật code, không cần redeploy Cloudinary — config sống ở
  console của họ.
- Free tier limit reset đầu tháng. Set up email alert ở dashboard nếu
  có nguy cơ vượt.

### Chuyển từ A → B sau

Đổi lúc nào cũng được — chỉ điền env rồi restart. Ảnh cũ tiếp tục
phục vụ từ local. Muốn migration toàn bộ về Cloudinary thì viết
script đẩy ảnh local lên rồi update `images_json` trong SQLite (tham
khảo `docs/DEPLOY.md` mục 9 cho schema).

---

## 4. Sao lưu (phần quan trọng nhất)

### 4.1 Backup tự động trong container

Backup loop tự chạy nếu `BACKUP_INTERVAL_MIN > 0`, viết snapshot vào
`/app/backend/data/backups/db-<timestamp>.sqlite` (nằm trong volume
`odn-data`). `BACKUP_KEEP` giới hạn số snapshot.

Trigger thủ công khi cần (vd trước migration):

```bash
docker exec o-day-ne node backend/scripts/db.mjs backup
# hoặc qua API (cần ADMIN_TOKEN):
curl -X POST -H "X-Admin-Token: $ADMIN_TOKEN" https://odayne.vn/api/admin/backup
```

### 4.2 Sao lưu **ra ngoài máy** (bắt buộc cho production)

Snapshot trong cùng volume không bảo vệ được khi VPS chết. Sync ra storage
khác. Một crontab đơn giản trên host:

```cron
# /etc/cron.d/odayne-backup
15 */6 * * * root \
  docker exec o-day-ne node backend/scripts/db.mjs backup >/dev/null && \
  rsync -az --delete \
    /var/lib/docker/volumes/odn-data/_data/backups/ \
    backup@nas.local:/backups/odayne/db/ && \
  rsync -az --delete \
    /var/lib/docker/volumes/odn-data/_data/uploads/ \
    backup@nas.local:/backups/odayne/uploads/
```

`uploads/` cũng phải sync — file ảnh KHÔNG nằm trong snapshot SQLite,
chỉ có URL trỏ tới chúng được lưu trong bảng `rooms.images_json`. Mất
uploads = ảnh phòng vỡ.

Hoặc sync lên S3/B2:

```bash
aws s3 sync \
  /var/lib/docker/volumes/odn-data/_data/backups/ \
  s3://my-bucket/odayne/db/ --delete
aws s3 sync \
  /var/lib/docker/volumes/odn-data/_data/uploads/ \
  s3://my-bucket/odayne/uploads/ --delete
```

### 4.3 Restore (DR)

```bash
# Trên máy mới hoặc khi DB hỏng:
docker compose down
docker volume create odn-data
# Copy file backup vào volume:
docker run --rm -v odn-data:/data -v $PWD:/host alpine \
  cp /host/db-2026-05-21T08-00-00.sqlite /data/db.sqlite
docker compose up -d
```

Hoặc dùng CLI (yêu cầu app dừng):

```bash
docker compose down
node backend/scripts/db.mjs restore /path/to/db-2026-05-21T08-00-00.sqlite
docker compose up -d
```

CLI tự tạo snapshot an toàn trước khi ghi đè, rollback dễ.

### 4.4 Vacuum định kỳ

SQLite không cần vacuum thường xuyên, nhưng sau lần xoá hàng loạt (vd
admin xoá nhiều tin spam) thì gọn file rõ rệt:

```bash
docker compose down
node backend/scripts/db.mjs vacuum
docker compose up -d
```

---

## 5. Khởi chạy

```bash
docker compose up -d --build
# Đợi ~15s cho healthcheck đầu tiên:
docker compose ps
# Test:
curl -fsS https://odayne.vn/healthz       # → "ok"
curl -fsS https://odayne.vn/api/health    # → {"ok":true,...}
```

Truy cập `https://odayne.vn` — landing thẳng vào stack quẹt với 18 phòng
seed nếu DB trống.

---

## 6. Quy trình cập nhật

```bash
cd /opt/o-day-ne
git pull
docker compose build
node backend/scripts/db.mjs backup    # snapshot trước khi đổi
docker compose up -d
docker compose logs -f --tail=100 # quan sát 1–2 phút
```

Nếu lỗi: `docker compose down` rồi restore snapshot phía 4.3.

---

## 7. Quan sát + log

```bash
# Tail log API + web:
docker compose logs -f --tail=200

# Lọc lỗi:
docker compose logs --since 1h 2>&1 | grep '"level":"error"'

# Healthcheck status:
docker inspect --format '{{.State.Health.Status}}' o-day-ne
```

API log là JSON dòng (`logEvent`). Nuốt vào Loki / Datadog / Grafana Cloud
nếu cần dashboard.

---

## 8. Hardening checklist trước khi mở cho người dùng thật

- [ ] `ALLOW_DEMO_AUTH=false` — đã tắt demo provider sau khi OAuth chạy
- [ ] `ADMIN_TOKEN` đã sinh ngẫu nhiên (≥ 32 hex), cất vault, không gõ trong shell history
- [ ] Domain trỏ về IP đúng, certificate xanh
- [ ] Backup off-machine đã chạy ít nhất 1 chu kỳ (verify file đến đích)
- [ ] Thử restore từ backup vào VPS staging — phục hồi được
- [ ] Admin email seeded (`admin@odayne.local` mặc định) đã đổi sang email
      bạn kiểm soát qua login thật, hoặc đã đổi `is_admin` trong DB
- [ ] `docker compose logs` không có `error` lặp lại
- [ ] Healthcheck container = `healthy` sau 1 phút chạy
- [ ] `curl https://odayne.vn/api/rooms` trả `ok: true`

---

## 9. Câu hỏi hay gặp

**Tại sao SQLite, không phải Postgres?**
Một file, không có process riêng, backup là copy file, restore là copy ngược.
Với quy mô vài chục nghìn phòng + vài trăm nghìn swipe/ngày, SQLite WAL chịu
được dễ dàng. Khi nào ghi > 1k req/s mới cần Postgres.

**App có cần Redis cho session/rate-limit không?**
Không. Session lưu trong bảng `sessions` của SQLite (có index). Rate-limit
trong RAM tiến trình (mất khi restart, chấp nhận được — bucket sẽ tạo lại).
Nâng cấp Redis chỉ khi nào chạy nhiều replica.

**Migration schema khi đổi cấu trúc bảng?**
Schema hiện tại dùng `CREATE TABLE IF NOT EXISTS` + index `IF NOT EXISTS`,
khá an toàn để thêm bảng / index mới. Khi đổi cột (rename / drop), thêm
một block migration mới trong `backend/src/storage.mjs` đọc `schema_meta` →
nếu version cũ thì chạy `ALTER TABLE` rồi bump version. Đừng quên backup
trước.

**Upload ảnh trực tiếp?**
Đã có. Form đăng phòng cung cấp 3 đường: tải từ thư viện (file picker /
iOS Photos), chụp trực tiếp bằng camera điện thoại (`capture="environment"`),
và dán URL https. File được POST raw lên `/api/uploads` (whitelist
JPG/PNG/WebP/GIF/AVIF, max 8 MB, magic-byte sniff để chặn fake MIME) rồi
lưu vào `backend/data/uploads/` với tên `<random-hex>.<ext>`. Web tier
proxy `/uploads/*` về API nên tất cả qua một volume duy nhất.

**File upload quá lớn / quá chậm?**
Tăng `UPLOAD_MAX_BYTES` trong `backend/src/api.mjs` (mặc định 8 MB). Lưu
ý: backup snapshot bao gồm cả DB metadata chứ không phải file ảnh. File
ảnh sống ở `backend/data/uploads/` — sync chúng cùng cron rsync với
`backups/` ở mục 4.2.
